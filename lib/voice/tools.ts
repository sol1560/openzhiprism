import type { FeedCard, FeedView } from "@/lib/feed/types";
import { COGNITION_VOICE_DEFINITIONS, createCognitionVoiceTools, type CognitionContext } from "@/lib/cognition/voice";
import type { ContentFeedback } from "@/lib/cognition/types";

/**
 * 语音向导的工具层：定义（给 ElevenLabs agent 配置）与实现（给浏览器 clientTools）共用一份常量。
 * 实现只依赖一个 fetchJson 与几个 UI 钩子，不碰 DOM、不 import Next，换成 Webhook 传输时可原样复用。
 * 所有工具返回 JSON 字符串、绝不 throw：失败也返回 {"error": "..."}，让模型如实告诉用户。
 */

export interface VoiceToolDefinition {
  name: string;
  /** 给模型看的中文描述 */
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  expectsResponse: boolean;
  responseTimeoutSecs: number;
}

const NO_PARAMS = { type: "object", properties: {} } as const;
const CARD_ID = { type: "string", description: "卡片 id，来自 get_today_feed / get_today_brief 的 cardId" } as const;

export const VOICE_TOOL_DEFINITIONS: readonly VoiceToolDefinition[] = [
  ...COGNITION_VOICE_DEFINITIONS,
  {
    name: "get_today_brief",
    description: "读取今日播报：一句话标题、总结、最多三条亮点（含卡片 id 与序号）和连续关注的话题。开场或用户问「今天发生了什么」「有什么值得看的」时用。",
    parameters: NO_PARAMS, expectsResponse: true, responseTimeoutSecs: 15,
  },
  {
    name: "get_today_feed",
    description: "列出今日 Feed 全部卡片：序号 index、卡片 id、类型（main 主内容 / light 热榜轻松内容 / perspective 换个角度看）、话题、标题、不超过 120 字的摘要、赞同数、是否已读。用户说「第几条」时以 index 为准。",
    parameters: NO_PARAMS, expectsResponse: true, responseTimeoutSecs: 15,
  },
  {
    name: "get_card_detail",
    description: "读取一张卡片的完整摘要、推荐理由、作者、赞同数和原文节选；展开讲某一条之前调用。视角卡会返回核心问题、用户倾向、另一方的两条高赞回答与中立分析。",
    parameters: { type: "object", properties: { cardId: CARD_ID }, required: ["cardId"] }, expectsResponse: true, responseTimeoutSecs: 15,
  },
  {
    name: "get_interest_profile",
    description: "读取用户的兴趣画像：前八个话题的名称、权重、关键词、是否有争议、立场倾向。用户问「你觉得我关心什么」「我的画像」时用。",
    parameters: NO_PARAMS, expectsResponse: true, responseTimeoutSecs: 15,
  },
  {
    name: "get_reading_history",
    description: "读取最近几天的阅读信号：各话题推送与打开数、最近打开的内容、昨天的情况、连续有 Feed 的天数、昨天在读的话题。",
    parameters: { type: "object", properties: { days: { type: "integer", description: "统计窗口天数，1-30，默认 7" } } }, expectsResponse: true, responseTimeoutSecs: 15,
  },
  {
    name: "get_perspectives",
    description: "对一个话题做「换个角度看」：核心争议问题、正反双方的标签与各两条高赞回答、一段中立分析。只在用户同意听另一方观点之后调用。首次分析可能需要十几秒。",
    parameters: { type: "object", properties: { topic: { type: "string", description: "话题名，例如「考研还是工作」" } }, required: ["topic"] }, expectsResponse: true, responseTimeoutSecs: 60,
  },
  {
    name: "search_zhihu",
    description: "在知乎搜索一个用户临时提出、今日 Feed 里没有的问题，最多返回五条。接口额度有限，Feed 里已有的内容不要用它。",
    parameters: { type: "object", properties: { query: { type: "string", description: "检索词，2-40 个字" } }, required: ["query"] }, expectsResponse: true, responseTimeoutSecs: 30,
  },
  {
    name: "mark_seen",
    description: "把一张或多张卡片标为已读，之后不再推送。必须先得到用户明确确认再调用。",
    parameters: { type: "object", properties: { cardIds: { type: "array", items: { type: "string", description: "卡片 id" }, description: "卡片 id 列表" } }, required: ["cardIds"] }, expectsResponse: true, responseTimeoutSecs: 10,
  },
  {
    name: "focus_card",
    description: "让页面滚动到某张卡片并高亮，不改变任何数据。开始讲一张卡片之前调用。",
    parameters: { type: "object", properties: { cardId: CARD_ID }, required: ["cardId"] }, expectsResponse: true, responseTimeoutSecs: 5,
  },
  {
    name: "open_card",
    description: "在新标签页打开卡片的知乎原文，并标为已读。只在用户明确说「打开」「去看原文」时用。",
    parameters: { type: "object", properties: { cardId: CARD_ID }, required: ["cardId"] }, expectsResponse: true, responseTimeoutSecs: 5,
  },
  {
    name: "rebuild_feed",
    description: "重新生成今日 Feed，大约需要二三十秒。立即返回「已开始」，生成完成后你会收到一条上下文更新。必须先得到用户确认再调用。",
    parameters: { type: "object", properties: { force: { type: "boolean", description: "是否强制重建，默认 true" } } }, expectsResponse: true, responseTimeoutSecs: 5,
  },
  {
    name: "get_status",
    description: "查看内容源状态、知乎接口剩余额度和当前使用的模型。用户问「数据从哪来」时用。",
    parameters: NO_PARAMS, expectsResponse: true, responseTimeoutSecs: 15,
  },
];

