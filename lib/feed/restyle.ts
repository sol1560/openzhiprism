import { llmObject } from "@/lib/llm/client";
import { RESTYLE_SYSTEM, restylePrompt, restyleSchema } from "@/lib/llm/prompts";
import { truncate } from "@/lib/zhihu/text";

/**
 * 按用户的长期规则（例如「摘要都用三条要点」）重写一批摘要。
 * 结果只写到 feed_items.summary_override（按用户），共享的 content_cache.summary 不动。
 * LLM 不可用时返回空 Map：不改写比改坏好。
 */

const BATCH_SIZE = 4;
const BODY_CHARS = 1400;

export interface RestyleInput {
  id: string;
  title: string;
  summary: string;
  body: string;
}

export interface RestyleOutcome {
  summaries: Map<string, string>;
  live: boolean;
  model: string;
}

export async function restyleSummaries(items: RestyleInput[], rules: string[]): Promise<RestyleOutcome> {
  const summaries = new Map<string, string>();
  if (items.length === 0 || rules.length === 0) return { summaries, live: false, model: "none" };
  let live = false;
  let model = "rules";
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const result = await llmObject({
      schema: restyleSchema,
      system: RESTYLE_SYSTEM,
      prompt: restylePrompt(batch.map((item) => ({ id: item.id, title: item.title, summary: item.summary, text: truncate(item.body, BODY_CHARS) })), rules),
      fallback: () => ({ items: [] }),
      temperature: 0.3,
    });
    if (!result.live) continue;
    live = true;
    model = result.model;
    const returned = new Map(result.value.items.map((entry) => [entry.id.trim(), entry.summary.trim()]));
    for (const [index, item] of batch.entries()) {
      const byOrder = result.value.items.length === batch.length ? result.value.items[index]?.summary?.trim() : undefined;
      const summary = returned.get(item.id) || byOrder;
      if (summary) summaries.set(item.id, summary);
    }
  }
  return { summaries, live, model };
}
