import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@/db";
import { writeTransaction } from "@/lib/security/transaction";
import { getArtifact, getDossier } from "./dossiers";
import { digest } from "./evidence";
import { CognitionError, reflectionDraftSchema, type ReflectionVersion, type ReflectionView } from "./types";

export const manageReflectionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), jobId: z.string(), dossierId: z.string(), inquiryId: z.string().optional(),
    reflectionId: z.string().optional(), expectedVersion: z.number().int().nonnegative().default(0), requestId: z.string().min(8).max(100),
    confirmed: z.literal(true), following: z.boolean().default(false), draft: reflectionDraftSchema }),
  z.object({ action: z.literal("follow"), reflectionId: z.string(), following: z.boolean(), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("delete"), reflectionId: z.string(), expectedVersion: z.number().int().positive(), confirmed: z.literal(true) }),
]);
export type ManageReflectionInput = z.infer<typeof manageReflectionSchema>;

export async function getReflections(userId: string, options: { id?: string; topic?: string } = {}, database?: Db): Promise<ReflectionView[]> {
  const d = database ?? await db();
  const rows = await d.select().from(schema.reflections).where(and(eq(schema.reflections.userId, userId), options.id ? eq(schema.reflections.id, options.id) : undefined)).orderBy(desc(schema.reflections.updatedAt));
  const selected = options.topic ? rows.filter((row) => row.topic.includes(options.topic!)) : rows;
  if (!selected.length) return [];
  const versions = await d.select().from(schema.reflectionVersions).where(inArray(schema.reflectionVersions.reflectionId, selected.map((r) => r.id)));
  return Promise.all(selected.map(async (row) => {
    const history = versions.filter((v) => v.reflectionId === row.id).map((v) => v.payload).sort((a, b) => b.version - a.version);
    let newSources: ReflectionView["newSources"] = [];
    if (row.following && history.length) {
      const [latest, previous] = await Promise.all([getDossier(userId, row.jobId, undefined, d), getArtifact(userId, row.jobId, history[0].dossierId, d)]);
      const old = new Set(previous.sources.map((s) => s.id));
      newSources = latest.dossier?.sources.filter((s) => !old.has(s.id)).map((s) => ({ id: s.id, title: s.title, url: s.url })) ?? [];
    }
    return { id: row.id, jobId: row.jobId, topic: row.topic, following: row.following, updatedAt: new Date(row.updatedAt).toISOString(), versions: history, newSources };
  }));
}
export async function reflectionForInquiry(userId: string, inquiryId: string, database: Db) {
  const [found] = await database.select({ id: schema.reflections.id }).from(schema.reflections)
    .innerJoin(schema.reflectionVersions, eq(schema.reflectionVersions.reflectionId, schema.reflections.id))
    .where(and(eq(schema.reflections.userId, userId), sql`json_extract(${schema.reflectionVersions.payload}, '$.inquiryId') = ${inquiryId}`)).limit(1);
  return found?.id;
}
function draftKey(draft: z.infer<typeof reflectionDraftSchema>) {
  return JSON.stringify([draft.judgment.trim(), draft.conditions, [...new Set(draft.evidenceIds)].sort(), draft.openQuestions, draft.nextStep ?? null]);
}
export async function manageReflection(userId: string, input: ManageReflectionInput, database?: Db) {
  const d = database ?? await db();
  if (input.action !== "save") {
    await writeTransaction(d, async (tx) => {
      const [row] = await tx.select().from(schema.reflections).where(and(eq(schema.reflections.userId, userId), eq(schema.reflections.id, input.reflectionId)));
      if (!row) throw new CognitionError("没有找到这条判断", 404);
      if (row.revision !== input.expectedVersion) throw new CognitionError("判断已有新版本，请刷新后重试", 409);
      if (input.action === "delete") await tx.delete(schema.reflections).where(eq(schema.reflections.id, row.id));
      else await tx.update(schema.reflections).set({ following: input.following, updatedAt: Date.now() }).where(eq(schema.reflections.id, row.id));
      await tx.delete(schema.dailyBriefs).where(eq(schema.dailyBriefs.userId, userId));
    });
    return { id: input.reflectionId, deleted: input.action === "delete" };
  }
  if (!input.draft.judgment.trim()) throw new CognitionError("请写下你愿意保存的判断，也可以明确写仍不确定");
  const dossier = await getArtifact(userId, input.jobId, input.dossierId, d);
  const allowed = new Set(dossier.evidence.map((e) => e.id));
  if (input.draft.evidenceIds.some((id) => !allowed.has(id))) throw new CognitionError("所选证据不属于当前版本");
  if (input.inquiryId) {
    const [inquiry] = await d.select().from(schema.inquiries).where(and(eq(schema.inquiries.id, input.inquiryId), eq(schema.inquiries.userId, userId)));
    if (!inquiry || inquiry.payload.jobId !== input.jobId || inquiry.payload.dossierId !== input.dossierId) throw new CognitionError("思辨与证据版本不匹配", 404);
  }
  const job = await getDossier(userId, input.jobId, input.dossierId, d);
  const existingInquiryReflection = input.inquiryId ? await reflectionForInquiry(userId, input.inquiryId, d) : undefined;
  const id = input.reflectionId ?? existingInquiryReflection ?? digest(`${userId}:reflection:${input.inquiryId ?? input.requestId}`);
  const inputHash = digest(JSON.stringify(input));
  const version = await writeTransaction(d, async (tx) => {
    const [old] = await tx.select().from(schema.reflections).where(eq(schema.reflections.id, id));
    if (old && old.userId !== userId) throw new CognitionError("没有找到这条判断", 404);
    const [replay] = await tx.select().from(schema.reflectionVersions).where(and(eq(schema.reflectionVersions.reflectionId, id), eq(schema.reflectionVersions.requestId, input.requestId)));
    if (replay) { if (replay.inputHash !== inputHash) throw new CognitionError("重试内容与原请求不同", 409); return replay.version; }
    if (old && input.inquiryId && input.expectedVersion === 0) {
      const [latest] = await tx.select().from(schema.reflectionVersions).where(and(eq(schema.reflectionVersions.reflectionId, id), eq(schema.reflectionVersions.version, old.revision)));
      if (latest && latest.payload.dossierId === input.dossierId && draftKey(latest.payload) === draftKey(input.draft)) return old.revision;
    }
    if ((old?.revision ?? 0) !== input.expectedVersion) throw new CognitionError("判断已有新版本，请刷新后继续", 409);
    if (old && old.jobId !== input.jobId) throw new CognitionError("不能把另一话题覆盖到这条判断", 409);
    const nextVersion = (old?.revision ?? 0) + 1;
    const payload: ReflectionVersion = { ...input.draft, judgment: input.draft.judgment.trim(), version: nextVersion,
      dossierId: input.dossierId, inquiryId: input.inquiryId ?? null, createdAt: new Date().toISOString() };
    if (!old) await tx.insert(schema.reflections).values({ id, userId, jobId: input.jobId, topic: job.topic, revision: nextVersion, following: input.following, updatedAt: Date.now() });
    else await tx.update(schema.reflections).set({ revision: nextVersion, following: input.following, updatedAt: Date.now() }).where(eq(schema.reflections.id, id));
    await tx.insert(schema.reflectionVersions).values({ reflectionId: id, version: nextVersion, requestId: input.requestId, inputHash, payload });
    await tx.delete(schema.dailyBriefs).where(eq(schema.dailyBriefs.userId, userId));
    return nextVersion;
  });
  return { id, version, deleted: false };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export async function reflectionExport(userId: string, id: string, format: "md" | "html", database?: Db) {
  const d = database ?? await db(); const [reflection] = await getReflections(userId, { id }, d);
  if (!reflection?.versions.length) throw new CognitionError("没有找到已确认的判断", 404);
  const version = reflection.versions[0];
  const dossier = await getArtifact(userId, reflection.jobId, version.dossierId, d);
  // Only confirmed judgment fields and public references; never inquiry turns/context/drafts.
  const citations = version.evidenceIds.flatMap((id) => {
    const evidence = dossier.evidence.find((e) => e.id === id); const source = dossier.sources.find((s) => s.id === evidence?.snapshotId);
    return evidence && source ? [{ quote: evidence.quote, title: source.title, url: source.url, author: source.author ?? "", at: source.fetchedAt }] : [];
  });
  const exportTopic = dossier.question;
  const lines = [`# ${exportTopic}`, `版本 ${version.version} · ${version.createdAt.slice(0, 10)}`, "## 我的判断", version.judgment,
    "## 成立条件", ...version.conditions.map((v) => `- ${v}`), "## 保留疑问", ...version.openQuestions.map((v) => `- ${v}`),
    ...(version.nextStep ? ["## 下一步", version.nextStep] : []), "## 采用的证据", ...citations.flatMap((c) => [`> ${c.quote.replace(/\n/g, "\n> ")}`, `${c.author} · [${c.title.replace(/[\[\]]/g, "")}](${c.url}) · 采集于 ${c.at.slice(0, 10)}`]),
    "仅反映作者确认的判断和所引用的来源片段，不代表社区共识。"];
  const markdown = lines.join("\n\n");
  if (format === "md") return markdown;
  const list = (title: string, values: string[]) => values.length ? `<section><h2>${title}</h2><ul>${values.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul></section>` : "";
  const references = citations.map((c) => `<article><blockquote>${escapeHtml(c.quote)}</blockquote><p><a href="${escapeHtml(c.url)}">${escapeHtml(c.author)} · ${escapeHtml(c.title)}</a><br>采集于 ${escapeHtml(c.at.slice(0, 10))}</p></article>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(exportTopic)}</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font:16px/1.8 system-ui;color:#20252b}p,blockquote,li{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:28px}h2{font-size:18px;margin-top:28px}blockquote{margin:16px 0;padding-left:16px;border-left:3px solid #b6c9da}a{color:#1750a3}article{break-inside:avoid}@media print{body{margin:0}a{color:inherit}}</style><main><h1>${escapeHtml(exportTopic)}</h1><p>版本 ${version.version} · ${escapeHtml(version.createdAt.slice(0, 10))}</p><h2>我的判断</h2><p>${escapeHtml(version.judgment)}</p>${list("成立条件", version.conditions)}${list("保留疑问", version.openQuestions)}${version.nextStep ? `<h2>下一步</h2><p>${escapeHtml(version.nextStep)}</p>` : ""}<h2>采用的证据</h2>${references}<p>仅反映作者确认的判断和所引用的来源片段，不代表社区共识。</p></main></html>`;
}
