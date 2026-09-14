import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { ArrowUpRight } from "lucide-react";
import { Chip } from "@/components/ui-primitives";
import { db, schema } from "@/db";
import { AppNav } from "@/components/app-nav";
import { ProfileActions } from "@/components/profile/profile-actions";
import { TopicWeightChart } from "@/components/profile/topic-weight-chart";
import { TopicList } from "@/components/topic-list";
import { listConversations } from "@/lib/ingest";
import { getProfile } from "@/lib/profile/store";
import { getSessionUser } from "@/lib/session";
import { sourceIdentity } from "@/lib/extension/contract";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  paste: "粘贴",
  upload: "上传",
  mcp: "MCP",
  recent_chats: "Claude 近期对话",
  browser_extension: "浏览器插件",
  zhihu_follow: "知乎关注",
};

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const database = await db();
  const [topics, conversations, seenRows, feedRows] = await Promise.all([
    getProfile(user.id),
    listConversations(user.id, 30),
    database.select({ value: count() }).from(schema.seenItems).where(eq(schema.seenItems.userId, user.id)),
    database.select({ value: count() }).from(schema.feedItems).where(eq(schema.feedItems.userId, user.id)),
  ]);
  const messageCount = conversations.reduce((sum, conversation) => sum + conversation.messageCount, 0);
  const redactedCount = conversations.reduce((sum, conversation) => sum + conversation.redactedCount, 0);
  const controversial = topics.filter((topic) => topic.controversial);
  const withStance = controversial.filter((topic) => topic.stance && topic.stance !== "neutral");
  const seen = seenRows[0]?.value ?? 0;
  const pushed = feedRows[0]?.value ?? 0;

  return <>
    <AppNav user={user} />
    <main id="main-content" className="product-page">
      <header className="product-heading">
        <div><span className="product-eyebrow">从你的对话中，慢慢清晰</span><h1>兴趣画像</h1><p>{user.displayName}{user.email && user.email !== user.displayName ? ` · ${user.email}` : ""}{user.headline ? ` · ${user.headline}` : ""} · 看看最近的好奇心，正指向哪里。</p></div>
        <ProfileActions />
      </header>
      <div className="profile-layout">
        <section className="product-surface">
          <h2 className="product-section-title">最近，什么最让你在意？</h2>
          <p className="mb-6 text-xs leading-relaxed text-muted">兴趣会随对话积累，也随时间淡去。最近讨论越深入的话题，权重越高。</p>
          <TopicWeightChart topics={topics} />
          <div className="mt-5"><TopicList topics={topics} /></div>
        </section>
        <div className="flex min-w-0 flex-col gap-6">
          <section className="product-surface" style={{ background: "linear-gradient(140deg, var(--surface), var(--warm-surface))" }}>
            <span className="warm-label">多一种视角</span>
            <h2 className="product-section-title mt-4">也听听另一边的声音</h2>
            {withStance.length === 0 ? <p className="text-sm leading-loose text-muted">目前没有明显的单一立场。当讨论持续偏向一方时，知棱会在推荐中补充不同观点。</p> : <ul className="divide-y divide-border">
              {withStance.map((topic) => <li key={topic.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{topic.name}</span><Chip size="sm" color="warning" variant="soft">{topic.stanceLabel ?? topic.stance}</Chip></div>
                {topic.questions[0] && <p className="mt-3 text-xs leading-loose text-muted">你问过：{topic.questions[0]}</p>}
              </li>)}
            </ul>}
          </section>
          <section className="product-surface">
            <h2 className="product-section-title">兴趣从这些对话开始</h2>
            {conversations.length === 0 ? <p className="text-sm text-muted">还没有对话记录。接入第一段对话，让知棱开始了解你。</p> : <ul className="divide-y divide-border">
              {conversations.map((conversation) => <li key={conversation.id} className="flex items-center gap-3 py-4 text-sm">
                <div className="min-w-0 flex-1"><p className="truncate">{conversation.title ?? "未命名对话"}</p><p className="mt-1 text-xs text-muted">{SOURCE_LABEL[conversation.source] ?? conversation.source}{conversation.platform ? " · " + (conversation.platform === "claude" ? "Claude" : "ChatGPT") : ""}</p>
                  {conversation.sourceUrl && sourceIdentity(conversation.sourceUrl) && <a href={conversation.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-control text-control-sm">打开原聊天<ArrowUpRight size={12} /></a>}
                  {conversation.capturedAt && <p className="mt-1 text-xs text-muted">最后捕捉 {new Date(conversation.capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted">{conversation.messageCount} 条消息</span>
              </li>)}
            </ul>}
          </section>
        </div>
      </div>
      <dl className="profile-stats">
        <div><dt>兴趣话题</dt><dd>{topics.length}</dd><p>{controversial.length} 个可以多看一面的议题</p></div>
        <div><dt>已采集对话</dt><dd>{conversations.length}</dd><p>共 {messageCount} 条消息</p></div>
        <div><dt>进入模型前脱敏</dt><dd>{redactedCount}</dd><p>处个人信息已隐去</p></div>
        <div><dt>已推送内容</dt><dd>{pushed}</dd><p>已读 {seen} 条 · 避免重复推荐</p></div>
      </dl>
    </main>
  </>;
}
