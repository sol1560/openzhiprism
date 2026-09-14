import { MAX_CAPTURE_BYTES, sourceIdentity, type CaptureMessage, type CapturePayload } from "../../../lib/extension/contract";
import type { PageCapture } from "./page-reader";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown) => typeof v === "string" ? v : "";
const failure = () => new Error("无法确认当前聊天的完整分支，请刷新聊天页后重试。");

// Claude's synthetic root is a UUID-shaped sentinel, not a message returned in chat_messages.
const CLAUDE_ROOT_IDS = ["00000000-0000-4000-8000-000000000000", "00000000-0000-0000-0000-000000000000"];

function walk(nodes: Map<string, { message: Obj; parent: string | null }>, leaf: string, rootIds: readonly string[]) {
  if (!leaf || !nodes.has(leaf)) throw failure();
  const chain: Array<{ id: string; message: Obj }> = [], visited = new Set<string>();
  let id: string | null = leaf;
  while (id && !rootIds.includes(id)) {
    if (visited.has(id)) throw failure();
    visited.add(id);
    const node = nodes.get(id);
    if (!node) throw failure();
    chain.push({ id, message: node.message });
    id = node.parent;
  }
  return chain.reverse();
}

export function normalizeCapture(page: PageCapture): CapturePayload {
  const identity = sourceIdentity(page.url);
  if (!identity) throw new Error("请先打开一段已保存的 ChatGPT 或 Claude 聊天。");
  const { raw } = page, nodes = new Map<string, { message: Obj; parent: string | null }>();
  let leaf: string;
  if (identity.platform === "chatgpt") {
    if (raw.conversation_id && raw.conversation_id !== identity.externalId) throw failure();
    for (const [id, value] of Object.entries(object(raw.mapping))) {
      const node = object(value);
      nodes.set(id, { message: object(node.message), parent: text(node.parent) || null });
    }
    leaf = text(raw.current_node);
  } else {
    if (raw.uuid && raw.uuid !== identity.externalId) throw failure();
    for (const value of array(raw.chat_messages)) {
      const message = object(value), id = text(message.uuid);
      if (!id || nodes.has(id)) throw failure();
      nodes.set(id, { message, parent: text(message.parent_message_uuid) || null });
    }
    leaf = text(raw.current_leaf_message_uuid);
  }
  const chain = walk(nodes, leaf, identity.platform === "claude" ? CLAUDE_ROOT_IDS : []), chainIds = new Set(chain.map((n) => n.id));
  if (page.visibleIds.some((id) => nodes.has(id) && !chainIds.has(id))) throw failure();
  const messages: CaptureMessage[] = [];
  for (const { id, message: m } of chain) {
    if (["in_progress", "streaming"].includes(text(m.status))) throw new Error("回复正在生成，请完成后再捕捉。");
    const role = identity.platform === "chatgpt" ? object(m.author).role : m.sender === "human" ? "user" : m.sender;
    if (role !== "user" && role !== "assistant") continue;
    if (object(m.metadata).is_visually_hidden_from_conversation) continue;
    // Reasoning and tools are not chat text, even if the underlying API returns them.
    if (identity.platform === "chatgpt" && m.channel && m.channel !== "final" && m.channel !== "commentary") continue;
    let content: string;
    let files: unknown[];
    if (identity.platform === "chatgpt") {
      const body = object(m.content);
      content = body.content_type === "code" ? `\`\`\`${text(body.language)}\n${text(body.text)}\n\`\`\``
        : array(body.parts).filter((p): p is string => typeof p === "string").join("\n\n");
      files = array(object(m.metadata).attachments);
    } else {
      content = Array.isArray(m.content) ? m.content.map(object).filter((b) => b.type === "text").map((b) => text(b.text)).join("\n\n") : text(m.text);
      files = [...array(m.attachments), ...array(m.files), ...array(m.files_v2)];
    }
    const attachments = [...new Set(files.map(object).map((f) => text(f.file_name) || text(f.name)).filter(Boolean))];
    if (content.trim() || attachments.length) messages.push({ id, role, content, attachments });
  }
  const normalize = (s: string) => s.replace(/\s+/g, "").slice(0, 100);
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content.replace(/\s+/g, ""));
  if (!page.visibleIds.some((id) => nodes.has(id)) &&
    page.visibleUserTexts.some((s) => normalize(s).length > 10 && !userText.some((m) => m.includes(normalize(s))))) throw failure();
  if (!messages.some((m) => m.role === "user" && m.content.trim())) throw new Error("这段聊天没有可分析的用户文字。");
  const payload: CapturePayload = { version: 1, ...identity, title: (text(raw.title) || text(raw.name) || "未命名对话").slice(0, 500), messages };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_CAPTURE_BYTES) throw new Error("这段聊天超过 2 MiB，请使用知棱网页分段导入。");
  return payload;
}
