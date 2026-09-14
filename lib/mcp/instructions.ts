import { env } from "@/lib/env";

/**
 * MCP 发现层的单一数据源：server instructions、/llms.txt、server-card 与接入页都从这里取。
 * instructions 会被客户端注入每一轮对话，保持在 1500 字以内。
 */

/** 与 @modelcontextprotocol/core 的 LATEST_PROTOCOL_VERSION 一致。 */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

export const IDENTITY = "知棱 ZhiPrism：从用户与 AI 的对话中发现兴趣，生成知乎内容摘要 Feed，并在争议话题上主动补充不同立场。";

export const TOOL_GROUPS = [
  { id: "connect", label: "连接自检与状态", tools: ["get_connection_status", "get_status"] },
  { id: "profile", label: "兴趣画像（只读）", tools: ["get_interest_profile"] },
  { id: "ingest", label: "采集对话（用户要求，或已开启自动采集）", tools: ["ingest_conversation"] },
  { id: "feed", label: "今日 Feed、简报与多元视角", tools: ["get_daily_feed", "get_daily_brief", "get_reading_history", "get_perspectives", "mark_seen"] },
  { id: "evidence", label: "依据与我的判断", tools: ["get_topic_dossier", "discuss_topic", "manage_reflection", "get_reflections", "set_content_feedback"] },
] as const;

export type ToolName = typeof TOOL_GROUPS[number]["tools"][number];
export const TOOL_NAMES: readonly ToolName[] = TOOL_GROUPS.flatMap((group) => group.tools);

export const RULES = [
  "首次连接先调用 get_connection_status，空画像也代表连接成功；autoIngest 表示该客户端的自动采集开关。",
  "用户说「把这段对话交给知棱」时，把当前对话整理成「用户：/助手：」文本交给 ingest_conversation，不让用户复制粘贴。",
  "只有 autoIngest: true 且讨论了实质的新兴趣，才主动采集一次；同段不重复，用户拒绝后本次对话不再提交。",
  "用户要求从历史找兴趣时，用 recent_chats 分页并用 conversation_search 补搜，至少三轮；脱敏后按主题分批，每批≤1500字，source: recent_chats；retryable 时拆短重试，无工具则说明。",
  "今天值得看什么：get_daily_feed；先讲整体用 get_daily_brief；最近读过什么用 get_reading_history。摘要附知乎链接与推荐理由，勿复述全文。",
  "争议话题可用 get_perspectives 补充另一方，明确标注这是不同立场；用户不需要就停止。",
  "核对依据用 get_topic_dossier，pending 时用 jobId 续查。区分作者原话与AI归纳；旧 exposureRatio 不能描述用户信念或正确率。",
  "用户说「帮我想清楚」才用 discuss_topic，最多三轮；inquiryId、revision 用于跨端继续，requestId 重试复用。",
  "先呈现草稿，只有用户明确确认，才能用 manage_reflection 保存、改版或删除。get_reflections 只读已确认判断；不自动分享。",
  "set_content_feedback 记录有帮助、已知道、不相关或归纳有误，不代表赞同；打开过不等于理解。"
] as const;

export const PRIVACY_LINE = "隐私：对话先脱敏再分析，只保存话题层面的画像；知棱不会把对话原文转交第三方。自动采集默认关闭，由用户按客户端在连接设置中开启。";

export function docsUrl() {
  return `${new URL(env.appUrl).origin}/connect`;
}

export function buildInstructions() {
  return [
    IDENTITY,
    "",
    "调用规则：",
    ...RULES.map((rule) => `- ${rule}`),
    "",
    "工具分组：",
    ...TOOL_GROUPS.map((group) => `- ${group.label}: ${group.tools.join(", ")}`),
    "",
    PRIVACY_LINE,
    `文档：${docsUrl()}`,
  ].join("\n");
}
