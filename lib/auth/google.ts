import { decodeIdToken, generateCodeVerifier, Google } from "arctic";
import { z } from "zod";
import { env } from "@/lib/env";
import type { Identity } from "./identity";
export const GOOGLE_VERIFIER_COOKIE = "zp_oauth_verifier";
export { generateCodeVerifier };
export function googleReadiness(): { ready: boolean; reason?: string } {
  if (!env.googleClientId || !env.googleClientSecret) return { ready: false, reason: "尚未配置 Google OAuth 客户端" };
  try {
    if (env.publicMode && new URL(env.appUrl).protocol !== "https:") return { ready: false, reason: "公开登录需要 HTTPS" };
  } catch { return { ready: false, reason: "应用地址配置不合法" }; }
  return { ready: true };
}
function client() { return new Google(env.googleClientId ?? "", env.googleClientSecret ?? "", `${env.appUrl}/api/auth/google/callback`); }
export function buildGoogleAuthorizeUrl(state: string, codeVerifier: string) {
  return client().createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]).toString();
}
const claimsSchema = z.object({
  sub: z.string().min(1).max(256),
  email: z.string().max(254).optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.url().optional(),
}).loose();
/** 只信任 Google 明确标记为已验证的邮箱；缺少 sub 视为无效身份。 */
export function parseGoogleClaims(claims: unknown): Identity {
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) throw new Error("Google identity claims invalid");
  const { sub, email, email_verified, name, picture } = parsed.data;
  const verified = email_verified === true && typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
  const fallback = verified ? verified.split("@")[0] : "Google 用户";
  return { provider: "google", subject: sub, email: verified, displayName: (name?.trim() || fallback).slice(0, 80), avatarUrl: picture ?? null };
}
/** 用授权码换取 id_token 并解析身份。id_token 来自直连 Google 令牌端点，故只解码不验签；绝不接受浏览器传来的令牌。 */
export async function fetchGoogleIdentity(code: string, codeVerifier: string): Promise<Identity> {
  const tokens = await client().validateAuthorizationCode(code, codeVerifier);
  return parseGoogleClaims(decodeIdToken(tokens.idToken()));
}
