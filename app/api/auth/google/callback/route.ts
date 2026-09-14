import { NextResponse, type NextRequest } from "next/server";
import { postLoginDestination } from "@/lib/auth/destination";
import { fetchGoogleIdentity, GOOGLE_VERIFIER_COOKIE, googleReadiness } from "@/lib/auth/google";
import { persistIdentity } from "@/lib/auth/identity";
import { consumeOAuthTransactionDetails, OAUTH_COOKIE } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/return-to";
import { env } from "@/lib/env";
import { setSessionUserId } from "@/lib/session";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, env.appUrl));
    response.cookies.delete(OAUTH_COOKIE);
    response.cookies.delete(GOOGLE_VERIFIER_COOKIE);
    return response;
  };
  if (!googleReadiness().ready) return finish("/login?error=unavailable");
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const browser = request.cookies.get(OAUTH_COOKIE)?.value;
  const verifier = request.cookies.get(GOOGLE_VERIFIER_COOKIE)?.value;
  if (!state || !browser || !verifier) return finish("/login?error=invalid_state");
  const transaction = await consumeOAuthTransactionDetails(state, browser);
  if (!transaction) return finish("/login?error=invalid_state");
  const returnTo = safeReturnTo(transaction.returnTo);
  const loginError = (error: string) => `/login?${new URLSearchParams({ error, ...(returnTo ? { next: returnTo } : {}) })}`;
  if (params.get("error")) return finish(loginError("denied"));
  if (!code) return finish(loginError("invalid_state"));
  try {
    const identity = await fetchGoogleIdentity(code, verifier);
    const userId = await persistIdentity(identity);
    await setSessionUserId(userId);
    return finish(returnTo ?? await postLoginDestination(userId));
  } catch {
    // 令牌端点的响应可能包含凭证，绝不写进重定向或日志
    return finish(loginError("failed"));
  }
}
