import { llmObject, type LlmCallResult } from "@/lib/llm/client";
import {
  EXTRACT_SYSTEM,
  extractPrompt,
  extractedInterestsSchema,
  type ExtractedInterests,
  type ExtractedTopic,
} from "@/lib/llm/prompts";
import { LEXICON } from "./lexicon";
import { conversationsToText, type ParsedConversation } from "./parse";

/**
 * 从对话中提取兴趣话题。优先走 LLM 结构化输出；LLM 不可用时用词典规则回退。
 */

export function ruleBasedExtract(conversations: ParsedConversation[]): ExtractedInterests {
  const topics: ExtractedTopic[] = [];
  for (const entry of LEXICON) {
    let mentions = 0;
    const sessions = new Set<number>();
    const evidence: string[] = [];
    const questions: string[] = [];
    let proHits = 0;
    let conHits = 0;

    conversations.forEach((conversation, index) => {
      for (const message of conversation.messages) {
        if (message.role !== "user") continue;
        const lower = message.content.toLowerCase();
        const hit = entry.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
        if (!hit) continue;
        mentions += 1;
        sessions.add(index);
        if (evidence.length < 2) evidence.push(message.content.replace(/\s+/g, " ").slice(0, 40));
        if (questions.length < 3 && /[?？]/.test(message.content)) {
          questions.push(message.content.split(/[?？]/)[0].slice(-40).trim() + "？");
        }
        if (entry.pro) proHits += entry.pro.cues.filter((cue) => lower.includes(cue.toLowerCase())).length;
        if (entry.con) conHits += entry.con.cues.filter((cue) => lower.includes(cue.toLowerCase())).length;
      }
    });

    if (mentions === 0) continue;
    const depth = Math.min(5, 1 + sessions.size + (mentions >= 6 ? 1 : 0));
    let stance: ExtractedTopic["stance"] = "unknown";
    let stanceLabel: string | undefined;
    if (entry.controversial && entry.pro && entry.con && proHits + conHits > 0) {
      if (proHits >= conHits * 2) {
        stance = "pro";
        stanceLabel = `倾向「${entry.pro.label}」`;
      } else if (conHits >= proHits * 2) {
        stance = "con";
        stanceLabel = `倾向「${entry.con.label}」`;
      } else {
        stance = "neutral";
      }
    }
    topics.push({
      name: entry.name,
      keywords: entry.keywords.slice(0, 6),
      questions,
      evidence,
      depth,
      mentions,
      stance,
      stanceLabel,
      controversial: entry.controversial,
      searchQueries: entry.searchQueries,
    });
  }
  topics.sort((a, b) => b.mentions * b.depth - a.mentions * a.depth);
  return { topics: topics.slice(0, 12), redactedCategories: [] };
}

export interface ExtractionOutcome {
  interests: ExtractedInterests;
  llm: Pick<LlmCallResult<unknown>, "provider" | "model" | "live" | "error">;
  inputChars: number;
}

/** 每块送给模型的文本上限：DeepSeek 一次提取约 20 秒，12k 字一次性提取会超时 */
export const EXTRACT_CHUNK_CHARS = 4_000;
/** 长输入分块后仍要给单块留足时间；MCP 路由 maxDuration 为 300 秒 */
export const EXTRACT_TIMEOUT_MS = 60_000;

