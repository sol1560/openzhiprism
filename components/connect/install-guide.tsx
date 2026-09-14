"use client";
import { type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { CLIENTS, CLAUDE_CONNECT_URL, CLAUDE_NEW_URL, VERIFY_PROMPT, INGEST_PROMPT, RECENT_CHATS_DAYS, claudeNewUrl, installPrompt, recentChatsPrompt, clientId, type ClientId } from "@/lib/connectors/clients";
import { McpTokens } from "@/components/mcp-tokens";
import { CopyField } from "./copy-field";
import { ConnectionList } from "./connection-list";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="pill-button pill-secondary" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} /></a>;
}
function Step({ number, title, children, action }: { number: number; title: string; children: ReactNode; action?: ReactNode }) {
  return <li className="install-step"><span className="install-step-number">0{number}</span><h3>{title}</h3><p>{children}</p>
    {action ? <div className="install-step-action">{action}</div> : null}</li>;
}

export function InstallGuide({ endpoint, appUrl, cursorUrl, signedIn, localOnly }: {
  endpoint: string; appUrl: string; cursorUrl: string; signedIn: boolean; localOnly: boolean;
}) {
  const active = clientId(useSearchParams().get("client"));
  const client = CLIENTS.find((c) => c.id === active)!;
  const isCli = active === "claude-code" || active === "codex";
  const json = JSON.stringify({ mcpServers: { zhiprism: { url: endpoint } } }, null, 2);
  function select(id: ClientId) {
    const url = new URL(window.location.href); url.searchParams.set("client", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const login = <Link className="pill-button pill-secondary" href="/login?next=%2Fconnect">登录知棱<ChevronRight size={14} /></Link>;
  return <>
    <section className="install-guide" aria-label="客户端接入指南">
      <div className="install-tabs" role="tablist" aria-label="选择 AI 客户端">{CLIENTS.map((c, index) => <button key={c.id} type="button"
        id={`tab-${c.id}`} role="tab" aria-selected={active === c.id} aria-controls={`panel-${active}`} tabIndex={active === c.id ? 0 : -1}
        onClick={() => select(c.id)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? CLIENTS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + CLIENTS.length) % CLIENTS.length;
          select(CLIENTS[next].id); document.getElementById(`tab-${CLIENTS[next].id}`)?.focus();
        }}><span>{c.label}</span><small>{c.detail}</small></button>)}</div>
      <div className="install-panel" key={active} id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
        <div className="install-panel-heading"><h2>{active === "sdk" ? "连接你的 Agent" : `在 ${client.label} 使用知棱`}</h2><span>{active === "sdk" ? "独立凭证 · 随时撤销" : "登录授权 · 无需手动密钥"}</span></div>
        {localOnly && (active === "claude" || active === "chatgpt") ? <p className="connect-local-note">当前是本地预览地址。{client.label} 云端需要能访问的 HTTPS 地址，部署后此处会使用正式连接地址。</p> : null}
        <ol className={`install-steps ${isCli ? "install-steps-two" : active === "claude" ? "install-steps-four" : ""}`}>
          {active === "claude" ? <>
            <Step number={1} title="复制连接器地址" action={<CopyField value={endpoint} label="连接器地址" />}>这是知棱的连接地址，下一步粘贴到 Claude。</Step>
            <Step number={2} title="添加自定义 Connector" action={<ExternalLink href={CLAUDE_CONNECT_URL}>打开 Claude</ExternalLink>}>在 Claude 的连接器设置中添加自定义连接器，名称填「知棱」，粘贴地址并添加。</Step>
            <Step number={3} title="登录并允许连接">点击连接，按提示登录知棱并允许授权。回到 Claude 后先做一次连接自检，画像为空也代表连接成功。</Step>
            <Step number={4} title="让 Claude 默认加载知棱" action={<ExternalLink href={CLAUDE_NEW_URL}>打开 Claude 新对话</ExternalLink>}>新对话左下角 ＋ → 连接器 → 工具访问 → 选「已加载工具」。Claude 没有这一设置的直达链接；选一次后，之后的新对话会默认带上知棱。</Step>
          </> : active === "chatgpt" ? <>
            <Step number={1} title="打开开发者模式" action={<ExternalLink href="https://chatgpt.com/#settings">打开 ChatGPT</ExternalLink>}>在网页设置的「安全与登录」中启用开发者模式。免费版 ChatGPT 暂不支持自定义连接器（OpenAI 平台限制），需要 Plus / Pro / Business；工作区账户可能需要管理员开放权限。</Step>
            <Step number={2} title="创建自定义应用" action={<CopyField value={endpoint} label="应用连接地址" />}>在 Apps／Plugins 页面点击添加，名称填「知棱」，粘贴地址，认证选择 OAuth。</Step>
            <Step number={3} title="授权并扫描工具" action={<ExternalLink href="https://developers.openai.com/api/docs/guides/developer-mode">查看官方说明</ExternalLink>}>登录知棱并允许连接，完成工具扫描和创建。在新对话中选择知棱应用。入口名称可能随账户版本不同。</Step>
          </> : isCli ? <>
            <Step number={1} title={`把安装说明发给 ${client.label}`} action={<CopyField value={installPrompt(active as "claude-code" | "codex", endpoint)} label="给助手的安装说明" multiline />}>复制下面的说明，让助手完成配置。命令和验证步骤都已包含。</Step>
            <Step number={2} title="在浏览器中授权">{active === "codex" ? "运行 codex mcp login zhiprism 后，在浏览器登录知棱并允许连接。" : "打开 /mcp，选择 zhiprism，按提示在浏览器中登录知棱并授权。"} 返回助手，读取一次兴趣画像确认连接。</Step>
          </> : active === "cursor" ? <>
            <Step number={1} title="添加到 Cursor" action={<a className="pill-button pill-primary" href={cursorUrl}>添加到 Cursor<ArrowUpRight size={14} /></a>}>打开 Cursor 后确认安装知棱。配置只包含连接地址。</Step>
            <Step number={2} title="登录知棱并授权">在 Cursor 的工具设置中找到 zhiprism，点击连接，完成浏览器登录授权。</Step>
            <Step number={3} title="回到 Agent 试用">让 Agent 读取兴趣画像。第一次使用还没有画像，也会正常返回并确认连接。</Step>
          </> : <>
            <Step number={1} title="创建独立访问令牌">为脚本或框架起一个名称，在下方生成凭证。每个调用方使用自己的令牌。</Step>
            <Step number={2} title="配置请求头">将生成配置中的地址和 Authorization 请求头交给框架的远程 MCP 客户端。</Step>
            <Step number={3} title="验证后开始使用">调用 get_interest_profile 验证用户身份。令牌只显示一次，可随时撤销。</Step>
          </>}
        </ol>
        {active === "claude" && !localOnly ? <div className="install-try">
          <a className="pill-button pill-primary" href={claudeNewUrl(VERIFY_PROMPT)} target="_blank" rel="noreferrer">在 Claude 中试试<ArrowUpRight size={14} /></a>
          <a className="pill-button pill-secondary" href={claudeNewUrl(recentChatsPrompt())} target="_blank" rel="noreferrer">让 Claude 翻近期对话找兴趣<ArrowUpRight size={14} /></a>
          <p>会在 claude.ai 新对话里预填「连接自检」或「翻最近 {RECENT_CHATS_DAYS} 天对话找兴趣」，不会自动发送。发送前请在该对话中启用知棱连接器；翻对话需要 Claude 账户已开启对话检索（Relevant chats）。</p></div> : null}
        {active === "cursor" ? <details className="install-fallback"><summary>无法打开 Cursor？手动添加配置</summary><p>在 Cursor 设置 → MCP 中添加服务，或合并到已有 mcp.json，保留其他服务。</p><CopyField value={json} label="Cursor 配置" multiline /></details> : null}
        {active === "sdk" ? <div className="install-token-panel">{signedIn ? <McpTokens appUrl={appUrl} /> : <><p className="mb-4 text-sm text-muted">登录后即可创建和管理访问令牌。</p>{login}</>}</div> : null}
      </div>
    </section>
    <section className="connect-first-prompt"><div className="connect-section-heading"><h2>从一句话开始</h2><span>先确认连接，再交给知棱一段对话</span></div>
      <CopyField value={VERIFY_PROMPT} label="验证连接" multiline />
      <details className="install-fallback"><summary>连接成功后，更新我的兴趣</summary><CopyField value={INGEST_PROMPT} label="提交对话" multiline /></details>
      <details className="install-fallback"><summary>连接成功后，让 Claude 翻最近 {RECENT_CHATS_DAYS} 天的对话找兴趣</summary><CopyField value={recentChatsPrompt()} label="翻近期对话" multiline /></details>
      <p className="mt-4 text-xs leading-loose text-muted">新账户的空画像也代表连接成功。默认只接收你主动交给助手的内容；在同意页或下方「我的连接」里为某个客户端开启「自动采集」后，它会在你聊到新兴趣时主动提交那段对话。连接不会读取历史聊天记录；「翻近期对话」是你主动让 Claude 用它自己的对话检索去翻，知棱只收到整理后的话题文本。</p>
    </section>
    {signedIn ? <ConnectionList /> : <section className="connect-signin"><div><h2>管理我的连接</h2><p>登录后查看授权、确认最近调用，或撤销不再使用的连接。</p></div>{login}</section>}
  </>;
}
