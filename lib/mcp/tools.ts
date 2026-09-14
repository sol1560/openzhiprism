import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getFeed, getHistorySignals, getOrBuildDailyBrief, hasFeed, markSeen, startFeedBuild } from "@/lib/feed";
import { connectorUrls, describeGrant } from "@/lib/connectors/oauth";
import { buildInstructions } from "./instructions";
import { ingestConversations } from "@/lib/ingest";
import { analyzeTopicForUser } from "@/lib/perspective/lookup";
import { getProfile, getUser, upsertUser } from "@/lib/profile/store";
import { getSourceStatus } from "@/lib/zhihu";
import { todayKey } from "@/lib/zhihu/text";
import { briefOut, briefView, feedOut, feedView, historyOut, historyView, markSeenOut, perspectivesOut, perspectivesView, profileOut, topicView } from "./views";
import { uiMeta } from "./widgets";
import { registerCognitionTools } from "@/lib/cognition/mcp";

/**
 * 知棱 MCP 工具集。与传输层无关：HTTP 与 stdio 共用同一份注册函数。
 * userId 由调用方解析（HTTP：已验证的独立 Bearer 令牌；stdio：ZHIPRISM_USER_ID）。
 */

export const SERVER_INFO = { name: "zhiprism", version: "0.2.0", title: "知棱 ZhiPrism" } as const;

export const SERVER_INSTRUCTIONS = buildInstructions();

/** HTTP 侧带 grantId（OAuth 授权）；手动令牌与 stdio 只有 userId。 */
export type ToolIdentity = { userId: string; grantId?: string | null };
export type ResolveUserId = (ctx: unknown) => Promise<string | ToolIdentity | null> | string | ToolIdentity | null;

async function ensureUser(userId: string) {
  const existing = await getUser(userId);
  if (existing) return existing;
  return upsertUser({ id: userId, displayName: "MCP 用户", headline: "通过 MCP 接入", loginSource: "mcp" });
}

