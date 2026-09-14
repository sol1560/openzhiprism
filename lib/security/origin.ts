import { env } from "@/lib/env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const isLocal = (hostname: string) => LOCAL_HOSTS.has(hostname);

/**
 * Cookie-authenticated writes must come from the page that was served for this request.
 * Accepted: the request's own origin, the configured app URL, and (outside public mode) any
 * localhost / 127.0.0.1 port, so a dev server on 3097 or 3001 is not silently blocked.
 * Public mode additionally requires https unless the app itself runs on a local address.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const incoming = new URL(origin);
    const configured = new URL(env.appUrl);
    const self = new URL(request.url);
    if (env.publicMode && incoming.protocol !== "https:" && !isLocal(incoming.hostname)) return false;
    if (incoming.origin === configured.origin || incoming.origin === self.origin) return true;
    return !env.publicMode && isLocal(incoming.hostname);
  } catch { return false; }
}
export function rejectCrossOrigin(request: Request): Response | null {
  return isAllowedOrigin(request) ? null : Response.json({ error: "请求来源验证失败" }, { status: 403 });
}
