import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { schema } from "@/db";
import { conversationHash, ingestConversations, parseConversations } from "@/lib/ingest";
import { seedEmailUser, testDatabase } from "./helpers/database";

let database: Db;
let store: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => database }));

const text = `用户：我最近在纠结要不要从大厂跳去一家 AI 创业公司，期权 0.3%，现金少 20 万。
助手：这取决于你对不确定性的承受力。
用户：我更想去创业公司。帮我分析一下 AI Agent 赛道两年内的机会。`;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("LLM_PROVIDER", "mock");
  store = await testDatabase(); database = store.database;
  await seedEmailUser(database, "alice", "alice@example.test");
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

describe("ingest dedupe", () => {
  it("stores the same conversation once per user and reports the repeat as duplicate", async () => {
    const first = await ingestConversations({ userId: "alice", source: "mcp", raw: text });
    expect(first.duplicate).toBe(false); expect(first.conversationCount).toBe(1);
    const second = await ingestConversations({ userId: "alice", source: "mcp", raw: `${text}\n` });
    expect(second.duplicate).toBe(true); expect(second.conversationCount).toBe(0);
    expect(second.topics.map((t) => t.name)).toEqual(first.topics.map((t) => t.name));
    const rows = await database.select().from(schema.conversations);
    expect(rows).toHaveLength(1); expect(rows[0].contentHash).toBe(conversationHash(parseConversations(text)[0]));
  });
  it("ignores whitespace and title when fingerprinting but keeps different users apart", async () => {
    await seedEmailUser(database, "bob", "bob@example.test");
    const [a] = parseConversations({ title: "A", messages: [{ role: "user", content: "考研  还是工作" }] });
    const [b] = parseConversations({ title: "B", messages: [{ role: "user", content: "考研 还是工作" }] });
    expect(conversationHash(a)).toBe(conversationHash(b));
    await ingestConversations({ userId: "alice", source: "paste", raw: text });
    const bob = await ingestConversations({ userId: "bob", source: "paste", raw: text });
    expect(bob.duplicate).toBe(false);
    expect(await database.select().from(schema.conversations)).toHaveLength(2);
  });
  it("stores recent_chats as its own source so the profile page can label it", async () => {
    const result = await ingestConversations({ userId: "alice", source: "recent_chats", raw: { title: "Claude 近期对话 · 最近 7 天 · 第 1 批", messages: [{ role: "user", content: "考研还是工作：我倾向先考研，想找支持考研的理由。" }] } });
    expect(result.retryable).toBe(false);
    const [row] = await database.select().from(schema.conversations);
    expect(row.source).toBe("recent_chats"); expect(row.title).toBe("Claude 近期对话 · 最近 7 天 · 第 1 批");
  });
});
