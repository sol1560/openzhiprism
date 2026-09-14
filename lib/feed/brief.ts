import { cognitionEnabled } from "@/lib/cognition/types";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InterestTopic } from "@/db/schema";
import { llmObject } from "@/lib/llm/client";
import { DAILY_BRIEF_SYSTEM, dailyBriefPrompt, dailyBriefSchema, type DailyBriefDraft } from "@/lib/llm/prompts";
import { getProfile } from "@/lib/profile/store";
import { todayKey, truncate } from "@/lib/zhihu/text";
import { getFeed } from "./build";
import { getHistorySignals } from "./history";
import { readingFollowups } from "@/lib/cognition/followups";
import type { BriefHighlight, DailyBrief, FeedCard, FeedView, HistorySignals } from "./types";

/**
 * 每日简报：页面头部文字 + 语音向导的开场口播。懒生成、一人一天一行，Feed 重建时作废。
 * LLM 不可用时用规则拼出同样满足长度约束的中文文本。
 */

export const BRIEF_LIMITS = { headline: 30, summary: 160, spokenMin: 150, spokenMax: 300, highlightsMin: 0, highlightsMax: 3, why: 40 } as const;

type BriefBody = Omit<DailyBrief, "generatedAt" | "model">;
type TopicLike = Pick<InterestTopic, "name" | "weight">;

const chars = (value: string) => [...value].length;
const clip = (value: string, max: number) => (chars(value) <= max ? value : `${[...value].slice(0, max - 1).join("").trimEnd()}…`);

function cardTitle(card: FeedCard): string {
  return card.kind === "perspective" ? (card.perspective?.question ?? card.topicName ?? "换个角度看") : (card.content?.title ?? "");
}

function cardWhy(card: FeedCard): string {
  const raw = card.kind === "perspective" ? "另一方的高赞说法，刻意补充的不同视角" : card.reason;
  return clip(raw, BRIEF_LIMITS.why);
}

function toHighlight(card: FeedCard, why?: string, takeaway?: string): BriefHighlight {
  return { cardId: card.id, contentId: card.content?.id ?? null, title: cardTitle(card), topicName: card.topicName, why: clip(why?.trim() || cardWhy(card), BRIEF_LIMITS.why), takeaway: takeaway?.trim() || (card.kind === "perspective" ? "核对不同说法各自成立的条件" : `进一步理解：${clip(cardTitle(card), 48)}`) };
}

/** 亮点候选：优先连续性 / 点开过的话题的主内容，再按赞数；有视角卡至少带一张 */
export function selectHighlightCandidates(feed: FeedView, history: HistorySignals, max: number = BRIEF_LIMITS.highlightsMax): FeedCard[] {
  const engaged = new Set(history.topics.filter((topic) => topic.opened > 0).map((topic) => topic.topicName));
  const continuity = new Set(history.continuityTopics);
  const score = (card: FeedCard): number => {
    if (card.kind === "perspective") return 1;
    if (!card.content) return -1;
    let value = Math.log10(card.content.voteUp + 1) / 2;
    if (card.kind === "light") value -= 1;
    if (card.topicName && continuity.has(card.topicName)) value += 3;
    if (card.topicName && engaged.has(card.topicName)) value += 2;
    if (card.seen) value -= 2;
    if (card.feedback === "useful") value += 1;
    return value;
  };
  const ranked = feed.cards.filter((card) => (card.content || card.perspective) && !["known", "irrelevant", "misleading"].includes(card.feedback ?? "")).sort((a, b) => score(b) - score(a) || a.position - b.position);
  const picked = ranked.slice(0, max);
  const perspective = ranked.find((card) => card.kind === "perspective");
  if (perspective && !picked.includes(perspective)) picked.splice(Math.max(0, picked.length - 1), 1, perspective);
  return picked.sort((a, b) => a.position - b.position);
}

function fitSpoken(parts: string[], fillers: string[]): string {
  let text = parts.filter(Boolean).join("");
  const spare = [...fillers];
  while (chars(text) < BRIEF_LIMITS.spokenMin && spare.length > 0) text += spare.shift();
  if (chars(text) > BRIEF_LIMITS.spokenMax) text = clip(text, BRIEF_LIMITS.spokenMax);
  return text;
}

