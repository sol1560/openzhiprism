import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, databaseUrl } from "@/db";
import { getDossier, startDossier } from "@/lib/cognition/dossiers";
import { isLlmLive } from "@/lib/llm/client";
import { todayKey } from "@/lib/zhihu/text";
import type { DossierView, TopicDossier } from "@/lib/cognition/types";

interface QaResult {
  topic: string; jobId: string; status: DossierView["status"]; quality?: TopicDossier["quality"]; model?: string | null;
  sources: number; evidence: number; dimensions: number; providers: string[]; quoteMatches: boolean | null;
  durationMs: number; error: string | null; dossier: TopicDossier | null;
}

async function main() {
  if (!databaseUrl().startsWith("file:/private/tmp/zhiprism-cognition-qa/")) throw new Error("QA 只能使用指定的独立临时数据库");
  if (!isLlmLive()) throw new Error("此验收脚本要求真实模型配置；离线回归请使用 tests/cognition-*.test.ts");
  const database = await db();
  const [user] = await database.select().from(schema.users).where(eq(schema.users.email, "evidence-qa@example.com"));
  if (!user) throw new Error("先在隔离服务中登录 evidence-qa@example.com");
  const retrying = process.argv.includes("--retry-failed");
  const previous = retrying ? JSON.parse(await readFile("/private/tmp/zhiprism-cognition-qa/evidence/five-topics.json", "utf8")) as QaResult[] : [];
  const topics = retrying ? previous.filter((r) => r.quality !== "grounded" || r.quoteMatches !== true).map((r) => r.topic) : process.argv.includes("--all") ? ["AI 会取代程序员吗", "考研还是就业", "转行产品经理", "回老家还是留在大城市", "主动回忆与反复阅读"] : ["考研还是就业"];
  const report: QaResult[] = [];
  for (const topic of topics) {
    const at = Date.now(); const job = await startDossier(user.id, { topic, refresh: !retrying }); await job.promise;
    const view = await getDossier(user.id, job.jobId);
    const validated = view.dossier?.evidence.length ? view.dossier.evidence.every((e) => { const source = view.dossier!.sources.find((s) => s.id === e.snapshotId); return source?.text.slice(e.start, e.end) === e.quote; }) : null;
    const result = { topic, jobId: job.jobId, status: view.status, quality: view.dossier?.quality, model: view.dossier?.model,
      sources: view.dossier?.sources.length ?? 0, evidence: view.dossier?.evidence.length ?? 0, dimensions: view.dossier?.dimensions.length ?? 0,
      providers: [...new Set(view.dossier?.sources.map((s) => s.provider))], quoteMatches: validated, durationMs: Date.now() - at, error: view.error };
    report.push({ ...result, dossier: view.dossier });
    console.log(JSON.stringify(result));
    await database.delete(schema.feedItems).where(and(eq(schema.feedItems.userId, user.id), eq(schema.feedItems.date, todayKey()), eq(schema.feedItems.topicName, topic), eq(schema.feedItems.reason, "隔离验收：用于核对原文、思辨与保存的真实来源")));
    for (const source of view.dossier?.sources.slice(0, 3) ?? []) {
      const [cached] = await database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, source.contentId));
      if (cached) await database.insert(schema.feedItems).values({ id: randomUUID(), userId: user.id, date: todayKey(), position: report.length * 10, kind: "main", contentId: source.contentId, topicName: topic, reason: "隔离验收：用于核对原文、思辨与保存的真实来源" });
    }
  }
  await mkdir("/private/tmp/zhiprism-cognition-qa/evidence", { recursive: true });
  const combined = retrying ? previous.map((old) => report.find((r) => r.topic === old.topic) ?? old) : report;
  await writeFile(`/private/tmp/zhiprism-cognition-qa/evidence/${!retrying && topics.length === 1 ? "single" : "five-topics"}.json`, JSON.stringify(combined, null, 2));
  if (report.some((r) => r.quality !== "grounded" || r.quoteMatches !== true)) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "QA failed"); process.exitCode = 1; });
