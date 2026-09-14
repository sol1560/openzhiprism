"use client";

import { useState } from "react";
import { ArrowUpRight, Bot, Check, Link2 } from "lucide-react";
import { Switch } from "@heroui/react";
import { PrismMark } from "@/components/logo";

export function ConnectorConsent({ requestId, clientName, account, redirectHost, offline, extension = false }: {
  requestId: string; clientName: string; account: string; redirectHost: string; offline: boolean; extension?: boolean;
}) {
  const [busy, setBusy] = useState<"accept" | "deny" | null>(null);
  const [autoIngest, setAutoIngest] = useState(false);
  const [error, setError] = useState<string>();
  async function decide(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "accept" : "deny"); setError(undefined);
    try {
      const response = await fetch("/api/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, accept, autoIngest: accept && autoIngest }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description ?? "暂时无法完成授权，请重试。");
      window.location.assign(data.redirect);
    } catch (err) { setError(err instanceof Error ? err.message : "网络异常，请重试。"); setBusy(null); }
  }
  return <section className="product-surface consent-card">
    <div className="consent-symbols" aria-hidden="true"><PrismMark className="size-8" /><Link2 size={18} /><span><Bot size={18} /></span></div>
    <span className="product-eyebrow">连接授权</span>
    <h1 className="product-section-title">允许 {clientName} 连接知棱？</h1>
    <p className="text-sm text-muted">当前账户 <strong className="break-all font-medium text-foreground">{account}</strong></p>
    <ul className="consent-permissions">
      {[...(extension ? ["接收你点击插件时捕捉的当前聊天，脱敏后更新兴趣画像和 Feed", "查看本账户的捕捉任务状态"] : ["读取你的兴趣画像、推荐内容与不同观点", "接收你主动提交的对话，更新画像并标记已读"]), ...(offline ? ["保持连接，直到你撤销授权或连接到期"] : [])].map((label) =>
        <li key={label}><Check size={16} aria-hidden="true" /><span>{label}</span></li>)}
    </ul>
    {!extension && <div className="consent-auto-ingest">
      <Switch isSelected={autoIngest} onChange={setAutoIngest} aria-label="自动采集">
        <Switch.Control><Switch.Thumb /></Switch.Control>
        <Switch.Content>允许 {clientName} 在我聊到新兴趣时自动交给知棱</Switch.Content>
      </Switch>
      <p>默认关闭。开启后助手会在你展开一个新话题时主动提交那段对话，每次提交前 {clientName} 仍可能向你确认；可随时在「连接 AI」中关闭。</p>
    </div>}
    <p className="text-xs leading-loose text-muted">{extension ? "只有点击图标时才捕捉当前聊天。文字、代码、链接和附件名称会发送到知棱，脱敏后保存并分析。插件不会自动扫描聊天列表，也不会把平台登录凭证交给知棱。" : "连接不会读取你的历史聊天记录。默认只有你交给助手并触发工具调用的内容才会发送到知棱；对话先脱敏，再保存用于兴趣分析。"}</p>
    <div className="consent-destination"><ArrowUpRight size={16} aria-hidden="true" /><span>授权后返回 <strong>{redirectHost}</strong></span></div>
    {/^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(redirectHost) ? <p className="mb-4 text-xs leading-relaxed text-muted">这是你电脑上的客户端回调。请确认本次连接由你正在使用的应用发起。</p> : null}
    {error ? <p role="alert" className="form-error mb-4">{error}</p> : null}
    <div className="flex gap-3"><button type="button" className="pill-button pill-primary flex-1" disabled={busy !== null} onClick={() => void decide(true)}>{busy === "accept" ? "正在连接…" : "允许连接"}</button>
      <button type="button" className="pill-button pill-secondary flex-1" disabled={busy !== null} onClick={() => void decide(false)}>{busy === "deny" ? "正在返回…" : "取消"}</button></div>
    <p className="mt-5 text-center text-xs text-muted">你可以随时在「连接 AI」中撤销授权。</p>
  </section>;
}
