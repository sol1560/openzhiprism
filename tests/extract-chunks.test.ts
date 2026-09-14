import { describe, expect, it } from "vitest";
import { chunkConversations, mergeExtracted, sanitizeInterests } from "@/lib/ingest/extract";
import { conversationsToText, type ParsedConversation } from "@/lib/ingest/parse";
import type { ExtractedTopic } from "@/lib/llm/prompts";

const topic = (overrides: Partial<ExtractedTopic>): ExtractedTopic => ({
  name: "模型蒸馏", keywords: ["蒸馏"], questions: [], evidence: ["想了解蒸馏"], depth: 2, mentions: 1, stance: "unknown", controversial: false, searchQueries: ["模型蒸馏 原理"], ...overrides,
});
const conversation = (title: string, count: number, size = 200): ParsedConversation => ({
  title, messages: Array.from({ length: count }, (_, i) => ({ role: "user" as const, content: `${title} 第 ${i} 条 ` + "字".repeat(size) })),
});

describe("chunked extraction", () => {
  it("packs conversations into chunks under the limit and splits an oversized conversation by message", () => {
    const chunks = chunkConversations([conversation("A", 3), conversation("B", 3), conversation("C", 30)], 1_500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(conversationsToText(chunk, Number.MAX_SAFE_INTEGER).length).toBeLessThanOrEqual(1_500);
    const titles = chunks.flatMap((chunk) => chunk.map((item) => item.title));
    expect(titles.filter((title) => title === "C").length).toBeGreaterThan(1);
    const total = chunks.flat().reduce((sum, item) => sum + item.messages.length, 0);
    expect(total).toBe(36);
  });
  it("keeps a short input in a single chunk", () => {
    expect(chunkConversations([conversation("A", 2, 20)])).toHaveLength(1);
  });
  it("merges same-name topics across chunks: mentions add up, depth takes the max, lists concatenate", () => {
    const merged = mergeExtracted([
      { topics: [topic({ mentions: 2, depth: 2, keywords: ["蒸馏"] }), topic({ name: "IGCSE 物理", searchQueries: ["IGCSE 物理 备考"] })], redactedCategories: ["财务"] },
      { topics: [topic({ name: "模型蒸馏 ", mentions: 3, depth: 4, keywords: ["知识蒸馏"], stance: "pro", stanceLabel: "倾向自己蒸馏" })], redactedCategories: ["财务", "身份信息"] },
    ]);
    expect(merged.topics.map((item) => item.name)).toEqual(["模型蒸馏", "IGCSE 物理"]);
    const distill = merged.topics[0];
    expect(distill.mentions).toBe(5); expect(distill.depth).toBe(4); expect(distill.stance).toBe("pro");
    expect(distill.keywords).toEqual(["蒸馏", "知识蒸馏"]);
    const clean = sanitizeInterests(merged);
    expect(clean.redactedCategories).toEqual(["财务", "身份信息"]);
    expect(clean.topics[0].evidence).toEqual(["想了解蒸馏"]);
  });
});
