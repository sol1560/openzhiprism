import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@/db";
import { env } from "@/lib/env";
import { digest, secret } from "@/lib/security/credentials";
import { writeTransaction, type WriteTx } from "@/lib/security/transaction";
import { isClientIdUrl, resolveMetadataClient, type MetadataFetcher } from "./cimd";

const HOUR = 3_600_000;
const GRANT_TTL = 90 * 24 * HOUR;
const CODE_TTL = 5 * 60_000;
const REQUEST_TTL = 10 * 60_000;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
export const CONNECTOR_SCOPE = "zhiprism";
export const CONNECTOR_SCOPES = "zhiprism offline_access";
export const EXTENSION_SCOPE = "conversations:write";
export const ALL_OAUTH_SCOPES = `${CONNECTOR_SCOPES} ${EXTENSION_SCOPE}`;
export function extensionResource() { return `${connectorUrls().issuer}/api/extension`; }
function knownResource(resource: string) { return resource === connectorUrls().resource || resource === extensionResource(); }

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function connectorUrls() {
  const url = new URL(env.appUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !["http:", "https:"].includes(url.protocol) || (env.publicMode && url.protocol !== "https:")) {
    throw new OAuthError("server_error", "连接服务地址配置不正确。", 503);
  }
  const issuer = url.origin;
  return { issuer, resource: `${issuer}/api/mcp`, metadata: `${issuer}/.well-known/oauth-protected-resource` };
}

/** robots/sitemap 用：配置不合法时退回 appUrl origin，永远不抛。 */
export function siteOrigin() {
  try { return connectorUrls().issuer; } catch { return new URL(env.appUrl).origin; }
}

function isLoopback(url: URL) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
export function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return !u.username && !u.password && !u.hash && (u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u)));
  } catch { return false; }
}
export function matchesRedirect(registered: string, requested: string): boolean {
  if (!validRedirect(requested)) return false;
  if (registered === requested) return true;
  const a = new URL(registered), b = new URL(requested);
  if (a.protocol !== "http:" || b.protocol !== "http:" || !isLoopback(a) || !isLoopback(b)) return false;
  // RFC 8252 native clients bind a different local port on each login.
  a.port = ""; b.port = "";
  return a.href === b.href;
}

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default("AI 客户端"),
  redirect_uris: z.array(z.string().max(2048).refine(validRedirect)).min(1).max(10),
  token_endpoint_auth_method: z.enum(["none", "client_secret_basic", "client_secret_post"]).default("client_secret_basic"),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).min(1).max(2).default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
});

export async function registerClient(input: unknown, database?: Db, now = Date.now()) {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success || !parsed.data.grant_types.includes("authorization_code")) throw new OAuthError("invalid_client_metadata", "客户端注册信息不合法。");
  const data = parsed.data, id = `zp_client_${secret()}`;
  const clientSecret = data.token_endpoint_auth_method === "none" ? undefined : secret();
  await (database ?? await db()).insert(schema.connectorClients).values({ id, name: data.client_name,
    redirectUris: data.redirect_uris, authMethod: data.token_endpoint_auth_method, grantTypes: data.grant_types,
    secretHash: clientSecret ? digest(clientSecret) : null, createdAt: now });
  return { ...data, client_id: id, client_id_issued_at: Math.floor(now / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}), scope: CONNECTOR_SCOPES };
}

export function singleParams(params: URLSearchParams) {
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length !== 1) throw new OAuthError("invalid_request", "请求包含重复参数。");
  }
  return params;
}
function scopes(value: string | null, resource = connectorUrls().resource) {
  const required = resource === extensionResource() ? EXTENSION_SCOPE : CONNECTOR_SCOPE;
  const allowed = `${required} offline_access`;
  const requested = [...new Set((value ?? allowed).split(/\s+/).filter(Boolean))];
  if (!requested.includes(required) || requested.some((s) => !allowed.split(" ").includes(s))) {
    throw new OAuthError("invalid_scope", "请求的权限不受支持。");
  }
  return requested.join(" ");
}

export function requestCookie(id: string) { return `zp_connector_${id.slice(0, 12)}`; }
export function consentPath(id: string) { return `/connect/authorize?request=${encodeURIComponent(id)}`; }

