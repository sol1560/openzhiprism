import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { createCapture, getCapture, retryCapture, runCapture, CAPTURE_LEASE_MS } from "@/lib/extension/service";
import { ruleBasedExtract, type ExtractionOutcome } from "@/lib/ingest/extract";
import { clearProfile } from "@/lib/profile/store";
import { seedEmailUser, testDatabase } from "./helpers/database";
import type { CapturePayload } from "@/lib/extension/contract";
import type { ParsedConversation } from "@/lib/ingest/parse";

let database: Db, store: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => database }));
let at: number;
const payload = (extra = false): CapturePayload => ({ version: 1, platform: "claude", externalId: "00000000-1111-2222-3333-444444444444",
  sourceUrl: "https://claude.ai/chat/00000000-1111-2222-3333-444444444444", title: "AI Agent 创业 alice@example.com",
  messages: [{ id: "u1", role: "user", content: "我想从大厂转到 AI Agent 创业公司，邮箱 alice@example.com。" },
    { id: "a1", role: "assistant", content: "可以评估 AI Agent 赛道。" }, ...(extra ? [{ id: "u2", role: "user" as const, content: "我也想入门公路车，碳架和铝架如何选择？" }] : [])] });
const extract = vi.fn(async (conversations: ParsedConversation[]): Promise<ExtractionOutcome> => ({ interests: ruleBasedExtract(conversations),
  llm: { provider: "mock", model: "test-rules", live: false }, inputChars: 0 }));
const deps = () => ({ database, extract, now: () => at });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"); vi.stubEnv("LLM_PROVIDER", "mock");
  store = await testDatabase(); database = store.database; at = Date.now(); extract.mockClear();
  await seedEmailUser(database, "alice", "alice@example.test"); await seedEmailUser(database, "bob", "bob@example.test");
  await database.insert(schema.connectorClients).values({ id: "client", name: "Extension", redirectUris: ["https://test.chromiumapp.org/zhiprism"], authMethod: "none", grantTypes: ["authorization_code"], createdAt: at });
  for (const userId of ["alice", "bob"]) await database.insert(schema.connectorGrants).values({ id: userId + "-grant", userId, clientId: "client", scope: "conversations:write",
    resource: "http://localhost:3000/api/extension", createdAt: at, expiresAt: at + 86400_000 });
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });
const view = (id: string) => getCapture("alice", id, Promise.resolve(database), at);

