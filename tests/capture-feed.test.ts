import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { refreshCapturedFeed } from "@/lib/extension/feed";
import { seedEmailUser, testDatabase } from "./helpers/database";
import type { StartBuildResult } from "@/lib/feed/jobs";
import type { FeedView } from "@/lib/feed/types";
let store: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => {
  store = await testDatabase(); await seedEmailUser(store.database, "alice", "alice@example.test");
  await store.database.insert(schema.captureFeedRefreshes).values({ userId: "alice" });
});
afterEach(async () => { await store.close(); });
function build(started: boolean, promise: Promise<FeedView> = Promise.resolve({} as FeedView)): StartBuildResult {
  return { started, promise, build: { status: "running", stage: null, stageIndex: 0, stageTotal: 0, detail: null, error: null, updatedAt: "", finishedAt: null } };
}
it("waits for the old in-flight feed then starts one based on the updated profile", async () => {
  const start = vi.fn().mockResolvedValueOnce(build(false)).mockResolvedValueOnce(build(true));
  await refreshCapturedFeed("alice", { database: store.database, start });
  expect(start).toHaveBeenCalledTimes(2);
  expect((await store.database.select().from(schema.captureFeedRefreshes))[0].status).toBe("ready");
});
it("keeps a newer revision pending while deduplicating concurrent refresh workers", async () => {
  let finish!: (value: FeedView) => void;
  const waiting = new Promise<FeedView>((resolve) => { finish = resolve; });
  let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; });
  const start = vi.fn(async () => { started(); return build(true, waiting); });
  const first = refreshCapturedFeed("alice", { database: store.database, start }); await began;
  await store.database.update(schema.captureFeedRefreshes).set({ revision: 2, status: "pending" }).where(eq(schema.captureFeedRefreshes.userId, "alice"));
  await refreshCapturedFeed("alice", { database: store.database, start });
  finish({} as FeedView); await first;
  expect(start).toHaveBeenCalledTimes(1);
  expect((await store.database.select().from(schema.captureFeedRefreshes))[0].status).toBe("pending");
  await refreshCapturedFeed("alice", { database: store.database, start: async () => build(true) });
  expect((await store.database.select().from(schema.captureFeedRefreshes))[0].status).toBe("ready");
});
