import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { schema } from "@/db";
import { testDatabase, seedEmailUser } from "./helpers/database";
import { issueCredential } from "@/lib/security/credentials";
import { createLoginCode, LOGIN_CODE_COOKIE } from "@/lib/auth/login-code";
import { createOAuthTransaction, OAUTH_COOKIE } from "@/lib/auth/oauth";
import { GOOGLE_VERIFIER_COOKIE } from "@/lib/auth/google";
import { connectorUrls, consentPath, resolveConnectorToken, requestCookie } from "@/lib/connectors/oauth";
import { TOOL_NAMES } from "@/lib/mcp/instructions";
import { GET as discover } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/[[...slug]]/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { GET as authorize, POST as decide } from "@/app/api/oauth/authorize/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { GET as connections, DELETE as revoke } from "@/app/api/connections/route";
import { POST as emailVerify } from "@/app/api/auth/email/verify/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { NextRequest } from "next/server";
vi.mock("@/lib/security/net", async (original) => ({ ...await original<typeof import("@/lib/security/net")>(),
  fetchPublicJson: async (url: URL) => ({ cacheControl: "max-age=300", json: { client_id: url.href, client_name: "Claude", token_endpoint_auth_method: "none",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"] } }) }));

let database: Db;
let store: Awaited<ReturnType<typeof testDatabase>>;
const jar = new Map<string, string>();
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => database }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value), delete: (name: string) => jar.delete(name) }) }));
vi.mock("@/lib/auth/google", async (original) => ({ ...await original<typeof import("@/lib/auth/google")>(),
  googleReadiness: () => ({ ready: true }),
  fetchGoogleIdentity: async () => ({ provider: "google", subject: "google-fixture", email: "google@example.test", displayName: "Google Fixture" }) }));

const origin = "http://localhost:3000";
const verifier = "v".repeat(43);
const callback = "https://claude.ai/api/mcp/auth_callback";
const jsonRequest = (path: string, body: unknown, headers: Record<string, string> = {}, method = "POST") => new Request(origin + path,
  { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_PUBLIC_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  store = await testDatabase(); database = store.database; jar.clear();
  await seedEmailUser(database, "alice", "alice@example.test");
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

async function begin() {
  const registered = await register(jsonRequest("/api/oauth/register", { client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: "none" }));
  expect(registered.status).toBe(201);
  const client = await registered.json();
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "round-trip-state" });
  const response = await authorize(new Request(`${origin}/api/oauth/authorize?${query}`));
  expect(response.status).toBe(307);
  const requestId = new URL(response.headers.get("location")!).searchParams.get("request")!;
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  jar.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
  return { requestId, client };
}
async function signedIn() {
  jar.set("zp_session", (await issueCredential("alice", "session", "", database)).token);
}
async function exchange(clientId: string, code: string) {
  return token(new Request(`${origin}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, code, code_verifier: verifier }) }));
}
async function rpc(access: string, method: string, params: unknown = {}) {
  const response = await mcp(jsonRequest("/api/mcp", { jsonrpc: "2.0", id: 1, method, params },
    { Authorization: `Bearer ${access}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }));
  const raw = await response.text();
  const body = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
  return { response, body };
}

it("serves discovery, completes consent and HTTP MCP, and verifies only a successful tool call", async () => {
  const unauthorized = await mcp(jsonRequest("/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("www-authenticate")).toContain(`${origin}/.well-known/oauth-protected-resource`);
  expect(unauthorized.headers.get("www-authenticate")).toContain("zhiprism");
  expect(await discover().json()).toMatchObject({ issuer: origin, code_challenge_methods_supported: ["S256"] });
  const metadata = await resourceMetadata(new Request(origin), { params: Promise.resolve({ slug: ["api", "mcp"] }) });
  expect(await metadata.json()).toMatchObject({ resource: connectorUrls().resource });
  expect((await resourceMetadata(new Request(origin), { params: Promise.resolve({ slug: ["other"] }) })).status).toBe(404);
  const flow = await begin(); await signedIn();
  const decision = await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }));
  expect(decision.status).toBe(200);
  const redirect = new URL((await decision.json()).redirect);
  expect(redirect.searchParams.get("state")).toBe("round-trip-state");
  const issued = await exchange(flow.client.client_id, redirect.searchParams.get("code")!);
  expect(issued.status).toBe(200); expect(issued.headers.get("cache-control")).toBe("no-store");
  const access = (await issued.json()).access_token;
  const listed = (await rpc(access, "tools/list")).body.result.tools as { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
  expect(listed.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
  for (const tool of listed) expect(tool._meta?.ui?.resourceUri).toMatch(/^ui:\/\/zhiprism\/[a-z]+\.html$/);
  const resources = (await rpc(access, "resources/list")).body.result.resources as { uri: string; mimeType: string }[];
  expect(resources.map((resource) => resource.uri).sort()).toEqual(["ui://zhiprism/cognition.html", "ui://zhiprism/feed.html", "ui://zhiprism/perspectives.html", "ui://zhiprism/profile.html", "ui://zhiprism/result.html"]);
  const widget = (await rpc(access, "resources/read", { uri: "ui://zhiprism/feed.html" })).body.result.contents[0];
  expect(widget.mimeType).toBe("text/html;profile=mcp-app"); expect(widget.text).toContain("<!DOCTYPE html>");
  expect((await (await connections()).json()).connections[0].status).toBe("authorized");
  const invalid = await rpc(access, "tools/call", { name: "get_interest_profile", arguments: { limit: -1 } });
  expect(invalid.body.result?.isError || invalid.body.error).toBeTruthy();
  expect((await (await connections()).json()).connections[0].status).toBe("authorized");
  const status = await rpc(access, "tools/call", { name: "get_connection_status", arguments: {} });
  expect(status.response.status).toBe(200);
  expect(status.body.result.structuredContent).toMatchObject({ ok: true, userId: "alice" });
  expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ ok: true, userId: "alice", auth: "oauth", client: "Claude",
    topicCount: 0, feedToday: false, manage: `${origin}/connect` });
  expect(JSON.parse(status.body.result.content[0].text).grantExpiresAt).toBeTruthy();
  const connection = (await (await connections()).json()).connections[0];
  expect(connection.status).toBe("verified");
  const profile = await rpc(access, "tools/call", { name: "get_interest_profile", arguments: {} });
  expect(JSON.parse(profile.body.result.content[0].text)).toEqual({ userId: "alice", topics: [] });
  expect((await revoke(jsonRequest("/api/connections", { id: connection.id }, {}, "DELETE"))).status).toBe(200);
  const rejected = await mcp(jsonRequest("/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { Authorization: `Bearer ${access}` }));
  expect(rejected.status).toBe(401);
});

it("enforces consent Origin, browser proof, session and management ownership", async () => {
  const flow = await begin();
  expect((await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }))).status).toBe(401);
  await signedIn();
  expect((await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }, { Origin: "https://evil.test" }))).status).toBe(403);
  expect((await revoke(jsonRequest("/api/connections", { id: crypto.randomUUID() }, { Origin: "https://evil.test" }, "DELETE"))).status).toBe(403);
  jar.delete(requestCookie(flow.requestId));
  expect((await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }))).status).toBe(400);
});