export async function startAuthorization(raw: URLSearchParams, database?: Db, now = Date.now(), deps: { fetchMetadata?: MetadataFetcher } = {}) {
  const params = singleParams(raw), databaseInstance = database ?? await db();
  const clientId = params.get("client_id") ?? "";
  // client_id 为 https URL 时走 CIMD；失败以 JSON 返回，不重定向到尚未信任的 redirect_uri
  const client = isClientIdUrl(clientId)
    ? await resolveMetadataClient(clientId, databaseInstance, now, deps.fetchMetadata)
    : (await databaseInstance.select().from(schema.connectorClients).where(eq(schema.connectorClients.id, clientId)))[0];
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client || !client.redirectUris.some((uri) => matchesRedirect(uri, redirectUri))) throw new OAuthError("invalid_request", "客户端或回调地址无效，请从客户端重新连接。");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "只支持授权码流程。");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !OPAQUE.test(challenge)) throw new OAuthError("invalid_request", "连接需要 S256 PKCE 校验。");
  const resource = params.get("resource") ?? connectorUrls().resource;
  if (!knownResource(resource)) throw new OAuthError("invalid_target", "授权目标不匹配。");
  const state = params.get("state");
  if (state && state.length > 2048) throw new OAuthError("invalid_request", "state 过长。");
  const requestedScope = scopes(params.get("scope"), resource);
  if (requestedScope.split(" ").includes("offline_access") && !client.grantTypes.includes("refresh_token")) throw new OAuthError("invalid_scope", "此客户端未注册续期权限。");
  const requestId = secret(), browser = secret();
  await databaseInstance.insert(schema.connectorRequests).values({ requestHash: digest(requestId), browserHash: digest(browser),
    clientId: client.id, redirectUri, state, challenge, scope: requestedScope, resource, expiresAt: now + REQUEST_TTL });
  return { requestId, browser };
}

export async function authorizationRequest(id: string, browser: string | undefined, database?: Db, now = Date.now()) {
  if (!OPAQUE.test(id) || !browser || !OPAQUE.test(browser)) return null;
  const [row] = await (database ?? await db()).select({ request: schema.connectorRequests, client: schema.connectorClients })
    .from(schema.connectorRequests).innerJoin(schema.connectorClients, eq(schema.connectorRequests.clientId, schema.connectorClients.id))
    .where(and(eq(schema.connectorRequests.requestHash, digest(id)), eq(schema.connectorRequests.browserHash, digest(browser)),
      gt(schema.connectorRequests.expiresAt, now), isNull(schema.connectorRequests.consumedAt)));
  return row ?? null;
}

async function userAllowed(tx: Db | WriteTx, userId: string) {
  const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return false;
  if (!env.publicMode) return true;
  const [identity] = await tx.select({ id: schema.oauthIdentities.userId }).from(schema.oauthIdentities).where(eq(schema.oauthIdentities.userId, userId)).limit(1);
  return Boolean(identity);
}

export async function decideAuthorization(id: string, browser: string | undefined, userId: string, accept: boolean, database?: Db, now = Date.now(), options: { autoIngest?: boolean } = {}) {
  const databaseInstance = database ?? await db();
  const pending = await authorizationRequest(id, browser, databaseInstance, now);
  if (!pending) throw new OAuthError("invalid_request", "这次授权已过期或已处理，请从客户端重新连接。");
  return writeTransaction(databaseInstance, async (tx) => {
    if (!await userAllowed(tx, userId)) throw new OAuthError("access_denied", "请先登录知棱。", 401);
    const rows = await tx.update(schema.connectorRequests).set({ consumedAt: now }).where(and(
      eq(schema.connectorRequests.requestHash, digest(id)), isNull(schema.connectorRequests.consumedAt), gt(schema.connectorRequests.expiresAt, now),
    )).returning({ id: schema.connectorRequests.requestHash });
    if (!rows.length) throw new OAuthError("invalid_request", "这次授权已处理，请从客户端重新连接。");
    const request = pending.request, redirect = new URL(request.redirectUri);
    if (request.state !== null) redirect.searchParams.set("state", request.state);
    redirect.searchParams.set("iss", connectorUrls().issuer);
    if (!accept) { redirect.searchParams.set("error", "access_denied"); return redirect.toString(); }
    const grantId = randomUUID(), code = secret();
    await tx.insert(schema.connectorGrants).values({ id: grantId, userId, clientId: request.clientId, scope: request.scope,
      resource: request.resource, createdAt: now, expiresAt: now + (request.scope.split(" ").includes("offline_access") ? GRANT_TTL : HOUR),
      autoIngest: request.resource === connectorUrls().resource && options.autoIngest === true });
    await tx.insert(schema.connectorCredentials).values({ tokenHash: digest(code), grantId, kind: "code",
      redirectUri: request.redirectUri, challenge: request.challenge, expiresAt: now + CODE_TTL });
    redirect.searchParams.set("code", code);
    return redirect.toString();
  });
}

