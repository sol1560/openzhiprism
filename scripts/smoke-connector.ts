/**
 * 部署后的连接器冒烟：pnpm smoke:connector https://zhi.openmo.org [--oauth] [--code <授权码>]
 * 环境变量 ZHIPRISM_SMOKE_TOKEN（/connect?client=sdk 生成的 zp_m_ 令牌）可在不走 OAuth 时调用工具。
 * 只打印 ok/FAIL，绝不打印任何令牌。
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { TOOL_NAMES } from "@/lib/mcp/instructions";

const [, , baseArg, ...flags] = process.argv;
if (!baseArg) { console.error("用法：pnpm smoke:connector <base-url> [--oauth] [--code <code>]"); process.exit(2); }
const base = new URL(baseArg).origin;
const wantOAuth = flags.includes("--oauth");
const pastedCode = flags.includes("--code") ? flags[flags.indexOf("--code") + 1] : undefined;
const manualToken = process.env.ZHIPRISM_SMOKE_TOKEN;
const CALLBACK_PORT = 43110;
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
}
async function getJson(path: string) {
  const response = await fetch(base + path, { headers: { accept: "application/json" }, redirect: "manual" });
  return { response, body: await response.json().catch(() => null) as Record<string, unknown> | null };
}
async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const raw = await response.text();
  const line = raw.startsWith("{") ? raw : raw.split("\n").find((entry) => entry.startsWith("data: "))?.slice(6) ?? "{}";
  return { response, body: JSON.parse(line) as { result?: Record<string, unknown>; error?: unknown } };
}

async function discovery() {
  const as = await getJson("/.well-known/oauth-authorization-server");
  check("授权服务器元数据", as.response.ok && as.body?.issuer === base && as.body?.client_id_metadata_document_supported === true
    && (as.body?.code_challenge_methods_supported as string[])?.includes("S256") && Boolean(as.body?.registration_endpoint), JSON.stringify(as.body));
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const pr = await getJson(path);
    check(`受保护资源元数据 ${path}`, pr.response.ok && pr.body?.resource === `${base}/api/mcp`, JSON.stringify(pr.body));
  }
  const card = await fetch(`${base}/.well-known/mcp/server-card.json`);
  const cardBody = await card.json().catch(() => null) as { transports?: { endpoint: string }[] } | null;
  check("server-card", card.ok && (card.headers.get("content-type") ?? "").startsWith("application/mcp-server-card+json") && cardBody?.transports?.[0]?.endpoint === `${base}/api/mcp`);
  const llms = await fetch(`${base}/llms.txt`); const llmsText = await llms.text();
  check("llms.txt", llms.ok && TOOL_NAMES.every((name) => llmsText.includes(name)));
  const robots = await fetch(`${base}/robots.txt`); check("robots.txt", robots.ok && (await robots.text()).includes("Sitemap:"));
  const sitemap = await fetch(`${base}/sitemap.xml`); check("sitemap.xml", sitemap.ok && (await sitemap.text()).includes("/connect"));
  const unauthorized = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const challenge = unauthorized.headers.get("www-authenticate") ?? "";
  check("无凭证 401 + resource_metadata", unauthorized.status === 401 && challenge.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource`), `${unauthorized.status} ${challenge}`);
}

async function register() {
  const response = await fetch(`${base}/api/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "zhiprism-smoke", redirect_uris: [`http://127.0.0.1:${CALLBACK_PORT}/callback`], token_endpoint_auth_method: "none" }) });
  const body = await response.json() as { client_id?: string };
  check("动态客户端注册", response.status === 201 && Boolean(body.client_id?.startsWith("zp_client_")), String(response.status));
  return body.client_id;
}

async function oauth(clientId: string) {
  const verifier = randomBytes(32).toString("base64url"), state = randomBytes(16).toString("base64url");
  const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), scope: "zhiprism offline_access", resource: `${base}/api/mcp`, state });
  console.log(`\n请在浏览器打开并完成授权：\n${base}/api/oauth/authorize?${query}\n`);
  const code = pastedCode ?? await new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", redirectUri);
      response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end("授权已回传，可以关闭此页。");
      server.close();
      if (url.searchParams.get("state") !== state) return reject(new Error("state 不匹配"));
      if (url.searchParams.get("iss") !== base) return reject(new Error("iss 不匹配"));
      const value = url.searchParams.get("code");
      if (value) resolve(value); else reject(new Error(url.searchParams.get("error") ?? "缺少 code"));
    }).listen(CALLBACK_PORT, "127.0.0.1");
    setTimeout(() => { server.close(); reject(new Error("等待授权超时")); }, 600_000).unref();
  });
  const exchange = async (params: Record<string, string>) => {
    const response = await fetch(`${base}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    return { response, body: await response.json() as { access_token?: string; refresh_token?: string; error?: string } };
  };
  const issued = await exchange({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier });
  check("授权码兑换", issued.response.ok && Boolean(issued.body.access_token) && Boolean(issued.body.refresh_token), issued.body.error ?? "");
  // token 端点有 30ms 的全局节流；本地回环太快会撞上
  await new Promise((resolve) => setTimeout(resolve, 100));
  const refreshed = await exchange({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.body.refresh_token ?? "" });
  check("刷新轮换", refreshed.response.ok && Boolean(refreshed.body.access_token) && refreshed.body.refresh_token !== issued.body.refresh_token, refreshed.body.error ?? "");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const replay = await exchange({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.body.refresh_token ?? "" });
  check("旧 refresh token 失效", replay.response.status === 400 && replay.body.error === "invalid_grant");
  return refreshed.body.access_token;
}

async function tools(token: string) {
  const list = await rpc(token, "tools/list");
  const names = ((list.body.result?.tools as { name: string }[] | undefined) ?? []).map((tool) => tool.name).sort();
  check("tools/list", JSON.stringify(names) === JSON.stringify([...TOOL_NAMES].sort()), names.join(","));
  const resources = await rpc(token, "resources/list");
  check("resources/list 四张卡片", ((resources.body.result?.resources as unknown[] | undefined) ?? []).length === 4);
  const status = await rpc(token, "tools/call", { name: "get_connection_status", arguments: {} });
  const payload = status.body.result?.structuredContent as Record<string, unknown> | undefined;
  check("get_connection_status", status.response.ok && payload?.ok === true, JSON.stringify(status.body.error ?? status.body.result));
  if (payload) console.log(`     client=${payload.client} auth=${payload.auth} topicCount=${payload.topicCount} feedToday=${payload.feedToday}`);
}

async function main() {
  await discovery();
  const clientId = await register();
  let token = manualToken;
  if (wantOAuth && clientId) token = await oauth(clientId) ?? token;
  if (token) await tools(token); else console.log("skip 工具调用（设置 ZHIPRISM_SMOKE_TOKEN 或加 --oauth）");
  console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
  process.exit(failures ? 1 : 0);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