it("rejects wrong content types, oversized requests, rapid registration, and session Bearers", async () => {
  expect((await token(jsonRequest("/api/oauth/token", {}))).status).toBe(415);
  const result = await register(jsonRequest("/api/oauth/register", { data: "x".repeat(17_000) }));
  expect(result.status).toBe(413);
  expect((await register(jsonRequest("/api/oauth/register", {}))).status).toBe(429);
  const session = await issueCredential("alice", "session", "", database);
  expect((await mcp(jsonRequest("/api/mcp", {}, { Authorization: `Bearer ${session.token}` }))).status).toBe(401);
  const manual = await issueCredential("alice", "mcp", "existing", database);
  const profile = await rpc(manual.token, "tools/call", { name: "get_interest_profile", arguments: {} });
  expect(JSON.parse(profile.body.result.content[0].text).userId).toBe("alice");
  const status = await rpc(manual.token, "tools/call", { name: "get_connection_status", arguments: {} });
  expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ auth: "manual_token", client: "manual token", grantExpiresAt: null });
});

it("accepts a client metadata document URL as client_id and advertises CIMD support", async () => {
  expect(await discover().json()).toMatchObject({ client_id_metadata_document_supported: true });
  const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "cimd" });
  const response = await authorize(new Request(`${origin}/api/oauth/authorize?${query}`));
  expect(response.status).toBe(307);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  jar.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
  await signedIn();
  const decision = await decide(jsonRequest("/api/oauth/authorize", { requestId: new URL(response.headers.get("location")!).searchParams.get("request"), accept: true }));
  const redirect = new URL((await decision.json()).redirect);
  const issued = await exchange(clientId, redirect.searchParams.get("code")!);
  expect(issued.status).toBe(200);
  const status = await rpc((await issued.json()).access_token, "tools/call", { name: "get_connection_status", arguments: {} });
  expect(JSON.parse(status.body.result.content[0].text)).toMatchObject({ auth: "oauth", client: "Claude" });
  await new Promise((resolve) => setTimeout(resolve, 120)); // 越过 authorize 的 100ms 冷却门
  const bad = await authorize(new Request(`${origin}/api/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(query), client_id: "https://claude.ai" })}`));
  expect(bad.status).toBe(400); expect((await bad.json()).error).toBe("invalid_client");
});

it("resumes email login into a stored authorization request", async () => {
  const flow = await begin();
  const code = await createLoginCode("alice@example.test", database);
  jar.set(LOGIN_CODE_COOKIE, code.cookie);
  const response = await emailVerify(jsonRequest("/api/auth/email/verify", { code: code.code, next: consentPath(flow.requestId) }));
  expect(response.status).toBe(200);
  expect((await response.json()).next).toBe(consentPath(flow.requestId));
  expect((await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }))).status).toBe(200);
});

it("resumes Google login into the consent request with the same browser binding", async () => {
  const flow = await begin();
  const transaction = await createOAuthTransaction(database, Date.now(), consentPath(flow.requestId));
  const request = new NextRequest(`${origin}/api/auth/google/callback?code=fixture&state=${transaction.state}`, {
    headers: { Cookie: `${OAUTH_COOKIE}=${transaction.browser}; ${GOOGLE_VERIFIER_COOKIE}=${verifier}` },
  });
  const response = await googleCallback(request);
  expect(response.headers.get("location")).toBe(origin + consentPath(flow.requestId));
  const decision = await decide(jsonRequest("/api/oauth/authorize", { requestId: flow.requestId, accept: true }));
  expect(decision.status).toBe(200);
  const redirect = new URL((await decision.json()).redirect);
  const issued = await exchange(flow.client.client_id, redirect.searchParams.get("code")!);
  const identity = await resolveConnectorToken((await issued.json()).access_token, database);
  expect(identity?.userId).toBeTruthy(); expect(identity?.userId).not.toBe("alice");
  expect((await database.select().from(schema.connectorGrants))[0].userId).toBe(identity?.userId);
});
