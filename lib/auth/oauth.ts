import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { env, ZHIHU_OAUTH_BASE_URL } from "@/lib/env";
import { digest, secret } from "@/lib/security/credentials";
import { persistIdentity } from "./identity";
import { writeTransaction } from "@/lib/security/transaction";
export const OAUTH_COOKIE = "zp_oauth_browser";
export function oauthReadiness(): { ready: boolean; reason?: string } {
  if (!env.zhihuOAuthAppId || !env.zhihuOAuthAppKey) return { ready: false, reason: "尚未配置正式 OAuth 应用凭证" };
  if (!env.oauthContractVerified || !env.oauthUserInfoUrl || !env.oauthSubjectPath) return { ready: false, reason: "尚未确认用户身份接口和授权事务校验" };
  try {
    const url = new URL(env.oauthUserInfoUrl);
    if (url.origin !== ZHIHU_OAUTH_BASE_URL || url.username || url.password || url.hash) return { ready: false, reason: "用户身份接口地址不合法" };
    if (env.publicMode && new URL(env.appUrl).protocol !== "https:") return { ready: false, reason: "公开登录需要 HTTPS" };
  } catch { return { ready: false, reason: "OAuth 地址配置不合法" }; }
  return { ready: true };
}
export async function createOAuthTransaction(database?: Db, now = Date.now(), returnTo?: string) {
  const databaseInstance = database ?? await db();
  const state = secret(), browser = secret();
  await writeTransaction(databaseInstance, async (tx) => {
    await tx.insert(schema.oauthTransactions).values({ stateHash: digest(state), browserHash: digest(browser), createdAt: now, expiresAt: now + 600000, returnTo });
  });
  return { state, browser };
}
export async function consumeOAuthTransaction(state: string, browser: string, database?: Db, now = Date.now()) {
  return Boolean(await consumeOAuthTransactionDetails(state, browser, database, now));
}
export async function consumeOAuthTransactionDetails(state: string, browser: string, database?: Db, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return null;
  const databaseInstance = database ?? await db();
  return writeTransaction(databaseInstance, async (tx) => {
    const rows = await tx.update(schema.oauthTransactions).set({ consumedAt: now }).where(and(
      eq(schema.oauthTransactions.stateHash, digest(state)), eq(schema.oauthTransactions.browserHash, digest(browser)),
      isNull(schema.oauthTransactions.consumedAt), gt(schema.oauthTransactions.expiresAt, now),
    )).returning({ returnTo: schema.oauthTransactions.returnTo });
    return rows[0] ?? null;
  });
}
export function buildOAuthAuthorizeUrl(redirectUri: string, state: string) {
  const url = new URL("/authorize", ZHIHU_OAUTH_BASE_URL);
  url.searchParams.set("app_id", env.zhihuOAuthAppId ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}
export async function exchangeOAuthCode(code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(new URL("/access_token", ZHIHU_OAUTH_BASE_URL), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ app_id: env.zhihuOAuthAppId ?? "", app_key: env.zhihuOAuthAppKey ?? "",
      grant_type: "authorization_code", redirect_uri: redirectUri, code }),
    signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "error",
  });
  const raw = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof raw.access_token !== "string" || !raw.access_token) throw new Error("OAuth token exchange failed");
  return raw.access_token;
}
function field(raw: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let value = raw;
  for (const key of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export interface ZhihuIdentity { subject: string; displayName: string }
/** Endpoint and field paths must come from approved official documentation; no guessed defaults. */
export async function fetchOAuthIdentity(token: string, fetcher: typeof fetch = fetch): Promise<ZhihuIdentity> {
  if (!oauthReadiness().ready) throw new Error("OAuth identity contract unavailable");
  const response = await fetcher(env.oauthUserInfoUrl!, { headers: { Authorization: `Bearer ${token}` },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("OAuth identity request failed");
  const raw: unknown = await response.json();
  const subject = field(raw, env.oauthSubjectPath);
  if (typeof subject !== "string" || !subject.trim() || subject.length > 256) throw new Error("OAuth stable subject missing");
  const name = field(raw, env.oauthNamePath);
  return { subject, displayName: typeof name === "string" && name.trim() ? name.slice(0, 80) : "知乎用户" };
}
export async function persistOAuthIdentity(identity: ZhihuIdentity, database?: Db) {
  return persistIdentity({ provider: "zhihu", subject: identity.subject, email: null, displayName: identity.displayName }, database);
}
