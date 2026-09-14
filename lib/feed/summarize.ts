import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { llmObject } from "@/lib/llm/client";
import { SUMMARY_SYSTEM, batchSummarySchema, summaryPrompt } from "@/lib/llm/prompts";
import { recallContent } from "@/lib/zhihu/provider";
import { truncate } from "@/lib/zhihu/text";
import type { ZhihuItem } from "@/lib/zhihu/types";

/**
 * 摘要：按 contentId 缓存在 content_cache.summary，跨用户复用；缺失的批量生成。
 */

const BATCH_SIZE = 4;
const BODY_CHARS = 1400;

/** 无 LLM 时的规则摘要：取正文前两句 */
export function ruleSummary(item: Pick<ZhihuItem, "excerpt" | "content" | "title">): string {
  const source = (item.content && item.content.length > 40 ? item.content : item.excerpt) || item.title;
  const sentences = source
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 6);
  const joined = sentences.slice(0, 2).join("");
  return truncate(joined || source, 120);
}

function bodyFor(item: ZhihuItem): string {
  const body = item.content ?? recallContent(item.id) ?? item.excerpt;
  return truncate(body, BODY_CHARS);
}

export interface SummaryOutcome {
  summaries: Map<string, string>;
  generated: number;
  cached: number;
  live: boolean;
  model: string;
}

export async function summarizeItems(items: ZhihuItem[]): Promise<SummaryOutcome> {
  const database = await db();
  const summaries = new Map<string, string>();
  if (items.length === 0) return { summaries, generated: 0, cached: 0, live: false, model: "none" };

  const rows = await database
    .select({ contentId: schema.contentCache.contentId, summary: schema.contentCache.summary })
    .from(schema.contentCache)
    .where(inArray(schema.contentCache.contentId, items.map((item) => item.id)));
  for (const row of rows) if (row.summary) summaries.set(row.contentId, row.summary);
  const cached = summaries.size;

  const missing = items.filter((item) => !summaries.has(item.id));
  let live = false;
  let model = "rules";
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const batch = missing.slice(start, start + BATCH_SIZE);
    const result = await llmObject({
      schema: batchSummarySchema,
      system: SUMMARY_SYSTEM,
      prompt: summaryPrompt(batch.map((item) => ({ id: item.id, title: item.title, text: bodyFor(item) }))),
      fallback: () => ({ items: batch.map((item) => ({ id: item.id, summary: ruleSummary(item) })) }),
      temperature: 0.3,
    });
    live = live || result.live;
    model = result.model;
    if (result.error) console.warn(`[summarize] 批次回退到规则摘要：${result.error.slice(0, 200)}`);
    const returned = new Map(result.value.items.map((entry) => [entry.id.trim(), entry.summary.trim()]));
    for (const [index, item] of batch.entries()) {
      // 模型偶尔改写 id（丢负号 / 前缀），按顺序位置兜底匹配
      const byOrder = result.value.items[index]?.summary?.trim();
      const summary = returned.get(item.id) || (result.value.items.length === batch.length ? byOrder : undefined) || ruleSummary(item);
      summaries.set(item.id, summary);
      await database
        .update(schema.contentCache)
        .set({ summary, summaryModel: result.live ? result.model : "rules" })
        .where(eq(schema.contentCache.contentId, item.id));
    }
  }
  return { summaries, generated: missing.length, cached, live, model };
}
