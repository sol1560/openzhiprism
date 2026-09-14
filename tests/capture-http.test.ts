import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { seedEmailUser, testDatabase } from "./helpers/database";
import { registerClient, startAuthorization, decideAuthorization, exchangeToken, resolveConnectorToken, extensionResource, connectorUrls, listConnections, setConnectionAutoIngest, revokeConnection } from "@/lib/connectors/oauth";
import { POST as capture } from "@/app/api/extension/captures/route";
import { GET as status } from "@/app/api/extension/captures/[id]/route";
import { readCaptureBody } from "@/lib/extension/http";

let database: Db, store: Awaited<ReturnType<typeof testDatabase>>;
const background: Array<() => Promise<void>> = [];
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => database }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: (fn: () => Promise<void>) => background.push(fn) }));
vi.mock("@/lib/extension/feed", () => ({ refreshCapturedFeed: vi.fn() }));
const origin = "http://localhost:3000", redirect = "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/zhiprism";
const verifier = "v".repeat(43);
const data = { version: 1, platform: "chatgpt", externalId: "00000000-1111-2222-3333-444444444444",
  sourceUrl: "https://chatgpt.com/c/00000000-1111-2222-3333-444444444444", title: "AI Agent",
  messages: [{ id: "message-1", role: "user", content: "我想了解 AI Agent 创业的机会。" }] };
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_PUBLIC_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("LLM_PROVIDER", "mock");
  store = await testDatabase(); database = store.database; background.length = 0;
  await seedEmailUser(database, "alice", "alice@example.test"); await seedEmailUser(database, "bob", "bob@example.test");
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });
async function authorize(userId = "alice", resource = extensionResource(), scope = "conversations:write offline_access") {
  const client = await registerClient({ client_name: "知棱浏览器插件", redirect_uris: [redirect], token_endpoint_auth_method: "none" }, database);
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource, scope, state: "state-123" });
  const request = await startAuthorization(params, database);
  const callback = new URL(await decideAuthorization(request.requestId, request.browser, userId, true, database, undefined, { autoIngest: true }));
  expect(callback.searchParams.get("state")).toBe("state-123");
  const tokens = await exchangeToken(new URLSearchParams({ client_id: client.client_id, grant_type: "authorization_code",
    code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: redirect, resource }), null, database);
  return { tokens, client, params };
}
const request = (token?: string, body: unknown = data) => new Request(origin + "/api/extension/captures", { method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
it("completes extension PKCE, keeps resource isolation, rotates refresh and rejects revoked tokens", async () => {
  const { tokens, client } = await authorize();
  const auth = await resolveConnectorToken(tokens.access_token, database, undefined, extensionResource());
  expect(auth?.userId).toBe("alice");
  expect(await resolveConnectorToken(tokens.access_token, database)).toBeNull();
  const connections = await listConnections("alice", database);
  expect(connections[0]).toMatchObject({ kind: "extension", autoIngest: false, status: "authorized" });
  expect(await setConnectionAutoIngest(connections[0].id, "alice", true, database)).toBe(false);
  const next = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id,
    refresh_token: tokens.refresh_token!, resource: extensionResource() }), null, database);
  expect(next.refresh_token).not.toBe(tokens.refresh_token);
  await revokeConnection(auth!.grantId, "alice", database);
  expect((await capture(request(next.access_token))).status).toBe(401);
});
it("rejects MCP tokens, session cookies, mixed scopes and changing resource on refresh", async () => {
  const mcp = await authorize("alice", connectorUrls().resource, "zhiprism offline_access");
  expect((await capture(request(mcp.tokens.access_token))).status).toBe(401);
  const cookie = request(); cookie.headers.set("Cookie", "zp_session=anything");
  expect((await capture(cookie)).status).toBe(401);
  const mixed = new URLSearchParams(mcp.params); mixed.set("resource", extensionResource());
  await expect(startAuthorization(mixed, database)).rejects.toMatchObject({ code: "invalid_scope" });
  await expect(exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: mcp.client.client_id,
    refresh_token: mcp.tokens.refresh_token!, resource: extensionResource() }), null, database)).rejects.toMatchObject({ code: "invalid_target" });
});
it("returns 202 before analysis, exposes only the owner's status, and reports repeated imports without reprocessing", async () => {
  const { tokens } = await authorize();
  const response = await capture(request(tokens.access_token));
  expect(response.status).toBe(202); const accepted = await response.json();
  expect(accepted.capture.status).toBe("queued");
  expect(await database.select().from(schema.conversations)).toHaveLength(0);
  await background.shift()!();
  const read = await status(new Request(origin, { headers: { Authorization: "Bearer " + tokens.access_token } }), { params: Promise.resolve({ id: accepted.id }) });
  expect((await read.json()).status).toBe("ready");
  const bob = await authorize("bob");
  expect((await status(new Request(origin, { headers: { Authorization: "Bearer " + bob.tokens.access_token } }), { params: Promise.resolve({ id: accepted.id }) })).status).toBe(404);
  const again = await capture(request(tokens.access_token));
  expect(again.status).toBe(200); expect((await again.json()).alreadyImported).toBe(true);
});
it("bounds streamed bytes and validates the source before accepting a task", async () => {
  const { tokens } = await authorize();
  expect((await capture(request(tokens.access_token, { ...data, sourceUrl: "https://evil.test/" }))).status).toBe(400);
  const over = request(tokens.access_token, { raw: "x".repeat(2 * 1024 * 1024) });
  over.headers.set("Content-Length", "10");
  await expect(readCaptureBody(over)).rejects.toMatchObject({ status: 413 });
});
