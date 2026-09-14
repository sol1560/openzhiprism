import { describe, expect, it } from "vitest";
import { HISTORY_BOOST, applyHistoryBoost, buildHistoryReason, historyFactor, pinTopics } from "@/lib/feed/select";
import type { TopicEngagement } from "@/lib/feed/types";

function engagement(topicName: string, pushed: number, opened: number, extra: Partial<TopicEngagement> = {}): TopicEngagement {
  return { topicName, topicId: null, pushed, opened, openRate: pushed ? opened / pushed : 0, lastPushedDate: null, lastOpenedDate: null, ...extra };
}

describe("historyFactor", () => {
  it("推了 5 条一条没点 → 最低 0.6", () => {
    expect(historyFactor(engagement("a", 5, 0))).toEqual({ factor: HISTORY_BOOST.min, kind: "damped" });
  });
  it("打开率 100% → 最高 1.4", () => {
    expect(historyFactor(engagement("a", 6, 6))).toEqual({ factor: HISTORY_BOOST.max, kind: "boosted" });
  });
  it("打开率正好在基线 25% → 中性 1.0", () => {
    expect(historyFactor(engagement("a", 8, 2)).factor).toBeCloseTo(1, 6);
    expect(historyFactor(engagement("a", 8, 2)).kind).toBe("neutral");
  });
  it("样本少时向 1 收缩：1 推 0 点 ≈ 0.92", () => {
    expect(historyFactor(engagement("a", 1, 0)).factor).toBeCloseTo(0.92, 6);
  });
  it("从未推送过 → 探索系数 1.1", () => {
    expect(historyFactor(undefined)).toEqual({ factor: HISTORY_BOOST.explore, kind: "explore" });
    expect(historyFactor(engagement("a", 0, 0)).kind).toBe("explore");
  });
});

describe("applyHistoryBoost", () => {
  it("保留 baseWeight，按系数缩放 weight", () => {
    const topics = [{ name: "a", weight: 1 }, { name: "b", weight: 0.5 }];
    const result = applyHistoryBoost(topics, [engagement("a", 5, 0)]);
    expect(result[0]).toMatchObject({ name: "a", baseWeight: 1, weight: 0.6, historyKind: "damped" });
    expect(result[1]).toMatchObject({ name: "b", baseWeight: 0.5, weight: 0.55, historyKind: "explore" });
  });
});

describe("pinTopics", () => {
  const topics = Array.from({ length: 8 }, (_, index) => ({ name: `t${index}`, weight: 1 - index * 0.1 }));
  it("把第 7 名的连续话题抬进前 6，其它话题不变", () => {
    const pinned = pinTopics(topics, ["t6"]);
    const top = [...pinned].sort((a, b) => b.weight - a.weight).slice(0, 6).map((topic) => topic.name);
    expect(top).toContain("t6");
    expect(pinned.find((topic) => topic.name === "t0")?.weight).toBe(1);
    expect(topics[6].weight).toBeCloseTo(0.4, 6);
  });
  it("已在前 6 或不存在的话题不动", () => {
    expect(pinTopics(topics, ["t0", "nope"])).toEqual(topics);
  });
});

describe("buildHistoryReason", () => {
  const topic = { name: "考研 vs 就业", evidence: ["在纠结要不要二战"] };
  it("昨天点开过 → 接着看", () => {
    expect(buildHistoryReason(topic, engagement("x", 3, 1, { lastOpenedDate: "2026-09-13" }), "2026-09-14", 14))
      .toBe("昨天你点开了「考研 vs 就业」的内容，今天接着看：在纠结要不要二战");
  });
  it("窗口内打开 ≥ 2 → 多放一点", () => {
    expect(buildHistoryReason({ name: "远程办公", evidence: [] }, engagement("x", 4, 2), "2026-09-14", 14))
      .toBe("最近 14 天你打开了「远程办公」的 2 条，今天多放一点");
  });
  it("推了 5 条没点 → 少放一点", () => {
    expect(buildHistoryReason({ name: "远程办公", evidence: [] }, engagement("x", 5, 0), "2026-09-14", 14))
      .toBe("「远程办公」推了 5 条你都没点，今天少放一点");
  });
  it("无历史或无可说的 → null", () => {
    expect(buildHistoryReason(topic, undefined, "2026-09-14", 14)).toBeNull();
    expect(buildHistoryReason(topic, engagement("x", 2, 1), "2026-09-14", 14)).toBeNull();
  });
});