/** 规则版简报：LLM 不可用或输出不合规时使用，文本仍需通顺并满足长度约束 */
export function ruleBrief(feed: FeedView, topics: TopicLike[], history: HistorySignals): BriefBody {
  const names = topics.slice(0, 2).map((topic) => topic.name);
  const mainCount = feed.cards.filter((card) => card.kind === "main").length;
  const lightCount = feed.cards.filter((card) => card.kind === "light").length;
  const perspectiveCard = feed.cards.find((card) => card.kind === "perspective" && card.perspective);
  const around = names.map((name) => `「${name}」`).join("");
  let headline = `今天 ${feed.cards.length} 条 · 围绕${around}`;
  if (chars(headline) > BRIEF_LIMITS.headline) headline = clip(`今天 ${feed.cards.length} 条 · 围绕「${names[0] ?? "你的兴趣"}」`, BRIEF_LIMITS.headline);

  const continuity: string[] = [];
  if (history.yesterday) {
    const pushed = history.yesterday.main + history.yesterday.light;
    continuity.push(history.yesterday.opened > 0 ? `昨天推了 ${pushed} 条，你打开了 ${history.yesterday.opened} 条` : `昨天推的 ${pushed} 条你还没点开`);
  }
  for (const topic of history.continuityTopics.slice(0, 1)) continuity.push(`昨天你在看「${topic}」，今天接着有新内容`);
  const recent = history.recentOpened[0];
  if (recent && continuity.length < 3) continuity.push(`最近你点开了《${clip(recent.title, 24)}》`);

  const highlights = selectHighlightCandidates(feed, history).map((card) => toHighlight(card));
  const perspectiveHint = perspectiveCard?.perspective ? `「${perspectiveCard.perspective.topicName}」这个话题今天有另一方的说法，值得听一听` : undefined;

  const summaryParts = [
    `今天围绕${around || "你的兴趣"}准备了 ${mainCount} 条主内容${lightCount > 0 ? `、${lightCount} 条热榜轻松内容` : ""}`,
    perspectiveCard?.perspective ? `，并在「${perspectiveCard.perspective.topicName}」上补了一张「换个角度看」。` : "。",
    continuity[0] ? `${continuity[0]}。` : "",
  ];
  const summary = clip(summaryParts.join(""), BRIEF_LIMITS.summary);

  const spokenHighlights = highlights.filter((item) => item.contentId).slice(0, 3);
  const spoken = fitSpoken(
    [
      `今天为你准备了 ${feed.cards.length} 条内容，主要围绕${around || "你最近关心的话题"}。`,
      continuity[0] ? `${continuity[0]}。` : "",
      spokenHighlights.length > 0
        ? `最值得先看的有：${spokenHighlights.map((item) => `《${clip(item.title, 30)}》，${item.why}`).join("；")}。`
        : "",
      perspectiveHint ? `另外，${perspectiveHint}，这是刻意补充的不同立场。` : "",
      "你想从哪一条开始？我可以逐条给你讲。",
    ],
    [
      "每条我都能先说两三句摘要，你再决定要不要去知乎读原文。",
      "读完的内容告诉我，我帮你标成已读，明天就不再重复推送。",
      "如果某个话题你只听过一种说法，我也可以把另一方的高赞观点找出来给你对照着看。",
      "想跳过哪条直接说就行，我们按你的节奏来。",
      "你也可以随时问我你的兴趣画像，或者让我搜一个 Feed 里没有的问题。",
    ],
  );

  return { date: feed.date, headline, summary, spokenScript: spoken, highlights, continuity: continuity.slice(0, 3), perspectiveHint };
}

