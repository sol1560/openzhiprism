import { describe, expect, it } from "vitest";
import { BRIEF_LIMITS, reconcileBrief, ruleBrief, selectHighlightCandidates } from "@/lib/feed/brief";
import type { FeedCard, FeedView, HistorySignals } from "@/lib/feed/types";

const chars = (value: string) => [...value].length;

function card(id: string, kind: FeedCard["kind"], topic: string | null, title: string, voteUp = 100, seen = false): FeedCard {
  if (kind === "perspective") {
    return {
      id, kind, position: 0, topicName: topic, reason: "你在这个话题上 80% 都在看同一方", content: null, seen,
      perspective: { topicKey: "k", topicName: topic ?? "", question: `${topic}，到底该怎么选？`, userSide: "pro", userSideLabel: "先考研", exposureRatio: 0.8, counterSide: "con", stances: [], analysis: null, analysisModel: null, reason: "你在这个话题上 80% 都在看同一方" },
    };
  }
  return {
    id, kind, position: 0, topicName: topic, reason: `因为你最近在聊「${topic ?? "热榜"}」`, perspective: null, seen,
    content: { id: `answer:${id}`, type: "answer", title, summary: `${title} 的摘要`, excerpt: "", url: `https://www.zhihu.com/${id}`, voteUp, commentCount: 0, provider: "fixture" },
  };
}

function feedOf(cards: FeedCard[]): FeedView {
  return { userId: "u", date: "2026-09-14", run: null, cards: cards.map((item, index) => ({ ...item, position: index + 1 })) };
}

const emptyHistory: HistorySignals = {
  date: "2026-09-14", windowDays: 14, topics: [], recentOpened: [], yesterday: null, streakDays: 0, feedDays: 0, totalPushed: 0, totalOpened: 0, continuityTopics: [], openedPerspectiveTopics: [],
};
const richHistory: HistorySignals = {
  ...emptyHistory,
  topics: [{ topicName: "远程办公", topicId: null, pushed: 4, opened: 3, openRate: 0.75, lastPushedDate: "2026-09-13", lastOpenedDate: "2026-09-13" }],
  recentOpened: [{ contentId: "answer:x", title: "远程办公的效率陷阱", url: "", topicName: "远程办公", kind: "main", date: "2026-09-13", seenAt: "2026-09-13T10:00:00.000Z" }],
  yesterday: { date: "2026-09-13", main: 8, light: 2, perspectives: 1, opened: 3 },
  streakDays: 3, feedDays: 3, totalPushed: 20, totalOpened: 5, continuityTopics: ["远程办公"], openedPerspectiveTopics: [],
};
const topics = [{ name: "考研 vs 就业", weight: 1 }, { name: "远程办公", weight: 0.7 }, { name: "AI Agent 产品", weight: 0.4 }];
const feed = feedOf([
  card("c1", "main", "考研 vs 就业", "二战还是先工作", 5000),
  card("c2", "perspective", "考研 vs 就业", ""),
  card("c3", "main", "远程办公", "远程三年后的复盘", 300),
  card("c4", "main", "AI Agent 产品", "Agent 产品的护城河", 900),
  card("c5", "light", null, "今天的热榜段子", 10),
  card("c6", "main", "考研 vs 就业", "考研人数下降说明了什么", 2000, true),
]);

describe("selectHighlightCandidates", () => {
  it("never fills the daily shortlist with explicitly rejected or already-known material", () => {
    const filtered = feedOf([ { ...card("known", "main", "考研", "已经知道"), feedback: "known" }, { ...card("bad", "main", "考研", "归纳有误"), feedback: "misleading" }, card("one", "main", "考研", "仅余一条") ]);
    expect(selectHighlightCandidates(filtered, emptyHistory).map((card) => card.id)).toEqual(["one"]);
    expect(ruleBrief(filtered, topics, emptyHistory).highlights).toHaveLength(1);
  });
  it("连续性话题优先，视角卡至少一张，按 position 排序", () => {
    const picked = selectHighlightCandidates(feed, richHistory, 3);
    expect(picked.map((item) => item.id)).toContain("c3");
    expect(picked.some((item) => item.kind === "perspective")).toBe(true);
    expect(picked.map((item) => item.position)).toEqual([...picked.map((item) => item.position)].sort((a, b) => a - b));
  });
  it("已读卡片靠后", () => {
    const picked = selectHighlightCandidates(feed, emptyHistory, 3);
    expect(picked.map((item) => item.id)).not.toContain("c6");
  });
});

