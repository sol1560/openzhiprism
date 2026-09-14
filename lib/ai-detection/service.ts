import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, ne, or } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { writeTransaction, type WriteTx } from "@/lib/security/transaction";
import { claimGate } from "@/lib/security/gate";
import { findFixtureContent } from "@/lib/zhihu/fixture";
import { sourceValues } from "./source";
import { countWords, DETECTION_MODEL, estimateCents, PROCESSING_VERSION } from "./text";
import { PangramError, type PangramClient } from "./pangram";
import type { DetectionSummary, DetectionView } from "./types";

const DAY = 86400000;
const POLL_INTERVAL = 2500;
/** A stored task whose result we failed to read can be read again without paying for a new submission. */
const REPOLLABLE = new Set(["invalid_result", "task_missing"]);
function repollable(job: { status: string; taskId: string | null; errorCode: string | null }) {
  return job.status === "error" && Boolean(job.taskId) && REPOLLABLE.has(job.errorCode ?? "");
}
type Job = typeof schema.detectionJobs.$inferSelect;
type Source = typeof schema.contentCache.$inferSelect;
export interface DetectionConfig {
  enabled: boolean;
  configured: boolean;
  publicReady: boolean;
  perDay: number; perMinute: number; dailyCents: number; rollingCents: number;
}
export class DetectionError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
const messages: Record<string, string> = {
  provider_rate: "检测服务繁忙，请稍后查看。", provider_credits: "检测服务额度不足，暂时无法检测。",
  provider_auth: "检测服务配置暂不可用。", invalid_text: "检测服务无法分析这段文本，可能是有效文本不足。",
  provider_failed: "检测服务未能分析这段文本。", network: "检测服务连接暂时中断，稍后可继续查询。",
  task_missing: "检测任务已无法查询，请联系站点管理员。", invalid_result: "检测结果格式或正文不匹配，暂不展示分类。",
};
function message(code: string | null) { return code ? messages[code] ?? "检测服务暂时不可用。" : undefined; }
function versionWhere(content: Source) {
  return and(eq(schema.detectionJobs.contentId, content.contentId), eq(schema.detectionJobs.textHash, content.sourceHash ?? ""),
    eq(schema.detectionJobs.model, DETECTION_MODEL), eq(schema.detectionJobs.processingVersion, PROCESSING_VERSION), ne(schema.detectionJobs.status, "rejected"),
    // A submission that never reached the provider may be retried by the user; a task that exists is re-read instead.
    or(ne(schema.detectionJobs.status, "error"), isNotNull(schema.detectionJobs.taskId)));
}
export function jobSummary(job: Job, now = Date.now()): DetectionSummary {
  if (job.status === "submitting" && now - job.createdAt > 30000 || job.status === "submission_unknown") {
    return { status: "submission_unknown", message: "提交结果尚未确认。为避免重复扣费，系统不会重新提交，请联系站点管理员核对。" };
  }
  return {
    status: job.status === "submitting" ? "pending" : job.status === "rejected" ? "error" : job.status as DetectionSummary["status"],
    label: job.result?.label, checkedAt: job.checkedAt ? new Date(job.checkedAt).toISOString() : undefined,
    message: message(job.errorCode),
  };
}
function view(job: Job, now: number): DetectionView {
  return { ...jobSummary(job, now), contentId: job.contentId,
    source: { text: job.sourceText, hash: job.textHash, provider: job.sourceProvider, fetchedAt: job.sourceFetchedAt ? new Date(job.sourceFetchedAt).toISOString() : null, truncated: job.sourceTruncated },
    result: job.result ?? undefined, retryAfterMs: Math.max(POLL_INTERVAL, job.nextPollAt - now),
    retry: job.status !== "error" ? undefined : job.taskId ? (repollable(job) ? "poll" : undefined) : "submit",
  };
}
export function claimProviderSlot(tx: WriteTx, now: number): Promise<boolean> { return claimGate(tx, "pangram", 500, now); }
export function createDetectionService(database: Db, client: PangramClient, config: DetectionConfig, clock = Date.now) {
  async function source(userId: string, contentId: string): Promise<Source> {
    const [membership] = await database.select({ id: schema.feedItems.id }).from(schema.feedItems)
      .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.contentId, contentId))).limit(1);
    if (!membership) throw new DetectionError("not_found", 404, "当前推荐流中没有这条内容。");
    const [content] = await database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, contentId));
    if (!content || !["answer", "article"].includes(content.type)) throw new DetectionError("unsupported", 422, "这类内容暂不支持检测。");
    if (!content.sourceText && !content.sourceProvider) {
      const fixture = await findFixtureContent(contentId);
      if (fixture?.content) {
        await writeTransaction(database, async (tx) => {
          await tx.update(schema.contentCache).set(sourceValues(fixture))
            .where(and(eq(schema.contentCache.contentId, contentId), isNull(schema.contentCache.sourceProvider)));
        });
        const [updated] = await database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, contentId));
        return updated;
      }
    }
    return content;
  }
  function unavailable(content: Source): DetectionView | null {
    const base = { contentId: content.contentId, status: "unavailable" as const };
    if (!content.sourceText || !content.sourceHash) return { ...base, message: "暂无可检测原文。" };
    if (countWords(content.sourceText) < 50) return { ...base, message: "原文片段过短，有效文本不足，暂不检测。" };
    if (!config.enabled) return { ...base, message: "新检测暂未开放，已有结果仍可查看。" };
    if (!config.configured) return { ...base, message: "检测服务尚未配置。" };
    if (!config.publicReady) return { ...base, message: "登录方式尚未配置，付费检测暂未开放。" };
    return null;
  }
  async function readJob(content: Source) {
    const [job] = await database.select().from(schema.detectionJobs).where(versionWhere(content));
    return job;
  }
  return {
    async start(userId: string, contentId: string): Promise<DetectionView> {
      const content = await source(userId, contentId);
      const existing = await readJob(content);
      if (existing) return view(existing, clock());
      const disabled = unavailable(content);
      if (disabled) return disabled;
      const now = clock();
      const reservation = await writeTransaction(database, async (tx) => {
        const [existing] = await tx.select().from(schema.detectionJobs).where(versionWhere(content));
        if (existing) return { job: existing, submit: false };
        // An earlier attempt that never reached the provider is voided so the unique index accepts a fresh
        // submission; its reservation stays counted, so retries still consume the user's limits.
        await tx.update(schema.detectionJobs).set({ status: "rejected" }).where(and(
          eq(schema.detectionJobs.contentId, content.contentId), eq(schema.detectionJobs.textHash, content.sourceHash ?? ""),
          eq(schema.detectionJobs.model, DETECTION_MODEL), eq(schema.detectionJobs.processingVersion, PROCESSING_VERSION),
          eq(schema.detectionJobs.status, "error"), isNull(schema.detectionJobs.taskId)));
        const [identity] = await tx.select().from(schema.oauthIdentities).where(eq(schema.oauthIdentities.userId, userId)).limit(1);
        if (!identity) throw new DetectionError("verified_login_required", 403, "请使用邮箱或 Google 登录后检测。");
        // Recheck the exact source under the same write lock as the reservation.
        const [current] = await tx.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, contentId));
        if (current?.sourceHash !== content.sourceHash) throw new DetectionError("source_changed", 409, "原文已更新，请重新打开检测。");
        const dayStart = Math.floor(now / DAY) * DAY;
        const rows = await tx.select().from(schema.detectionReservations).where(gte(schema.detectionReservations.createdAt, now - 31 * DAY));
        const owned = rows.filter((row) => row.userId === userId);
        if (owned.filter((row) => row.createdAt >= dayStart).length >= config.perDay || owned.filter((row) => row.createdAt > now - 60000).length >= config.perMinute) {
          throw new DetectionError("user_limit", 429, "本账户的检测次数已达上限，请稍后再试。缓存结果仍可查看。");
        }
        const cents = estimateCents(content.sourceText!);
        const total = rows.reduce((sum, row) => sum + row.cents, 0);
        const daily = rows.filter((row) => row.createdAt >= dayStart).reduce((sum, row) => sum + row.cents, 0);
        if (total + cents > config.rollingCents || daily + cents > config.dailyCents) {
          throw new DetectionError("budget_limit", 429, "本站的检测预算已达上限，已有结果仍可查看。");
        }
        if (!await claimProviderSlot(tx, now)) throw new DetectionError("busy", 429, "检测服务繁忙，请稍后重试。");
        const job: Job = { id: randomUUID(), contentId, textHash: content.sourceHash!, model: DETECTION_MODEL,
          processingVersion: PROCESSING_VERSION, status: "submitting", taskId: null,
          sourceText: content.sourceText!, sourceProvider: content.sourceProvider ?? content.provider,
          sourceFetchedAt: content.sourceFetchedAt?.getTime() ?? null, sourceTruncated: content.sourceTruncated,
          result: null, errorCode: null, createdAt: now, checkedAt: null, nextPollAt: now + POLL_INTERVAL, pollLease: null };
        await tx.insert(schema.detectionJobs).values(job);
        await tx.insert(schema.detectionReservations).values({ jobId: job.id, userId, cents, createdAt: now });
        return { job, submit: true };
      });
      if (!reservation.submit) return view(reservation.job, now);
      let taskId: string;
      try { taskId = await client.submit(reservation.job.sourceText); }
      catch (error) {
        const failure = error instanceof PangramError ? error : new PangramError("network", true);
        const rejected = !failure.uncertain && ["invalid_text", "provider_auth", "provider_credits", "provider_rate"].includes(failure.code);
        const status = failure.uncertain ? "submission_unknown" : rejected ? "rejected" : "error";
        await writeTransaction(database, async (tx) => {
          await tx.update(schema.detectionJobs).set({ status, errorCode: failure.code }).where(eq(schema.detectionJobs.id, reservation.job.id));
          // Only explicit pre-processing rejections release estimated dollars; attempts stay counted.
          if (rejected) {
            await tx.update(schema.detectionReservations).set({ cents: 0 }).where(eq(schema.detectionReservations.jobId, reservation.job.id));
          }
        });
        return view({ ...reservation.job, status, errorCode: failure.code }, clock());
      }
      // If storage fails after submission, leave the existing reservation in place. Never resubmit.
      await writeTransaction(database, async (tx) => {
        await tx.update(schema.detectionJobs).set({ taskId, status: "pending" }).where(eq(schema.detectionJobs.id, reservation.job.id));
      });
      return view({ ...reservation.job, taskId, status: "pending" }, clock());
    },
    async get(userId: string, contentId: string): Promise<DetectionView> {
      const content = await source(userId, contentId);
      const job = await readJob(content);
      if (!job) return unavailable(content) ?? { contentId, status: "not_requested" };
      if ((job.status !== "pending" && !repollable(job)) || !job.taskId || !config.configured) return view(job, clock());
      const now = clock();
      const lease = randomUUID();
      const claimed = await writeTransaction(database, async (tx) => {
        const [current] = await tx.select().from(schema.detectionJobs).where(eq(schema.detectionJobs.id, job.id));
        if ((current.status !== "pending" && !repollable(current)) || current.nextPollAt > now) return false;
        if (!await claimProviderSlot(tx, now)) return false;
        await tx.update(schema.detectionJobs).set({ nextPollAt: now + 20000, pollLease: lease }).where(eq(schema.detectionJobs.id, job.id));
        return true;
      });
      if (!claimed) return view(await readJob(content) ?? job, clock());
      let patch: Partial<Job> = { nextPollAt: clock() + POLL_INTERVAL, pollLease: null, errorCode: null };
      try {
        const result = await client.poll(job.taskId, job.sourceText);
        if (result.stage === "ready") patch = { ...patch, status: "ready", result: result.result, checkedAt: clock() };
        if (result.stage === "failed") patch = { ...patch, status: "error", errorCode: result.code };
      } catch (error) {
        const code = error instanceof PangramError ? error.code : "network";
        patch.errorCode = code;
        patch.nextPollAt = clock() + 10000;
        if (["invalid_result", "task_missing"].includes(code)) patch.status = "error";
      }
      await writeTransaction(database, async (tx) => {
        await tx.update(schema.detectionJobs).set(patch).where(and(eq(schema.detectionJobs.id, job.id), eq(schema.detectionJobs.pollLease, lease)));
      });
      return view(await readJob(content) ?? job, clock());
    },
  };
}
