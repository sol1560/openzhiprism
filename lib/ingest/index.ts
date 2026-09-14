import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Conversation, InterestTopic } from "@/db/schema";
import { extractInterests, type ExtractionOutcome } from "./extract";
import { countMessages, parseConversations, type ParsedConversation } from "./parse";
import { redactText, redactionLabel, type Redaction } from "./privacy";
import { applyExtraction, getProfile } from "@/lib/profile/store";

export type IngestSource = "paste" | "mcp" | "persona" | "upload" | "recent_chats" | "browser_extension";

export interface IngestResult {
  conversationCount: number;
  messageCount: number;
  redactions: Array<Redaction & { label: string }>;
  redactedCategoriesFromLlm: string[];
  topics: InterestTopic[];
  newTopicNames: string[];
  llm: ExtractionOutcome["llm"];
  /** 全部对话都已采集过：没有新增存档，也没有重新提取 */
  duplicate: boolean;
  /** 模型超时或出错：本次存档已回滚、画像未变，同样内容可以拆短后重新提交 */
  retryable: boolean;
}

/** 同一段对话（忽略空白与标题）的稳定指纹，用于自动采集去重 */
export function conversationHash(conversation: ParsedConversation) {
  const text = conversation.messages.map((message) => `${message.role}\n${message.content.replace(/\s+/g, " ").trim()}`).join("\n");
  return createHash("sha256").update(text).digest("hex");
}

export type RedactedConversation = ParsedConversation & { redactedCount: number };

export function redactConversations(conversations: ParsedConversation[]): {
  conversations: RedactedConversation[];
  redactions: Redaction[];
} {
  const totals = new Map<Redaction["category"], number>();
  const redacted = conversations.map((conversation) => {
    let redactedCount = 0;
    const messages = conversation.messages.map((message) => {
      const result = redactText(message.content);
      redactedCount += result.total;
      for (const item of result.redactions) totals.set(item.category, (totals.get(item.category) ?? 0) + item.count);
      return { ...message, content: result.text };
    });
    return { ...conversation, messages, redactedCount };
  });
  return {
    conversations: redacted,
    redactions: [...totals.entries()].map(([category, count]) => ({ category, count })),
  };
}

/**
 * 完整采集流程：解析 → 脱敏 → 存档 → LLM 提取 → 合并画像。
 */
export async function ingestConversations(input: {
  userId: string;
  source: IngestSource;
  raw: string | unknown;
}): Promise<IngestResult> {
  const parsed = parseConversations(input.raw);
  if (parsed.length === 0) {
    throw new Error("没有解析出任何对话，请检查格式（支持纯文本、Markdown、JSON 导出）");
  }
  const { conversations: all, redactions } = redactConversations(parsed);
  const database = await db();
  const now = new Date();

  // 同一用户同一段对话只采集一次：自动采集或重复粘贴不会把同样的内容反复喂进画像
  const conversations: RedactedConversation[] = [];
  const insertedIds: string[] = [];
  for (const conversation of all) {
    const hash = conversationHash(conversation);
    const [seen] = await database.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(and(eq(schema.conversations.userId, input.userId), eq(schema.conversations.contentHash, hash))).limit(1);
    if (seen) continue;
    const { redactedCount, ...stored } = conversation;
    const id = randomUUID();
    insertedIds.push(id);
    await database.insert(schema.conversations).values({
      id,
      userId: input.userId,
      source: input.source,
      title: conversation.title,
      content: JSON.stringify(stored),
      messageCount: conversation.messages.length,
      redactedCount,
      contentHash: hash,
      createdAt: now,
      processedAt: now,
    });
    conversations.push(conversation);
  }

  const before = await getProfile(input.userId);
  if (conversations.length === 0) {
    return {
      conversationCount: 0,
      messageCount: 0,
      redactions: [],
      redactedCategoriesFromLlm: [],
      topics: before,
      newTopicNames: [],
      llm: { provider: "mock", model: "duplicate", live: false },
      duplicate: true,
      retryable: false,
    };
  }
  const outcome = await extractInterests(
    conversations,
    before.map((topic) => topic.name),
  );
  if (!outcome.llm.live && outcome.llm.error) {
    // 模型超时：撤掉刚写入的存档，否则同样内容再提交会被去重拦下、永远提取不到
    for (const id of insertedIds) await database.delete(schema.conversations).where(eq(schema.conversations.id, id));
    return {
      conversationCount: 0,
      messageCount: 0,
      redactions: redactions.map((item) => ({ ...item, label: redactionLabel(item.category) })),
      redactedCategoriesFromLlm: [],
      topics: before,
      newTopicNames: [],
      llm: outcome.llm,
      duplicate: false,
      retryable: true,
    };
  }
  const topics = await applyExtraction(input.userId, outcome.interests, "conversation", now);
  const beforeNames = new Set(before.map((topic) => topic.name));

  return {
    conversationCount: conversations.length,
    messageCount: countMessages(conversations),
    redactions: redactions.map((item) => ({ ...item, label: redactionLabel(item.category) })),
    redactedCategoriesFromLlm: outcome.interests.redactedCategories,
    topics,
    newTopicNames: topics.filter((topic) => !beforeNames.has(topic.name)).map((topic) => topic.name),
    llm: outcome.llm,
    duplicate: false,
    retryable: false,
  };
}

export async function listConversations(userId: string, limit = 50): Promise<Conversation[]> {
  const database = await db();
  return database
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.userId, userId))
    .orderBy(desc(schema.conversations.createdAt))
    .limit(limit);
}

export { parseConversations, extractInterests, redactText };
export type { ParsedConversation };
