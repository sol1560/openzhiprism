import { describe, expect, it } from "vitest";
import { allocateSlots, interleaveFeed, rankItems } from "@/lib/feed/select";
import type { ZhihuItem } from "@/lib/zhihu/types";

describe("allocateSlots", () => {
  it("先保证每个话题 1 条，剩余按权重分配，总数守恒", () => {
    const topics = [{ weight: 1 }, { weight: 0.5 }, { weight: 0.25 }];
    const slots = allocateSlots(topics, 12);
    expect(slots.reduce((sum, slot) => sum + slot.count, 0)).toBe(12);
    expect(slots[0].count).toBeGreaterThan(slots[1].count);
    expect(slots[1].count).toBeGreaterThan(slots[2].count);
    expect(slots.every((slot) => slot.count >= 1)).toBe(true);
  });

  it("最多取 maxTopics 个话题", () => {
    const topics = Array.from({ length: 10 }, (_, index) => ({ weight: 1 - index * 0.05 }));
    expect(allocateSlots(topics, 12, 6)).toHaveLength(6);
  });

  it("空画像返回空", () => {
    expect(allocateSlots([], 12)).toEqual([]);
  });
});

function item(id: string, voteUp: number, type: ZhihuItem["type"] = "answer"): ZhihuItem {
  return { id, type, title: id, excerpt: "", url: "", voteUp, commentCount: 0, provider: "fixture" };
}

describe("rankItems", () => {
  it("按赞同数排序并保持类型多样性", () => {
    const items = [item("a1", 900, "article"), item("a2", 800, "article"), item("a3", 700, "article"), item("b1", 10, "answer")];
    const picked = rankItems(items, 3);
    expect(picked.map((entry) => entry.id)).toEqual(["a1", "a2", "b1"]);
  });
});

describe("interleaveFeed", () => {
  it("话题轮转、每 4 条主内容后插 1 条轻松内容、视角卡紧跟宿主话题首条", () => {
    const result = interleaveFeed(
      [
        { topicName: "A", cards: ["A1", "A2", "A3"] },
        { topicName: "B", cards: ["B1", "B2"] },
        { topicName: "C", cards: ["C1"] },
      ],
      ["L1", "L2"],
      [{ topicName: "B", card: "P-B" }],
      4,
    );
    const sequence = result.map((card) => (card.kind === "main" ? card.payload : card.kind === "light" ? `[${card.payload}]` : `{${card.payload}}`));
    expect(sequence).toEqual(["A1", "B1", "{P-B}", "C1", "A2", "[L1]", "B2", "A3", "[L2]"]);
  });

  it("找不到宿主话题的视角卡与多余轻松内容放末尾", () => {
    const result = interleaveFeed([{ topicName: "A", cards: ["A1"] }], ["L1"], [{ topicName: "Z", card: "P-Z" }]);
    expect(result.map((card) => card.kind)).toEqual(["main", "perspective", "light"]);
  });
});
