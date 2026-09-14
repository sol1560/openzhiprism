import { mailReadiness } from "./email";
import { googleReadiness } from "./google";
import { oauthReadiness } from "./oauth";
/** 知乎 OAuth（预留，未接入 UI） */
export function isOAuthConfigured() { return oauthReadiness().ready; }
/** 至少一种可用的登录方式（邮箱验证码或 Google） */
export function loginReadiness(): { ready: boolean; reason?: string } {
  if (googleReadiness().ready || mailReadiness().ready) return { ready: true };
  return { ready: false, reason: "登录方式尚未配置" };
}
