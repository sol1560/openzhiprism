import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { NetError } from "@/lib/security/net";
import { metadataTtl, resolveMetadataClient, validateClientIdUrl, type MetadataFetcher } from "@/lib/connectors/cimd";
import { OAuthError, authorizationRequest, connectorUrls, decideAuthorization, exchangeToken, listConnections, startAuthorization } from "@/lib/connectors/oauth";
import { seedEmailUser, testDatabase } from "./helpers/database";

let store: Awaited<ReturnType<typeof testDatabase>>;
const now = 1_800_000_000_000;
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const CLAUDE_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const callback = "https://claude.ai/api/mcp/auth_callback";
/** 2026-09-12 从 claude.ai 实取的文档，注意 jwt-bearer 扩展授权类型。 */
const CLAUDE_DOC = { client_id: CLAUDE_ID, client_name: "Claude", client_uri: "https://claude.ai", redirect_uris: [callback],
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"], response_types: ["code"], token_endpoint_auth_method: "none" };
const doc = (json: unknown, cacheControl = "public, max-age=300"): MetadataFetcher => vi.fn(async () => ({ json, cacheControl }));

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_PUBLIC_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  store = await testDatabase();
  await seedEmailUser(store.database, "alice", "alice@example.test");
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

function authorizeParams(clientId = CLAUDE_ID, redirect = callback) {
  return new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge,
    code_challenge_method: "S256", scope: "zhiprism offline_access", resource: connectorUrls().resource, state: "s" });
}
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as OAuthError; }
  throw new Error("expected rejection");
}

describe("CIMD clients", () => {
  it("authorizes, exchanges and refreshes with the real claude.ai metadata document", async () => {
    const fetcher = doc(CLAUDE_DOC);
    const request = await startAuthorization(authorizeParams(), store.database, now, { fetchMetadata: fetcher });
    expect((await authorizationRequest(request.requestId, request.browser, store.database, now))?.client.name).toBe("Claude");
    const stored = (await store.database.select().from(schema.connectorClients))[0];
    expect(stored).toMatchObject({ id: CLAUDE_ID, authMethod: "none", grantTypes: ["authorization_code", "refresh_token"], metadataExpiresAt: now + 300_000 });
    const redirect = new URL(await decideAuthorization(request.requestId, request.browser, "alice", true, store.database, now));
    expect(redirect.origin + redirect.pathname).toBe(callback);
    const token = await exchangeToken(new URLSearchParams({ grant_type: "authorization_code", client_id: CLAUDE_ID, code: redirect.searchParams.get("code")!,
      code_verifier: verifier, redirect_uri: callback }), null, store.database, now);
    expect(token.refresh_token).toBeTruthy();
    const refreshed = await exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: CLAUDE_ID, refresh_token: token.refresh_token! }), null, store.database, now + 1000);
    expect(refreshed.access_token).not.toBe(token.access_token);
    expect((await listConnections("alice", store.database, now))[0].clientName).toBe("Claude");
    // 元数据客户端不能带 secret
    const withSecret = await failure(exchangeToken(new URLSearchParams({ grant_type: "refresh_token", client_id: CLAUDE_ID, client_secret: "x",
      refresh_token: refreshed.refresh_token! }), null, store.database, now + 2000));
    expect(withSecret.code).toBe("invalid_client");
  });

  it("caches the document until max-age expires and throttles refetches per origin", async () => {
    const fetcher = doc(CLAUDE_DOC);
    await resolveMetadataClient(CLAUDE_ID, store.database, now, fetcher);
    await resolveMetadataClient(CLAUDE_ID, store.database, now + 299_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolveMetadataClient(CLAUDE_ID, store.database, now + 300_001, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // 同一 origin 1 秒内的另一个未缓存文档被节流；已缓存的过期文档则继续沿用旧值
    const other = "https://claude.ai/oauth/claude-code-client-metadata";
    expect((await failure(resolveMetadataClient(other, store.database, now + 300_500, fetcher))).status).toBe(429);
    const stale = await resolveMetadataClient(CLAUDE_ID, store.database, now + 300_500 + 300_001, doc(CLAUDE_DOC));
    expect(stale.name).toBe("Claude");
    expect(metadataTtl("max-age=5", now)).toBe(now + 300_000);
    expect(metadataTtl("max-age=999999", now)).toBe(now + 86_400_000);
    expect(metadataTtl("", now)).toBe(now + 3_600_000);
  });

  it("rejects malformed client ids and documents with specific invalid_client reasons", async () => {
    expect(validateClientIdUrl("http://claude.ai/x")).toContain("https");
    expect(validateClientIdUrl("https://claude.ai")).toContain("路径");
    expect(validateClientIdUrl("https://claude.ai/a#b")).toContain("片段");
    expect(validateClientIdUrl("https://claude.ai/a/../b")).toContain("点段");
    expect(validateClientIdUrl("https://user:pw@claude.ai/a")).toContain("凭证");
    expect(validateClientIdUrl("https://localhost/a")).toContain("本机");
    expect(validateClientIdUrl("https://10.0.0.1/a")).toContain("私网");
    expect(validateClientIdUrl(CLAUDE_ID)).toBeNull();
    const cases: [unknown, string][] = [
      [{ ...CLAUDE_DOC, client_id: "https://claude.ai/other" }, "不一致"],
      [{ ...CLAUDE_DOC, token_endpoint_auth_method: "client_secret_post" }, "none"],
      [{ ...CLAUDE_DOC, client_name: "" }, "client_name"],
      [{ ...CLAUDE_DOC, redirect_uris: ["http://claude.ai/cb"] }, "redirect_uris"],
      [{ ...CLAUDE_DOC, grant_types: ["refresh_token"] }, "authorization_code"],
      ["not an object", "client_id"],
    ];
    let clock = now; // 每次抓取越过同 origin 的 1 秒冷却门
    for (const [json, fragment] of cases) {
      const error = await failure(resolveMetadataClient(CLAUDE_ID, store.database, clock += 1001, doc(json)));
      expect(error.code).toBe("invalid_client"); expect(error.message).toContain(fragment);
    }
    const network = await failure(resolveMetadataClient(CLAUDE_ID, store.database, clock += 1001, async () => { throw new NetError("DNS 解析失败"); }));
    expect(network.message).toContain("DNS 解析失败");
    const badUrl = await failure(startAuthorization(authorizeParams("https://claude.ai"), store.database, clock += 1001, { fetchMetadata: doc(CLAUDE_DOC) }));
    expect(badUrl.code).toBe("invalid_client");
    const badRedirect = await failure(startAuthorization(authorizeParams(CLAUDE_ID, "https://evil.test/cb"), store.database, clock += 1001, { fetchMetadata: doc(CLAUDE_DOC) }));
    expect(badRedirect.code).toBe("invalid_request");
    expect(await store.database.select().from(schema.connectorRequests)).toHaveLength(0);
  });
});
