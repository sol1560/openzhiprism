import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { postLoginDestination } from "@/lib/auth/destination";
import { persistIdentity } from "@/lib/auth/identity";
import { consumeLoginCode, LOGIN_CODE_COOKIE } from "@/lib/auth/login-code";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { setSessionUserId } from "@/lib/session";
import { safeReturnTo } from "@/lib/auth/return-to";
export const runtime = "nodejs";
const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/), next: z.string().max(200).optional() }).strict();
const MESSAGES = { invalid: "验证码不正确", expired: "验证码已过期，请重新发送", locked: "错误次数过多，请重新发送验证码" } as const;
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  const store = await cookies();
  const result = await consumeLoginCode(store.get(LOGIN_CODE_COOKIE)?.value, parsed.data.code);
  if (result.status !== "ok") {
    if (result.status !== "invalid") store.delete(LOGIN_CODE_COOKIE);
    return NextResponse.json({ error: MESSAGES[result.status], code: result.status, attemptsLeft: result.status === "invalid" ? result.attemptsLeft : undefined },
      { status: result.status === "locked" ? 429 : 400 });
  }
  const userId = await persistIdentity({ provider: "email", subject: result.email, email: result.email, displayName: result.email.split("@")[0].slice(0, 80) });
  await setSessionUserId(userId);
  store.delete(LOGIN_CODE_COOKIE);
  return NextResponse.json({ ok: true, next: safeReturnTo(parsed.data.next) ?? await postLoginDestination(userId) });
}