/** 把模型输出对齐到真实卡片：丢掉不存在的 cardId、补全标题，不足时从规则版补齐 */
export function reconcileBrief(raw: DailyBriefDraft, feed: FeedView, fallback: BriefBody): BriefBody {
  const byId = new Map(feed.cards.filter((card) => !["known", "irrelevant", "misleading"].includes(card.feedback ?? "")).map((card) => [card.id, card]));
  const highlights: BriefHighlight[] = [];
  for (const item of raw.highlights) {
    const card = byId.get(item.cardId);
    if (card && !highlights.some((existing) => existing.cardId === card.id)) highlights.push(toHighlight(card, item.why, item.takeaway));
  }
  for (const item of fallback.highlights) {
    if (highlights.length >= BRIEF_LIMITS.highlightsMax) break;
    if (!highlights.some((existing) => existing.cardId === item.cardId)) highlights.push(item);
  }
  const spoken = raw.spokenScript.replace(/[*#`>\[\]]/g, "").trim();
  const spokenOk = chars(spoken) >= 120 && chars(spoken) <= 320;
  return {
    date: feed.date,
    headline: clip(raw.headline.trim() || fallback.headline, BRIEF_LIMITS.headline),
    summary: clip(raw.summary.trim() || fallback.summary, BRIEF_LIMITS.summary),
    spokenScript: spokenOk ? spoken : fallback.spokenScript,
    highlights: highlights.slice(0, BRIEF_LIMITS.highlightsMax),
    continuity: raw.continuity.map((line) => clip(line.trim(), 60)).filter(Boolean).slice(0, 3),
    perspectiveHint: raw.perspectiveHint?.trim() || fallback.perspectiveHint,
  };
}

function toDraft(body: BriefBody): DailyBriefDraft {
  return {
    headline: body.headline, summary: body.summary, spokenScript: body.spokenScript,
    highlights: body.highlights.map((item) => ({ cardId: item.cardId, why: item.why })),
    continuity: body.continuity, perspectiveHint: body.perspectiveHint,
  };
}

export async function composeDailyBrief(feed: FeedView, topics: TopicLike[], history: HistorySignals): Promise<DailyBrief> {
  const fallback = ruleBrief(feed, topics, history);
  const result = await llmObject({
    schema: dailyBriefSchema,
    system: DAILY_BRIEF_SYSTEM,
    prompt: dailyBriefPrompt({
      date: feed.date,
      topics: topics.slice(0, 8).map((topic) => ({ name: topic.name, weight: topic.weight })),
      cards: feed.cards.map((card) => ({
        cardId: card.id, kind: card.kind, topic: card.topicName, title: cardTitle(card),
        summary: truncate(card.kind === "perspective" ? (card.perspective?.reason ?? "") : (card.content?.summary ?? ""), 120),
      })),
      history: {
        yesterday: history.yesterday ? { date: history.yesterday.date, pushed: history.yesterday.main + history.yesterday.light, opened: history.yesterday.opened } : null,
        recentOpened: history.recentOpened.slice(0, 5).map((item) => ({ title: item.title, topic: item.topicName })),
        streakDays: history.streakDays,
        topEngaged: history.topics.slice(0, 5).map((topic) => ({ topic: topic.topicName, opened: topic.opened, pushed: topic.pushed })),
      },
    }),
    fallback: () => toDraft(fallback),
  });
  const body = result.live ? reconcileBrief(result.value, feed, fallback) : fallback;
  return { ...body, generatedAt: new Date().toISOString(), model: result.live ? result.model : "rules" };
}

export async function getDailyBrief(userId: string, date = todayKey()): Promise<DailyBrief | null> {
  const database = await db();
  const [row] = await database.select().from(schema.dailyBriefs)
    .where(and(eq(schema.dailyBriefs.userId, userId), eq(schema.dailyBriefs.date, date))).limit(1);
  return row ? { ...row.payload, highlights: row.payload.highlights.slice(0, 3) } : null;
}

/** 读取或生成简报；当日没有 Feed 时返回 null */
export async function getOrBuildDailyBrief(userId: string, date = todayKey(), options: { force?: boolean } = {}): Promise<DailyBrief | null> {
  if (!options.force) {
    const existing = await getDailyBrief(userId, date);
    if (existing) return existing;
  }
  const feed = await getFeed(userId, date);
  if (feed.cards.length === 0) return null;
  const [topics, history] = await Promise.all([getProfile(userId), getHistorySignals(userId, { date })]);
  const brief = await composeDailyBrief(feed, topics, history);
  brief.followups = cognitionEnabled() ? await readingFollowups(feed) : [];
  // A newly relevant source for an explicitly followed question earns one slot.
  const followup = brief.followups[0];
  const followupCard = followup ? feed.cards.find((card) => card.content && followup.titles.includes(card.content.title)) : undefined;
  if (followupCard && !brief.highlights.some((h) => h.cardId === followupCard.id)) brief.highlights = [toHighlight(followupCard, "你保留的疑问有新材料了"), ...brief.highlights].slice(0, 3);
  const database = await db();
  await database.insert(schema.dailyBriefs).values({ userId, date, payload: brief, model: brief.model })
    .onConflictDoUpdate({ target: [schema.dailyBriefs.userId, schema.dailyBriefs.date], set: { payload: brief, model: brief.model, createdAt: new Date() } });
  return brief;
}

export async function deleteDailyBrief(userId: string, date: string): Promise<void> {
  const database = await db();
  await database.delete(schema.dailyBriefs).where(and(eq(schema.dailyBriefs.userId, userId), eq(schema.dailyBriefs.date, date)));
}
