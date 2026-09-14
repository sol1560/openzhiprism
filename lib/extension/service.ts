import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { extensionResource } from "@/lib/connectors/oauth";
import { chunkConversations, extractInterests, mergeExtracted, type ExtractionOutcome } from "@/lib/ingest/extract";
import { redactText } from "@/lib/ingest/privacy";
import { conversationHash } from "@/lib/ingest";
import { applyExtractionInTransaction } from "@/lib/profile/store";
import { writeTransaction } from "@/lib/security/transaction";
import type { CaptureMessage, CapturePayload, CaptureView } from "./contract";

export const CAPTURE_LEASE_MS = 240_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const messageVersion = (message: CaptureMessage) => hash([message.role, message.content, message.attachments ?? []]);
type CaptureJob = typeof schema.captureJobs.$inferSelect;
export type CaptureDeps = { database?: Db; extract?: typeof extractInterests; now?: () => number };

function redactPayload(payload: CapturePayload) {
  let redactedCount = 0;
  const redact = (text: string) => { const result = redactText(text); redactedCount += result.total; return result.text; };
  const safe: CapturePayload = { ...payload, title: redact(payload.title), messages: payload.messages.map((m) => ({
    ...m, content: redact(m.content), attachments: (m.attachments ?? []).map(redact),
  })) };
  return { safe, redactedCount };
}

export async function createCapture(userId: string, grantId: string, payload: CapturePayload, deps: CaptureDeps = {}) {
  const database = deps.database ?? await db(), now = (deps.now ?? Date.now)();
  const { safe, redactedCount } = redactPayload(payload);
  const snapshotHash = hash(safe);
  return writeTransaction(database, async (tx) => {
    const where = and(eq(schema.captureJobs.userId, userId), eq(schema.captureJobs.platform, safe.platform),
      eq(schema.captureJobs.externalId, safe.externalId), eq(schema.captureJobs.snapshotHash, snapshotHash));
    const [existing] = await tx.select().from(schema.captureJobs).where(where);
    if (existing) {
      // Reauthorizing can resume the user's own capture under the new grant.
      await tx.update(schema.captureJobs).set({ grantId }).where(eq(schema.captureJobs.id, existing.id));
      if (existing.status === "ready") {
        await tx.update(schema.conversations).set({ title: safe.title, content: JSON.stringify(safe), messageCount: safe.messages.length,
          redactedCount, contentHash: conversationHash(safe), sourceUrl: safe.sourceUrl, capturedAt: now })
          .where(and(eq(schema.conversations.userId, userId), eq(schema.conversations.platform, safe.platform), eq(schema.conversations.externalId, safe.externalId)));
      }
      return existing.id;
    }
    const id = randomUUID();
    await tx.insert(schema.captureJobs).values({ id, userId, grantId, platform: safe.platform, externalId: safe.externalId,
      snapshotHash, payload: safe, redactedCount, createdAt: now, updatedAt: now });
    return id;
  });
}

export async function getCapture(userId: string, id: string, database = db(), now = Date.now()): Promise<CaptureView | null> {
  const connection = await database;
  const [job] = await connection.select().from(schema.captureJobs).where(and(eq(schema.captureJobs.id, id), eq(schema.captureJobs.userId, userId)));
  if (!job) return null;
  const [feed] = await connection.select().from(schema.captureFeedRefreshes).where(eq(schema.captureFeedRefreshes.userId, userId));
  const stale = job.status === "running" && (job.leaseExpiresAt ?? 0) <= now;
  return { id: job.id, status: stale ? "error" : job.status as CaptureView["status"], stage: stale ? "分析中断" : job.stage,
    error: stale ? "分析中断了，请重试。已完成的分块会保留。" : job.error, result: job.result,
    feedStatus: job.result?.profileUpdated && feed ? feed.status as CaptureView["feedStatus"] : null };
}

export async function retryCapture(userId: string, id: string, grantId: string, deps: CaptureDeps = {}) {
  const database = deps.database ?? await db(), now = (deps.now ?? Date.now)();
  return writeTransaction(database, async (tx) => {
    const [job] = await tx.select().from(schema.captureJobs).where(and(eq(schema.captureJobs.id, id), eq(schema.captureJobs.userId, userId)));
    if (!job) return false;
    if (job.status === "error" || (job.status === "running" && (job.leaseExpiresAt ?? 0) <= now)) {
      await tx.update(schema.captureJobs).set({ status: "queued", stage: "等待重试", error: null, grantId, updatedAt: now }).where(eq(schema.captureJobs.id, id));
    }
    if (job.status === "ready") await tx.update(schema.captureFeedRefreshes).set({ status: "pending", token: null, leaseExpiresAt: null })
      .where(and(eq(schema.captureFeedRefreshes.userId, userId), eq(schema.captureFeedRefreshes.status, "error")));
    return true;
  });
}