export const VOICE_TOOL_NAMES = VOICE_TOOL_DEFINITIONS.map((tool) => tool.name);

export interface VoiceDataClient {
  /** 发 GET/POST 到本站 API；非 2xx 需 reject 并带上服务端的 error 文案 */
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export interface VoiceUi {
  onContentFeedback?: (id: string, kind: ContentFeedback | null) => void;
  cognitionContext?: () => CognitionContext;
  /** 滚动并高亮；找不到 DOM 节点返回 false */
  focusCard(cardId: string): boolean;
  /** 新标签页打开原文；被拦截返回 false */
  openCard(url: string): boolean;
  markSeen(contentIds: string[]): Promise<void>;
  /** 发起后台重建；完成与否由页面另行通知 agent */
  rebuild(force: boolean): Promise<void>;
}

export type VoiceToolHandler = (params: Record<string, unknown>) => Promise<string>;
export type VoiceTools = Record<string, VoiceToolHandler>;

export interface CompactCard {
  index: number;
  cardId: string;
  contentId: string | null;
  kind: FeedCard["kind"];
  topic: string | null;
  title: string;
  summary: string;
  voteUp: number;
  seen: boolean;
}

export const LIMITS = { summary: 120, excerpt: 300, analysis: 300, items: 2, topics: 8, searchItems: 5, maxCards: 24 } as const;

const chars = (value: string) => [...value].length;
export function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return chars(text) <= max ? text : `${[...text].slice(0, max - 1).join("").trimEnd()}…`;
}

export function compactCard(card: FeedCard, index: number, max: number = LIMITS.summary): CompactCard {
  if (card.kind === "perspective") {
    return {
      index, cardId: card.id, contentId: null, kind: "perspective", topic: card.topicName,
      title: card.perspective?.question ?? `${card.topicName ?? ""}：换个角度看`,
      summary: clip(card.reason, max), voteUp: 0, seen: card.seen,
    };
  }
  return {
    index, cardId: card.id, contentId: card.content?.id ?? null, kind: card.kind, topic: card.topicName,
    title: card.content?.title ?? "", summary: clip(card.content?.summary, max), voteUp: card.content?.voteUp ?? 0, seen: card.seen,
  };
}

export function fail(message: string): string {
  return JSON.stringify({ error: message });
}

const ok = (value: unknown) => JSON.stringify(value);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const asString = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

function perspectiveDetail(card: FeedCard, index: number) {
  const p = card.perspective;
  if (!p) return null;
  const counter = p.stances.find((stance) => stance.side === p.counterSide);
  const others = p.stances.filter((stance) => stance.side !== p.counterSide);
  return {
    cardId: card.id, index, kind: "perspective", topic: p.topicName, question: p.question,
    userSideLabel: p.userSideLabel, exposurePercent: Math.round(p.exposureRatio * 100), reason: clip(p.reason, 120),
    counterLabel: counter?.label ?? null,
    counterItems: (counter?.items ?? []).slice(0, LIMITS.items).map((item) => ({ title: item.title, oneLine: clip(item.oneLine, 80), voteUp: item.voteUp })),
    otherSides: others.map((stance) => ({ side: stance.side, label: stance.label, items: stance.items.slice(0, 1).map((item) => ({ title: item.title, oneLine: clip(item.oneLine, 80) })) })),
    analysis: clip(p.analysis, LIMITS.analysis) || null,
  };
}

