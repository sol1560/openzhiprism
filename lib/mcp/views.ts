import { z } from "zod";
import { cognitionEnabled } from "@/lib/cognition/types";
import type { InterestTopic } from "@/db/schema";
import type { DailyBrief, FeedView, HistorySignals } from "@/lib/feed/types";
import type { analyzeTopic } from "@/lib/perspective";

/**
 * MCP 工具的输出投影与输出 schema。卡片（widgets/src）只消费 structuredContent，
 * 所以这里的形状就是卡片的契约；schema 故意宽松：数据库来源的字符串不用枚举，run 允许多余字段。
 */

type TopicAnalysis = Awaited<ReturnType<typeof analyzeTopic>>;

export const topicOut = z.object({
  name: z.string(), weight: z.number(), hits: z.number(), keywords: z.array(z.string()), questions: z.array(z.string()),
  stance: z.string().nullable(), stanceLabel: z.string().nullable(), controversial: z.boolean(), source: z.string(), lastSeenAt: z.string(),
});
const itemOut = z.object({ title: z.string(), oneLine: z.string(), url: z.string(), voteUp: z.number(), author: z.string().optional() });
const stanceOut = z.object({ side: z.enum(["pro", "con", "neutral"]), label: z.string(), items: z.array(itemOut) });
export const feedOut = z.object({
  cognitionEnabled: z.boolean().optional(),
  date: z.string(),
  hint: z.string().optional(),
  run: z.object({ sourceUsed: z.string(), llmUsed: z.string(), createdAt: z.string() }).loose().nullable(),
  cards: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("perspective"), topic: z.string(), question: z.string(), reason: z.string(),
      userSide: z.string().nullable(), userSideLabel: z.string().nullable(), counterSide: z.string(), exposureRatio: z.number(),
      stances: z.array(stanceOut), analysis: z.string().nullable(), analysisModel: z.string().nullable() }),
    z.object({ kind: z.enum(["main", "light"]), topic: z.string().nullable(), reason: z.string(), title: z.string(), summary: z.string(),
      url: z.string(), author: z.string().optional(), voteUp: z.number(), contentId: z.string(), seen: z.boolean() }),
  ])),
});
export const profileOut = z.object({ userId: z.string(), topics: z.array(topicOut) });
export const perspectivesOut = z.object({
  topic: z.string(), isControversial: z.boolean(), question: z.string(), userStance: z.string().nullable(),
  sides: z.object({ pro: z.object({ label: z.string(), items: z.array(itemOut) }), con: z.object({ label: z.string(), items: z.array(itemOut) }), neutral: z.array(itemOut) }),
  analysis: z.string().nullable(), analysisModel: z.string().nullable(),
});
export const markSeenOut = z.object({ ok: z.literal(true), marked: z.number().int() });
export const briefOut = z.object({
  date: z.string(), headline: z.string(), summary: z.string(), spokenScript: z.string(),
  highlights: z.array(z.object({ cardId: z.string(), contentId: z.string().nullable(), title: z.string(), topicName: z.string().nullable(), why: z.string(), takeaway: z.string().optional() })),
  followups: z.array(z.object({ reflectionId: z.string(), jobId: z.string(), topic: z.string(), question: z.string(), titles: z.array(z.string()) })).optional(),
  continuity: z.array(z.string()), perspectiveHint: z.string().optional(), generatedAt: z.string(), model: z.string(),
  hint: z.string().optional(),
});
export const historyOut = z.object({
  date: z.string(), windowDays: z.number().int(),
  topics: z.array(z.object({ topicName: z.string(), pushed: z.number().int(), opened: z.number().int(), openRate: z.number(), lastPushedDate: z.string().nullable(), lastOpenedDate: z.string().nullable() })),
  recentOpened: z.array(z.object({ contentId: z.string(), title: z.string(), url: z.string(), topicName: z.string().nullable(), kind: z.string(), date: z.string(), seenAt: z.string() })),
  yesterday: z.object({ date: z.string(), main: z.number().int(), light: z.number().int(), perspectives: z.number().int(), opened: z.number().int() }).nullable(),
  streakDays: z.number().int(), feedDays: z.number().int(), totalPushed: z.number().int(), totalOpened: z.number().int(),
  continuityTopics: z.array(z.string()), openedPerspectiveTopics: z.array(z.string()),
});

