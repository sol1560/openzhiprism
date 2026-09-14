import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import type { InterestTopic } from "@/db/schema";
import { llmObject } from "@/lib/llm/client";
import { ASK_SYSTEM, askPlanSchema, askPrompt, type AskPlanDraft } from "@/lib/llm/prompts";
import { topicsMatch } from "@/lib/profile/merge";
import { getProfile } from "@/lib/profile/store";
import { writeTransaction } from "@/lib/security/transaction";
import { searchZhihu } from "@/lib/zhihu/provider";
import { truncate } from "@/lib/zhihu/text";
import type { ZhihuItem } from "@/lib/zhihu/types";
import { getFeed } from "./build";
import { addRuleDirective, addTopicDirective, listDirectives, setCardOverride } from "./directives";
import { restyleSummaries, type RestyleOutcome, type RestyleInput } from "./restyle";
import { summarizeItems, type SummaryOutcome } from "./summarize";
import type { AskAction, AskActionResult, AskPlan, AskResponse, DirectiveDirection, FeedCard, FeedView } from "./types";

/**
 * 「对 Feed 说话」：一句话 → LLM 解释成结构化动作 → 确定性执行。
 * 卡片级：改写这一篇 / 回答问题；Feed 级：立即搜新内容、记下话题增减与长期规则。
 * 所有 LLM 调用都有规则兜底，mock 模式下也能跑通。
 */

export const ASK_LIMITS = { text: 300, reply: 160, summary: 400, query: 40, rule: 60, searchCards: 3, bodyChars: 1400, promptSummary: 80 } as const;

const chars = (value: string) => [...value].length;
const clip = (value: string, max: number) => (chars(value) <= max ? value : `${[...value].slice(0, max - 1).join("").trimEnd()}…`);

export interface AskInput {
  text: string;
  cardId?: string;
  date: string;
}

export interface InterpretContext {
  text: string;
  date: string;
  focusedCard: { cardId: string; title: string; summary: string; body: string; topic: string | null } | null;
  cards: FeedCard[];
  topics: string[];
  directives: string[];
}

export interface AskDeps {
  database?: Db;
  loadProfile?: (userId: string) => Promise<InterestTopic[]>;
  interpret?: (context: InterpretContext) => Promise<{ plan: AskPlanDraft; live: boolean }>;
  search?: (query: string) => Promise<ZhihuItem[]>;
  summarize?: (items: ZhihuItem[]) => Promise<SummaryOutcome>;
  restyle?: (items: RestyleInput[], rules: string[]) => Promise<RestyleOutcome>;
}

// ── 规则兜底 ────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[。！？!?；;])/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 4);
}

/** 无 LLM 时的改写：能机械做的（要点化、缩短）就做，其余返回 null 表示做不了 */
export function ruleRewrite(instruction: string, summary: string): string | null {
  const sentences = splitSentences(summary);
  if (/要点|列表|分点|几条|三条|bullet/i.test(instruction)) {
    const points = (sentences.length > 0 ? sentences : [summary]).slice(0, 3);
    return points.map((point) => `· ${point}`).join("\n");
  }
  if (/短|简短|精简|简洁|一句话|太长|浓缩/.test(instruction)) {
    const first = sentences[0] ?? summary;
    return clip(first, 80);
  }
  return null;
}

/** 从「我想看看 X」「来点关于 X 的」里抽检索词 */
function extractQuery(text: string): string | null {
  const patterns = [/(?:想看看|想看|看看|来点|多来点|多推点|推点|找点|关于)\s*(.+?)(?:的(?:内容|东西|文章|回答|讨论)?)?\s*$/u];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const query = match[1].replace(/^(?:一些|一点|点|些|更多|多一点)/, "").replace(/^(?:关于|有关)/, "").replace(/[，。！？,.!?\s]+$/u, "").trim();
      if (query.length >= 2) return clip(query, ASK_LIMITS.query);
    }
  }
  return null;
}

function mentionedTopic(text: string, topics: string[]): string | null {
  const direct = topics.find((topic) => text.includes(topic));
  if (direct) return direct;
  const fuzzy = topics.find((topic) => topic.length >= 2 && topicsMatch(topic, text));
  return fuzzy ?? null;
}

