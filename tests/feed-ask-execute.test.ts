import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { askFeed, type AskDeps } from "@/lib/feed/ask";
import type { RestyleInput } from "@/lib/feed/restyle";
import type { ZhihuItem } from "@/lib/zhihu/types";
import { seedEmailUser, testDatabase } from "./helpers/database";

const USER = "u1";
const DATE = "2026-09-14";

function item(id: string, type: ZhihuItem["type"] = "answer"): ZhihuItem {
  return { id, type, title: `标题 ${id}`, excerpt: `摘录 ${id}。第二句。`, content: `正文 ${id}`, url: `https://www.zhihu.com/${id}`, voteUp: 10, commentCount: 1, provider: "fixture" };
}

describe("askFeed", () => {
  let env: Awaited<ReturnType<typeof testDatabase>>;
  let deps: AskDeps;
  const searchItems = [item("answer:s1"), item("answer:seen"), item("question:q1", "question"), item("answer:s2"), item("answer:s3"), item("answer:s4")];

  beforeEach(async () => {
    env = await testDatabase();
    await seedEmailUser(env.database, USER, "u1@example.com");
    const cached = [item("answer:a"), item("answer:b"), ...searchItems];
    for (const entry of cached) {
      await env.database.insert(schema.contentCache).values({ contentId: entry.id, provider: "fixture", type: entry.type, title: entry.title, excerpt: entry.excerpt, sourceText: entry.content, url: entry.url, summary: `摘要 ${entry.id}` }).onConflictDoNothing();
    }
    await env.database.insert(schema.feedItems).values([
      { id: "card-a", userId: USER, date: DATE, position: 1, kind: "main", contentId: "answer:a", topicName: "考研 vs 就业", reason: "r" },
      { id: "card-b", userId: USER, date: DATE, position: 2, kind: "main", contentId: "answer:b", topicName: "远程办公效率", reason: "r" },
    ]);
    await env.database.insert(schema.seenItems).values({ userId: USER, contentId: "answer:seen" });
    await env.database.insert(schema.dailyBriefs).values({ userId: USER, date: DATE, payload: { date: DATE, headline: "h", summary: "s", spokenScript: "x".repeat(150), highlights: [], continuity: [], generatedAt: "", model: "rules" } });
    deps = {
      database: env.database,
      loadProfile: async () => [{ name: "考研 vs 就业", weight: 1 }, { name: "远程办公效率", weight: 0.5 }] as never,
      interpret: vi.fn(),
      search: vi.fn(async () => searchItems),
      summarize: vi.fn(async () => ({ summaries: new Map(), generated: 0, cached: 0, live: false, model: "none" })),
      restyle: vi.fn(async (items: RestyleInput[]) => ({ summaries: new Map(items.map((entry) => [entry.id, `· 要点版 ${entry.title}`])), live: true, model: "test" })),
    };
  });
  afterEach(async () => { await env.close(); });

  it("rewrites one card for this user only and returns the updated feed", async () => {
    vi.mocked(deps.interpret!).mockResolvedValue({ plan: { reply: "改好了", summary: "· 一\n· 二", actions: [{ type: "rewrite" }] }, live: true });
    const result = await askFeed(USER, { text: "改成两条要点", cardId: "card-a", date: DATE }, deps);
    expect(result.reply).toBe("改好了");
    expect(result.results).toEqual([{ type: "rewrite", ok: true, note: "已改写", cardId: "card-a" }]);
    const card = result.cards.find((entry) => entry.id === "card-a");
    expect(card?.content?.summary).toBe("· 一\n· 二");
    expect(card?.override).toEqual({ note: "改成两条要点", originalSummary: "摘要 answer:a" });
    expect(result.cards.find((entry) => entry.id === "card-b")?.override).toBeNull();
    expect(result.rebuildSuggested).toBe(false);
    const context = vi.mocked(deps.interpret!).mock.calls[0][0];
    expect(context.focusedCard).toMatchObject({ cardId: "card-a", body: "正文 answer:a" });
  });

  it("rejects a card that is not in that day's feed", async () => {
    await expect(askFeed(USER, { text: "改短", cardId: "nope", date: DATE }, deps)).rejects.toThrow(/不在今天的 Feed/);
  });

  it("appends up to three fresh search results and invalidates the brief", async () => {
    vi.mocked(deps.interpret!).mockResolvedValue({ plan: { reply: "找到了", actions: [{ type: "search", query: "露营装备" }] }, live: true });
    const result = await askFeed(USER, { text: "我想看看露营装备", date: DATE }, deps);
    expect(result.results[0]).toMatchObject({ type: "search", ok: true, note: "已加 3 条" });
    const appended = result.cards.slice(2);
    expect(appended.map((card) => card.content?.id)).toEqual(["answer:s1", "answer:s2", "answer:s3"]);
    expect(appended.map((card) => card.position)).toEqual([3, 4, 5]);
    expect(appended.every((card) => card.reason === "你刚才要求看「露营装备」" && card.topicName === "露营装备")).toBe(true);
    expect(deps.summarize).toHaveBeenCalledTimes(1);
    expect(await env.database.select().from(schema.dailyBriefs).where(and(eq(schema.dailyBriefs.userId, USER), eq(schema.dailyBriefs.date, DATE)))).toEqual([]);
  });

  it("stores topic directives, suggests a rebuild, and restyles today after a rule", async () => {
    vi.mocked(deps.interpret!).mockResolvedValue({ plan: { reply: "记下了", actions: [
      { type: "adjust_topic", topic: "远程办公", direction: "less" },
      { type: "add_rule", rule: "摘要都用要点" },
    ] }, live: true });
    const result = await askFeed(USER, { text: "少推远程办公，摘要都用要点", date: DATE }, deps);
    expect(result.rebuildSuggested).toBe(true);
    expect(result.directives.map((directive) => directive.text)).toEqual(["少推 · 远程办公效率", "摘要都用要点"]);
    expect(result.results.map((entry) => entry.note)).toEqual(["少推 · 远程办公效率", "已记住规则", "今天 2 条摘要已按新规则改写"]);
    expect(result.cards.map((card) => card.content?.summary)).toEqual(["· 要点版 标题 answer:a", "· 要点版 标题 answer:b"]);
    expect(result.cards[0].override?.note).toBe("摘要都用要点");
    expect(vi.mocked(deps.restyle!).mock.calls[0][1]).toEqual(["摘要都用要点"]);
  });

  it("falls back to the heuristic plan when the interpreter is the rule engine", async () => {
    const heuristic: AskDeps["interpret"] = async (context) => ({ plan: (await import("@/lib/feed/ask")).heuristicPlan(context), live: false });
    const result = await askFeed(USER, { text: "别再推考研 vs 就业了", date: DATE }, { ...deps, interpret: heuristic });
    expect(result.live).toBe(false);
    expect(result.directives[0]).toMatchObject({ kind: "topic", topic: "考研 vs 就业", direction: "mute" });
  });
});