export function createVoiceTools(deps: { data: VoiceDataClient; ui: VoiceUi }): VoiceTools {
  const { data, ui } = deps;
  let lastFeed: FeedView | null = null;

  const loadFeed = async (): Promise<FeedView> => {
    const feed = (await data.fetchJson("/api/feed")) as FeedView;
    lastFeed = feed;
    return feed;
  };
  const ensureFeed = async () => lastFeed ?? loadFeed();
  const locate = async (cardId: string): Promise<{ card: FeedCard; index: number } | null> => {
    let feed = await ensureFeed();
    let position = feed.cards.findIndex((card) => card.id === cardId);
    if (position < 0) {
      feed = await loadFeed();
      position = feed.cards.findIndex((card) => card.id === cardId);
    }
    return position < 0 ? null : { card: feed.cards[position], index: position + 1 };
  };
  const guard = (fn: (params: Record<string, unknown>) => Promise<string>): VoiceToolHandler =>
    async (params) => {
      try { return await fn(params ?? {}); } catch (error) { return fail(errorText(error)); }
    };
  const missing = (cardId: string) => fail(cardId ? `今天的 Feed 里没有这张卡片：${cardId}` : "缺少 cardId");

  return {
    ...createCognitionVoiceTools(data, ui.cognitionContext, ui.onContentFeedback),
    get_today_brief: guard(async () => {
      const brief = (await data.fetchJson("/api/feed/brief")) as {
        date: string; headline: string; summary: string; highlights: Array<{ cardId: string; title: string; topicName: string | null; why: string }>; continuity: string[]; perspectiveHint?: string;
      };
      const feed = lastFeed;
      return ok({
        date: brief.date, headline: brief.headline, summary: brief.summary,
        highlights: brief.highlights.map((item) => {
          const position = feed ? feed.cards.findIndex((card) => card.id === item.cardId) : -1;
          return { ...(position >= 0 ? { index: position + 1 } : {}), cardId: item.cardId, title: item.title, topic: item.topicName, why: item.why };
        }),
        continuity: brief.continuity, perspectiveHint: brief.perspectiveHint ?? null,
      });
    }),

    get_today_feed: guard(async () => {
      const feed = await loadFeed();
      const cards = feed.cards.slice(0, LIMITS.maxCards).map((card, position) => compactCard(card, position + 1));
      return ok({ date: feed.date, count: feed.cards.length, cards });
    }),

    get_card_detail: guard(async (params) => {
      const cardId = asString(params.cardId);
      const hit = cardId ? await locate(cardId) : null;
      if (!hit) return missing(cardId);
      const { card, index } = hit;
      if (card.kind === "perspective") return ok(perspectiveDetail(card, index));
      const content = card.content;
      if (!content) return missing(cardId);
      return ok({
        cardId: card.id, index, kind: card.kind, topic: card.topicName, title: content.title,
        summary: clip(content.summary, LIMITS.excerpt), reason: clip(card.reason, 120), author: content.authorName ?? null,
        voteUp: content.voteUp, commentCount: content.commentCount, excerpt: clip(content.excerpt, LIMITS.excerpt), seen: card.seen,
      });
    }),

    get_interest_profile: guard(async () => {
      const profile = (await data.fetchJson("/api/profile")) as { topics: Array<{ name: string; weight: number; keywords: string[]; controversial: boolean; stanceLabel: string | null }> };
      return ok({
        topics: profile.topics.slice(0, LIMITS.topics).map((topic) => ({
          name: topic.name, weight: Math.round(topic.weight * 100) / 100, keywords: topic.keywords.slice(0, 5), controversial: topic.controversial, stanceLabel: topic.stanceLabel,
        })),
      });
    }),

    get_reading_history: guard(async (params) => {
      const raw = Number(params.days ?? 7);
      const days = Number.isFinite(raw) ? Math.min(30, Math.max(1, Math.round(raw))) : 7;
      return ok(await data.fetchJson(`/api/feed/history?days=${days}`));
    }),

    get_perspectives: guard(async (params) => {
      const topic = asString(params.topic);
      if (topic.length < 2) return fail("缺少话题名");
      const view = (await data.fetchJson(`/api/perspectives?topic=${encodeURIComponent(topic)}`)) as {
        topic: string; isControversial: boolean; question: string; userStance: string | null;
        sides: { pro: { label: string; items: Array<{ title: string; oneLine: string; voteUp: number }> }; con: { label: string; items: Array<{ title: string; oneLine: string; voteUp: number }> }; neutral: Array<{ title: string; oneLine: string; voteUp: number }> };
        analysis: string | null;
      };
      const items = (list: Array<{ title: string; oneLine: string; voteUp: number }>, max: number) => list.slice(0, max).map((item) => ({ title: item.title, oneLine: clip(item.oneLine, 80), voteUp: item.voteUp }));
      if (!view.isControversial) return ok({ topic: view.topic, isControversial: false, note: "这个话题在公共讨论里没有明显对立的立场，不需要换个角度看" });
      return ok({
        topic: view.topic, isControversial: true, question: view.question, userStance: view.userStance,
        pro: { label: view.sides.pro.label, items: items(view.sides.pro.items, LIMITS.items) },
        con: { label: view.sides.con.label, items: items(view.sides.con.items, LIMITS.items) },
        neutral: items(view.sides.neutral, 1),
        analysis: clip(view.analysis, LIMITS.analysis) || null,
      });
    }),

    search_zhihu: guard(async (params) => {
      const query = clip(asString(params.query), 40);
      if (query.length < 2) return fail("检索词至少两个字");
      const result = (await data.fetchJson(`/api/search?q=${encodeURIComponent(query)}`)) as { provider: string; items: Array<{ title: string; url: string; voteUp: number; excerpt: string }> };
      return ok({ query, provider: result.provider, items: result.items.slice(0, LIMITS.searchItems).map((item) => ({ title: item.title, voteUp: item.voteUp, excerpt: clip(item.excerpt, LIMITS.summary) })) });
    }),

    mark_seen: guard(async (params) => {
      const ids = Array.isArray(params.cardIds) ? params.cardIds.map(asString).filter(Boolean) : [asString(params.cardIds)].filter(Boolean);
      if (ids.length === 0) return fail("缺少 cardIds");
      const contentIds: string[] = [];
      const skipped: string[] = [];
      for (const cardId of ids) {
        const hit = await locate(cardId);
        if (hit?.card.content) contentIds.push(hit.card.content.id); else skipped.push(cardId);
      }
      if (contentIds.length > 0) {
        await ui.markSeen(contentIds);
        if (lastFeed) lastFeed = { ...lastFeed, cards: lastFeed.cards.map((card) => (card.content && contentIds.includes(card.content.id) ? { ...card, seen: true } : card)) };
      }
      return ok({ ok: true, marked: contentIds.length, skipped });
    }),

    focus_card: guard(async (params) => {
      const cardId = asString(params.cardId);
      const hit = cardId ? await locate(cardId) : null;
      if (!hit) return missing(cardId);
      return ui.focusCard(cardId) ? ok({ ok: true, cardId, index: hit.index, title: compactCard(hit.card, hit.index).title }) : fail("页面上没有找到这张卡片，可能还在加载");
    }),

    open_card: guard(async (params) => {
      const cardId = asString(params.cardId);
      const hit = cardId ? await locate(cardId) : null;
      if (!hit) return missing(cardId);
      const content = hit.card.content;
      if (!content) return fail("视角卡没有单独的原文链接，可以让用户展开卡片里的具体回答");
      if (!ui.openCard(content.url)) return fail("浏览器拦截了新标签页，请用户手动点击卡片");
      await ui.markSeen([content.id]);
      if (lastFeed) lastFeed = { ...lastFeed, cards: lastFeed.cards.map((card) => (card.id === hit.card.id ? { ...card, seen: true } : card)) };
      return ok({ ok: true, cardId, title: content.title });
    }),

    rebuild_feed: guard(async (params) => {
      const force = params.force === undefined ? true : params.force !== false && params.force !== "false";
      void ui.rebuild(force).catch(() => undefined);
      lastFeed = null;
      return ok({ started: true, etaSeconds: 30 });
    }),

    get_status: guard(async () => {
      const status = (await data.fetchJson("/api/status")) as {
        source: { strategy: string; active: string; official: { configured: boolean; searchRemaining?: number | null; hotRemaining?: number | null; zhidaRemaining?: number | null } };
        llm: { provider: string; model: string };
      };
      return ok({
        source: { strategy: status.source.strategy, active: status.source.active, official: status.source.official.configured ? { searchRemaining: status.source.official.searchRemaining ?? null, hotRemaining: status.source.official.hotRemaining ?? null, zhidaRemaining: status.source.official.zhidaRemaining ?? null } : null },
        llm: status.llm,
      });
    }),
  };
}
