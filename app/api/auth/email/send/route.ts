import { NextResponse } from "next/server";
import { z } from "zod";
import { mailReadiness, sendLoginCode } from "@/lib/auth/email";
import { createLoginCode, LOGIN_CODE_COOKIE, LOGIN_CODE_TTL_MS, LoginError } from "@/lib/auth/login-code";
import { env } from "@/lib/env";
import { rejectCrossOrigin } from "@/lib/security/origin";
export const runtime = "nodejs";
const bodySchema = z.object({ email: z.string().max(254) }).strict();
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request);
  if (denied) return denied;
  if (!mailReadiness().ready) return NextResponse.json({ error: "邮件服务未配置" }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  try {
    const issued = await createLoginCode(parsed.data.email);
    // 本地开发（非公开模式）把验证码直接回给页面：不用等邮件，也不受 Resend 沙箱收件人限制。
    // 生产环境 publicMode 恒为 true（lib/env.ts），这个分支不会泄漏到线上。
    const devCode = env.publicMode ? undefined : issued.code;
    try {
      await sendLoginCode(issued.email, issued.code);
    } catch (error) {
      if (!devCode) throw error;
      console.warn("[zhiprism] 本地发信失败，已改用页面内验证码：%s", error instanceof Error ? error.message : String(error));
    }
    const response = NextResponse.json({ ok: true, email: issued.email, expiresInSeconds: LOGIN_CODE_TTL_MS / 1000, ...(devCode ? { devCode } : {}) });
    response.cookies.set(LOGIN_CODE_COOKIE, issued.cookie, { httpOnly: true, secure: env.publicMode, sameSite: "lax", path: "/", maxAge: LOGIN_CODE_TTL_MS / 1000 });
    return response;
  } catch (error) {
    if (error instanceof LoginError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "60" } : {} });
    // 发信服务的错误可能包含密钥或收件人信息，不回显
    return NextResponse.json({ error: "验证码发送失败，请稍后再试" }, { status: 502 });
  }
}
