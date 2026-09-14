import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { schema } from "@/db";
import { ingestConversations } from "@/lib/ingest";
import { seedEmailUser, testDatabase } from "./helpers/database";

let database: Db;
let store: Awaited<ReturnType<typeof testDatabase>>;
let mode: "timeout" | "ok" = "timeout";
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => database }));
vi.mock("@/lib/llm/client", async (original) => {
  const actual = await original<typeof import("@/lib/llm/client")>();
  return {
    ...actual,
    llmObject: vi.fn(async (call: { fallback: () => unknown }) => mode === "timeout"
      ? { value: call.fallback(), provider: "zenmux", model: "deepseek/deepseek-v4-flash", live: false, error: "timeout after 60000ms" }
      : { value: { topics: [{ name: "考研 vs 就业", keywords: ["考研"], questions: [], evidence: [], depth: 3, mentions: 2, stance: "pro", stanceLabel: "倾向先考研", controversial: true, searchQueries: ["考研还是工作"] }], redactedCategories: [] }, provider: "zenmux", model: "deepseek/deepseek-v4-flash", live: true }),
  };
});

const text = `用户：我倾向先考研，想找支持考研的理由。
助手：可以从起薪和行业门槛两方面看。
用户：那就业呢？帮我比较一下。`;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  store = await testDatabase(); database = store.database;
  await seedEmailUser(database, "alice", "alice@example.test");
  mode = "timeout";
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

describe("ingest retry after model timeout", () => {
  it("rolls back the archive, reports retryable, and lets the same content be resubmitted", async () => {
    const first = await ingestConversations({ userId: "alice", source: "mcp", raw: text });
    expect(first.retryable).toBe(true); expect(first.duplicate).toBe(false);
    expect(first.conversationCount).toBe(0); expect(first.topics).toEqual([]);
    expect(first.llm.live).toBe(false); expect(first.llm.error).toContain("timeout");
    expect(await database.select().from(schema.conversations)).toHaveLength(0);
    expect(await database.select().from(schema.interestTopics)).toHaveLength(0);

    mode = "ok";
    const second = await ingestConversations({ userId: "alice", source: "mcp", raw: text });
    expect(second.duplicate).toBe(false); expect(second.retryable).toBe(false);
    expect(second.conversationCount).toBe(1); expect(second.newTopicNames).toEqual(["考研 vs 就业"]);
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
  });
});