/** 规则版解释：卡片级默认改写；Feed 级按关键词分类 */
export function heuristicPlan(context: Pick<InterpretContext, "text" | "focusedCard" | "topics">): AskPlanDraft {
  const text = context.text.trim();
  if (context.focusedCard) {
    if (/[?？]|什么|为什么|怎么|如何|哪些|是不是|有没有/.test(text) && !/改|写|翻译|要点|短/.test(text)) {
      return { reply: `模型暂时不可用，这一篇的摘要是：${clip(context.focusedCard.summary, 120)}`, actions: [{ type: "answer" }] };
    }
    const summary = ruleRewrite(text, context.focusedCard.summary);
    if (summary) return { reply: "已按你的要求整理了这篇的摘要。", summary, actions: [{ type: "rewrite" }] };
    return { reply: "模型暂时不可用，这条要求先没能改写；稍后可以再试。", actions: [] };
  }
  const topic = mentionedTopic(text, context.topics);
  if (/屏蔽|别再|不要再|不想再|别推|不要推/.test(text)) {
    if (topic) return { reply: `好，以后不再推「${topic}」。`, actions: [{ type: "adjust_topic", topic, direction: "mute" }] };
    return { reply: "已记下这条要求，下次生成时会遵守。", actions: [{ type: "add_rule", rule: clip(text, ASK_LIMITS.rule) }] };
  }
  if (/少推|少来|少一点|少点|不想看|不太想看/.test(text)) {
    if (topic) return { reply: `好，以后少推「${topic}」。`, actions: [{ type: "adjust_topic", topic, direction: "less" }] };
    return { reply: "已记下这条要求，下次生成时会遵守。", actions: [{ type: "add_rule", rule: clip(text, ASK_LIMITS.rule) }] };
  }
  if (/多推|多来|多一点|多点|想看|来点|关于/.test(text)) {
    if (topic && /多推|多来|多一点|多点/.test(text)) return { reply: `好，以后多推「${topic}」。`, actions: [{ type: "adjust_topic", topic, direction: "more" }] };
    const query = extractQuery(text) ?? topic;
    if (query) return { reply: `马上去找几条关于「${query}」的内容。`, actions: [{ type: "search", query }] };
  }
  return { reply: "已记下这条要求，下次生成时会遵守。", actions: [{ type: "add_rule", rule: clip(text, ASK_LIMITS.rule) }] };
}

// ── 清洗模型输出 ────────────────────────────────────────

function resolveTopic(name: string, topics: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return topics.find((topic) => topic === trimmed) ?? topics.find((topic) => topicsMatch(topic, trimmed)) ?? null;
}

/** 丢掉字段不全 / 引用不存在的动作，把话题名对齐到画像，最多 3 条 */
export function normalizePlan(raw: AskPlanDraft, context: { hasCard: boolean; topics: string[] }): AskPlan {
  const actions: AskAction[] = [];
  const seen = new Set<string>();
  const push = (action: AskAction, key: string) => {
    if (seen.has(key) || actions.length >= 3) return;
    seen.add(key);
    actions.push(action);
  };
  const summary = raw.summary?.trim() ? clip(raw.summary.trim(), ASK_LIMITS.summary) : undefined;
  // 模型常常只填 summary 而忘了列 rewrite 动作：卡片级带 summary 就视为改写
  if (context.hasCard && summary) push({ type: "rewrite" }, "rewrite");
  for (const action of raw.actions ?? []) {
    switch (action.type) {
      case "rewrite":
        if (context.hasCard && summary) push({ type: "rewrite" }, "rewrite");
        break;
      case "answer":
        if (context.hasCard) push({ type: "answer" }, "answer");
        break;
      case "search": {
        const query = action.query?.trim();
        if (query && chars(query) >= 2) push({ type: "search", query: clip(query, ASK_LIMITS.query) }, `search:${query}`);
        break;
      }
      case "adjust_topic": {
        const direction = action.direction as DirectiveDirection | undefined;
        const requested = action.topic?.trim();
        if (!direction || !requested) break;
        const topic = resolveTopic(requested, context.topics);
        if (topic) push({ type: "adjust_topic", topic, direction }, `topic:${topic}`);
        else if (direction === "more") push({ type: "search", query: clip(requested, ASK_LIMITS.query) }, `search:${requested}`);
        else push({ type: "add_rule", rule: clip(`${direction === "mute" ? "不推" : "少推"}：${requested}`, ASK_LIMITS.rule) }, `rule:${requested}`);
        break;
      }
      case "add_rule": {
        const rule = action.rule?.trim();
        if (rule && chars(rule) >= 2) push({ type: "add_rule", rule: clip(rule, ASK_LIMITS.rule) }, `rule:${rule}`);
        break;
      }
    }
  }
  const reply = clip((raw.reply ?? "").trim() || "已处理。", ASK_LIMITS.reply);
  return { reply, summary: actions.some((action) => action.type === "rewrite") ? summary : undefined, actions };
}

