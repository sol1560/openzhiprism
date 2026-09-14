import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { digest, issueCredential, resolveCredential, revokeCredential } from "@/lib/security/credentials";
import { isAllowedOrigin } from "@/lib/security/origin";
import { buildOAuthAuthorizeUrl, consumeOAuthTransaction, createOAuthTransaction, exchangeOAuthCode, fetchOAuthIdentity, oauthReadiness, persistOAuthIdentity } from "@/lib/auth/oauth";
import { seedUser, testDatabase } from "./helpers/database";
let store: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => {
  store = await testDatabase();
  await seedUser(store.database, "alice"); await seedUser(store.database, "bob");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://zhiprism.example");
});
afterEach(async () => { vi.unstubAllEnvs(); await store.close(); });
describe("independent revocable credentials", () => {
  it("does not accept raw user IDs or one kind of token in another transport", async () => {
    const session = await issueCredential("alice", "session", "", store.database);
    const mcp = await issueCredential("bob", "mcp", "test", store.database);
    expect(await resolveCredential("alice", "session", store.database)).toBeNull();
    expect(await resolveCredential("bob", "mcp", store.database)).toBeNull();
    expect(await resolveCredential(session.token, "mcp", store.database)).toBeNull();
    expect(await resolveCredential(mcp.token, "session", store.database)).toBeNull();
    expect(await resolveCredential(session.token, "session", store.database)).toBe("alice");
    expect(await resolveCredential(mcp.token, "mcp", store.database)).toBe("bob");
    const serialized = JSON.stringify(await store.database.select().from(schema.authCredentials));
    expect(serialized).not.toContain(session.token); expect(serialized).not.toContain(mcp.token);
  });
  it("expires tokens, revokes only the owner's token, and limits active MCP credentials", async () => {
    const token = await issueCredential("alice", "mcp", "test", store.database, 1000);
    expect(await resolveCredential(token.token, "mcp", store.database, token.expiresAt)).toBeNull();
    await revokeCredential(digest(token.token), "bob", "mcp", store.database);
    expect(await resolveCredential(token.token, "mcp", store.database, 1001)).toBe("alice");
    await revokeCredential(digest(token.token), "alice", "mcp", store.database);
    expect(await resolveCredential(token.token, "mcp", store.database, 1001)).toBeNull();
    await Promise.all(Array.from({ length: 5 }, () => issueCredential("alice", "mcp", "test", store.database)));
    await expect(issueCredential("alice", "mcp", "test", store.database)).rejects.toThrow("Too many");
  });
  it("cannot reuse a local demo session after public mode is enabled", async () => {
    await seedUser(store.database, "demo", false);
    const token = await issueCredential("demo", "session", "", store.database);
    expect(await resolveCredential(token.token, "session", store.database)).toBe("demo");
    vi.stubEnv("APP_PUBLIC_MODE", "true");
    expect(await resolveCredential(token.token, "session", store.database)).toBeNull();
  });
});
describe("OAuth transactions and identity", () => {
  it("binds state to one browser, rejects replay atomically and expires unused transactions", async () => {
    const a = await createOAuthTransaction(store.database, 1000);
    const b = await createOAuthTransaction(store.database, 1000);
    expect(await consumeOAuthTransaction(a.state, b.browser, store.database, 2000)).toBe(false);
    const results = await Promise.all([consumeOAuthTransaction(a.state, a.browser, store.database, 2000), consumeOAuthTransaction(a.state, a.browser, store.database, 2000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await consumeOAuthTransaction(b.state, b.browser, store.database, 602000)).toBe(false);
    expect(JSON.stringify(await store.database.select().from(schema.oauthTransactions))).not.toContain(a.browser);
  });
  it("binds stable subjects to existing accounts without trusting display names", async () => {
    const first = await persistOAuthIdentity({ subject: "verified-id", displayName: "same name" }, store.database);
    const second = await persistOAuthIdentity({ subject: "other-id", displayName: "same name" }, store.database);
    expect(first).not.toBe(second);
    expect(await persistOAuthIdentity({ subject: "verified-id", displayName: "renamed" }, store.database)).toBe(first);
  });
  it("uses documented app_id/app_key and never exposes provider errors", async () => {
    vi.stubEnv("ZHIHU_OAUTH_APP_ID", "test-app-id"); vi.stubEnv("ZHIHU_OAUTH_APP_KEY", "test-secret-key");
    const url = new URL(buildOAuthAuthorizeUrl("https://zhiprism.example/api/auth/zhihu/callback", "state"));
    expect(url.searchParams.get("app_id")).toBe("test-app-id"); expect(url.searchParams.has("app_key")).toBe(false);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "test-access-token" }));
    await expect(exchangeOAuthCode("test-code", "https://zhiprism.example/api/auth/zhihu/callback", fetcher)).resolves.toBe("test-access-token");
    const body = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("app_id")).toBe("test-app-id"); expect(body.get("app_key")).toBe("test-secret-key"); expect(body.has("app_secret")).toBe(false);
    fetcher.mockResolvedValue(Response.json({ error: "test-secret-key" }, { status: 400 }));
    await expect(exchangeOAuthCode("test-code", "https://zhiprism.example/api/auth/zhihu/callback", fetcher)).rejects.toThrow(/^OAuth token exchange failed$/);
  });
  it("requires the verified official contract and a stable subject; never guesses identity", async () => {
    vi.stubEnv("ZHIHU_OAUTH_APP_ID", "test-app-id"); vi.stubEnv("ZHIHU_OAUTH_APP_KEY", "test-secret-key");
    vi.stubEnv("ZHIHU_OAUTH_CONTRACT_VERIFIED", "false");
    expect(oauthReadiness().ready).toBe(false);
    vi.stubEnv("ZHIHU_OAUTH_CONTRACT_VERIFIED", "true");
    vi.stubEnv("ZHIHU_OAUTH_USERINFO_URL", "https://attacker.invalid/user"); vi.stubEnv("ZHIHU_OAUTH_SUBJECT_PATH", "data.subject");
    expect(oauthReadiness().ready).toBe(false);
    // Test-only route, not a claimed or guessed production endpoint.
    vi.stubEnv("ZHIHU_OAUTH_USERINFO_URL", "https://openapi.zhihu.com/test-only-identity-contract");
    vi.stubEnv("ZHIHU_OAUTH_NAME_PATH", "data.name");
    expect(oauthReadiness().ready).toBe(true);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { name: "Alice" } }));
    await expect(fetchOAuthIdentity("test-token", fetcher)).rejects.toThrow("stable subject missing");
    fetcher.mockResolvedValue(Response.json({ data: { subject: "stable-1", name: "Alice" } }));
    await expect(fetchOAuthIdentity("test-token", fetcher)).resolves.toEqual({ subject: "stable-1", displayName: "Alice" });
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
});
describe("cookie write origins", () => {
  it("rejects absent, foreign, forged-host and cross-site requests", () => {
    const request = (headers: Record<string, string>) => new Request("https://zhiprism.example/api/ai-detection", { method: "POST", headers });
    expect(isAllowedOrigin(request({ origin: "https://zhiprism.example" }))).toBe(true);
    expect(isAllowedOrigin(request({}))).toBe(false);
    expect(isAllowedOrigin(request({ origin: "https://attacker.example", host: "attacker.example" }))).toBe(false);
    expect(isAllowedOrigin(request({ origin: "https://zhiprism.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    vi.stubEnv("APP_PUBLIC_MODE", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://zhiprism.example");
    expect(isAllowedOrigin(request({ origin: "http://zhiprism.example" }))).toBe(false);
  });
  it("accepts the request's own origin and any local port outside public mode", () => {
    const local = (url: string, origin: string) => new Request(url, { method: "POST", headers: { origin } });
    expect(isAllowedOrigin(local("http://localhost:3097/api/feed", "http://localhost:3097"))).toBe(true);
    expect(isAllowedOrigin(local("http://localhost:3000/api/feed", "http://127.0.0.1:3000"))).toBe(true);
    expect(isAllowedOrigin(local("http://localhost:3000/api/feed", "https://attacker.example"))).toBe(false);
    vi.stubEnv("APP_PUBLIC_MODE", "true");
    expect(isAllowedOrigin(local("https://zhi.openmo.org/api/feed", "https://zhi.openmo.org"))).toBe(true);
    expect(isAllowedOrigin(local("https://zhi.openmo.org/api/feed", "http://zhi.openmo.org"))).toBe(false);
    expect(isAllowedOrigin(local("http://localhost:3000/api/feed", "http://localhost:3097"))).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3001");
    expect(isAllowedOrigin(local("http://localhost:3001/api/feed", "http://localhost:3001"))).toBe(true);
  });
  it("marks session cookies secure only for an https app", async () => {
    const { env } = await import("@/lib/env");
    expect(env.secureCookies).toBe(false);
    vi.stubEnv("APP_PUBLIC_MODE", "true");
    expect(env.secureCookies).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3001");
    expect(env.secureCookies).toBe(false);
  });
});

it("invalid or zero budget settings fail closed rather than silently increasing the limit", async () => {
  const { env } = await import("@/lib/env");
  vi.stubEnv("AI_DETECTION_DAILY_CENTS", "0");
  expect(env.detectionLimits.dailyCents).toBe(0);
  vi.stubEnv("AI_DETECTION_DAILY_CENTS", "typo");
  expect(env.detectionLimits.dailyCents).toBe(0);
});