/** Processes at most four extraction chunks per invocation; large chats checkpoint and resume on polling. */
export async function runCapture(userId: string, id: string, deps: CaptureDeps = {}) {
  const database = deps.database ?? await db(), now = deps.now ?? Date.now, extract = deps.extract ?? extractInterests;
  const token = randomUUID();
  const job = await writeTransaction(database, async (tx) => {
    const [job] = await tx.select().from(schema.captureJobs).where(and(eq(schema.captureJobs.id, id), eq(schema.captureJobs.userId, userId)));
    if (!job || job.status !== "queued") return null;
    const [worker] = await tx.select().from(schema.captureWorkers).where(eq(schema.captureWorkers.userId, userId));
    if (worker && worker.expiresAt > now()) return null;
    await tx.insert(schema.captureWorkers).values({ userId, token, expiresAt: now() + CAPTURE_LEASE_MS })
      .onConflictDoUpdate({ target: schema.captureWorkers.userId, set: { token, expiresAt: now() + CAPTURE_LEASE_MS } });
    await tx.update(schema.captureJobs).set({ status: "running", stage: "正在分析兴趣", leaseToken: token,
      leaseExpiresAt: now() + CAPTURE_LEASE_MS, attempts: job.attempts + 1, updatedAt: now() }).where(eq(schema.captureJobs.id, id));
    return job;
  });
  if (!job) return;
  const ownsLease = and(eq(schema.captureJobs.id, id), eq(schema.captureJobs.leaseToken, token));
  try {
    const [archive] = await database.select().from(schema.conversations).where(and(eq(schema.conversations.userId, userId),
      eq(schema.conversations.platform, job.platform), eq(schema.conversations.externalId, job.externalId)));
    const previous = archive ? await database.select().from(schema.captureMessages).where(eq(schema.captureMessages.conversationId, archive.id)) : [];
    const seen = new Set(previous.map((m) => `${m.messageId}:${m.contentHash}`));
    const fresh = job.payload.messages.filter((m) => !seen.has(`${m.id}:${messageVersion(m)}`));
    const users = fresh.filter((m) => m.role === "user" && m.content.trim());
    const signature = hash(users.map((m) => [m.id, messageVersion(m)]));
    const checkpoint = job.checkpoint?.signature === signature ? job.checkpoint : { signature, cursor: 0, outcomes: [] as ExtractionOutcome[] };
    // Old turns appear only as explicitly marked context; rule extraction sees only new user messages.
    const messages = users.flatMap((m) => {
      const chars = Array.from(m.content), parts: Array<{ role: "user"; content: string }> = [];
      for (let i = 0; i < chars.length; i += 3500) parts.push({ role: "user", content: chars.slice(i, i + 3500).join("") });
      return parts;
    });
    const chunks = users.length ? chunkConversations([{ title: job.payload.title, messages }]) : [];
    const before = await database.select().from(schema.interestTopics).where(eq(schema.interestTopics.userId, userId));
    if (users.length && checkpoint.cursor < chunks.length) {
      const batch = chunks.slice(checkpoint.cursor, checkpoint.cursor + 4).flat();
      const freshUserIds = new Set(users.map((m) => m.id));
      const context = job.payload.messages.filter((m) => !freshUserIds.has(m.id)).slice(-6)
        .map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join("\n");
      const outcome = await extract(batch, before.map((t) => t.name), context);
      if (outcome.llm.error) throw new Error("extraction_failed");
      checkpoint.outcomes.push(outcome);
      checkpoint.cursor += Math.min(4, chunks.length - checkpoint.cursor);
      await database.update(schema.captureJobs).set({ checkpoint, updatedAt: now() }).where(ownsLease);
      if (checkpoint.cursor < chunks.length) {
        await database.update(schema.captureJobs).set({ status: "queued", stage: `已分析 ${checkpoint.cursor}/${chunks.length} 组`, leaseToken: null, leaseExpiresAt: null }).where(ownsLease);
        return;
      }
    }
    const interests = mergeExtracted(checkpoint.outcomes.map((o) => o.interests));
    await commitCapture(database, job, token, fresh, users.length, interests, checkpoint.outcomes, now());
  } catch {
    // Never persist or echo provider error text; it may contain prompts or credentials.
    await database.update(schema.captureJobs).set({ status: "error", stage: "分析失败", error: "兴趣分析暂时失败，请重试。画像尚未更新。", updatedAt: now() })
      .where(ownsLease).catch(() => undefined);
  } finally {
    await writeTransaction(database, async (tx) => {
      await tx.delete(schema.captureWorkers).where(and(eq(schema.captureWorkers.userId, userId), eq(schema.captureWorkers.token, token)));
    });
  }
}

