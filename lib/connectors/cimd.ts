import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import { claimGate } from "@/lib/security/gate";
import { digest } from "@/lib/security/credentials";
import { fetchPublicJson, isPublicIp, NetError, type PublicJson } from "@/lib/security/net";
import { writeTransaction } from "@/lib/security/transaction";
import { OAuthError, validRedirect } from "./oauth";

/**
 * OAuth Client ID Metadata Documents（CIMD，MCP 2026-07-28 profile）：
 * client_id 本身是一个 https URL，指向客户端自己托管的 JSON 元数据。claude.ai 新版连接器优先走这条路，
 * 其次才回退到动态注册。文档缓存成 connector_clients 行（授权与请求表对它有外键），按 Cache-Control 到期后重新拉取。
 */

export type MetadataFetcher = (url: URL) => Promise<PublicJson>;

const MIN_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 3_600_000;
const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().max(2048).refine(validRedirect)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  // claude.ai 的文档带 jwt-bearer 等扩展授权类型，只能放行不能枚举校验
  grant_types: z.array(z.string()).optional(),
}).loose();

export function isClientIdUrl(id: string) { return /^https:\/\//i.test(id); }

/** 返回 null 表示合法，否则返回中文原因。规则来自 CIMD 草案：https、显式 authority 与 path、无点段、无片段、无凭证、公网主机。 */
export function validateClientIdUrl(id: string): string | null {
  let url: URL;
  try { url = new URL(id); } catch { return "不是合法 URL"; }
  if (url.protocol !== "https:") return "必须使用 https";
  if (url.username || url.password) return "不能携带凭证";
  if (id.includes("#")) return "不能包含片段";
  const afterAuthority = id.slice(id.indexOf("//") + 2);
  if (!afterAuthority.includes("/")) return "必须包含显式路径";
  // URL 解析会先规范化点段，必须看原始字符串
  if (/(^|\/)\.\.?(\/|\?|$)/.test(afterAuthority.slice(afterAuthority.indexOf("/")))) return "路径不能包含点段";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain"].includes(host) || host.endsWith(".localhost") || host.endsWith(".local")) return "不能是本机地址";
  if (/^[\d.]+$|:/.test(host) && !isPublicIp(host)) return "不能是私网地址";
  return null;
}

export function metadataTtl(cacheControl: string, now: number) {
  const match = /max-age=(\d+)/i.exec(cacheControl);
  const ms = match ? Number(match[1]) * 1000 : 3_600_000;
  return now + Math.min(Math.max(ms, MIN_TTL_MS), MAX_TTL_MS);
}

export async function resolveMetadataClient(clientId: string, database: Db, now = Date.now(), fetcher: MetadataFetcher = fetchPublicJson) {
  const urlError = validateClientIdUrl(clientId);
  if (urlError) throw new OAuthError("invalid_client", `client_id 不是合法的客户端元数据地址：${urlError}。`);
  const [cached] = await database.select().from(schema.connectorClients).where(eq(schema.connectorClients.id, clientId));
  if (cached && (cached.metadataExpiresAt ?? 0) > now) return cached;
  const origin = new URL(clientId).origin;
  const allowed = await writeTransaction(database, (tx) => claimGate(tx, `connector:cimd:${digest(origin)}`, 1000, now));
  if (!allowed) {
    if (cached) return cached;
    throw new OAuthError("temporarily_unavailable", "客户端元数据请求过于频繁，请稍后重试。", 429);
  }
  let fetched: PublicJson;
  try { fetched = await fetcher(new URL(clientId)); }
  catch (error) {
    const reason = error instanceof NetError ? error.reason : "网络错误";
    console.warn("cimd_fetch_failed", { clientId, reason });
    throw new OAuthError("invalid_client", `无法获取客户端元数据文档（${reason}）。请稍后重试，或改用动态客户端注册。`);
  }
  const parsed = documentSchema.safeParse(fetched.json);
  if (!parsed.success) throw new OAuthError("invalid_client", "客户端元数据文档缺少 client_id、client_name 或 redirect_uris，或 token_endpoint_auth_method 不是 none。");
  if (parsed.data.client_id !== clientId) throw new OAuthError("invalid_client", "元数据文档中的 client_id 与请求地址不一致。");
  const grantTypes = ["authorization_code", "refresh_token"].filter((type) => !parsed.data.grant_types || parsed.data.grant_types.includes(type));
  if (!grantTypes.includes("authorization_code")) throw new OAuthError("invalid_client", "元数据文档未声明 authorization_code 授权类型。");
  const row = { id: clientId, name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris, authMethod: "none", grantTypes,
    secretHash: null, createdAt: cached?.createdAt ?? now, metadataExpiresAt: metadataTtl(fetched.cacheControl, now) };
  await database.insert(schema.connectorClients).values(row).onConflictDoUpdate({ target: schema.connectorClients.id,
    set: { name: row.name, redirectUris: row.redirectUris, grantTypes: row.grantTypes, metadataExpiresAt: row.metadataExpiresAt } });
  return row;
}
