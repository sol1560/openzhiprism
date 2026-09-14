import { describe, expect, it } from "vitest";
import type { InterestTopic } from "@/db/schema";
import { decayScore, mergeTopics, topicsMatch } from "@/lib/profile/merge";

const DAY = 24 * 60 * 60 * 1000;

function topic(overrides: Partial<InterestTopic>): InterestTopic {
  const now = new Date();
  return {
    id: "t1",
    userId: "u",
    name: "考研 vs 就业",
    weight: 1,
    rawScore: 10,
    hits: 2,
    keywords: ["考研"],
    questions: [],
    evidence: [],
    searchQueries: ["考研还是直接工作"],
    controversial: true,
    stance: null,
    stanceLabel: null,
    source: "conversation",
    lastSeenAt: now,
    createdAt: now,
    ...overrides,
  };
}

describe("decayScore", () => {
  it("14 天半衰期", () => {
    const now = new Date();
    expect(decayScore(10, now, now)).toBeCloseTo(10);
    expect(decayScore(10, new Date(now.getTime() - 14 * DAY), now)).toBeCloseTo(5);
    expect(decayScore(10, new Date(now.getTime() - 28 * DAY), now)).toBeCloseTo(2.5);
  });
});

describe("topicsMatch", () => {
  it("同名、包含、词典同源、相似都算匹配", () => {
    expect(topicsMatch("考研 vs 就业", "考研vs就业")).toBe(true);
    expect(topicsMatch("考研还是直接工作", "考研 vs 就业")).toBe(true); // 词典同源
    expect(topicsMatch("量子计算入门", "量子")).toBe(false); // 非词典话题，过短的包含不算
    expect(topicsMatch("手冲咖啡入门", "手冲咖啡")).toBe(true);
    expect(topicsMatch("手冲咖啡", "公路车骑行")).toBe(false);
  });
});

describe("mergeTopics", () => {
  it("累积同名话题、新建新话题、归一化权重", () => {
    const now = new Date();
    const existing = [topic({ rawScore: 10, lastSeenAt: new Date(now.getTime() - 14 * DAY) })];
    const merged = mergeTopics(
      existing,
      [
        { name: "考研vs就业", keywords: ["读研"], questions: ["要不要考"], evidence: ["e"], depth: 3, mentions: 2, stance: "pro", stanceLabel: "倾向考研", controversial: true, searchQueries: ["为什么建议考研"] },
        { name: "手冲咖啡", keywords: ["V60"], questions: [], evidence: [], depth: 1, mentions: 1, stance: "unknown", controversial: false, searchQueries: ["手冲咖啡 入门"] },
      ],
      "conversation",
      now,
    );
    expect(merged).toHaveLength(2);
    const kaoyan = merged.find((item) => item.id === "t1")!;
    expect(kaoyan.rawScore).toBeCloseTo(5 + 6); // 衰减后 5 + 新增 2×3
    expect(kaoyan.hits).toBe(4);
    expect(kaoyan.keywords).toEqual(expect.arrayContaining(["考研", "读研"]));
    expect(kaoyan.stance).toBe("pro");
    expect(kaoyan.stanceLabel).toBe("倾向考研");
    expect(kaoyan.weight).toBe(1);
    const coffee = merged.find((item) => item.name === "手冲咖啡")!;
    expect(coffee.id).toBeUndefined();
    expect(coffee.weight).toBeCloseTo(1 / 11, 3);
    expect(merged[0].weight).toBeGreaterThanOrEqual(merged[1].weight);
  });

  it("不同来源合并后标记为 mixed", () => {
    const merged = mergeTopics(
      [topic({ source: "zhihu_follow" })],
      [{ name: "考研 vs 就业", keywords: [], questions: [], evidence: [], depth: 1, mentions: 1, stance: "unknown", controversial: true, searchQueries: [] }],
      "conversation",
    );
    expect(merged[0].source).toBe("mixed");
  });
});