// ── 执行 ────────────────────────────────────────────────

async function interpretWithLlm(context: InterpretContext): Promise<{ plan: AskPlanDraft; live: boolean }> {
  const result = await llmObject({
    schema: askPlanSchema,
    system: ASK_SYSTEM,
    prompt: askPrompt({
      date: context.date,
      text: context.text,
      focusedCard: context.focusedCard ?? undefined,
      cards: context.cards
        .filter((card) => card.content)
        .map((card) => ({ cardId: card.id, kind: card.kind, topic: card.topicName, title: card.content!.title, summary: clip(card.content!.summary, ASK_LIMITS.promptSummary) })),
      topics: context.topics,
      directives: context.directives,
    }),
    fallback: () => heuristicPlan(context),
    temperature: 0.3,
  });
  if (result.error) console.warn(`[ask] 回退到规则解释：${result.error.slice(0, 200)}`);
  return { plan: result.value, live: result.live };
}

async function bodiesFor(database: Db, contentIds: string[]): Promise<Map<string, { body: string; summary: string | null; title: string }>> {
  if (contentIds.length === 0) return new Map();
  const rows = await database
    .select({ contentId: schema.contentCache.contentId, sourceText: schema.contentCache.sourceText, excerpt: schema.contentCache.excerpt, summary: schema.contentCache.summary, title: schema.contentCache.title })
    .from(schema.contentCache)
    .where(inArray(schema.contentCache.contentId, contentIds));
  return new Map(rows.map((row) => [row.contentId, { body: truncate(row.sourceText || row.excerpt || row.title, ASK_LIMITS.bodyChars), summary: row.summary, title: row.title }]));
}

async function excludedIds(database: Db, userId: string): Promise<Set<string>> {
  const [seen, pushed] = await Promise.all([
    database.select({ contentId: schema.seenItems.contentId }).from(schema.seenItems).where(eq(schema.seenItems.userId, userId)),
    database.select({ contentId: schema.feedItems.contentId }).from(schema.feedItems).where(eq(schema.feedItems.userId, userId)),
  ]);
  return new Set([...seen.map((row) => row.contentId), ...pushed.map((row) => row.contentId).filter((id): id is string => Boolean(id))]);
}

/** 立即搜一批新内容追加到今天的 Feed 末尾；卡片变了就作废当日简报 */
async function appendSearchCards(database: Db, userId: string, date: string, query: string, deps: AskDeps): Promise<string[]> {
  const search = deps.search ?? (async (value: string) => (await searchZhihu(value, { count: 6 })).items);
  const summarize = deps.summarize ?? summarizeItems;
  const exclude = await excludedIds(database, userId);
  const picked: ZhihuItem[] = [];
  for (const item of await search(query)) {
    if (picked.length >= ASK_LIMITS.searchCards) break;
    if (exclude.has(item.id) || item.type === "question" || picked.some((chosen) => chosen.id === item.id)) continue;
    picked.push(item);
  }
  if (picked.length === 0) return [];
  await summarize(picked);
  const existing = await database.select({ position: schema.feedItems.position }).from(schema.feedItems)
    .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.date, date)));
  let position = existing.reduce((max, row) => Math.max(max, row.position), 0);
  const rows = picked.map((item) => ({
    id: randomUUID(), userId, date, position: ++position, kind: "main" as const, contentId: item.id, topicId: null,
    topicName: query, reason: `你刚才要求看「${query}」`,
  }));
  await writeTransaction(database, async (tx) => {
    for (const row of rows) await tx.insert(schema.feedItems).values(row);
    await tx.delete(schema.dailyBriefs).where(and(eq(schema.dailyBriefs.userId, userId), eq(schema.dailyBriefs.date, date)));
  });
  return rows.map((row) => row.id);
}