/** 按对话切块，每块不超过 EXTRACT_CHUNK_CHARS；单段超长的对话再按消息切 */
export function chunkConversations(conversations: ParsedConversation[], maxChars = EXTRACT_CHUNK_CHARS): ParsedConversation[][] {
  const chunks: ParsedConversation[][] = [];
  let current: ParsedConversation[] = [];
  let currentChars = 0;
  const push = (conversation: ParsedConversation, chars: number) => {
    if (current.length > 0 && currentChars + chars > maxChars) { chunks.push(current); current = []; currentChars = 0; }
    current.push(conversation); currentChars += chars;
  };
  for (const conversation of conversations) {
    const chars = conversationsToText([conversation], Number.MAX_SAFE_INTEGER).length;
    if (chars <= maxChars) { push(conversation, chars); continue; }
    // 单段超长：按消息累积拆成多段，标题沿用
    let part: ParsedConversation = { ...conversation, messages: [] };
    let partChars = 0;
    for (const message of conversation.messages) {
      const messageChars = conversationsToText([{ ...conversation, messages: [message] }], Number.MAX_SAFE_INTEGER).length;
      if (part.messages.length > 0 && partChars + messageChars > maxChars) { push(part, partChars); part = { ...conversation, messages: [] }; partChars = 0; }
      part.messages.push(message); partChars += messageChars;
    }
    if (part.messages.length > 0) push(part, partChars);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 合并多块提取结果：同名话题 mentions 相加、depth 取最大、列表去重拼接（长度由 sanitizeInterests 收紧） */
export function mergeExtracted(parts: ExtractedInterests[]): ExtractedInterests {
  const byName = new Map<string, ExtractedTopic>();
  for (const part of parts) {
    for (const topic of part.topics) {
      const key = topic.name.trim().replace(/\s+/g, " ").toLowerCase();
      const existing = byName.get(key);
      if (!existing) { byName.set(key, { ...topic }); continue; }
      existing.mentions += topic.mentions;
      existing.depth = Math.max(existing.depth, topic.depth);
      existing.keywords = [...existing.keywords, ...topic.keywords];
      existing.questions = [...existing.questions, ...topic.questions];
      existing.evidence = [...existing.evidence, ...topic.evidence];
      existing.searchQueries = [...existing.searchQueries, ...topic.searchQueries];
      existing.controversial = existing.controversial || topic.controversial;
      if (existing.stance === "unknown" && topic.stance !== "unknown") { existing.stance = topic.stance; existing.stanceLabel = topic.stanceLabel; }
    }
  }
  const topics = [...byName.values()].sort((a, b) => b.mentions * b.depth - a.mentions * a.depth);
  return { topics, redactedCategories: parts.flatMap((part) => part.redactedCategories) };
}

export async function extractInterests(
  conversations: ParsedConversation[],
  priorTopics: string[] = [],
  historicalContext = "",
): Promise<ExtractionOutcome> {
  const text = conversationsToText(conversations, Number.MAX_SAFE_INTEGER);
  if (!text.trim()) {
    return {
      interests: { topics: [], redactedCategories: [] },
      llm: { provider: "mock", model: "rules", live: false },
      inputChars: 0,
    };
  }
  const chunks = chunkConversations(conversations);
  const results = await Promise.all(chunks.map((chunk) => llmObject({
    schema: extractedInterestsSchema,
    system: EXTRACT_SYSTEM,
    prompt: extractPrompt(conversationsToText(chunk, Number.MAX_SAFE_INTEGER), priorTopics) + (historicalContext ?
      `\n\n以下是已经分析过的历史上下文，只用于理解上面新增用户消息的指代。不要从以下内容新增话题、证据或提及次数：\n<historical_context>\n${historicalContext}\n</historical_context>` : ""),
    fallback: () => ({ topics: [], redactedCategories: [] }),
    temperature: 0.1,
    timeoutMs: EXTRACT_TIMEOUT_MS,
  })));
  const failed = results.filter((result) => !result.live && result.error);
  const first = results[0];
  // 任一块超时都算失败：调用方会回滚存档并提示重试，避免半份画像被当成完整结果
  const live = results.every((result) => result.live);
  const merged = live ? mergeExtracted(results.map((result) => result.value)) : { topics: [], redactedCategories: [] };
  // 模型偶尔会给空数组：此时用规则结果兜底，避免 onboarding 卡在空画像
  const interests = merged.topics.length > 0 ? merged : ruleBasedExtract(conversations);
  return {
    interests: sanitizeInterests(interests),
    llm: { provider: first.provider, model: first.model, live, error: failed.map((result) => result.error).join(" | ") || undefined },
    inputChars: text.length,
  };
}

/** 收紧模型输出：去空、限长、去重 */
export function sanitizeInterests(interests: ExtractedInterests): ExtractedInterests {
  const seen = new Set<string>();
  const topics: ExtractedTopic[] = [];
  for (const topic of interests.topics) {
    const name = topic.name.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    topics.push({
      ...topic,
      name: name.slice(0, 20),
      keywords: dedupe(topic.keywords).slice(0, 6),
      questions: dedupe(topic.questions).slice(0, 3),
      evidence: dedupe(topic.evidence).map((item) => item.slice(0, 60)).slice(0, 2),
      depth: clamp(Math.round(topic.depth), 1, 5),
      mentions: Math.max(1, Math.round(topic.mentions)),
      searchQueries: dedupe(topic.searchQueries.length > 0 ? topic.searchQueries : [name]).slice(0, 3),
      stanceLabel: topic.stance === "unknown" ? undefined : topic.stanceLabel,
    });
  }
  return { topics: topics.slice(0, 12), redactedCategories: dedupe(interests.redactedCategories) };
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
