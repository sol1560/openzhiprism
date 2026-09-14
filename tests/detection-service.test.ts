import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDetectionService, type DetectionConfig } from "@/lib/ai-detection/service";
import { PangramError, parseResult, type PangramClient } from "@/lib/ai-detection/pangram";
import { estimateCents, prepareSource } from "@/lib/ai-detection/text";
import { schema } from "@/db";
import { prose, seedContent, seedUser, testDatabase } from "./helpers/database";

const config: DetectionConfig = { enabled: true, configured: true, publicReady: true, perDay: 5, perMinute: 2, dailyCents: 500, rollingCents: 15000 };
const success = (text: string) => parseResult({ text, version: "4.0", prediction_short: "Human", fraction_ai: 0, fraction_ai_assisted: 0, fraction_human: 1, windows: [] }, text);
let store: Awaited<ReturnType<typeof testDatabase>>;
let now: number;
let client: PangramClient;
const service = (settings: Partial<DetectionConfig> = {}) => createDetectionService(store.database, client, { ...config, ...settings }, () => now);
beforeEach(async () => {
  store = await testDatabase(); now = Date.UTC(2026, 8, 9, 12);
  await seedUser(store.database, "alice"); await seedUser(store.database, "bob");
  await seedContent(store.database, "alice"); await seedContent(store.database, "bob");
  client = { submit: vi.fn(async () => "task-1"), poll: vi.fn(async (_id: string, text: string) => ({ stage: "ready" as const, result: success(text) })) };
});
afterEach(async () => { await store.close(); });
describe("detection orchestration", () => {
  it("shares one atomic reservation across concurrent users and never sends summaries", async () => {
    const [a, b] = await Promise.all([service().start("alice", "answer:1"), service().start("bob", "answer:1")]);
    expect(a.status).toBe("pending"); expect(b.status).toBe("pending");
    expect(client.submit).toHaveBeenCalledTimes(1); expect(client.submit).toHaveBeenCalledWith(prose);
    expect(await store.database.select().from(schema.detectionReservations)).toHaveLength(1);
    expect(a.source?.text).toBe(prose);
  });
  it("rejects foreign content, unknown IDs, demo accounts, and unsupported types", async () => {
    await seedContent(store.database, "alice", "answer:private");
    await expect(service().start("bob", "answer:private")).rejects.toMatchObject({ status: 404 });
    await expect(service().get("alice", "answer:missing")).rejects.toMatchObject({ status: 404 });
    await seedUser(store.database, "demo", false); await seedContent(store.database, "demo", "answer:demo");
    await expect(service().start("demo", "answer:demo")).rejects.toMatchObject({ status: 403 });
    await store.database.update(schema.contentCache).set({ type: "hot" }).where(eq(schema.contentCache.contentId, "answer:1"));
    await expect(service().start("alice", "answer:1")).rejects.toMatchObject({ status: 422 });
    expect(client.submit).not.toHaveBeenCalled();
  });
  it("skips short/missing source and fails closed for missing config and OAuth", async () => {
    for (const settings of [{ enabled: false }, { configured: false }, { publicReady: false }]) {
      expect((await service(settings).start("alice", "answer:1")).status).toBe("unavailable");
    }
    await seedContent(store.database, "alice", "answer:short", "短文");
    expect((await service().start("alice", "answer:short")).message).toContain("过短");
    await seedContent(store.database, "alice", "answer:empty", "");
    expect((await service().start("alice", "answer:empty")).message).toContain("暂无");
    expect(client.submit).not.toHaveBeenCalled();
  });
  it("resumes persisted tasks in a fresh service and coalesces concurrent polls", async () => {
    await service().start("alice", "answer:1"); now += 3000;
    await Promise.all([service().get("alice", "answer:1"), service().get("bob", "answer:1")]);
    expect(client.poll).toHaveBeenCalledTimes(1);
    const cached = await service({ enabled: false, configured: false, publicReady: false }).get("bob", "answer:1");
    expect(cached.status).toBe("ready"); expect(cached.result?.fractions.human).toBe(1);
    expect((await service().start("bob", "answer:1")).status).toBe("ready");
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
  it("invalidates old results when source text changes", async () => {
    await service().start("alice", "answer:1"); now += 3000; await service().get("alice", "answer:1"); now += 3000;
    const updated = prepareSource(prose + " 更新正文");
    await store.database.update(schema.contentCache).set({ sourceText: updated.text, sourceHash: updated.hash }).where(eq(schema.contentCache.contentId, "answer:1"));
    expect((await service().get("bob", "answer:1")).status).toBe("not_requested");
    expect((await service().start("bob", "answer:1")).source?.text).toBe(updated.text);
    expect(client.submit).toHaveBeenCalledTimes(2);
  });
  it("keeps uncertain submission reservations and never retries a lost submission", async () => {
    client.submit = vi.fn(async () => { throw new PangramError("network", true); });
    expect((await service().start("alice", "answer:1")).status).toBe("submission_unknown");
    now += 90000;
    expect((await service().start("bob", "answer:1")).status).toBe("submission_unknown");
    expect(client.submit).toHaveBeenCalledTimes(1);
    const [reservation] = await store.database.select().from(schema.detectionReservations);
    expect(reservation.cents).toBe(estimateCents(prose));
  });
  it("recovers transient query errors without another paid submission", async () => {
    await service().start("alice", "answer:1"); now += 3000;
    client.poll = vi.fn().mockRejectedValueOnce(new PangramError("provider_rate")).mockResolvedValue({ stage: "ready", result: success(prose) });
    expect((await service().get("alice", "answer:1")).status).toBe("pending");
    now += 11000; expect((await service().get("alice", "answer:1")).status).toBe("ready");
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
  it("releases only an explicitly rejected submission's dollars", async () => {
    client.submit = vi.fn(async () => { throw new PangramError("provider_credits"); });
    expect((await service().start("alice", "answer:1")).status).toBe("error");
    const [row] = await store.database.select().from(schema.detectionReservations);
    expect(row.cents).toBe(0); expect(row.userId).toBe("alice");
  });
  it("enforces budget atomically under contention for the last affordable scan", async () => {
    await seedContent(store.database, "bob", "answer:2");
    const limit = estimateCents(prose);
    const outcomes = await Promise.allSettled([
      service({ dailyCents: limit }).start("alice", "answer:1"),
      service({ dailyCents: limit }).start("bob", "answer:2"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("budget_limit");
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
  it("uses the rolling budget across UTC day boundaries and counts only new user tasks", async () => {
    await service().start("alice", "answer:1"); now += 1000;
    expect((await service({ perDay: 1 }).start("alice", "answer:1")).status).toBe("pending");
    await seedContent(store.database, "alice", "answer:2");
    await expect(service({ perDay: 1 }).start("alice", "answer:2")).rejects.toMatchObject({ code: "user_limit" });
    now += 86400000;
    await expect(service({ rollingCents: estimateCents(prose) }).start("alice", "answer:2")).rejects.toMatchObject({ code: "budget_limit" });
    now += 31 * 86400000;
    expect((await service({ rollingCents: estimateCents(prose) }).start("alice", "answer:2")).status).toBe("pending");
  });
  it("shares the global gate between submission and polling", async () => {
    await service().start("alice", "answer:1");
    await seedContent(store.database, "bob", "answer:2");
    await expect(service().start("bob", "answer:2")).rejects.toMatchObject({ code: "busy" });
    expect(await store.database.select().from(schema.detectionReservations).where(and(eq(schema.detectionReservations.userId, "bob")))).toHaveLength(0);
  });
});

it("continues a task after opening a new database connection", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  await service().start("alice", "answer:1"); now += 3000;
  const restartedClient = createClient({ url: `file:${store.dir}/test.db` });
  try {
    const restarted = createDetectionService(drizzle(restartedClient, { schema }), client, config, () => now);
    expect((await restarted.get("bob", "answer:1")).status).toBe("ready");
    expect(client.submit).toHaveBeenCalledTimes(1);
  } finally { restartedClient.close(); }
});

it("backfills a legacy row only by its exact snapshot ID, and identifies snapshot provenance", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = await readdir("fixtures/zhihu/search");
  const fixture = JSON.parse(await readFile(`fixtures/zhihu/search/${files.find((name) => name.endsWith('.json'))}`, "utf8"));
  const original = fixture.items.find((item: { type: string; content?: string }) => item.type === "answer" && item.content);
  expect(original).toBeTruthy();
  await store.database.insert(schema.contentCache).values({ contentId: original.id, provider: "official", type: "answer", title: "旧数据", excerpt: "旧摘录", url: original.url });
  await store.database.insert(schema.feedItems).values({ id: "legacy-fixture", userId: "alice", contentId: original.id, kind: "main", position: 1, date: "2026-09-09" });
  await service({ enabled: false }).get("alice", original.id);
  const [row] = await store.database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, original.id));
  expect(row.sourceText).toBe(prepareSource(original.content).text); expect(row.sourceProvider).toBe("fixture");
  expect(row.sourceFetchedAt).toBeNull();
  expect(client.submit).not.toHaveBeenCalled();
});

it("does not quietly replace a current missing body with an older fixture", async () => {
  await store.database.update(schema.contentCache).set({ sourceText: null, sourceHash: null, sourceProvider: "official" }).where(eq(schema.contentCache.contentId, "answer:1"));
  expect((await service().start("alice", "answer:1")).status).toBe("unavailable");
  expect(client.submit).not.toHaveBeenCalled();
});

it("deduplicates submission across independent database connections", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const otherClient = createClient({ url: `file:${store.dir}/test.db` });
  try {
    const other = createDetectionService(drizzle(otherClient, { schema }), client, config, () => now);
    const result = await Promise.all([service().start("alice", "answer:1"), other.start("bob", "answer:1")]);
    expect(result.every((view) => view.status === "pending")).toBe(true);
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(await store.database.select().from(schema.detectionReservations)).toHaveLength(1);
  } finally { otherClient.close(); }
});

it("allows a new user-triggered attempt only after an explicit unpaid rejection, retaining rate-limit history", async () => {
  client.submit = vi.fn().mockRejectedValueOnce(new PangramError("provider_rate")).mockResolvedValue("task-retry");
  expect((await service().start("alice", "answer:1")).status).toBe("error");
  expect((await service().get("alice", "answer:1")).status).toBe("not_requested");
  await expect(service({ perDay: 1 }).start("alice", "answer:1")).rejects.toMatchObject({ code: "user_limit" });
  now += 1000;
  expect((await service().start("alice", "answer:1")).status).toBe("pending");
  expect(client.submit).toHaveBeenCalledTimes(2);
  const reservations = await store.database.select().from(schema.detectionReservations);
  expect(reservations).toHaveLength(2);
  expect(reservations.reduce((sum, row) => sum + row.cents, 0)).toBe(estimateCents(prose));
  expect((await store.database.select().from(schema.detectionJobs)).filter((job) => job.status !== "rejected")).toHaveLength(1);
});

it("re-reads an existing task after an unreadable result instead of paying again", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await service().start("alice", "answer:1"); now += 3000;
  client.poll = vi.fn().mockRejectedValueOnce(new PangramError("invalid_result")).mockResolvedValue({ stage: "ready", result: success(prose) });
  const failed = await service().get("alice", "answer:1");
  expect(failed.status).toBe("error"); expect(failed.retry).toBe("poll");
  expect((await service().start("bob", "answer:1")).status).toBe("error");
  now += 11000;
  expect((await service().get("alice", "answer:1")).status).toBe("ready");
  expect(client.submit).toHaveBeenCalledTimes(1);
  expect(await store.database.select().from(schema.detectionReservations)).toHaveLength(1);
  vi.mocked(console.warn).mockRestore();
});

it("lets the user submit again when the submission itself failed with an unclassified provider error", async () => {
  client.submit = vi.fn().mockRejectedValueOnce(new PangramError("provider_error")).mockResolvedValue("task-2");
  const failed = await service().start("alice", "answer:1");
  expect(failed.status).toBe("error"); expect(failed.retry).toBe("submit");
  expect((await service().get("alice", "answer:1")).status).toBe("not_requested");
  now += 1000;
  expect((await service().start("alice", "answer:1")).status).toBe("pending");
  expect(client.submit).toHaveBeenCalledTimes(2);
});
