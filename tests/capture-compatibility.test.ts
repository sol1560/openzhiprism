import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { repairCaptureCheckpoint } from "@/db/compatibility";
import { testDatabase, seedEmailUser } from "./helpers/database";
import { schema, ensureMigrated, type Db } from "@/db";
let store: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => { store = await testDatabase(); });
afterEach(async () => { await store.close(); });
it("repairs an already-migrated early capture table without replacing rows or migration history", async () => {
  const database = store.database;
  await seedEmailUser(database, "compat-user", "compat@example.test");
  await database.insert(schema.connectorClients).values({ id: "compat-client", name: "test", redirectUris: ["https://example.test/callback"],
    authMethod: "none", grantTypes: ["authorization_code"], createdAt: 1 });
  await database.insert(schema.connectorGrants).values({ id: "compat-grant", userId: "compat-user", clientId: "compat-client",
    scope: "conversations:write", resource: "http://localhost:3000/api/extension", createdAt: 1, expiresAt: 9999999999999 });
  await database.insert(schema.captureJobs).values({ id: "existing-job", userId: "compat-user", grantId: "compat-grant", platform: "claude",
    externalId: "existing-chat", snapshotHash: "existing-snapshot", payload: { version: 1, platform: "claude", externalId: "existing-chat",
      sourceUrl: "https://claude.ai/chat/existing-chat", title: "既有记录", messages: [{ id: "m1", role: "user", content: "已脱敏的内容" }] },
    status: "queued", createdAt: 1, updatedAt: 1 });
  await store.client.execute('ALTER TABLE "capture_jobs" DROP COLUMN "checkpoint"');
  const history = (await store.client.execute("SELECT * FROM __drizzle_migrations")).rows;
  await expect(database.select().from(schema.captureJobs)).rejects.toThrow();
  expect(await repairCaptureCheckpoint(database)).toBe(true);
  const [job] = await database.select().from(schema.captureJobs);
  expect(job).toMatchObject({ id: "existing-job", status: "queued", checkpoint: null, payload: { title: "既有记录" } });
  expect(await repairCaptureCheckpoint(database)).toBe(false);
  expect((await store.client.execute("SELECT * FROM __drizzle_migrations")).rows).toEqual(history);
});
it("leaves current schemas unchanged", async () => {
  expect(await repairCaptureCheckpoint(store.database)).toBe(false);
  expect((await store.client.execute('PRAGMA table_info("capture_jobs")')).rows.some((column) => column.name === "checkpoint")).toBe(true);
});
it("repairs the running development server even when an earlier migration promise is cached", async () => {
  await store.client.execute('ALTER TABLE "capture_jobs" DROP COLUMN "checkpoint"');
  const globals = globalThis as unknown as { __zhiprismDb?: Db; __zhiprismMigrated?: Promise<void>; __zhiprismMigrationKey?: string };
  const previous = { database: globals.__zhiprismDb, migrated: globals.__zhiprismMigrated, key: globals.__zhiprismMigrationKey };
  globals.__zhiprismDb = store.database;
  globals.__zhiprismMigrated = Promise.resolve();
  globals.__zhiprismMigrationKey = undefined;
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", "file:" + store.dir + "/test.db");
  vi.stubEnv("DATABASE_MIGRATE_ON_START", "true");
  try {
    await Promise.all([ensureMigrated(), ensureMigrated()]);
    expect((await store.client.execute('PRAGMA table_info("capture_jobs")')).rows.some((column) => column.name === "checkpoint")).toBe(true);
    expect(await repairCaptureCheckpoint(store.database)).toBe(false);
  } finally {
    globals.__zhiprismDb = previous.database;
    globals.__zhiprismMigrated = previous.migrated;
    globals.__zhiprismMigrationKey = previous.key;
    vi.unstubAllEnvs();
  }
});
