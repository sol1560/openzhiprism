import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { consentPath, decideAuthorization, requestCookie, startAuthorization } from "@/lib/connectors/oauth";
import { limitOAuth, oauthError, oauthJson, readOAuthBody } from "@/lib/connectors/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await limitOAuth("authorize");
    if (request.url.length > 8192) return oauthJson({ error: "invalid_request" }, 414);
    const issued = await startAuthorization(new URL(request.url).searchParams);
    const response = NextResponse.redirect(new URL(consentPath(issued.requestId), env.appUrl));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(requestCookie(issued.requestId), issued.browser, { httpOnly: true, secure: env.publicMode,
      sameSite: "lax", path: "/", maxAge: 600 });
    return response;
  } catch (error) { return oauthError(error); }
}
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return oauthJson({ error: "access_denied", error_description: "登录已过期，请重新登录。" }, 401);
  try {
    const parsed = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), accept: z.boolean(), autoIngest: z.boolean().optional() }).strict().safeParse(await readOAuthBody(request, "json"));
    if (!parsed.success) return oauthJson({ error: "invalid_request", error_description: "请求不合法。" }, 400);
    const { requestId, accept, autoIngest } = parsed.data, store = await cookies();
    const redirect = await decideAuthorization(requestId, store.get(requestCookie(requestId))?.value, userId, accept, undefined, undefined, { autoIngest });
    store.delete(requestCookie(requestId));
    return oauthJson({ redirect });
  } catch (error) { return oauthError(error); }
}