async function authenticateClient(params: URLSearchParams, authorization: string | null, database: Db) {
  let id = params.get("client_id") ?? "", supplied = params.get("client_secret"), method = supplied !== null ? "client_secret_post" : "none";
  if (authorization) {
    if (!authorization.startsWith("Basic ") || supplied !== null) throw new OAuthError("invalid_client", "客户端验证失败。", 401);
    let basic: string;
    try { basic = Buffer.from(authorization.slice(6), "base64").toString("utf8"); } catch { throw new OAuthError("invalid_client", "客户端验证失败。", 401); }
    const split = basic.indexOf(":");
    if (split < 1) throw new OAuthError("invalid_client", "客户端验证失败。", 401);
    try {
      const basicId = decodeURIComponent(basic.slice(0, split).replace(/\+/g, " "));
      if (id && id !== basicId) throw new Error("mismatch");
      id = basicId; supplied = decodeURIComponent(basic.slice(split + 1).replace(/\+/g, " ")); method = "client_secret_basic";
    } catch { throw new OAuthError("invalid_client", "客户端验证失败。", 401); }
  }
  if (isClientIdUrl(id) && (method !== "none" || supplied !== null)) throw new OAuthError("invalid_client", "元数据客户端只能使用 none 认证方式。", 401);
  const [client] = await database.select().from(schema.connectorClients).where(eq(schema.connectorClients.id, id));
  if (!client || client.authMethod !== method || (method !== "none" && (!supplied || !client.secretHash ||
      !timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(client.secretHash))))) {
    throw new OAuthError("invalid_client", "客户端验证失败。", 401);
  }
  return client;
}

export async function exchangeToken(raw: URLSearchParams, authorization: string | null, database?: Db, now = Date.now()) {
  const params = singleParams(raw), databaseInstance = database ?? await db();
  const client = await authenticateClient(params, authorization, databaseInstance);
  const type = params.get("grant_type");
  if (type !== "authorization_code" && type !== "refresh_token") throw new OAuthError("unsupported_grant_type", "不支持此授权方式。");
  if (!client.grantTypes.includes(type)) throw new OAuthError("unauthorized_client", "客户端未注册此授权方式。");
  const value = params.get(type === "authorization_code" ? "code" : "refresh_token") ?? "";
  if (!OPAQUE.test(value)) throw new OAuthError("invalid_grant", "授权凭证无效或已过期。");
  const result = await writeTransaction(databaseInstance, async (tx) => {
    const [row] = await tx.select({ credential: schema.connectorCredentials, grant: schema.connectorGrants })
      .from(schema.connectorCredentials).innerJoin(schema.connectorGrants, eq(schema.connectorCredentials.grantId, schema.connectorGrants.id))
      .where(eq(schema.connectorCredentials.tokenHash, digest(value)));
    const expectedKind = type === "authorization_code" ? "code" : "refresh";
    if (!row || row.credential.kind !== expectedKind || row.grant.clientId !== client.id) return null;
    const { credential, grant } = row;
    if (!knownResource(grant.resource) || (params.has("resource") && params.get("resource") !== grant.resource)) {
      throw new OAuthError("invalid_target", "授权目标不匹配。");
    }
    if (type === "authorization_code") {
      const verifier = params.get("code_verifier") ?? "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || credential.redirectUri !== params.get("redirect_uri") ||
          createHash("sha256").update(verifier).digest("base64url") !== credential.challenge) return null;
    }
    if (credential.consumedAt !== null) {
      // Commit the revocation before returning invalid_grant, including code replay.
      await tx.update(schema.connectorGrants).set({ revokedAt: now }).where(eq(schema.connectorGrants.id, grant.id));
      return null;
    }
    if (credential.expiresAt <= now || grant.expiresAt <= now || grant.revokedAt !== null || !await userAllowed(tx, grant.userId)) return null;
    if (params.has("scope") && scopes(params.get("scope"), grant.resource) !== grant.scope) throw new OAuthError("invalid_scope", "刷新不能更改已授权权限。");
    await tx.update(schema.connectorCredentials).set({ consumedAt: now }).where(eq(schema.connectorCredentials.tokenHash, credential.tokenHash));
    const access = secret(), refresh = grant.scope.split(" ").includes("offline_access") ? secret() : undefined;
    const expiresAt = Math.min(now + HOUR, grant.expiresAt);
    await tx.insert(schema.connectorCredentials).values({ tokenHash: digest(access), grantId: grant.id, kind: "access", expiresAt });
    if (refresh) await tx.insert(schema.connectorCredentials).values({ tokenHash: digest(refresh), grantId: grant.id, kind: "refresh", expiresAt: grant.expiresAt });
    return { access_token: access, token_type: "Bearer", expires_in: Math.floor((expiresAt - now) / 1000), scope: grant.scope,
      ...(refresh ? { refresh_token: refresh } : {}) };
  });
  if (!result) throw new OAuthError("invalid_grant", "授权凭证无效或已过期，请重新连接。");
  return result;
}

