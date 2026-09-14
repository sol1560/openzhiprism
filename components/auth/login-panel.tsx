"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input, InputOTP, Label, Spinner, TextField, REGEXP_ONLY_DIGITS } from "@heroui/react";
import { AlertTriangle, ArrowLeft, Info, Mail } from "lucide-react";
import { PrismMark } from "@/components/logo";
import { postJson } from "@/components/onboarding/types";

const OAUTH_ERRORS: Record<string, string> = {
  invalid_state: "授权已过期或无法验证，请重新登录。",
  denied: "已取消 Google 授权。",
  unavailable: "Google 登录尚未配置。",
  failed: "暂时无法完成 Google 登录，请稍后重试。",
};
const RESEND_SECONDS = 60;

function GoogleMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1C3.2 21.3 7.3 24 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.2C.4 8.2 0 10 0 12s.4 3.8 1.2 5.4l4.1-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>;
}

export function LoginPanel({ googleReady, mailReady, devMode, initialError, returnTo }: { googleReady: boolean; mailReady: boolean; devMode: boolean; initialError?: string; returnTo?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? OAUTH_ERRORS[initialError] ?? "登录失败，请重试。" : null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const result = await postJson<{ next: string }>("/api/auth/email/verify", { code: value, ...(returnTo ? { next: returnTo } : {}) });
      router.push(result.next); router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message); setCode("");
      if (message.includes("重新发送")) setCooldown(0);
    } finally { setBusy(false); }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || cooldown > 0) return;
    setBusy(true); setError(null);
    try {
      const result = await postJson<{ email: string; devCode?: string }>("/api/auth/email/send", { email });
      setEmail(result.email); setCode(""); setStep("code"); setCooldown(RESEND_SECONDS);
      // 本地开发：服务端直接把验证码回给页面，填好即可登录，不用去邮箱找
      setDevCode(result.devCode ?? null);
      if (result.devCode) setCode(result.devCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  const nothingReady = !googleReady && !mailReady;

  return <div className="product-surface surface-stack w-full max-w-md">
    <div className="flex flex-col items-start gap-3">
      <PrismMark className="size-6" />
      <h1 className="product-section-title">登录知棱</h1>
      <p className="text-sm leading-relaxed text-muted">{returnTo?.startsWith("/connect/authorize") ? "登录后继续连接授权。首次登录即自动注册。" : "首次登录即自动注册。我们只用你的邮箱识别账户，不会发送任何营销邮件。"}</p>
    </div>

    {error ? <div role="alert" className="inline-note inline-note-danger"><AlertTriangle size={16} /><div className="inline-note-body">{error}</div></div> : null}
    {nothingReady ? <div className="inline-note inline-note-warm"><AlertTriangle size={16} /><div className="inline-note-body"><strong>登录方式还没配置</strong>请在 .env 里配置 RESEND_API_KEY 或 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET。</div></div> : null}

    {googleReady && step === "email" ? <>
      <a href={`/api/auth/google${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`} className="pill-button pill-secondary w-full"><GoogleMark />使用 Google 登录</a>
      {mailReady ? <div className="flex items-center gap-3 text-xs text-muted" role="separator" aria-label="或"><span className="h-px flex-1 bg-border" />或用邮箱验证码<span className="h-px flex-1 bg-border" /></div> : null}
    </> : null}

    {mailReady && step === "email" ? <form onSubmit={send} className="flex flex-col gap-4">
      <TextField type="email" name="email" autoComplete="email" isRequired value={email} onChange={setEmail} fullWidth>
        <Label>邮箱</Label>
        <Input placeholder="you@example.com" autoFocus />
      </TextField>
      {devMode ? <p className="text-xs leading-relaxed text-muted">本地开发模式：验证码会直接显示在页面上，不需要真的收邮件。</p> : null}
      <button type="submit" className="pill-button pill-primary w-full" disabled={busy || !email.includes("@")}>
        {busy ? <Spinner size="sm" color="current" /> : <Mail size={15} />}
        发送验证码
      </button>
    </form> : null}

    {step === "code" ? <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-muted">验证码已发送到 <span className="font-medium text-foreground">{email}</span>，10 分钟内有效。</p>
      {devCode ? <div className="inline-note inline-note-accent"><Info size={16} /><div className="inline-note-body"><strong>本地开发验证码：{devCode}</strong>已自动填入，点「登录」即可。</div></div> : null}
      <InputOTP maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} onComplete={(value: string) => void verify(value)} isDisabled={busy} isInvalid={Boolean(error)} autoFocus aria-label="6 位验证码">
        <InputOTP.Group>
          {[0, 1, 2, 3, 4, 5].map((index) => <InputOTP.Slot key={index} index={index} />)}
        </InputOTP.Group>
      </InputOTP>
      <button type="button" className="pill-button pill-primary w-full" disabled={busy || code.length !== 6} onClick={() => void verify()}>
        {busy ? <Spinner size="sm" color="current" /> : null}
        登录
      </button>
      <div className="flex items-center justify-between text-xs text-muted">
        <button type="button" className="text-control text-control-sm" onClick={() => { setStep("email"); setCode(""); setError(null); }}><ArrowLeft size={14} />换个邮箱</button>
        <button type="button" className="text-control text-control-sm" disabled={busy || cooldown > 0} onClick={() => void send()}>
          {cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送"}
        </button>
      </div>
    </div> : null}
  </div>;
}
