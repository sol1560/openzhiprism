import { NextResponse, type NextRequest } from "next/server";
import { consumeOAuthTransaction, exchangeOAuthCode, fetchOAuthIdentity, oauthReadiness, OAUTH_COOKIE, persistOAuthIdentity } from "@/lib/auth/oauth";
import { env } from "@/lib/env";
import { setSessionUserId } from "@/lib/session";
export async function GET(request: NextRequest) {
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, env.appUrl));
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  };
  if (!oauthReadiness().ready) return finish("/onboarding?oauth=unavailable");
  const code = request.nextUrl.searchParams.get("authorization_code");
  const state = request.nextUrl.searchParams.get("state");
  const browser = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!code || !state || !browser || !await consumeOAuthTransaction(state, browser)) return finish("/onboarding?oauth=invalid_state");
  try {
    const token = await exchangeOAuthCode(code, `${env.appUrl}/api/auth/zhihu/callback`);
    const identity = await fetchOAuthIdentity(token);
    const userId = await persistOAuthIdentity(identity);
    await setSessionUserId(userId);
    return finish("/onboarding?step=2");
  } catch {
    // Provider responses can contain credentials; never echo them in redirects or logs.
    return finish("/onboarding?oauth=failed");
  }
}
