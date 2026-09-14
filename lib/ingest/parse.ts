/**
 * 把用户粘贴 / 上传 / MCP 传入的对话统一解析成 ParsedConversation[]。
 * 支持：
 *   - 知棱 persona 格式 { conversations: [{ title, messages }] }
 *   - 通用格式 { messages: [{ role, content }] } 或 [{ role, content }]
 *   - ChatGPT 导出 conversations.json（mapping 树）
 *   - 纯文本 / Markdown：按「用户：」「User:」「Assistant:」「AI：」等前缀切分；无前缀时整段视为用户消息
 */

export type Role = "user" | "assistant" | "system";

export interface ParsedMessage {
  role: Role;
  content: string;
}

export interface ParsedConversation {
  title: string;
  date?: string;
  messages: ParsedMessage[];
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRole(raw: unknown): Role | null {
  const value = String(raw ?? "").toLowerCase();
  if (["user", "human", "用户", "我"].includes(value)) return "user";
  if (["assistant", "ai", "model", "bot", "助手", "claude", "chatgpt", "gpt"].includes(value)) return "assistant";
  if (value === "system") return "system";
  return null;
}

function messagesFromArray(raw: unknown): ParsedMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: ParsedMessage[] = [];
  for (const entry of raw) {
    if (!isObj(entry)) continue;
    const role = normalizeRole(entry.role ?? entry.author ?? entry.from);
    let content = entry.content ?? entry.text ?? entry.message;
    if (Array.isArray(content)) {
      content = content
        .map((part) => (typeof part === "string" ? part : isObj(part) ? String(part.text ?? "") : ""))
        .join("\n");
    }
    if (isObj(content) && Array.isArray(content.parts)) {
      content = content.parts.map((part) => (typeof part === "string" ? part : "")).join("\n");
    }
    if (role && typeof content === "string" && content.trim()) {
      messages.push({ role, content: content.trim() });
    }
  }
  return messages;
}

/** ChatGPT 官方导出：每个会话的 mapping 是节点树，按 create_time 排序即可得到线性对话 */
function parseChatGptExport(conversation: Obj): ParsedConversation | null {
  const mapping = conversation.mapping;
  if (!isObj(mapping)) return null;
  const nodes = Object.values(mapping)
    .filter(isObj)
    .map((node) => node.message)
    .filter(isObj)
    .sort((a, b) => Number(a.create_time ?? 0) - Number(b.create_time ?? 0));
  const messages: ParsedMessage[] = [];
  for (const node of nodes) {
    const author = isObj(node.author) ? node.author.role : undefined;
    const role = normalizeRole(author);
    const content = isObj(node.content) && Array.isArray(node.content.parts)
      ? node.content.parts.filter((part): part is string => typeof part === "string").join("\n").trim()
      : "";
    if (role && content) messages.push({ role, content });
  }
  if (messages.length === 0) return null;
  return {
    title: String(conversation.title ?? "未命名对话"),
    date: conversation.create_time ? new Date(Number(conversation.create_time) * 1000).toISOString().slice(0, 10) : undefined,
    messages,
  };
}

const SPEAKER_PATTERN = /^\s*(?:\*\*)?(用户|我|User|Human|You|助手|AI|Assistant|Claude|ChatGPT|GPT|模型)(?:\*\*)?\s*[:：]\s*/i;

function parsePlainText(text: string): ParsedConversation[] {
  const lines = text.split(/\r?\n/);
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;
  let sawSpeaker = false;

  for (const line of lines) {
    const match = line.match(SPEAKER_PATTERN);
    if (match) {
      sawSpeaker = true;
      if (current && current.content.trim()) messages.push(current);
      const role = normalizeRole(match[1]) ?? "user";
      current = { role, content: line.slice(match[0].length) };
    } else if (current) {
      current.content += `\n${line}`;
    } else if (line.trim()) {
      current = { role: "user", content: line };
    }
  }
  if (current && current.content.trim()) messages.push(current);

  if (!sawSpeaker) {
    // 无角色前缀：按空行分段，每段视为一条用户消息
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    return [
      {
        title: paragraphs[0]?.slice(0, 24) ?? "粘贴的对话",
        messages: paragraphs.map((paragraph) => ({ role: "user" as const, content: paragraph })),
      },
    ];
  }
  const trimmed = messages.map((message) => ({ ...message, content: message.content.trim() }));
  return [{ title: trimmed.find((m) => m.role === "user")?.content.slice(0, 24) ?? "粘贴的对话", messages: trimmed }];
}

export function parseConversations(input: string | unknown): ParsedConversation[] {
  let data: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        return parsePlainText(trimmed);
      }
    } else {
      return parsePlainText(trimmed);
    }
  }

  if (Array.isArray(data)) {
    // ChatGPT 导出数组 或 通用消息数组
    const chatGpt = data.filter(isObj).map(parseChatGptExport).filter((c): c is ParsedConversation => c !== null);
    if (chatGpt.length > 0) return chatGpt;
    const conversations = data
      .filter(isObj)
      .filter((entry) => Array.isArray(entry.messages))
      .map((entry) => ({
        title: String(entry.title ?? "未命名对话"),
        date: typeof entry.date === "string" ? entry.date : undefined,
        messages: messagesFromArray(entry.messages),
      }))
      .filter((c) => c.messages.length > 0);
    if (conversations.length > 0) return conversations;
    const flat = messagesFromArray(data);
    return flat.length > 0 ? [{ title: "粘贴的对话", messages: flat }] : [];
  }

  if (isObj(data)) {
    if (Array.isArray(data.conversations)) return parseConversations(data.conversations);
    if (Array.isArray(data.messages)) {
      const messages = messagesFromArray(data.messages);
      return messages.length > 0 ? [{ title: String(data.title ?? "粘贴的对话"), messages }] : [];
    }
    const single = parseChatGptExport(data);
    if (single) return [single];
  }
  return [];
}

/** 把对话拼成送给 LLM 的文本：用户消息全量，助手消息只保留首句作为上下文 */
export function conversationsToText(conversations: ParsedConversation[], maxChars = 12_000): string {
  const blocks: string[] = [];
  for (const conversation of conversations) {
    const lines = [`## ${conversation.title}${conversation.date ? `（${conversation.date}）` : ""}`];
    for (const message of conversation.messages) {
      if (message.role === "user") lines.push(`用户：${message.content}`);
      else if (message.role === "assistant") lines.push(`助手：${message.content.split(/[。\n]/)[0].slice(0, 60)}…`);
    }
    blocks.push(lines.join("\n"));
  }
  const text = blocks.join("\n\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（已截断）` : text;
}

export function countMessages(conversations: ParsedConversation[]): number {
  return conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0);
}