/** 新增长期规则后，按全部规则把今天的主内容摘要改写一遍（只写 override） */
async function restyleToday(database: Db, userId: string, feed: FeedView, rules: string[], deps: AskDeps): Promise<number> {
  const restyle = deps.restyle ?? restyleSummaries;
  const cards = feed.cards.filter((card) => card.kind === "main" && card.content);
  const bodies = await bodiesFor(database, cards.map((card) => card.content!.id));
  const items: RestyleInput[] = cards.map((card) => {
    const body = bodies.get(card.content!.id);
    return { id: card.id, title: card.content!.title, summary: card.override?.originalSummary ?? card.content!.summary, body: body?.body ?? card.content!.excerpt };
  });
  const outcome = await restyle(items, rules);
  if (!outcome.live) return 0;
  const note = rules.join("；");
  for (const [cardId, summary] of outcome.summaries) await setCardOverride(userId, cardId, { summary, note }, database);
  return outcome.summaries.size;
}

export async function askFeed(userId: string, input: AskInput, deps: AskDeps = {}): Promise<AskResponse> {
  const database = deps.database ?? (await db());
  const text = input.text.trim();
  const [feed, profile, directives] = await Promise.all([
    getFeed(userId, input.date, database),
    (deps.loadProfile ?? getProfile)(userId),
    listDirectives(userId, database),
  ]);
  const focused = input.cardId ? feed.cards.find((card) => card.id === input.cardId) ?? null : null;
  if (input.cardId && (!focused || !focused.content)) throw new Error("这张卡片不在今天的 Feed 里");
  const topics = profile.map((topic) => topic.name);

  let focusedCard: InterpretContext["focusedCard"] = null;
  if (focused?.content) {
    const bodies = await bodiesFor(database, [focused.content.id]);
    const body = bodies.get(focused.content.id);
    focusedCard = { cardId: focused.id, title: focused.content.title, summary: focused.content.summary, body: body?.body ?? focused.content.excerpt, topic: focused.topicName };
  }
  const context: InterpretContext = { text, date: input.date, focusedCard, cards: feed.cards, topics, directives: directives.map((directive) => directive.text) };
  const interpreted = await (deps.interpret ?? interpretWithLlm)(context);
  const plan = normalizePlan(interpreted.plan, { hasCard: Boolean(focusedCard), topics });

  const results: AskActionResult[] = [];
  let ruleAdded = false;
  for (const action of plan.actions) {
    try {
      switch (action.type) {
        case "rewrite":
          await setCardOverride(userId, focused!.id, { summary: plan.summary!, note: clip(text, 60) }, database);
          results.push({ type: "rewrite", ok: true, note: "已改写", cardId: focused!.id });
          break;
        case "answer":
          results.push({ type: "answer", ok: true, note: "已回答", cardId: focused!.id });
          break;
        case "search": {
          const cardIds = await appendSearchCards(database, userId, input.date, action.query, deps);
          results.push({ type: "search", ok: cardIds.length > 0, note: cardIds.length > 0 ? `已加 ${cardIds.length} 条` : `没搜到关于「${action.query}」的新内容`, cardIds });
          break;
        }
        case "adjust_topic": {
          const directive = await addTopicDirective(userId, { topic: action.topic, direction: action.direction, sourceText: text }, database);
          results.push({ type: "adjust_topic", ok: true, note: directive.text, directive });
          break;
        }
        case "add_rule": {
          const directive = await addRuleDirective(userId, { text: action.rule, sourceText: text }, database);
          ruleAdded = true;
          results.push({ type: "add_rule", ok: true, note: "已记住规则", directive });
          break;
        }
      }
    } catch (error) {
      results.push({ type: action.type, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  }
  if (ruleAdded) {
    const rules = (await listDirectives(userId, database)).filter((directive) => directive.kind === "rule").map((directive) => directive.text);
    const restyled = await restyleToday(database, userId, feed, rules, deps).catch(() => 0);
    if (restyled > 0) results.push({ type: "add_rule", ok: true, note: `今天 ${restyled} 条摘要已按新规则改写` });
  }

  const [cards, latest] = await Promise.all([getFeed(userId, input.date, database), listDirectives(userId, database)]);
  return {
    reply: plan.reply,
    results,
    cards: cards.cards,
    directives: latest,
    rebuildSuggested: results.some((result) => result.type === "adjust_topic" && result.ok),
    live: interpreted.live,
  };
}
