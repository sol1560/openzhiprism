import { describe, expect, it, vi } from "vitest";
import type { FeedCard, FeedView } from "@/lib/feed/types";
import { LIMITS, VOICE_TOOL_NAMES, compactCard, createVoiceTools, type VoiceUi } from "@/lib/voice/tools";

function main(id: string, title: string, summary = "摘要", seen = false): FeedCard {
  return {
    id, kind: "main", position: 0, topicName: "远程办公", reason: `因为你最近在聊「远程办公」`, perspective: null, seen,
    content: { id: `answer:${id}`, type: "answer", title, summary, excerpt: "节选".repeat(200), url: `https://www.zhihu.com/answer/${id}`, voteUp: 1200, commentCount: 30, provider: "fixture", authorName: "某人" },
  };
}
const perspective: FeedCard = {
  id: "p1", kind: "perspective", position: 0, topicName: "考研 vs 就业", reason: "你 80% 都在看同一方", content: null, seen: false,
  perspective: {
    topicKey: "k", topicName: "考研 vs 就业", question: "应届生先考研还是先工作？", userSide: "pro", userSideLabel: "先考研", exposureRatio: 0.8, counterSide: "con",
    stances: [
      { side: "con", label: "先工作", items: [{ id: "answer:c1", title: "反方一", url: "u", oneLine: "先工作更稳", excerpt: "", voteUp: 900, provider: "fixture" }, { id: "answer:c2", title: "反方二", url: "u", oneLine: "x", excerpt: "", voteUp: 100, provider: "fixture" }, { id: "answer:c3", title: "反方三", url: "u", oneLine: "y", excerpt: "", voteUp: 10, provider: "fixture" }] },
      { side: "neutral", label: "中立", items: [{ id: "answer:n1", title: "中立一", url: "u", oneLine: "看情况", excerpt: "", voteUp: 50, provider: "fixture" }] },
    ],
    analysis: "分析".repeat(300), analysisModel: "rules", reason: "你 80% 都在看同一方",
  },
};
const feed: FeedView = { userId: "u", date: "2026-09-14", run: null, cards: [main("c1", "第一条", "很".repeat(200)), perspective, main("c2", "第二条")].map((card, index) => ({ ...card, position: index + 1 })) };

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    "/api/feed": feed,
    "/api/feed/brief": { date: "2026-09-14", headline: "h", summary: "s", spokenScript: "x", highlights: [{ cardId: "c2", title: "第二条", topicName: "远程办公", why: "值得" }], continuity: ["昨天在看"], perspectiveHint: undefined },
    "/api/profile": { topics: Array.from({ length: 10 }, (_, i) => ({ name: `t${i}`, weight: 0.123456, keywords: ["a", "b", "c", "d", "e", "f"], controversial: i === 0, stanceLabel: null })) },
    "/api/feed/history?days=7": { windowDays: 7 },
    [`/api/perspectives?topic=${encodeURIComponent("考研")}`]: { topic: "考研", isControversial: true, question: "q", userStance: "先考研", sides: { pro: { label: "考研", items: [{ title: "a", oneLine: "1", voteUp: 1 }, { title: "b", oneLine: "2", voteUp: 2 }, { title: "c", oneLine: "3", voteUp: 3 }] }, con: { label: "工作", items: [] }, neutral: [{ title: "n", oneLine: "n", voteUp: 0 }, { title: "n2", oneLine: "n2", voteUp: 0 }] }, analysis: "分析".repeat(300) },
    [`/api/search?q=${encodeURIComponent("远程办公")}`]: { provider: "fixture", items: Array.from({ length: 8 }, (_, i) => ({ title: `r${i}`, url: "u", voteUp: i, excerpt: "e".repeat(200) })) },
    "/api/status": { source: { strategy: "auto", active: "fixture", official: { configured: false } }, llm: { provider: "mock", model: "m" } },
    ...overrides,
  };
  const data = {
    fetchJson: vi.fn(async (path: string) => {
      calls.push(path);
      if (!(path in responses)) throw new Error(`unexpected ${path}`);
      const value = responses[path];
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  const ui: VoiceUi = { focusCard: vi.fn(() => true), openCard: vi.fn(() => true), markSeen: vi.fn(async () => undefined), rebuild: vi.fn(() => new Promise<void>(() => undefined)) };
  return { tools: createVoiceTools({ data, ui }), calls, ui, data };
}
const parse = (value: string) => JSON.parse(value) as Record<string, unknown>;

describe("compactCard", () => {
  it("截断摘要、序号从 1 起、视角卡映射为问题", () => {
    const card = compactCard(feed.cards[0], 1);
    expect(card.index).toBe(1);
    expect([...card.summary].length).toBe(LIMITS.summary);
    expect(card.summary.endsWith("…")).toBe(true);
    expect(compactCard(perspective, 2)).toMatchObject({ kind: "perspective", contentId: null, title: "应届生先考研还是先工作？", voteUp: 0 });
  });
});

describe("createVoiceTools", () => {
  it("工具名与定义一致", () => {
    const { tools } = setup();
    expect(Object.keys(tools).sort()).toEqual([...VOICE_TOOL_NAMES].sort());
  });

  it("get_today_feed 返回压缩卡片；get_card_detail 复用缓存不再请求", async () => {
    const { tools, calls } = setup();
    const list = parse(await tools.get_today_feed({}));
    expect(list.count).toBe(3);
    expect((list.cards as unknown[]).length).toBe(3);
    const detail = parse(await tools.get_card_detail({ cardId: "c1" }));
    expect(detail).toMatchObject({ index: 1, title: "第一条", author: "某人", voteUp: 1200 });
    expect([...(detail.excerpt as string)].length).toBeLessThanOrEqual(LIMITS.excerpt);
    expect(calls.filter((path) => path === "/api/feed")).toHaveLength(1);
  });

  it("视角卡详情封顶：另一方最多 2 条、分析 ≤ 300 字", async () => {
    const { tools } = setup();
    const detail = parse(await tools.get_card_detail({ cardId: "p1" }));
    expect(detail).toMatchObject({ kind: "perspective", counterLabel: "先工作", exposurePercent: 80 });
    expect((detail.counterItems as unknown[]).length).toBe(2);
    expect([...(detail.analysis as string)].length).toBeLessThanOrEqual(LIMITS.analysis);
  });

  it("未知 cardId 返回 error 字符串而不是抛错（会重新拉一次 feed）", async () => {
    const { tools, calls } = setup();
    const result = parse(await tools.get_card_detail({ cardId: "ghost" }));
    expect(result.error).toContain("ghost");
    expect(calls.filter((path) => path === "/api/feed")).toHaveLength(2);
    expect(parse(await tools.focus_card({})).error).toBeTruthy();
  });

  it("get_today_brief 带上序号；get_interest_profile 只留 8 个话题与 5 个关键词", async () => {
    const { tools } = setup();
    await tools.get_today_feed({});
    const brief = parse(await tools.get_today_brief({}));
    expect((brief.highlights as Array<{ index: number }>)[0].index).toBe(3);
    const profile = parse(await tools.get_interest_profile({}));
    const topics = profile.topics as Array<{ weight: number; keywords: string[] }>;
    expect(topics).toHaveLength(LIMITS.topics);
    expect(topics[0].keywords).toHaveLength(5);
    expect(topics[0].weight).toBe(0.12);
  });

  it("get_reading_history 钳制 days；get_perspectives / search_zhihu 封顶条数", async () => {
    const { tools, calls } = setup();
    await tools.get_reading_history({ days: 99 });
    expect(calls.at(-1)).toBe("/api/feed/history?days=30");
    const { tools: t2, calls: c2 } = setup();
    await t2.get_reading_history({});
    expect(c2.at(-1)).toBe("/api/feed/history?days=7");
    const perspectives = parse(await t2.get_perspectives({ topic: "考研" }));
    expect(((perspectives.pro as { items: unknown[] }).items)).toHaveLength(2);
    expect((perspectives.neutral as unknown[])).toHaveLength(1);
    expect([...(perspectives.analysis as string)].length).toBeLessThanOrEqual(LIMITS.analysis);
    const search = parse(await t2.search_zhihu({ query: "远程办公" }));
    expect((search.items as unknown[])).toHaveLength(LIMITS.searchItems);
    expect(parse(await t2.search_zhihu({ query: "x" })).error).toBeTruthy();
  });

  it("mark_seen 把 cardId 换成 contentId，视角卡进 skipped；open_card 打开并标已读", async () => {
    const { tools, ui } = setup();
    const marked = parse(await tools.mark_seen({ cardIds: ["c1", "p1", "nope"] }));
    expect(ui.markSeen).toHaveBeenCalledWith(["answer:c1"]);
    expect(marked).toEqual({ ok: true, marked: 1, skipped: ["p1", "nope"] });
    const opened = parse(await tools.open_card({ cardId: "c2" }));
    expect(ui.openCard).toHaveBeenCalledWith("https://www.zhihu.com/answer/c2");
    expect(ui.markSeen).toHaveBeenLastCalledWith(["answer:c2"]);
    expect(opened).toMatchObject({ ok: true, title: "第二条" });
    expect(parse(await tools.open_card({ cardId: "p1" })).error).toBeTruthy();
  });

  it("focus_card 调 ui 且报告序号；ui 找不到节点时返回 error", async () => {
    const { tools, ui } = setup();
    expect(parse(await tools.focus_card({ cardId: "c2" }))).toMatchObject({ ok: true, index: 3 });
    expect(ui.focusCard).toHaveBeenCalledWith("c2");
    (ui.focusCard as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    expect(parse(await tools.focus_card({ cardId: "c2" })).error).toBeTruthy();
  });

  it("rebuild_feed 立即返回 started，即使 rebuild 永不 resolve", async () => {
    const { tools, ui } = setup();
    const result = parse(await tools.rebuild_feed({}));
    expect(result).toEqual({ started: true, etaSeconds: 30 });
    expect(ui.rebuild).toHaveBeenCalledWith(true);
    await tools.rebuild_feed({ force: "false" });
    expect(ui.rebuild).toHaveBeenLastCalledWith(false);
  });

  it("fetch 失败 → {error}，不抛出", async () => {
    const { tools } = setup({ "/api/feed/brief": new Error("该日期还没有 Feed") });
    expect(parse(await tools.get_today_brief({})).error).toBe("该日期还没有 Feed");
    const status = parse(await tools.get_status({}));
    expect(status).toEqual({ source: { strategy: "auto", active: "fixture", official: null }, llm: { provider: "mock", model: "m" } });
  });
});
