import { db } from "@/db";
import { claimGate } from "@/lib/security/gate";
import { writeTransaction } from "@/lib/security/transaction";
import { digest } from "@/lib/security/credentials";
import { OAuthError, connectorUrls } from "./oauth";

export const OAUTH_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" };
export const DISCOVERY_HEADERS = { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
export function oauthJson(body: unknown, status = 200) { return Response.json(body, { status, headers: OAUTH_HEADERS }); }
/** 发现文件（llms.txt、server-card 等）：可缓存、允许匿名跨域读取。 */
export function discoveryResponse(body: string, contentType: string) { return new Response(body, { headers: { ...DISCOVERY_HEADERS, "Content-Type": contentType } }); }
export function oauthError(error: unknown) {
  if (error instanceof OAuthError) {
    const response = oauthJson({ error: error.code, error_description: error.message }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "2");
    if (error.status === 401) response.headers.set("WWW-Authenticate", "Basic realm=\"connector\"");
    return response;
  }
  return oauthJson({ error: "server_error", error_description: "连接服务暂时不可用，请稍后重试。" }, 503);
}
export function oauthOptions() {
  return new Response(null, { status: 204, headers: { ...OAUTH_HEADERS,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}
export async function readOAuthBody(request: Request, format: "json" | "form") {
  const expected = format === "json" ? "application/json" : "application/x-www-form-urlencoded";
  if (request.headers.get("content-type")?.split(";")[0].trim() !== expected) throw new OAuthError("invalid_request", `需要 ${expected}。`, 415);
  // Bound reads before parsing; Content-Length alone cannot be trusted.
  const reader = request.body?.getReader();
  if (!reader) throw new OAuthError("invalid_request", "请求内容为空。");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) { await reader.cancel(); throw new OAuthError("invalid_request", "请求内容过长。", 413); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (format === "form") return new URLSearchParams(text);
  try { return JSON.parse(text) as unknown; } catch { throw new OAuthError("invalid_request", "JSON 不合法。"); }
}
export async function limitOAuth(kind: "register" | "authorize" | "token", key = "global") {
  connectorUrls();
  const interval = kind === "register" ? 2000 : kind === "authorize" ? 100 : 30;
  const allowed = await writeTransaction(await db(), (tx) => claimGate(tx, `connector:${kind}:${digest(key)}`, interval));
  if (!allowed) throw new OAuthError("temporarily_unavailable", "请求过于频繁，请稍后重试。", 429);
}