export async function resolveConnectorToken(token: string | undefined, database?: Db, now = Date.now(), resource = connectorUrls().resource) {
  if (!token || !OPAQUE.test(token)) return null;
  const databaseInstance = database ?? await db();
  const [row] = await databaseInstance.select({ credential: schema.connectorCredentials, grant: schema.connectorGrants })
    .from(schema.connectorCredentials).innerJoin(schema.connectorGrants, eq(schema.connectorCredentials.grantId, schema.connectorGrants.id))
    .where(and(eq(schema.connectorCredentials.tokenHash, digest(token)), eq(schema.connectorCredentials.kind, "access"),
      gt(schema.connectorCredentials.expiresAt, now), isNull(schema.connectorGrants.revokedAt), gt(schema.connectorGrants.expiresAt, now)));
  if (!knownResource(resource) || !row || row.grant.resource !== resource || !await userAllowed(databaseInstance, row.grant.userId)) return null;
  return { userId: row.grant.userId, grantId: row.grant.id, clientId: row.grant.clientId,
    scopes: row.grant.scope.split(" "), expiresAt: Math.floor(row.credential.expiresAt / 1000) };
}

export async function markConnectorUsed(grantId: string, userId: string, database?: Db, now = Date.now()) {
  await (database ?? await db()).update(schema.connectorGrants).set({ lastUsedAt: now }).where(and(
    eq(schema.connectorGrants.id, grantId), eq(schema.connectorGrants.userId, userId), isNull(schema.connectorGrants.revokedAt), gt(schema.connectorGrants.expiresAt, now)));
}

/** 连接自检用：某次授权的客户端名称与有效期，只能查自己的授权。 */
export async function describeGrant(grantId: string, userId: string, database?: Db) {
  const [row] = await (database ?? await db()).select({ grant: schema.connectorGrants, name: schema.connectorClients.name })
    .from(schema.connectorGrants).innerJoin(schema.connectorClients, eq(schema.connectorGrants.clientId, schema.connectorClients.id))
    .where(and(eq(schema.connectorGrants.id, grantId), eq(schema.connectorGrants.userId, userId)));
  return row ? { clientName: row.name, clientId: row.grant.clientId, scope: row.grant.scope, createdAt: row.grant.createdAt,
    expiresAt: row.grant.expiresAt, lastUsedAt: row.grant.lastUsedAt, revoked: row.grant.revokedAt !== null, autoIngest: row.grant.autoIngest } : null;
}

export async function listConnections(userId: string, database?: Db, now = Date.now()) {
  const rows = await (database ?? await db()).select({ grant: schema.connectorGrants, name: schema.connectorClients.name })
    .from(schema.connectorGrants).innerJoin(schema.connectorClients, eq(schema.connectorGrants.clientId, schema.connectorClients.id))
    .where(eq(schema.connectorGrants.userId, userId)).orderBy(desc(schema.connectorGrants.createdAt));
  return rows.map(({ grant, name }) => ({ id: grant.id, clientName: name, createdAt: grant.createdAt, expiresAt: grant.expiresAt,
    lastUsedAt: grant.lastUsedAt, autoIngest: grant.autoIngest, kind: grant.resource === extensionResource() ? "extension" as const : "connector" as const,
    status: grant.revokedAt !== null || grant.expiresAt <= now ? "expired" as const : grant.lastUsedAt !== null ? "verified" as const : "authorized" as const }));
}

/** 切换某个连接的自动采集；只能改自己的、仍有效的授权。返回是否命中。 */
export async function setConnectionAutoIngest(id: string, userId: string, autoIngest: boolean, database?: Db, now = Date.now()) {
  const rows = await (database ?? await db()).update(schema.connectorGrants).set({ autoIngest }).where(and(
    eq(schema.connectorGrants.resource, connectorUrls().resource),
    eq(schema.connectorGrants.id, id), eq(schema.connectorGrants.userId, userId), isNull(schema.connectorGrants.revokedAt), gt(schema.connectorGrants.expiresAt, now),
  )).returning({ id: schema.connectorGrants.id });
  return rows.length > 0;
}

export async function revokeConnection(id: string, userId: string, database?: Db, now = Date.now()) {
  await (database ?? await db()).update(schema.connectorGrants).set({ revokedAt: now })
    .where(and(eq(schema.connectorGrants.id, id), eq(schema.connectorGrants.userId, userId)));
}

export async function revokeOAuthToken(raw: URLSearchParams, authorization: string | null, database?: Db, now = Date.now()) {
  const params = singleParams(raw), databaseInstance = database ?? await db();
  const client = await authenticateClient(params, authorization, databaseInstance);
  const [row] = await databaseInstance.select({ grant: schema.connectorGrants }).from(schema.connectorCredentials)
    .innerJoin(schema.connectorGrants, eq(schema.connectorCredentials.grantId, schema.connectorGrants.id))
    .where(eq(schema.connectorCredentials.tokenHash, digest(params.get("token") ?? "")));
  if (row?.grant.clientId === client.id) await revokeConnection(row.grant.id, row.grant.userId, databaseInstance, now);
}
