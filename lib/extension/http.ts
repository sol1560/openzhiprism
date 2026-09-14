import { after } from "next/server";
import { MAX_CAPTURE_BYTES } from "./contract";
import { EXTENSION_SCOPE, extensionResource, resolveConnectorToken } from "@/lib/connectors/oauth";
import { runCapture } from "./service";
import { refreshCapturedFeed } from "./feed";

export class CaptureHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const HEADERS = { "Cache-Control": "private, no-store", "Access-Control-Allow-Origin": "*", "Vary": "Authorization" };
export function captureJson(body: unknown, status = 200) { return Response.json(body, { status, headers: HEADERS }); }
export function captureOptions() {
  return new Response(null, { status: 204, headers: { ...HEADERS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
}
export async function captureAuth(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  const auth = await resolveConnectorToken(bearer, undefined, undefined, extensionResource());
  if (!auth || !auth.scopes.includes(EXTENSION_SCOPE)) throw new CaptureHttpError(401, "请重新连接知棱后再捕捉。");
  return auth;
}
export async function readCaptureBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new CaptureHttpError(415, "需要 JSON 格式。");
  const reader = request.body?.getReader();
  if (!reader) throw new CaptureHttpError(400, "缺少聊天内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_CAPTURE_BYTES) { await reader.cancel(); throw new CaptureHttpError(413, "这段聊天超过 2 MiB，请分段后使用网页导入。"); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new CaptureHttpError(400, "聊天数据格式不正确。"); }
}
export function continueCapture(userId: string, id: string) {
  after(async () => { await runCapture(userId, id); await refreshCapturedFeed(userId); });
}
export function captureError(error: unknown) {
  if (!(error instanceof CaptureHttpError)) {
    // Classify locally, but never log SQL parameters, request bodies or tokens.
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
      messages.push(current.message);
      current = current.cause;
    }
    const reason = /no such (column|table)|SQLITE_SCHEMA/i.test(messages.join(" "))
      ? "storage_schema_mismatch" : /SQLITE_BUSY|SQLITE_LOCKED/i.test(messages.join(" "))
        ? "storage_busy" : "internal_error";
    console.error("[zhiprism] capture request failed", { reason });
  }
  const response = error instanceof CaptureHttpError ? captureJson({ error: error.message }, error.status)
    : captureJson({ error: "导入服务暂时不可用，请稍后重试。" }, 503);
  if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="extension"');
  return response;
}
