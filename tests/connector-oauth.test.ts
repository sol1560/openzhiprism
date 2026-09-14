import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { issueCredential, resolveCredential } from "@/lib/security/credentials";
import { safeReturnTo } from "@/lib/auth/return-to";
import { createOAuthTransaction, consumeOAuthTransactionDetails } from "@/lib/auth/oauth";
import { CLIENTS, VERIFY_PROMPT, claudeNewUrl, clientId, cursorInstallUrl, installPrompt, recentChatsPrompt } from "@/lib/connectors/clients";
import { authorizationRequest, connectorUrls, decideAuthorization, exchangeToken, listConnections,
  markConnectorUsed, matchesRedirect, registerClient, resolveConnectorToken, revokeConnection, revokeOAuthToken, setConnectionAutoIngest, startAuthorization } from "@/lib/connectors/oauth";
import { seedEmailUser, testDatabase } from "./helpers/database";

let store: Awaited<ReturnType<typeof testDatabase>>;
const now = 1_800_000_000_000;
const verifier = "v".repeat(43);
const callback = "https://claude.ai/api/mcp/auth_callback";
const challenge = createHash("sha256").update(verifier).digest("base64url");
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_PUBLIC_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  store = await testDatabase();
  await seedEmailUser(store.database, "alice", "alice@example.test");
  await seedEmailUser(store.database, "bob", "bob@example.test");
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

async function begin(method: "none" | "client_secret_basic" | "client_secret_post" = "none") {
  const client = await registerClient({ client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: method }, store.database, now);
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code",
    code_challenge: challenge, code_challenge_method: "S256", scope: "zhiprism offline_access", resource: connectorUrls().resource, state: "a-state" });
  const request = await startAuthorization(params, store.database, now);
  return { client, params, request };
}
async function approved(method: "none" | "client_secret_basic" | "client_secret_post" = "none") {
  const flow = await begin(method);
  const redirect = new URL(await decideAuthorization(flow.request.requestId, flow.request.browser, "alice", true, store.database, now));
  const params = new URLSearchParams({ grant_type: "authorization_code", client_id: flow.client.client_id,
    code: redirect.searchParams.get("code")!, code_verifier: verifier, redirect_uri: callback, resource: connectorUrls().resource });
  if (method === "client_secret_post") params.set("client_secret", flow.client.client_secret!);
  const header = method === "client_secret_basic" ? `Basic ${Buffer.from(`${flow.client.client_id}:${flow.client.client_secret}`).toString("base64")}` : null;
  return { ...flow, redirect, params, header };
}
async function connected() {
  const flow = await approved();
  const token = await exchangeToken(flow.params, null, store.database, now);
  return { ...flow, token };
}

