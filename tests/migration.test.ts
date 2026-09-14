import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { expect, it } from "vitest";
import { schema } from "@/db";
import { issueCredential, resolveCredential } from "@/lib/security/credentials";
it("upgrades a legacy database without losing users, source metadata or feed membership", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-upgrade-"));
  const client = createClient({ url: `file:${dir}/legacy.db` });
  try {
    const old = path.join(dir, "migrations"); await mkdir(path.join(old, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entry = journal.entries[0];
    await writeFile(path.join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [entry] }));
    await writeFile(path.join(old, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: old });
    await client.execute("INSERT INTO users (id, display_name) VALUES ('legacy', '原用户')");
    await client.execute("INSERT INTO content_cache (content_id, provider, type, title, url, summary) VALUES ('answer:legacy', 'fixture', 'answer', '原标题', 'https://www.zhihu.com/answer/1', '已有摘要')");
    await client.execute("INSERT INTO feed_items (id,user_id,date,position,kind,content_id) VALUES ('feed','legacy','2026-09-09',0,'main','answer:legacy')");
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const [content] = await database.select().from(schema.contentCache);
    expect(content.summary).toBe("已有摘要"); expect(content.sourceText).toBeNull();
    expect(await database.select().from(schema.users)).toHaveLength(1);
    expect(await database.select().from(schema.feedItems)).toHaveLength(1);
    expect(await database.select().from(schema.detectionJobs)).toHaveLength(0);
  } finally { client.close(); await rm(dir, { recursive: true, force: true }); }
});

it("adds connector authorization without losing existing email identities, sessions or manual keys", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-connector-upgrade-"));
  const client = createClient({ url: `file:${dir}/legacy.db` });
  try {
    const old = path.join(dir, "migrations"); await mkdir(path.join(old, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 4);
    await writeFile(path.join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await writeFile(path.join(old, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: old });
    await database.insert(schema.users).values({ id: "email-user", displayName: "原用户", email: "legacy@example.test", loginSource: "email" });
    await database.insert(schema.oauthIdentities).values({ provider: "email", subject: "legacy@example.test", email: "legacy@example.test", userId: "email-user" });
    const session = await issueCredential("email-user", "session", "", database);
    const key = await issueCredential("email-user", "mcp", "existing-agent", database);
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    expect(await resolveCredential(session.token, "session", database)).toBe("email-user");
    expect(await resolveCredential(key.token, "mcp", database)).toBe("email-user");
    expect((await database.select().from(schema.users))[0].email).toBe("legacy@example.test");
    expect(await database.select().from(schema.oauthIdentities)).toHaveLength(1);
    expect(await database.select().from(schema.connectorGrants)).toEqual([]);
  } finally { client.close(); await rm(dir, { recursive: true, force: true }); }
});
it("adds CIMD metadata expiry without touching registered clients or their grants", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-cimd-upgrade-"));
  const client = createClient({ url: `file:${dir}/legacy.db` });
  try {
    const old = path.join(dir, "migrations"); await mkdir(path.join(old, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6);
    await writeFile(path.join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await writeFile(path.join(old, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: old });
    await database.insert(schema.users).values({ id: "u", displayName: "u", loginSource: "email" });
    await client.execute("INSERT INTO connector_clients (id, name, redirect_uris, auth_method, grant_types, created_at) VALUES ('zp_client_x', 'Claude', '[\"https://claude.ai/api/mcp/auth_callback\"]', 'none', '[\"authorization_code\"]', 1)");
    await client.execute("INSERT INTO connector_grants (id, user_id, client_id, scope, resource, created_at, expires_at) VALUES ('g', 'u', 'zp_client_x', 'zhiprism', 'http://localhost:3000/api/mcp', 1, 9999999999999)");
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const [existing] = await database.select().from(schema.connectorClients);
    expect(existing).toMatchObject({ id: "zp_client_x", metadataExpiresAt: null });
    expect(await database.select().from(schema.connectorGrants)).toHaveLength(1);
  } finally { client.close(); await rm(dir, { recursive: true, force: true }); }
});

it("keeps zhihu identities and adds login tables when upgrading from the single-provider schema", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-upgrade-"));
  const client = createClient({ url: `file:${dir}/legacy.db` });
  try {
    const old = path.join(dir, "migrations"); await mkdir(path.join(old, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.slice(0, 3);
    await writeFile(path.join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await writeFile(path.join(old, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: old });
    await client.execute("INSERT INTO users (id, display_name) VALUES ('legacy', '原用户')");
    await client.execute("INSERT INTO oauth_identities (subject, user_id) VALUES ('subject-1', 'legacy')");
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const identities = await database.select().from(schema.oauthIdentities);
    expect(identities).toEqual([{ provider: "zhihu", subject: "subject-1", userId: "legacy", email: null, createdAt: 0 }]);
    const [user] = await database.select().from(schema.users);
    expect(user.email).toBeNull();
    expect(await database.select().from(schema.loginCodes)).toHaveLength(0);
  } finally { client.close(); await rm(dir, { recursive: true, force: true }); }
});

it("adds feed directives and summary overrides without touching existing feed rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zhiprism-ask-upgrade-"));
  const client = createClient({ url: `file:${dir}/legacy.db` });
  try {
    const old = path.join(dir, "migrations"); await mkdir(path.join(old, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 10);
    await writeFile(path.join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await writeFile(path.join(old, `${entry.tag}.sql`), await readFile(`drizzle/${entry.tag}.sql`));
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: old });
    await client.execute("INSERT INTO users (id, display_name) VALUES ('u', 'u')");
    await client.execute("INSERT INTO content_cache (content_id, provider, type, title, url, summary) VALUES ('answer:1', 'fixture', 'answer', 't', 'https://www.zhihu.com/answer/1', '共享摘要')");
    await client.execute("INSERT INTO feed_items (id,user_id,date,position,kind,content_id) VALUES ('f','u','2026-09-13',1,'main','answer:1')");
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    await migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const [row] = await database.select().from(schema.feedItems);
    expect(row).toMatchObject({ id: "f", summaryOverride: null, overrideNote: null });
    expect(await database.select().from(schema.feedDirectives)).toEqual([]);
  } finally { client.close(); await rm(dir, { recursive: true, force: true }); }
});
