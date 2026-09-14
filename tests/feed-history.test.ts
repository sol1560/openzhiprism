import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/db";
import { computeHistorySignals, historySignalsFrom, shiftDateKey } from "@/lib/feed/history";
import { seedUser, testDatabase } from "./helpers/database";

type Store = Awaited<ReturnType<typeof testDatabase>>;

describe("shiftDateKey", () => {
  it("跨月跨年按本地日期位移", () => {
    expect(shiftDateKey("2026-09-10", -1)).toBe("2026-09-09");
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("historySignalsFrom", () => {
  let store: Store;
  beforeAll(async () => {
    store = await testDatabase();
    const database = store.database;
    await seedUser(database, "alice");
    const contents = [
      ["answer:a1", "A 的第一条"], ["answer:a2", "A 的第二条"], ["answer:a3", "A 的第三条"],
      ["answer:b1", "B 的第一条"], ["answer:b2", "B 的第二条"], ["hot:h1", "热榜"],
    ] as const;
    for (const [contentId, title] of contents) {
      await database.insert(schema.contentCache).values({ contentId, provider: "fixture", type: contentId.startsWith("hot") ? "hot" : "answer", title, excerpt: "", url: `https://www.zhihu.com/${contentId}` });
    }
    const row = (id: string, date: string, position: number, kind: string, contentId: string | null, topicName: string | null, payload?: unknown) =>
      database.insert(schema.feedItems).values({ id, userId: "alice", date, position, kind, contentId, topicName, reason: "", payload });
    // 09-08：A ×2、B ×2、1 张 A 的视角卡、1 条热榜
    await row("r1", "2026-09-08", 1, "main", "answer:a1", "A");
    await row("r2", "2026-09-08", 2, "perspective", null, "A", { stances: [{ side: "con", label: "反方", items: [{ id: "answer:p1", title: "反方回答", url: "https://www.zhihu.com/answer/p1" }] }] });
    await row("r3", "2026-09-08", 3, "main", "answer:b1", "B");
    await row("r4", "2026-09-08", 4, "main", "answer:a2", "A");
    await row("r5", "2026-09-08", 5, "main", "answer:b2", "B");
    await row("r6", "2026-09-08", 6, "light", "hot:h1", null);
    // 09-09：A ×1
    await row("r7", "2026-09-09", 1, "main", "answer:a3", "A");
    const seen = (contentId: string, seenAt: Date) => database.insert(schema.seenItems).values({ userId: "alice", contentId, seenAt });
    await seen("answer:a1", new Date(2026, 8, 8, 20, 0)); // 09-08 晚点开
    await seen("answer:p1", new Date(2026, 8, 9, 9, 0)); // 09-09 点开视角卡里的反方
    await seen("answer:orphan", new Date(2026, 8, 9, 10, 0)); // MCP 写入的孤儿 id
  });
  afterAll(async () => { await store.close(); });

  it("聚合话题推送 / 打开、昨天、连续天数与最近打开", async () => {
    const signals = await historySignalsFrom(store.database, "alice", { date: "2026-09-10", windowDays: 14 });
    const a = signals.topics.find((topic) => topic.topicName === "A");
    const b = signals.topics.find((topic) => topic.topicName === "B");
    expect(a).toMatchObject({ pushed: 3, opened: 1, lastPushedDate: "2026-09-09", lastOpenedDate: "2026-09-08" });
    expect(a?.openRate).toBeCloseTo(1 / 3, 6);
    expect(b).toMatchObject({ pushed: 2, opened: 0, openRate: 0, lastOpenedDate: null });
    expect(signals.topics[0].topicName).toBe("A");
    expect(signals.totalPushed).toBe(6); // 5 条 main + 1 条 light
    expect(signals.totalOpened).toBe(1);
    expect(signals.yesterday).toEqual({ date: "2026-09-09", main: 1, light: 0, perspectives: 0, opened: 0 });
    expect(signals.streakDays).toBe(2);
    expect(signals.feedDays).toBe(2);
    expect(signals.continuityTopics).toEqual(["A"]); // 09-09 点开了 A 的视角卡条目
    expect(signals.openedPerspectiveTopics).toEqual(["A"]);
    expect(signals.recentOpened.map((item) => item.contentId)).toEqual(["answer:p1", "answer:a1"]);
    expect(signals.recentOpened[0]).toMatchObject({ kind: "perspective", title: "反方回答", topicName: "A", date: "2026-09-08" });
    expect(signals.recentOpened[1]).toMatchObject({ kind: "main", title: "A 的第一条", url: "https://www.zhihu.com/answer:a1" });
  });

  it("目标日期当天的行不计入 pushed，窗口外的行被忽略", async () => {
    const today = await historySignalsFrom(store.database, "alice", { date: "2026-09-09" });
    expect(today.topics.find((topic) => topic.topicName === "A")?.pushed).toBe(2);
    expect(today.streakDays).toBe(2);
    const far = await historySignalsFrom(store.database, "alice", { date: "2026-10-30", windowDays: 7 });
    expect(far.topics).toEqual([]);
    expect(far.streakDays).toBe(0);
    expect(far.yesterday).toBeNull();
  });
});

describe("computeHistorySignals", () => {
  it("没有任何历史时返回空信号", () => {
    const signals = computeHistorySignals({ feedRows: [], seenRows: [], contentById: new Map() }, "2026-09-10");
    expect(signals).toMatchObject({ topics: [], recentOpened: [], yesterday: null, streakDays: 0, feedDays: 0, totalPushed: 0, continuityTopics: [] });
  });
});
