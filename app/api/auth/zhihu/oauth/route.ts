import { NextResponse } from "next/server";
import { buildOAuthAuthorizeUrl, createOAuthTransaction, oauthReadiness, OAUTH_COOKIE } from "@/lib/auth/oauth";
import { env } from "@/lib/env";
export async function GET() {
  if (!oauthReadiness().ready) return NextResponse.redirect(new URL("/onboarding?oauth=unavailable", env.appUrl));
  const { state, browser } = await createOAuthTransaction();
  const response = NextResponse.redirect(buildOAuthAuthorizeUrl(`${env.appUrl}/api/auth/zhihu/callback`, state));
  response.cookies.set(OAUTH_COOKIE, browser, { httpOnly: true, secure: env.publicMode, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
