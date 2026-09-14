import { NextResponse } from "next/server";
import { buildGoogleAuthorizeUrl, generateCodeVerifier, GOOGLE_VERIFIER_COOKIE, googleReadiness } from "@/lib/auth/google";
import { createOAuthTransaction, OAUTH_COOKIE } from "@/lib/auth/oauth";
import { env } from "@/lib/env";
import { safeReturnTo } from "@/lib/auth/return-to";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!googleReadiness().ready) return NextResponse.redirect(new URL("/login?error=unavailable", env.appUrl));
  const { state, browser } = await createOAuthTransaction(undefined, Date.now(), safeReturnTo(new URL(request.url).searchParams.get("next")));
  const verifier = generateCodeVerifier();
  const response = NextResponse.redirect(buildGoogleAuthorizeUrl(state, verifier));
  const options = { httpOnly: true, secure: env.publicMode, sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set(OAUTH_COOKIE, browser, options);
  response.cookies.set(GOOGLE_VERIFIER_COOKIE, verifier, options);
  return response;
}
