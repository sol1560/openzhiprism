import { APP_URL } from "./config";

interface Connection { clientId: string; accessToken: string; refreshToken?: string; expiresAt: number; account: { id: string; name: string } }
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => toBase64(crypto.getRandomValues(new Uint8Array(32)));
let refreshing: Promise<Connection> | undefined;
export async function connection(): Promise<Connection | undefined> { return (await chrome.storage.local.get("connection")).connection as Connection | undefined; }
async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(`${APP_URL}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource: `${APP_URL}/api/extension` }), signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) throw new Error("连接已过期，请重新连接知棱。");
  return await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
}
export async function connect() {
  const verifier = random(), state = random();
  const challenge = toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirectUri = chrome.identity.getRedirectURL("zhiprism");
  const registration = await fetch(`${APP_URL}/api/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "知棱浏览器插件", redirect_uris: [redirectUri], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }), signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!registration.ok) throw new Error("暂时无法连接知棱，请稍后重试。");
  const { client_id: clientId } = await registration.json() as { client_id: string };
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge_method: "S256",
    code_challenge: challenge, state, scope: "conversations:write offline_access", resource: `${APP_URL}/api/extension` });
  const result = await chrome.identity.launchWebAuthFlow({ url: `${APP_URL}/api/oauth/authorize?${params}`, interactive: true });
  if (!result) throw new Error("连接已取消。");
  const callback = new URL(result);
  if (callback.origin + callback.pathname !== redirectUri || callback.searchParams.get("state") !== state || callback.searchParams.get("iss") !== APP_URL) throw new Error("无法验证这次授权，请重新连接。");
  if (callback.searchParams.has("error")) throw new Error("连接已取消。");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("授权没有完成，请重试。");
  const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
  const accountResponse = await fetch(`${APP_URL}/api/extension/account`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!accountResponse.ok) throw new Error("无法读取连接账户，请重试。");
  const account = await accountResponse.json() as Connection["account"];
  await chrome.storage.local.set({ connection: { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000, account } satisfies Connection, tasks: [], lastResult: null });
}
async function validConnection(): Promise<Connection> {
  const saved = await connection();
  if (!saved) throw new Error("请先连接知棱。");
  if (saved.expiresAt > Date.now() + 30_000) return saved;
  if (!saved.refreshToken) throw new Error("连接已过期，请重新连接知棱。");
  refreshing ??= (async () => {
    try {
      const tokens = await tokenRequest({ grant_type: "refresh_token", client_id: saved.clientId, refresh_token: saved.refreshToken! });
      const updated = { ...saved, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
      await chrome.storage.local.set({ connection: updated });
      return updated;
    } catch {
      await chrome.storage.local.remove("connection");
      throw new Error("连接已过期，请重新连接知棱。");
    }
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await validConnection();
  const response = await fetch(`${APP_URL}/api/extension${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (response.status === 401) { await chrome.storage.local.remove("connection"); throw new Error("授权已失效，请重新连接知棱。"); }
  if (!response.ok) {
    const known: Record<number, string> = { 400: "捕捉数据不完整，请刷新聊天页后重试。", 404: "没有找到这次捕捉。", 413: "这段聊天超过 2 MiB，请分段后使用网页导入。", 429: "操作较频繁，请稍后重试。" };
    throw new Error(known[response.status] ?? "导入服务暂时不可用，请稍后重试。");
  }
  return response.json() as Promise<T>;
}
export async function disconnect() {
  const saved = await connection();
  if (saved) {
    const response = await fetch(`${APP_URL}/api/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: saved.clientId, token: saved.refreshToken ?? saved.accessToken }), signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("撤销失败，请重试，或在知棱「连接 AI」中撤销。");
  }
  await chrome.storage.local.remove(["connection", "tasks", "lastResult"]);
  await chrome.alarms.clear("capture-status");
}
