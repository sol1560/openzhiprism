"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, Link2, Upload } from "lucide-react";
import { CLIENTS, CLAUDE_CONNECT_URL, INGEST_PROMPT, RECENT_CHATS_DAYS, VERIFY_PROMPT, claudeNewUrl, installPrompt, recentChatsPrompt, type ClientId } from "@/lib/connectors/clients";
import { CopyField } from "@/components/connect/copy-field";
import { IngestStep } from "./ingest-step";
import { ExtensionLink } from "@/components/connect/extension-link";
import type { IngestResponse } from "./types";

type Status = { topicCount: number; connections: Array<{ id: string; clientName: string; status: "authorized" | "verified" }> };

export function ConnectStep({ endpoint, cursorUrl, localOnly, onAnalyzed }: {
  endpoint: string; cursorUrl: string; localOnly: boolean; onAnalyzed: (result: IngestResponse) => void;
}) {
  const router = useRouter();
  const [active, setActive] = useState<ClientId>("claude");
  const [status, setStatus] = useState<Status | null>(null);
  const [fallback, setFallback] = useState<"upload" | "paste" | null>(null);
  const client = CLIENTS.find((c) => c.id === active)!;
  const isCli = active === "claude-code" || active === "codex";

  // 连接与画像都发生在客户端那一侧，这里只能轮询；画像一出现就进第 2 步
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      fetch("/api/onboarding/status", { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
        .then((data) => { if (data && !controller.signal.aborted) setStatus(data); })
        .catch(() => undefined); // 网络抖动时保持上一次状态
    };
    const timer = setInterval(refresh, 5_000);
    const first = setTimeout(refresh, 0);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); clearTimeout(first); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (status && status.topicCount > 0) router.replace("/onboarding?step=2");
  }, [status, router]);

  const connected = status?.connections[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">把知棱连进你常用的 AI</h2>
        <p className="mt-1 text-muted">连上以后，你聊过的问题会成为兴趣画像；聊到有分歧的话题时，知棱还会补一条不同的看法。</p>
      </div>

      <div className="install-tabs install-tabs-standalone" role="tablist" aria-label="选择 AI 客户端">
        {CLIENTS.map((c) => <button key={c.id} type="button" role="tab" aria-selected={active === c.id} onClick={() => setActive(c.id)}>
          <span>{c.label}</span><small>{c.detail}</small></button>)}
      </div>

      <div className="connect-step-panel" key={active}>
        {localOnly && (active === "claude" || active === "chatgpt") ? <p className="connect-local-note">当前是本地预览地址。{client.label} 云端需要能访问的 HTTPS 地址，部署后此处会使用正式连接地址。</p> : null}
        {active === "claude" ? <>
          <CopyField value={endpoint} label="连接器地址" />
          <div className="connect-step-actions">
            <a className="pill-button pill-primary" href={CLAUDE_CONNECT_URL} target="_blank" rel="noreferrer">打开 Claude 添加连接器<ArrowUpRight size={14} /></a>
            {!localOnly ? <a className="pill-button pill-secondary" href={claudeNewUrl(VERIFY_PROMPT)} target="_blank" rel="noreferrer">连上后在 Claude 里试试<ArrowUpRight size={14} /></a> : null}
          </div>
          <p className="text-xs leading-loose text-muted">在连接器设置里添加自定义连接器，名称填「知棱」，粘贴地址，然后登录知棱并允许连接。新对话左下角 ＋ → 连接器 → 工具访问 → 选「已加载工具」，之后的对话会默认带上知棱。</p>
        </> : active === "chatgpt" ? <>
          <CopyField value={endpoint} label="应用连接地址" />
          <div className="connect-step-actions"><a className="pill-button pill-primary" href="https://chatgpt.com/#settings" target="_blank" rel="noreferrer">打开 ChatGPT 设置<ArrowUpRight size={14} /></a></div>
          <p className="text-xs leading-loose text-muted">在「安全与登录」中启用开发者模式，然后在 Apps 页面添加自定义应用，名称填「知棱」，认证选择 OAuth。免费版 ChatGPT 暂不支持自定义连接器。</p>
        </> : isCli ? <>
          <CopyField value={installPrompt(active as "claude-code" | "codex", endpoint)} label={`发给 ${client.label} 的安装说明`} multiline />
          <p className="text-xs leading-loose text-muted">把这段话发给 {client.label}，它会完成配置并提醒你在浏览器里登录知棱授权。</p>
        </> : active === "cursor" ? <>
          <div className="connect-step-actions"><a className="pill-button pill-primary" href={cursorUrl}>添加到 Cursor<ArrowUpRight size={14} /></a></div>
          <p className="text-xs leading-loose text-muted">打开 Cursor 后确认安装知棱，再在工具设置里点击连接，完成浏览器登录授权。配置只包含连接地址。</p>
        </> : <>
          <p className="text-sm leading-loose text-muted">脚本或 Agent 框架使用独立访问令牌，在「连接 AI」页面创建并配置请求头。</p>
          <div className="connect-step-actions"><Link className="pill-button pill-primary" href="/connect?client=sdk">去创建访问令牌<ArrowUpRight size={14} /></Link></div>
        </>}
      </div>

      <div className={`connect-step-status ${connected ? "is-connected" : ""}`} role="status" aria-live="polite">
        {connected ? <>
          <span className="connect-step-status-icon"><Check size={14} /></span>
          <div>
            <strong>已连接 {connected.clientName}</strong>
            <p>回到 {connected.clientName}，说一句下面这句话，知棱就会从这段对话里读出你的兴趣。画像一出现，这里会自动进入下一步。</p>
            <CopyField value={INGEST_PROMPT} label="在 AI 里说" />
            {active === "claude" && !localOnly ? <div className="flex flex-wrap gap-2">
              <a className="text-control" href={claudeNewUrl(INGEST_PROMPT)} target="_blank" rel="noreferrer">在 Claude 新对话里预填这句话<ArrowUpRight size={14} /></a>
              <a className="text-control" href={claudeNewUrl(recentChatsPrompt())} target="_blank" rel="noreferrer">或让 Claude 翻最近 {RECENT_CHATS_DAYS} 天的对话找兴趣<ArrowUpRight size={14} /></a>
            </div> : null}
          </div>
        </> : <>
          <span className="connect-step-status-icon"><Link2 size={14} /></span>
          <div><strong>等待连接</strong><p>完成授权后这里会自动更新，不用刷新页面。</p></div>
        </>}
      </div>

      <div className="connect-step-fallback">
        <ExtensionLink />
        <p className="text-xs text-muted">不想现在连接？也可以：</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`text-control ${fallback === "upload" ? "is-active" : ""}`} onClick={() => setFallback(fallback === "upload" ? null : "upload")}><Upload size={14} />导入 ChatGPT / Claude 导出的聊天记录</button>
          <button type="button" className={`text-control ${fallback === "paste" ? "is-active" : ""}`} onClick={() => setFallback(fallback === "paste" ? null : "paste")}>粘贴一段文本试试</button>
        </div>
        {fallback ? <div className="mt-4"><IngestStep initialTab={fallback} onAnalyzed={onAnalyzed} /></div> : null}
      </div>
    </div>
  );
}
