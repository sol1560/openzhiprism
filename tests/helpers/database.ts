import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/db/schema";
import { sourceValues } from "@/lib/ai-detection/source";
import type { Db } from "@/db";
export async function testDatabase() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-test-"));
  const client = createClient({ url: `file:${dir}/test.db` });
  await client.execute("PRAGMA journal_mode = WAL");
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.resolve("drizzle") });
  return { database, client, dir, close: async () => { client.close(); await rm(dir, { recursive: true, force: true }); } };
}
export const prose = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
export async function seedUser(database: Db, userId: string, verified = true) {
  await database.insert(schema.users).values({ id: userId, displayName: userId, loginSource: verified ? "zhihu_oauth" : "demo" });
  if (verified) await database.insert(schema.oauthIdentities).values({ provider: "zhihu", subject: `subject-${userId}`, userId });
}
export async function seedEmailUser(database: Db, userId: string, email: string) {
  await database.insert(schema.users).values({ id: userId, displayName: email.split("@")[0], email, loginSource: "email" });
  await database.insert(schema.oauthIdentities).values({ provider: "email", subject: email, userId, email });
}
export async function seedContent(database: Db, userId: string, contentId = "answer:1", text = prose) {
  await database.insert(schema.contentCache).values({ contentId, provider: "official", type: "answer", title: "测试回答", excerpt: "短摘录", summary: "这是 AI 生成的摘要，绝不能送检", url: "https://www.zhihu.com/answer/1",
    ...sourceValues({ id: contentId, type: "answer", provider: "official", title: "测试回答", content: text, contentTruncated: false, sourceFetchedAt: Date.now(), excerpt: "短摘录", url: "https://www.zhihu.com/answer/1", voteUp: 0, commentCount: 0 }),
  }).onConflictDoNothing();
  await database.insert(schema.feedItems).values({ id: `${userId}-${contentId}`, userId, date: "2026-09-09", position: 0, kind: "main", contentId });
}