/** 文本给不支持结构化输出的宿主，structuredContent 给卡片与声明了 outputSchema 的校验。 */
function result(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function registerZhiprismTools(server: McpServer, resolveUserId: ResolveUserId, onSuccess?: (ctx: unknown) => Promise<void>) {
  const respond = async (ctx: unknown, value: Record<string, unknown>) => {
    try { await onSuccess?.(ctx); } catch { console.warn("connector_usage_update_failed"); }
    return result(value);
  };
  const requireIdentity = async (ctx: unknown): Promise<ToolIdentity> => {
    const resolved = await resolveUserId(ctx);
    const identity = typeof resolved === "string" ? { userId: resolved } : resolved;
    if (!identity?.userId) throw new Error("缺少用户身份：HTTP 请用 Authorization: Bearer <MCP访问令牌>，stdio 请设置 ZHIPRISM_USER_ID");
    await ensureUser(identity.userId);
    return identity;
  };
  const requireUser = async (ctx: unknown) => (await requireIdentity(ctx)).userId;
  registerCognitionTools(server, requireUser, respond);

  server.registerTool(
    "get_connection_status",
    {
      title: "连接自检",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "确认连接可用：返回账户、授权客户端、授权到期时间、画像话题数与今日 Feed 是否已生成。推荐首次连接后先调用；画像为空也代表连接成功。",
      inputSchema: z.object({}),
      _meta: uiMeta("result"),
    },
    async (_args, ctx) => {
      const { userId, grantId } = await requireIdentity(ctx);
      const [user, topics, feedToday, grant] = await Promise.all([
        getUser(userId), getProfile(userId), hasFeed(userId), grantId ? describeGrant(grantId, userId) : null,
      ]);
      let manage: string | null = null;
      try { manage = `${connectorUrls().issuer}/connect`; } catch { /* 本地配置不合法时不给链接 */ }
      return respond(ctx, {
        ok: true,
        userId,
        displayName: user?.displayName ?? null,
        loginSource: user?.loginSource ?? null,
        topicCount: topics.length,
        feedDate: todayKey(),
        feedToday,
        auth: grant ? "oauth" : "manual_token",
        client: grant?.clientName ?? "manual token",
        autoIngest: grant?.autoIngest ?? false,
        grantExpiresAt: grant ? new Date(grant.expiresAt).toISOString() : null,
        lastUsedAt: grant?.lastUsedAt ? new Date(grant.lastUsedAt).toISOString() : null,
        manage,
        server: SERVER_INFO,
        next: topics.length > 0
          ? `连接正常，可以直接问「今天有什么值得看的」。${grant?.autoIngest ? "该用户已开启自动采集：聊到新的兴趣或决策时主动调用一次 ingest_conversation。" : ""}`
          : "连接成功但画像为空：把当前这段对话（或用户指定的对话）整理后交给 ingest_conversation，不需要用户复制粘贴。",
      });
    },
  );

  server.registerTool(
    "ingest_conversation",
    {
      title: "采集对话兴趣",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description:
        "把一段用户与 AI 的对话交给知棱：可以直接传入当前正在进行的这段对话，不需要用户复制粘贴。先做隐私脱敏（手机号、身份证、邮箱、金额等），再由 LLM 提取话题层面的兴趣并合并进画像；同一段对话重复提交会被识别为 duplicate，不会重复计入。也可以传入助手用自带的对话检索（recent_chats / conversation_search）从近期历史对话里整理出的话题文本，source 填 recent_chats。单次不要超过 1500 字，返回 retryable: true 时把内容拆短后重新提交。返回本次识别到的话题与脱敏统计。",
      inputSchema: z.object({
        conversation: z
          .string()
          .min(10)
          .describe("对话文本，通常就是当前对话的逐行整理。支持「用户：/助手：」前缀、纯文本或 JSON（{messages:[{role,content}]}）"),
        title: z.string().optional().describe("对话标题（可选）"),
        source: z.enum(["chat", "recent_chats"]).default("chat")
          .describe("对话来源：chat = 当前对话（默认）；recent_chats = 助手用自带的对话检索工具从近期历史对话里整理出的话题"),
      }),
      _meta: uiMeta("result", { modelOnly: true }),
    },
    async ({ conversation, title, source }, ctx) => {
      const userId = await requireUser(ctx);
      const raw = title ? { title, messages: parseToMessages(conversation) } : conversation;
      const result = await ingestConversations({ userId, source: source === "recent_chats" ? "recent_chats" : "mcp", raw });
      return respond(ctx, {
        conversations: result.conversationCount,
        messages: result.messageCount,
        duplicate: result.duplicate,
        retryable: result.retryable,
        ...(result.retryable ? { hint: "模型超时，这批没有计入画像；请拆成更短的几批（每批不超过 1500 字）重新提交。" } : {}),
        redactions: result.redactions,
        llm: result.llm,
        newTopics: result.newTopicNames,
        topics: result.topics.slice(0, 10).map(topicView),
      });
    },
  );

  server.registerTool(
    "get_interest_profile",
    {
      title: "读取兴趣画像",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "返回当前用户的兴趣画像：话题、归一化权重、关键词、用户提出过的问题、立场倾向与来源（对话 / 知乎关注）。",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
      outputSchema: profileOut,
      _meta: uiMeta("profile"),
    },
    async ({ limit }, ctx) => {
      const userId = await requireUser(ctx);
      const topics = await getProfile(userId);
      return respond(ctx, { userId, topics: topics.slice(0, limit).map(topicView) });
    },
  );

  server.registerTool(
    "get_daily_feed",
    {
      title: "获取今日 Feed",
      // 只读写自己的缓存，对用户数据无副作用；标成只读，宿主才不会每次都弹确认框
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description:
        "获取（必要时生成）今日知乎内容 Feed：每条含 AI 摘要、来源链接、话题、推荐理由；约 20% 为热榜轻松内容；争议话题附「换个角度看」卡片。首次生成约需 20-40 秒。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("默认今天"),
        regenerate: z.boolean().default(false).describe("强制重新生成"),
        mainCount: z.number().int().min(4).max(24).optional(),
      }),
      outputSchema: feedOut,
      _meta: uiMeta("feed"),
    },
    async ({ date, regenerate, mainCount }, ctx) => {
      const userId = await requireUser(ctx);
      const day = date ?? todayKey();
      const existing = regenerate ? null : await getFeed(userId, day);
      // 复用正在跑的后台构建（浏览器可能已经发起），不会起第二份
      const feed = existing && existing.cards.length > 0 ? existing : await (await startFeedBuild(userId, { date: day, force: regenerate, mainCount })).promise;
      if (feed.cards.length === 0) {
        return respond(ctx, { date: day, cards: [], run: null, hint: "还没有兴趣画像，请先调用 ingest_conversation。" });
      }
      return respond(ctx, feedView(feed));
    },
  );

  server.registerTool(
    "get_perspectives",
    {
      title: "多元视角展开",
      // 结果按话题缓存，无用户可见副作用；只读才能在对话里被主动调用而不打断用户
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description: "对某个话题做多元视角分析：判断是否有争议、把它改写成核心问题、分别给出支持 / 反对 / 中立的知乎高赞回答与一段中立分析。结果按话题缓存。",
      inputSchema: z.object({
        topic: z.string().min(2).max(40).describe("话题名，例如「考研还是工作」"),
        refresh: z.boolean().default(false),
      }),
      outputSchema: perspectivesOut,
      _meta: uiMeta("perspectives"),
    },
    async ({ topic, refresh }, ctx) => {
      const userId = await requireUser(ctx);
      const { analysis, userStance } = await analyzeTopicForUser(userId, topic, { refresh });
      return respond(ctx, perspectivesView(analysis, userStance));
    },
  );

  server.registerTool(
    "get_daily_brief",
    {
      title: "今日简报",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "读取（必要时生成）今日简报：一句话标题、页面总结、可直接朗读的口播文本 spokenScript、3-5 条亮点（含卡片 id）和与昨天阅读的连续性说明。用户问「今天有什么」时可先用 spokenScript 口播式转述。当天还没有 Feed 时返回 hint。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("默认今天"),
        regenerate: z.boolean().default(false).describe("强制重新生成简报"),
      }),
      outputSchema: briefOut,
      _meta: uiMeta("result", { modelOnly: true }),
    },
    async ({ date, regenerate }, ctx) => {
      const userId = await requireUser(ctx);
      const day = date ?? todayKey();
      const brief = await getOrBuildDailyBrief(userId, day, { force: regenerate });
      if (!brief) {
        return respond(ctx, { date: day, headline: "", summary: "", spokenScript: "", highlights: [], continuity: [], generatedAt: new Date().toISOString(), model: "none", hint: "当天还没有 Feed，请先调用 get_daily_feed。" });
      }
      return respond(ctx, briefView(brief));
    },
  );

  server.registerTool(
    "get_reading_history",
    {
      title: "阅读历史",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "返回最近几天的阅读信号：各话题推送 / 打开数、最近打开的内容、昨天的情况、连续有 Feed 的天数、昨天在读的连续性话题。",
      inputSchema: z.object({ days: z.number().int().min(1).max(60).default(14).describe("统计窗口天数") }),
      outputSchema: historyOut,
      _meta: uiMeta("result", { modelOnly: true }),
    },
    async ({ days }, ctx) => {
      const userId = await requireUser(ctx);
      return respond(ctx, historyView(await getHistorySignals(userId, { windowDays: days })));
    },
  );

  server.registerTool(
    "mark_seen",
    {
      title: "标记已读",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "把内容标记为已读，之后的 Feed 不再重复推送。contentId 来自 get_daily_feed。",
      inputSchema: z.object({ contentIds: z.array(z.string()).min(1).max(50) }),
      outputSchema: markSeenOut,
      // Feed 卡片会直接回调这个工具，不能标成仅模型可见
      _meta: uiMeta("result"),
    },
    async ({ contentIds }, ctx) => {
      const userId = await requireUser(ctx);
      await markSeen(userId, contentIds);
      return respond(ctx, { ok: true, marked: contentIds.length });
    },
  );

  server.registerTool(
    "get_status",
    {
      title: "数据源状态",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      description: "查看知乎开放平台额度、当前内容源策略与 LLM 配置。",
      inputSchema: z.object({}),
      _meta: uiMeta("result", { modelOnly: true }),
    },
    async (_args, ctx) => { await requireUser(ctx); return respond(ctx, { ...await getSourceStatus() }); },
  );
}

function parseToMessages(conversation: string) {
  return conversation
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\s*(用户|User|Human|助手|AI|Assistant)\s*[:：]\s*/i);
      const role = match && /^(助手|AI|Assistant)$/i.test(match[1]) ? "assistant" : "user";
      return { role, content: match ? line.slice(match[0].length) : line };
    });
}
