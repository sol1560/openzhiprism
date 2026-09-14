import { Resend } from "resend";
import { env } from "@/lib/env";
export function mailReadiness(): { ready: boolean; reason?: string } {
  if (env.resendApiKey) return { ready: true };
  if (!env.publicMode) return { ready: true };
  return { ready: false, reason: "邮件服务未配置" };
}
/** 发送验证码。本地开发没有 RESEND_API_KEY 时打印到终端；公开模式下没有配置则失败。 */
export async function sendLoginCode(email: string, code: string, logger: (message: string, ...rest: unknown[]) => void = console.log) {
  if (!env.resendApiKey) {
    if (env.publicMode) throw new Error("邮件服务未配置");
    logger("[zhiprism] login code for %s: %s", email, code);
    return;
  }
  const resend = new Resend(env.resendApiKey);
  const { error } = await resend.emails.send({
    from: env.emailFrom, to: email, subject: `知棱登录验证码 ${code}`,
    text: `你的知棱 ZhiPrism 登录验证码是 ${code}，10 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件。`,
  });
  if (error) throw new Error("邮件发送失败");
}
