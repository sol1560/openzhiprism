import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:./data/zhiprism.db";
const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

// 本地 SQLite 与远程 Turso（libSQL）共用同一套迁移；远程库需要 turso 方言才能带 authToken。
export default defineConfig(url.startsWith("file:")
  ? { dialect: "sqlite", schema: "./db/schema.ts", out: "./drizzle", dbCredentials: { url } }
  : { dialect: "turso", schema: "./db/schema.ts", out: "./drizzle", dbCredentials: { url, authToken } });
