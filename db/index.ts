import { sql } from "drizzle-orm";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";
import { repairCaptureCheckpoint } from "./compatibility";

const DEFAULT_URL = "file:./data/zhiprism.db";

/** Vercel Marketplace 的 Turso 集成注入 TURSO_*，本地与自建库用 DATABASE_*。 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? DEFAULT_URL;
}
export function databaseAuthToken(): string | undefined {
  return process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
}
/** 本地文件库在首个请求时自动迁移；远程库默认关闭（并发冷启动会互相撞迁移），改由 pnpm db:migrate 出站执行。 */
export function migrateOnStart(): boolean {
  const flag = process.env.DATABASE_MIGRATE_ON_START;
  if (flag === "true" || flag === "false") return flag === "true";
  return databaseUrl().startsWith("file:");
}

function resolveUrl(): string {
  const url = databaseUrl();
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePath)), { recursive: true });
  }
  return url;
}

function createDb() {
  const client = createClient({ url: resolveUrl(), authToken: databaseAuthToken() });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  __zhiprismDb?: Db;
  __zhiprismMigrated?: Promise<void>;
  __zhiprismMigrationKey?: string;
};

export function getDb(): Db {
  if (!globalForDb.__zhiprismDb) {
    globalForDb.__zhiprismDb = createDb();
  }
  return globalForDb.__zhiprismDb;
}

/** 幂等地应用 drizzle 迁移；首次调用后复用同一 Promise。 */
export function ensureMigrated(): Promise<void> {
  // HMR preserves globalThis: don't hide migrations added while next dev runs.
  // Remote schema writes still require explicit startup opt-in or the CLI.
  const enabled = migrateOnStart();
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const key = "capture-checkpoint-v1:" + String(enabled) + ":" + (enabled && process.env.NODE_ENV !== "production"
    ? readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8") : "");
  if (!globalForDb.__zhiprismMigrated || globalForDb.__zhiprismMigrationKey !== key) {
    const previous = globalForDb.__zhiprismMigrated ?? Promise.resolve();
    globalForDb.__zhiprismMigrationKey = key;
    const pending = previous.catch(() => undefined).then(async () => {
      if (!enabled) return;
      const database = getDb();
      if (databaseUrl().startsWith("file:")) await database.all(sql`PRAGMA journal_mode = WAL`);
      await migrate(database, { migrationsFolder });
      await repairCaptureCheckpoint(database);
    });
    globalForDb.__zhiprismMigrated = pending;
    void pending.catch(() => {
      if (globalForDb.__zhiprismMigrated === pending) globalForDb.__zhiprismMigrated = undefined;
    });
  }
  return globalForDb.__zhiprismMigrated;
}

export async function db(): Promise<Db> {
  await ensureMigrated();
  return getDb();
}

export { schema };
