import { AppNav } from "@/components/app-nav";
import { ExtensionLink } from "@/components/connect/extension-link";
import { InstallGuide } from "@/components/connect/install-guide";
import { CopyField } from "@/components/connect/copy-field";
import { connectorUrls } from "@/lib/connectors/oauth";
import { cursorInstallUrl } from "@/lib/connectors/clients";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "连接 AI · 知棱" };

const TOOLS = [
  { name: "get_connection_status", desc: "连接自检：账户、授权客户端、授权到期、画像话题数与今日 Feed 状态。首次连接后先调用。" },
  { name: "ingest_conversation", desc: "把当前这段对话交给知棱，脱敏后提取兴趣并更新画像；也能分批提交 Claude 从近期历史对话里整理出的话题（source: recent_chats）。开启「自动采集」后助手会在你聊到新兴趣时主动调用。" },
  { name: "get_interest_profile", desc: "读取当前用户的兴趣画像，也可用于首次连接验证。" },
  { name: "get_daily_feed", desc: "获取或生成今日推荐：摘要、来源、推荐理由与不同观点。" },
  { name: "get_perspectives", desc: "针对一个话题，了解支持、反对和中立的不同观点。" },
  { name: "get_daily_brief", desc: "今日简报：一句话标题、总结、可朗读的口播文本与 3-5 条亮点。" },
  { name: "get_reading_history", desc: "最近几天的阅读信号：各话题推送 / 打开数、最近打开的内容、连续性话题。" },
  { name: "mark_seen", desc: "标记已读，减少重复推荐。" },
  { name: "get_status", desc: "读取内容源与模型服务的当前状态。" },
];

export default async function ConnectPage() {
  const user = await getSessionUser();
  const { issuer, resource } = connectorUrls();
  const host = new URL(issuer).hostname;
  const localOnly = new URL(issuer).protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const stdio = JSON.stringify({ mcpServers: { zhiprism: {
    command: "node", args: ["--env-file=.env.local", "--import", "tsx", "scripts/mcp-stdio.ts"],
    cwd: "/path/to/Zhiprism", env: { ZHIPRISM_USER_ID: user?.id ?? "<本地用户 id>" },
  } } }, null, 2);
  return <>
    <AppNav user={user} />
    <main id="main-content" className="product-page connect-page">
      <span className="product-eyebrow">连接 AI</span>
      <h1 className="product-title">把知棱带到你的 AI 助手。</h1>
      <p className="connect-intro">选一个你常用的助手，接好后直接问它：我的兴趣画像是什么？<br className="hidden sm:block" />聊过的问题，就有了继续探索的起点。</p>
      <InstallGuide endpoint={resource} appUrl={issuer} cursorUrl={cursorInstallUrl(resource)} signedIn={Boolean(user)} localOnly={localOnly} />
      <ExtensionLink />
      <section className="connect-advanced" aria-label="高级说明">
        <details className="connect-detail"><summary>本地 stdio 与高级配置</summary><div>
          <p className="mb-4 text-sm leading-loose text-muted">适用于持有本地仓库和数据库的开发者。安装依赖、配置 .env.local，将目录替换为本机仓库路径。此进程直接使用本地数据，不是 Claude Connector 的安装方式。</p>
          <CopyField value={stdio} label="本地 stdio 配置" multiline />
          <p className="mt-4 text-xs text-muted">远程脚本的请求头配置与访问令牌，请选择上方「Agent 框架」。</p>
        </div></details>
        <details className="connect-detail"><summary>知棱提供的 {TOOLS.length} 个工具</summary><div><ul className="divide-y divide-border">{TOOLS.map((tool) => <li key={tool.name} className="py-4"><code className="text-sm font-medium text-accent">{tool.name}</code><p className="mt-2 text-sm leading-loose text-muted">{tool.desc}</p></li>)}</ul></div></details>
      </section>
    </main>
  </>;
}
