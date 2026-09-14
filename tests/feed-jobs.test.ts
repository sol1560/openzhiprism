import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { BUILD_STALE_MS, buildView, getBuildStatus, startFeedBuild, type FeedBuilder } from "@/lib/feed/jobs";
import type { FeedView } from "@/lib/feed/types";
import { seedEmailUser, testDatabase } from "./helpers/database";

const DATE = "2026-09-12";
const USER = "u1";
const feedOf = (cards = 3): FeedView => ({ userId: USER, date: DATE, cards: Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, kind: "main", position: i + 1, topicName: null, reason: "", content: null, perspective: null, seen: false })), run: null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("feed build jobs", () => {
  let env: Awaited<ReturnType<typeof testDatabase>>;
  beforeEach(async () => {
    env = await testDatabase();
    await seedEmailUser(env.database, USER, "u1@example.com");
    (globalThis as { __zhiprismBuilds?: Map<string, unknown> }).__zhiprismBuilds = new Map();
  });
  afterEach(async () => { await env.close(); });

  it("records real progress and finishes ready", async () => {
    const builder: FeedBuilder = async (_userId, options) => {
      await options.onProgress?.({ stage: "allocate", index: 1, total: 4, detail: "2 个话题" });
      await options.onProgress?.({ stage: "search", index: 2, total: 4, detail: "公路车入门" });
      return feedOf();
    };
    const result = await startFeedBuild(USER, { date: DATE, force: true }, { builder, database: env.database });
    expect(result.started).toBe(true);
    expect(result.build.status).toBe("queued");
    const feed = await result.promise;
    expect(feed.cards).toHaveLength(3);
    const status = await getBuildStatus(USER, DATE, env.database);
    expect(status?.status).toBe("ready");
    expect(status?.stage).toBe("done");
    expect(status?.finishedAt).not.toBeNull();
    const [row] = await env.database.select().from(schema.feedBuilds).where(eq(schema.feedBuilds.userId, USER));
    expect(row.stageIndex).toBe(2);
    expect(row.stageTotal).toBe(4);
    expect(row.detail).toBe("公路车入门");
    expect(row.force).toBe(true);
  });

  it("dedupes a second start while the first is running", async () => {
    const gate = deferred<FeedView>();
    let calls = 0;
    const builder: FeedBuilder = async () => { calls += 1; return gate.promise; };
    const first = await startFeedBuild(USER, { date: DATE }, { builder, database: env.database });
    const second = await startFeedBuild(USER, { date: DATE, force: true }, { builder, database: env.database });
    expect(second.started).toBe(false);
    expect(calls).toBe(1);
    gate.resolve(feedOf(5));
    const [a, b] = await Promise.all([first.promise, second.promise]);
    expect(a.cards).toHaveLength(5);
    expect(b).toBe(a);
    // 完成后可以再次发起
    const third = await startFeedBuild(USER, { date: DATE, force: true }, { builder, database: env.database });
    expect(third.started).toBe(true);
    await third.promise;
    expect(calls).toBe(2);
  });

  it("stores the failure message and allows a retry", async () => {
    const builder: FeedBuilder = async () => { throw new Error("知乎搜索超时"); };
    const result = await startFeedBuild(USER, { date: DATE }, { builder, database: env.database });
    await expect(result.promise).rejects.toThrow("知乎搜索超时");
    const status = await getBuildStatus(USER, DATE, env.database);
    expect(status?.status).toBe("error");
    expect(status?.error).toBe("知乎搜索超时");
    const retry = await startFeedBuild(USER, { date: DATE }, { builder: async () => feedOf(), database: env.database });
    expect(retry.started).toBe(true);
    await retry.promise;
    expect((await getBuildStatus(USER, DATE, env.database))?.status).toBe("ready");
  });

  it("treats a running row that stopped updating as stale and restartable", async () => {
    const now = Date.now();
    await env.database.insert(schema.feedBuilds).values({
      id: "stale", userId: USER, date: DATE, status: "running", stage: "search", stageIndex: 2, stageTotal: 5,
      detail: null, error: null, force: false, createdAt: now - BUILD_STALE_MS - 1000, updatedAt: now - BUILD_STALE_MS - 1000, finishedAt: null,
    });
    const view = await getBuildStatus(USER, DATE, env.database, now);
    expect(view?.status).toBe("error");
    expect(view?.error).toContain("中断");
    const result = await startFeedBuild(USER, { date: DATE }, { builder: async () => feedOf(), database: env.database, now: () => now });
    expect(result.started).toBe(true);
    await result.promise;
    const [row] = await env.database.select().from(schema.feedBuilds).where(eq(schema.feedBuilds.userId, USER));
    expect(row.id).toBe("stale");
    expect(row.status).toBe("ready");
  });

  it("keeps an active row active until the stale window passes", () => {
    const now = Date.now();
    const row = { id: "x", userId: USER, date: DATE, status: "running", stage: "search", stageIndex: 1, stageTotal: 3, detail: "AI", error: null, force: false, createdAt: now, updatedAt: now - 5000, finishedAt: null };
    expect(buildView(row, now).status).toBe("running");
    expect(buildView(row, now + BUILD_STALE_MS + 1).status).toBe("error");
  });
});
