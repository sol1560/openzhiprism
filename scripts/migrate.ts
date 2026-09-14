/**
 * 出站迁移：对 DATABASE_URL / TURSO_DATABASE_URL 指向的库应用 drizzle/ 下全部待执行迁移。
 *   vercel env pull .env.production.local && pnpm db:migrate
 * 幂等，可重复执行。生产请求期不再自动迁移（见 db/index.ts migrateOnStart）。
 */
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { databaseUrl, getDb } from "@/db";
import { repairCaptureCheckpoint } from "@/db/compatibility";

async function main() {
  const url = databaseUrl();
  console.log(`migrating ${url.replace(/\/\/[^@/]*@/, "//…@")}`);
  await migrate(getDb(), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await repairCaptureCheckpoint(getDb());
  console.log("migrated");
}
main().catch((error) => { console.error(error); process.exit(1); });
