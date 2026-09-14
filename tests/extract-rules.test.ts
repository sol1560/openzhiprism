import { describe, expect, it } from "vitest";
import { ruleBasedExtract, sanitizeInterests } from "@/lib/ingest/extract";
import type { ParsedConversation } from "@/lib/ingest/parse";

const conversations: ParsedConversation[] = [
  {
    title: "考研",
    messages: [
      { role: "user", content: "我倾向于考研，感觉研究生毕业起薪会高很多。帮我列一下考研的好处？" },
      { role: "assistant", content: "……" },
      { role: "user", content: "我还是想考，帮我找找支持考研的理由，我要说服我爸。" },
    ],
  },
  {
    title: "咖啡",
    messages: [{ role: "user", content: "想入坑手冲咖啡，V60 和 kalita 区别大吗？" }],
  },
];

describe("ruleBasedExtract", () => {
  it("按词典命中话题并推断立场", () => {
    const result = ruleBasedExtract(conversations);
    const names = result.topics.map((topic) => topic.name);
    expect(names).toContain("考研 vs 就业");
    expect(names).toContain("手冲咖啡");
    const kaoyan = result.topics.find((topic) => topic.name === "考研 vs 就业")!;
    expect(kaoyan.controversial).toBe(true);
    expect(kaoyan.stance).toBe("pro");
    expect(kaoyan.mentions).toBe(2);
    expect(kaoyan.searchQueries.length).toBeGreaterThan(0);
  });

  it("按 mentions × depth 排序", () => {
    const result = ruleBasedExtract(conversations);
    expect(result.topics[0].name).toBe("考研 vs 就业");
  });
});

describe("sanitizeInterests", () => {
  it("去重、裁剪并在 stance 为 unknown 时清空 stanceLabel", () => {
    const result = sanitizeInterests({
      topics: [
        {
          name: " 考研 ",
          keywords: ["a", "a", "b"],
          questions: [],
          evidence: ["x".repeat(100)],
          depth: 9,
          mentions: 0,
          stance: "unknown",
          stanceLabel: "不该出现",
          controversial: false,
          searchQueries: [],
        },
        { name: "考研", keywords: [], questions: [], evidence: [], depth: 1, mentions: 1, stance: "pro", controversial: true, searchQueries: ["q"] },
      ],
      redactedCategories: ["财务", "财务"],
    });
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].keywords).toEqual(["a", "b"]);
    expect(result.topics[0].depth).toBe(5);
    expect(result.topics[0].mentions).toBe(1);
    expect(result.topics[0].evidence[0]).toHaveLength(60);
    expect(result.topics[0].stanceLabel).toBeUndefined();
    expect(result.topics[0].searchQueries).toEqual(["考研"]);
    expect(result.redactedCategories).toEqual(["财务"]);
  });
});