async function commitCapture(database: Db, job: CaptureJob, token: string, fresh: CaptureMessage[], userCount: number,
  interests: ExtractionOutcome["interests"], outcomes: ExtractionOutcome[], now: number) {
  await writeTransaction(database, async (tx) => {
    const [worker] = await tx.select().from(schema.captureWorkers).where(eq(schema.captureWorkers.userId, job.userId));
    const [current] = await tx.select().from(schema.captureJobs).where(eq(schema.captureJobs.id, job.id));
    if (!worker || worker.token !== token || worker.expiresAt <= now || !current || current.leaseToken !== token) return;
    const [grant] = await tx.select().from(schema.connectorGrants).where(eq(schema.connectorGrants.id, current.grantId));
    if (!grant || grant.userId !== job.userId || grant.revokedAt !== null || grant.expiresAt <= now || grant.resource !== extensionResource()) throw new Error("revoked");
    const before = await tx.select().from(schema.interestTopics).where(eq(schema.interestTopics.userId, job.userId));
    const topics = interests.topics.length ? await applyExtractionInTransaction(tx, job.userId, interests, "conversation", new Date(now)) : before;
    const [archive] = await tx.select().from(schema.conversations).where(and(eq(schema.conversations.userId, job.userId),
      eq(schema.conversations.platform, job.platform), eq(schema.conversations.externalId, job.externalId)));
    const conversationId = archive?.id ?? randomUUID();
    const values = { userId: job.userId, source: "browser_extension", platform: job.platform, externalId: job.externalId,
      sourceUrl: job.payload.sourceUrl, title: job.payload.title, content: JSON.stringify(job.payload), messageCount: job.payload.messages.length,
      redactedCount: job.redactedCount, contentHash: conversationHash(job.payload), capturedAt: job.createdAt, processedAt: new Date(now) };
    if (!archive) await tx.insert(schema.conversations).values({ id: conversationId, ...values, createdAt: new Date(now) });
    else if ((archive.capturedAt ?? 0) <= job.createdAt) await tx.update(schema.conversations).set(values).where(eq(schema.conversations.id, conversationId));
    for (const m of fresh) await tx.insert(schema.captureMessages).values({ conversationId, messageId: m.id, contentHash: messageVersion(m) }).onConflictDoNothing();
    const profileUpdated = interests.topics.length > 0;
    if (profileUpdated) await tx.insert(schema.captureFeedRefreshes).values({ userId: job.userId })
      .onConflictDoUpdate({ target: schema.captureFeedRefreshes.userId,
        set: { revision: sql`${schema.captureFeedRefreshes.revision} + 1`, status: "pending" } });
    const result = { newMessageCount: fresh.length, newUserMessageCount: userCount, topicCount: topics.length,
      newTopicNames: topics.filter((t) => !before.some((b) => b.name === t.name)).map((t) => t.name),
      redactedCount: job.redactedCount, duplicate: fresh.length === 0, profileUpdated,
      llm: outcomes.length ? { provider: outcomes[0].llm.provider, model: outcomes[0].llm.model, live: outcomes.every((o) => o.llm.live) } : null };
    await tx.update(schema.captureJobs).set({ status: "ready", stage: fresh.length ? "已导入" : "无新增消息", result,
      checkpoint: null, error: null, leaseToken: null, leaseExpiresAt: null, updatedAt: now }).where(eq(schema.captureJobs.id, job.id));
    await tx.update(schema.connectorGrants).set({ lastUsedAt: now }).where(eq(schema.connectorGrants.id, grant.id));
  });
}
