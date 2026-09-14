export const CLIENTS = [
  { id: "claude", label: "Claude", detail: "Connector" },
  { id: "chatgpt", label: "ChatGPT", detail: "自定义应用" },
  { id: "claude-code", label: "Claude Code", detail: "终端助手" },
  { id: "codex", label: "Codex", detail: "CLI" },
  { id: "cursor", label: "Cursor", detail: "编辑器" },
  { id: "sdk", label: "Agent 框架", detail: "访问令牌" },
] as const;
export type ClientId = typeof CLIENTS[number]["id"];
export function clientId(value: unknown): ClientId { return CLIENTS.some((c) => c.id === value) ? value as ClientId : "claude"; }
export const VERIFY_PROMPT = "请调用知棱的 get_connection_status 做一次连接自检，告诉我账户、授权来源、画像话题数和今日 Feed 是否已生成。如果画像为空，说明已连接，让我选一段对话交给知棱。以后我问「今天有什么值得看的」时，直接用知棱的 get_daily_feed。";
export const INGEST_PROMPT = "请把我接下来选定的这段对话交给知棱，更新我的兴趣画像。";
/** 让 Claude 用自带的对话检索（recent_chats / conversation_search，界面上叫 Relevant chats）翻近期对话再分批提交。 */
export const RECENT_CHATS_DAYS = 7;
export function recentChatsPrompt(days = RECENT_CHATS_DAYS) {
  return [
    `请帮我从最近 ${days} 天的 Claude 对话里找出我真正关心的话题，提交给知棱更新兴趣画像。`,
    "1. 先调用知棱的 get_connection_status 确认已连接。",
    `2. 用你自带的 recent_chats 工具拉最近 ${days} 天的对话，按时间往前翻页直到覆盖 ${days} 天，不要只看第一页。`,
    "3. 至少 3 轮仔细找：第一轮按标题和摘要挑出有实质讨论的对话；第二轮用 conversation_search 按这些对话的关键词补搜同主题但不在列表里的对话；第三轮对聊得深的主题继续搜相关关键词，弄清楚在讨论什么、我持什么看法、提过什么问题。不要看两三段就停。",
    "4. 只保留话题层面：技术、学习、职业、消费决策、公共议题等有观点或问题的讨论。跳过一次性的翻译、改错字和闲聊；不要写进手机号、地址、金额、真实姓名等隐私。",
    `5. 每个话题整理成一段「话题 / 在聊什么 / 我表达过的观点或问题 / 讨论深度」，按主题分批调用知棱的 ingest_conversation：每批 2-3 个话题、不超过 1500 字（太长会让模型超时），title 写「Claude 近期对话 · 最近 ${days} 天 · 第 X 批」，source 填 recent_chats。返回 retryable: true 就把那批拆短再提交。`,
    "6. 最后调用 get_interest_profile，告诉我识别出的话题和跳过了哪些类型的内容。",
    "如果这个对话里没有 recent_chats / conversation_search，直接告诉我怎么开启，不要猜。",
  ].join("\n");
}
export const CLAUDE_CONNECT_URL = "https://claude.ai/new?modal=add-custom-connector#customize/connectors";
/** Claude 没有「工具访问」设置的直达链接，只能引导到新对话。 */
export const CLAUDE_NEW_URL = "https://claude.ai/new";
/** 在 claude.ai 新对话中预填一句话；只预填，不会自动发送。 */
export function claudeNewUrl(prompt: string) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

/** This configuration contains only a public endpoint, never a credential. */
export function cursorInstallUrl(endpoint: string) {
  const config = Buffer.from(JSON.stringify({ url: endpoint })).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({ name: "zhiprism", config })}`;
}
export function installPrompt(client: "claude-code" | "codex", endpoint: string) {
  const quoted = `'${endpoint.replaceAll("'", "'\\''")}'`;
  return ["把知棱 ZhiPrism 接进来，帮我读取兴趣画像和发现值得读的内容。",
    client === "codex" ? `1. 运行：codex mcp add zhiprism --url ${quoted}` : `1. 运行：claude mcp add --transport http zhiprism ${quoted}`,
    client === "codex" ? "2. 运行：codex mcp login zhiprism；我会在浏览器中登录知棱并授权。" : "2. 提醒我打开 /mcp，选择 zhiprism 完成浏览器登录授权。",
    "3. 调用 get_connection_status 确认连接；画像为空也算成功。未经我主动要求，不要提交对话。",
  ].join("\n");
}