describe("ruleBrief", () => {
  it("满足长度约束，亮点都来自 feed", () => {
    for (const history of [emptyHistory, richHistory]) {
      const brief = ruleBrief(feed, topics, history);
      expect(chars(brief.headline)).toBeLessThanOrEqual(BRIEF_LIMITS.headline);
      expect(chars(brief.summary)).toBeLessThanOrEqual(BRIEF_LIMITS.summary);
      expect(chars(brief.spokenScript)).toBeGreaterThanOrEqual(BRIEF_LIMITS.spokenMin);
      expect(chars(brief.spokenScript)).toBeLessThanOrEqual(BRIEF_LIMITS.spokenMax);
      expect(brief.highlights.length).toBeGreaterThanOrEqual(BRIEF_LIMITS.highlightsMin);
      expect(brief.highlights.length).toBeLessThanOrEqual(BRIEF_LIMITS.highlightsMax);
      const ids = new Set(feed.cards.map((item) => item.id));
      expect(brief.highlights.every((item) => ids.has(item.cardId))).toBe(true);
      expect(brief.perspectiveHint).toContain("考研 vs 就业");
      expect(brief.spokenScript).not.toMatch(/[*#\[\]]/);
    }
  });
  it("有昨天记录时写进 continuity 与口播", () => {
    const brief = ruleBrief(feed, topics, richHistory);
    expect(brief.continuity[0]).toBe("昨天推了 10 条，你打开了 3 条");
    expect(brief.continuity).toContain("昨天你在看「远程办公」，今天接着有新内容");
    expect(brief.spokenScript).toContain("昨天推了 10 条");
    expect(ruleBrief(feed, topics, emptyHistory).continuity).toEqual([]);
  });
  it("没有视角卡就没有 perspectiveHint；极小 feed 也能补足长度", () => {
    const tiny = feedOf([card("only", "main", "远程办公", "唯一一条")]);
    const brief = ruleBrief(tiny, topics.slice(1, 2), emptyHistory);
    expect(brief.perspectiveHint).toBeUndefined();
    expect(chars(brief.spokenScript)).toBeGreaterThanOrEqual(BRIEF_LIMITS.spokenMin);
    expect(brief.highlights).toHaveLength(1);
  });
});

describe("reconcileBrief", () => {
  const fallback = ruleBrief(feed, topics, richHistory);
  it("丢弃幻觉 cardId 并从规则版补足到 3 条", () => {
    const body = reconcileBrief({
      headline: "今天先看远程办公", summary: "两句总结。", spokenScript: "x".repeat(200),
      highlights: [{ cardId: "c3", why: "你昨天在看" }, { cardId: "ghost", why: "不存在" }],
      continuity: ["昨天你在看远程办公"],
    }, feed, fallback);
    expect(body.highlights.map((item) => item.cardId)).not.toContain("ghost");
    expect(body.highlights[0]).toMatchObject({ cardId: "c3", title: "远程三年后的复盘", topicName: "远程办公", why: "你昨天在看" });
    expect(body.highlights.length).toBeGreaterThanOrEqual(3);
    expect(body.spokenScript).toBe("x".repeat(200));
    expect(body.perspectiveHint).toBe(fallback.perspectiveHint);
  });
  it("口播长度不合规时回落到规则版", () => {
    const body = reconcileBrief({ headline: "h", summary: "s", spokenScript: "太短", highlights: [{ cardId: "c1", why: "w" }], continuity: [] }, feed, fallback);
    expect(body.spokenScript).toBe(fallback.spokenScript);
  });
});