export type TopicOut = z.infer<typeof topicOut>;
export type FeedOut = z.infer<typeof feedOut>;
export type FeedCardOut = FeedOut["cards"][number];
export type ProfileOut = z.infer<typeof profileOut>;
export type PerspectivesOut = z.infer<typeof perspectivesOut>;
export type BriefOut = z.infer<typeof briefOut>;
export type HistoryOut = z.infer<typeof historyOut>;

export function topicView(topic: InterestTopic): TopicOut {
  return {
    name: topic.name, weight: topic.weight, hits: topic.hits, keywords: topic.keywords, questions: topic.questions,
    stance: topic.stance, stanceLabel: topic.stanceLabel, controversial: topic.controversial, source: topic.source,
    lastSeenAt: topic.lastSeenAt.toISOString(),
  };
}

export function itemView(item: { title: string; oneLine: string; url: string; voteUp: number; authorName?: string }) {
  return { title: item.title, oneLine: item.oneLine, url: item.url, voteUp: item.voteUp, author: item.authorName };
}

export function feedView(feed: FeedView): FeedOut {
  return {
    cognitionEnabled: cognitionEnabled(),
    date: feed.date,
    run: feed.run ? { ...feed.run } : null,
    cards: feed.cards.flatMap((card): FeedCardOut[] => {
      if (card.kind === "perspective") {
        if (!card.perspective) return [];
        const p = card.perspective;
        return [{ kind: "perspective", topic: p.topicName, question: p.question, reason: p.reason, userSide: p.userSide, userSideLabel: p.userSideLabel,
          counterSide: p.counterSide, exposureRatio: p.exposureRatio,
          stances: p.stances.map((stance) => ({ side: stance.side, label: stance.label, items: stance.items.map(itemView) })),
          analysis: p.analysis, analysisModel: p.analysisModel }];
      }
      if (!card.content) return [];
      return [{ kind: card.kind, topic: card.topicName, reason: card.reason, title: card.content.title, summary: card.content.summary,
        url: card.content.url, author: card.content.authorName, voteUp: card.content.voteUp, contentId: card.content.id, seen: card.seen }];
    }),
  };
}

export function perspectivesView(analysis: TopicAnalysis, userStance: string | null): PerspectivesOut {
  return {
    topic: analysis.topicName,
    isControversial: analysis.isControversial,
    question: analysis.question,
    userStance,
    sides: {
      pro: { label: analysis.proLabel, items: analysis.items.filter((item) => item.side === "pro").map(itemView) },
      con: { label: analysis.conLabel, items: analysis.items.filter((item) => item.side === "con").map(itemView) },
      neutral: analysis.items.filter((item) => item.side === "neutral").map(itemView),
    },
    analysis: analysis.analysis,
    analysisModel: analysis.analysisModel,
  };
}

export function briefView(brief: DailyBrief): BriefOut {
  return {
    date: brief.date, headline: brief.headline, summary: brief.summary, spokenScript: brief.spokenScript,
    followups: brief.followups,
    highlights: brief.highlights.slice(0, 3).map((item) => ({ ...item })), continuity: [...brief.continuity],
    perspectiveHint: brief.perspectiveHint, generatedAt: brief.generatedAt, model: brief.model,
  };
}

export function historyView(signals: HistorySignals): HistoryOut {
  return {
    date: signals.date, windowDays: signals.windowDays,
    topics: signals.topics.map((topic) => ({
      topicName: topic.topicName, pushed: topic.pushed, opened: topic.opened, openRate: Math.round(topic.openRate * 100) / 100,
      lastPushedDate: topic.lastPushedDate, lastOpenedDate: topic.lastOpenedDate,
    })),
    recentOpened: signals.recentOpened.map((item) => ({ ...item })),
    yesterday: signals.yesterday ? { ...signals.yesterday } : null,
    streakDays: signals.streakDays, feedDays: signals.feedDays, totalPushed: signals.totalPushed, totalOpened: signals.totalOpened,
    continuityTopics: [...signals.continuityTopics], openedPerspectiveTopics: [...signals.openedPerspectiveTopics],
  };
}