describe("connector OAuth", () => {
  it("binds consent to the initiating browser, echoes state, and consumes the request once", async () => {
    const flow = await begin();
    expect(await authorizationRequest(flow.request.requestId, "x".repeat(43), store.database, now)).toBeNull();
    await expect(decideAuthorization(flow.request.requestId, "x".repeat(43), "alice", true, store.database, now)).rejects.toMatchObject({ code: "invalid_request" });
    const result = new URL(await decideAuthorization(flow.request.requestId, flow.request.browser, "alice", false, store.database, now));
    expect(result.origin).toBe("https://claude.ai"); expect(result.searchParams.get("error")).toBe("access_denied");
    expect(result.searchParams.get("state")).toBe("a-state"); expect(result.searchParams.get("iss")).toBe(connectorUrls().issuer);
    expect(await listConnections("alice", store.database, now)).toEqual([]);
    await expect(decideAuthorization(flow.request.requestId, flow.request.browser, "alice", true, store.database, now)).rejects.toMatchObject({ code: "invalid_request" });
  });
  it.each(["none", "client_secret_basic", "client_secret_post"] as const)("exchanges a code with %s client authentication, stores only credential hashes", async (method) => {
    const flow = await approved(method);
    const token = await exchangeToken(flow.params, flow.header, store.database, now);
    expect(token.expires_in).toBe(3600); expect(token.refresh_token).toBeTruthy();
    expect(await resolveConnectorToken(token.access_token, store.database, now)).toMatchObject({ userId: "alice", clientId: flow.client.client_id });
    expect(await resolveConnectorToken(token.refresh_token, store.database, now)).toBeNull();
    const persisted = JSON.stringify(await store.database.select().from(schema.connectorCredentials));
    expect(persisted).not.toContain(token.access_token); expect(persisted).not.toContain(token.refresh_token);
    expect(persisted).not.toContain(flow.params.get("code"));
    if (flow.client.client_secret) expect(JSON.stringify(await store.database.select().from(schema.connectorClients))).not.toContain(flow.client.client_secret);
  });
  it("rejects invalid PKCE, wrong redirect and resource without consuming the legitimate code", async () => {
    const flow = await approved();
    for (const [key, value, code] of [["code_verifier", "x".repeat(43), "invalid_grant"], ["redirect_uri", "https://evil.test/callback", "invalid_grant"], ["resource", "https://evil.test/mcp", "invalid_target"]]) {
      const bad = new URLSearchParams(flow.params); bad.set(key, value);
      await expect(exchangeToken(bad, null, store.database, now)).rejects.toMatchObject({ code });
    }
    expect(await exchangeToken(flow.params, null, store.database, now)).toHaveProperty("access_token");
  });
  it("rotates refresh tokens atomically and commits grant revocation on replay", async () => {
    const { client, token } = await connected();
    const params = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token.refresh_token! });
    const renewed = await exchangeToken(params, null, store.database, now + 3600_000);
    expect(renewed.refresh_token).not.toBe(token.refresh_token);
    expect(await resolveConnectorToken(token.access_token, store.database, now + 3600_000)).toBeNull();
    expect(await resolveConnectorToken(renewed.access_token, store.database, now + 3600_000)).toMatchObject({ userId: "alice" });
    await expect(exchangeToken(params, null, store.database, now + 3600_001)).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await resolveConnectorToken(renewed.access_token, store.database, now + 3600_001)).toBeNull();
    params.set("refresh_token", renewed.refresh_token!);
    await expect(exchangeToken(params, null, store.database, now + 3600_002)).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("invalidates an issued grant after authorization-code replay", async () => {
    const flow = await connected();
    await expect(exchangeToken(flow.params, null, store.database, now)).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await resolveConnectorToken(flow.token.access_token, store.database, now)).toBeNull();
  });
  it("allows only one exchange during a concurrent refresh and revokes on reuse", async () => {
    const flow = await connected();
    const params = new URLSearchParams({ grant_type: "refresh_token", client_id: flow.client.client_id, refresh_token: flow.token.refresh_token! });
    const results = await Promise.allSettled([exchangeToken(params, null, store.database, now), exchangeToken(params, null, store.database, now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listConnections("alice", store.database, now))[0].status).toBe("expired");
  });
  it("isolates users, verifies only successful usage, and revokes both access and refresh", async () => {
    const flow = await connected();
    const [connection] = await listConnections("alice", store.database, now);
    expect(connection.status).toBe("authorized"); expect(await listConnections("bob", store.database, now)).toEqual([]);
    await markConnectorUsed(connection.id, "bob", store.database, now);
    await revokeConnection(connection.id, "bob", store.database, now);
    expect((await listConnections("alice", store.database, now))[0].status).toBe("authorized");
    await markConnectorUsed(connection.id, "alice", store.database, now + 1);
    expect((await listConnections("alice", store.database, now))[0].status).toBe("verified");
    await revokeConnection(connection.id, "alice", store.database, now + 2);
    expect(await resolveConnectorToken(flow.token.access_token, store.database, now + 2)).toBeNull();
    await expect(exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: flow.client.client_id, refresh_token: flow.token.refresh_token! }), null, store.database, now + 2)).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("keeps auto-ingest off by default, persists the consent choice, and only the owner of a live grant can toggle it", async () => {
    const off = await connected();
    expect((await listConnections("alice", store.database, now))[0].autoIngest).toBe(false);
    const flow = await begin();
    await decideAuthorization(flow.request.requestId, flow.request.browser, "alice", true, store.database, now + 1, { autoIngest: true });
    const [latest] = await listConnections("alice", store.database, now + 1);
    expect(latest.autoIngest).toBe(true);
    expect(await setConnectionAutoIngest(latest.id, "bob", false, store.database, now + 1)).toBe(false);
    expect((await listConnections("alice", store.database, now + 1))[0].autoIngest).toBe(true);
    expect(await setConnectionAutoIngest(latest.id, "alice", false, store.database, now + 1)).toBe(true);
    expect((await listConnections("alice", store.database, now + 1))[0].autoIngest).toBe(false);
    const offId = (await listConnections("alice", store.database, now)).find((c) => c.id !== latest.id)!.id;
    await revokeConnection(offId, "alice", store.database, now + 2);
    expect(await setConnectionAutoIngest(offId, "alice", true, store.database, now + 2)).toBe(false);
    expect(await resolveConnectorToken(off.token.access_token, store.database, now + 2)).toBeNull();
  });
  it("rejects a different client's token exchange and revocation", async () => {
    const flow = await connected();
    const other = await registerClient({ redirect_uris: [callback], token_endpoint_auth_method: "none" }, store.database, now);
    const params = new URLSearchParams({ grant_type: "refresh_token", client_id: other.client_id, refresh_token: flow.token.refresh_token! });
    await expect(exchangeToken(params, null, store.database, now)).rejects.toMatchObject({ code: "invalid_grant" });
    await revokeOAuthToken(new URLSearchParams({ client_id: other.client_id, token: flow.token.access_token }), null, store.database, now);
    expect(await resolveConnectorToken(flow.token.access_token, store.database, now)).toBeTruthy();
    await revokeOAuthToken(new URLSearchParams({ client_id: flow.client.client_id, token: flow.token.refresh_token! }), null, store.database, now);
    expect(await resolveConnectorToken(flow.token.access_token, store.database, now)).toBeNull();
  });
  it("validates redirect URIs, duplicate parameters, scope, and expiry", async () => {
    expect(matchesRedirect("http://127.0.0.1/callback", "http://127.0.0.1:4123/callback")).toBe(true);
    expect(matchesRedirect("http://localhost/callback", "http://localhost:4123/callback")).toBe(true);
    expect(matchesRedirect(callback, callback + "?other=1")).toBe(false);
    expect(matchesRedirect("http://localhost/callback", "http://localhost.evil.test/callback")).toBe(false);
    await expect(registerClient({ redirect_uris: ["javascript:alert(1)"] }, store.database, now)).rejects.toMatchObject({ code: "invalid_client_metadata" });
    const flow = await begin();
    for (const [key, value] of [["code_challenge_method", "plain"], ["resource", "https://evil.test/mcp"], ["scope", "admin"], ["redirect_uri", "https://evil.test/callback"]]) {
      const bad = new URLSearchParams(flow.params); bad.set(key, value);
      await expect(startAuthorization(bad, store.database, now)).rejects.toThrow();
    }
    flow.params.append("state", "second");
    await expect(startAuthorization(flow.params, store.database, now)).rejects.toMatchObject({ code: "invalid_request" });
    expect(await authorizationRequest(flow.request.requestId, flow.request.browser, store.database, now + 600_000)).toBeNull();
    const code = await approved();
    await expect(exchangeToken(code.params, null, store.database, now + 300_000)).rejects.toMatchObject({ code: "invalid_grant" });
    const connectedFlow = await connected();
    await expect(exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: connectedFlow.client.client_id, refresh_token: connectedFlow.token.refresh_token! }), null, store.database, now + 90 * 86400_000)).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("keeps manual credentials and browser sessions distinct, with an independent key limit", async () => {
    const manual = await issueCredential("alice", "mcp", "legacy", store.database, now);
    const session = await issueCredential("alice", "session", "", store.database, now);
    await Promise.all(Array.from({ length: 4 }, () => issueCredential("alice", "mcp", "script", store.database, now)));
    const flow = await connected();
    expect(await resolveCredential(manual.token, "mcp", store.database, now)).toBe("alice");
    expect(await resolveCredential(session.token, "session", store.database, now)).toBe("alice");
    expect(await resolveConnectorToken(manual.token, store.database, now)).toBeNull();
    expect(await resolveConnectorToken(session.token, store.database, now)).toBeNull();
    expect(await resolveCredential(flow.token.access_token, "session", store.database, now)).toBeNull();
    await expect(issueCredential("alice", "mcp", "sixth", store.database, now)).rejects.toThrow();
  });
  it("persists a bounded login continuation and rejects external or arbitrary return destinations", async () => {
    const path = "/connect/authorize?request=" + "r".repeat(43);
    expect(safeReturnTo(path)).toBe(path); expect(safeReturnTo("/connect")).toBe("/connect");
    for (const value of ["https://evil.test", "//evil.test", "/api/oauth/authorize?redirect_uri=evil", path + "&next=//evil.test"]) expect(safeReturnTo(value)).toBeUndefined();
    const tx = await createOAuthTransaction(store.database, now, path);
    expect(await consumeOAuthTransactionDetails(tx.state, tx.browser, store.database, now)).toEqual({ returnTo: path });
    expect(await consumeOAuthTransactionDetails(tx.state, tx.browser, store.database, now)).toBeNull();
  });
  it("generates six client guides, an endpoint-only Cursor link, and explicit Codex login", () => {
    expect(CLIENTS).toHaveLength(6); expect(clientId("invalid")).toBe("claude");
    const endpoint = connectorUrls().resource;
    const url = new URL(cursorInstallUrl(endpoint));
    expect(JSON.parse(Buffer.from(url.searchParams.get("config")!, "base64").toString())).toEqual({ url: endpoint });
    expect(installPrompt("codex", endpoint)).toContain("codex mcp login zhiprism");
    expect(installPrompt("claude-code", endpoint)).toContain("get_connection_status");
    expect(VERIFY_PROMPT).toContain("get_connection_status");
    expect(new URL(claudeNewUrl("知棱 自检")).searchParams.get("q")).toBe("知棱 自检");
  });
  it("prefills a multi-round recent-chats prompt that ends in batched ingest with the recent_chats source", () => {
    const prompt = recentChatsPrompt();
    for (const needle of ["get_connection_status", "recent_chats", "conversation_search", "至少 3 轮", "ingest_conversation", "source 填 recent_chats", "retryable", "get_interest_profile", "最近 7 天"]) expect(prompt).toContain(needle);
    expect(prompt.length).toBeLessThanOrEqual(700);
    expect(recentChatsPrompt(3)).toContain("最近 3 天");
    expect(new URL(claudeNewUrl(prompt)).searchParams.get("q")).toBe(prompt);
  });
});