describe("browser capture persistence", () => {
  it("redacts before queuing, commits archive/profile/versions together, and deduplicates repeated captures", async () => {
    const id = await createCapture("alice", "alice-grant", payload(), deps());
    const [queued] = await database.select().from(schema.captureJobs);
    expect(JSON.stringify(queued)).not.toContain("alice@example.com");
    await runCapture("alice", id, deps());
    expect((await view(id))?.status).toBe("ready");
    expect((await view(id))?.result?.newUserMessageCount).toBe(1);
    const before = await database.select().from(schema.interestTopics);
    expect(before.length).toBeGreaterThan(0);
    at += 1000;
    expect(await createCapture("alice", "alice-grant", payload(), deps())).toBe(id);
    await runCapture("alice", id, deps());
    expect(await database.select().from(schema.interestTopics)).toEqual(before);
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
    expect((await database.select().from(schema.conversations))[0].capturedAt).toBe(at);
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it("only analyzes added user turns; edited versions and branch switches do not recount unchanged messages", async () => {
    let id = await createCapture("alice", "alice-grant", payload(), deps()); await runCapture("alice", id, deps());
    at++;
    id = await createCapture("alice", "alice-grant", payload(true), deps()); await runCapture("alice", id, deps());
    expect((await view(id))?.result?.newUserMessageCount).toBe(1);
    expect(extract.mock.calls[1][0][0].messages.map((m) => m.content).join()).not.toContain("大厂");
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
    const edited = payload(true); edited.messages[0].content = "我现在更想留在大厂研究 AI Agent。"; at++;
    id = await createCapture("alice", "alice-grant", edited, deps()); await runCapture("alice", id, deps());
    expect((await view(id))?.result?.newUserMessageCount).toBe(1);
    const branch = payload(); branch.title = "回到旧分支"; at++;
    id = await createCapture("alice", "alice-grant", branch, deps()); await runCapture("alice", id, deps());
    expect((await view(id))?.result?.duplicate).toBe(true);
    expect(extract).toHaveBeenCalledTimes(3);
  });
  it("isolates accounts and serializes concurrent attempts", async () => {
    const [a, same] = await Promise.all([createCapture("alice", "alice-grant", payload(), deps()), createCapture("alice", "alice-grant", payload(), deps())]);
    expect(same).toBe(a);
    expect(await getCapture("bob", a, Promise.resolve(database))).toBeNull();
    await Promise.all([runCapture("alice", a, deps()), runCapture("alice", a, deps())]);
    expect(extract).toHaveBeenCalledTimes(1);
    const b = await createCapture("bob", "bob-grant", payload(), deps()); await runCapture("bob", b, deps());
    expect(await database.select().from(schema.conversations)).toHaveLength(2);
  });
  it("does not commit on model failure and permits explicit retry without leaking provider errors", async () => {
    const id = await createCapture("alice", "alice-grant", payload(), deps());
    await runCapture("alice", id, { ...deps(), extract: async () => { throw new Error("secret prompt alice@example.com"); } });
    expect((await view(id))?.status).toBe("error");
    expect(JSON.stringify(await view(id))).not.toContain("secret");
    expect(await database.select().from(schema.conversations)).toHaveLength(0);
    expect(await database.select().from(schema.interestTopics)).toHaveLength(0);
    await retryCapture("alice", id, "alice-grant", deps()); await runCapture("alice", id, deps());
    expect((await view(id))?.status).toBe("ready");
  });
  it("resumes a long conversation from saved chunks rather than re-extracting completed chunks", async () => {
    const long = payload(); long.messages = [{ id: "large", role: "user", content: "我想研究 AI Agent 创业。\n".repeat(1700) }];
    const id = await createCapture("alice", "alice-grant", long, deps());
    await runCapture("alice", id, deps());
    expect((await view(id))?.status).toBe("queued");
    expect(await database.select().from(schema.interestTopics)).toHaveLength(0);
    const [checkpoint] = await database.select().from(schema.captureJobs);
    expect(checkpoint.checkpoint?.cursor).toBe(4);
    for (let i = 0; i < 10 && (await view(id))?.status === "queued"; i++) await runCapture("alice", id, deps());
    expect((await view(id))?.status).toBe("ready");
    expect((await view(id))?.result?.newUserMessageCount).toBe(1);
    expect((await database.select().from(schema.captureMessages))).toHaveLength(1);
  });
  it("rejects a stale worker after another attempt takes over", async () => {
    const id = await createCapture("alice", "alice-grant", payload(), deps());
    let release!: () => void;
    const paused = new Promise<void>((r) => { release = r; });
    let started!: () => void;
    const signal = new Promise<void>((r) => { started = r; });
    const stale = runCapture("alice", id, { ...deps(), extract: async (conversations) => { started(); await paused; return extract(conversations); } });
    await signal; at += CAPTURE_LEASE_MS + 1;
    expect((await view(id))?.status).toBe("error");
    await retryCapture("alice", id, "alice-grant", deps()); await runCapture("alice", id, deps()); release(); await stale;
    expect((await view(id))?.status).toBe("ready");
    expect(await database.select().from(schema.conversations)).toHaveLength(1);
    expect(await database.select().from(schema.captureMessages)).toHaveLength(2);
  });
  it("a revoked grant or reset cannot commit queued data back into the profile", async () => {
    const id = await createCapture("alice", "alice-grant", payload(), deps());
    await database.update(schema.connectorGrants).set({ revokedAt: at }).where(eq(schema.connectorGrants.id, "alice-grant"));
    await runCapture("alice", id, deps());
    expect((await view(id))?.status).toBe("error");
    expect(await database.select().from(schema.interestTopics)).toHaveLength(0);
    await clearProfile("alice");
    expect(await database.select().from(schema.captureJobs)).toHaveLength(0);
  });
});
