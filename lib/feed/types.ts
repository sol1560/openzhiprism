import type { DetectionSummary } from "@/lib/ai-detection/types";
import type { ContentProvider, ZhihuContentType } from "@/lib/zhihu/types";
import type { PerspectiveCard } from "@/lib/perspective/types";
import type { ContentFeedback } from "@/lib/cognition/types";

export type FeedKind = "main" | "light" | "perspective";

export interface FeedContent {
  aiDetection?: DetectionSummary;
  sourceVersion?: string;
  evidenceSourceVersion?: string;
  id: string;
  type: ZhihuContentType;
  title: string;
  summary: string;
  excerpt: string;
  url: string;
  authorName?: string;
  authorAvatar?: string;
  voteUp: number;
  commentCount: number;
  thumbnailUrl?: string;
  provider: ContentProvider;
}

export interface FeedCard {
  feedback?: ContentFeedback | null;
  id: string;
  kind: FeedKind;
  position: number;
  topicName: string | null;
  reason: string;
  content: FeedContent | null;
  perspective: PerspectiveCard | null;
  seen: boolean;
  /** 用户要求改写后的摘要信息；summary 已是覆盖后的文本 */
  override?: { note: string; originalSummary: string } | null;
}

export interface FeedRunInfo {
  sourceUsed: string;
  llmUsed: string;
  stats: Record<string, unknown>;
  createdAt: string;
}

export interface FeedView {
  userId: string;
  date: string;
  cards: FeedCard[];
  run: FeedRunInfo | null;
}

export type BuildStage = "allocate" | "search" | "enrich" | "persist" | "done";

export interface BuildProgress {
  stage: BuildStage;
  /** 已完成的步数（含当前），total 为总步数 */
  index: number;
  total: number;
  /** 例如正在检索的话题名 */
  detail?: string;
}

export interface BuildFeedOptions {
  date?: string;
  /** 主内容条数，默认 12；轻松内容约为其 1/4 */
  mainCount?: number;
  force?: boolean;
  /** 是否生成「换个角度看」卡片 */
  withPerspectives?: boolean;
  /** 构建阶段回调，供后台任务把真实进度写入状态行 */
  onProgress?: (event: BuildProgress) => void | Promise<void>;
}

export type FeedBuildStatus = "queued" | "running" | "ready" | "error";

/** 前端可见的构建状态（feed_builds 行的投影） */
export interface FeedBuildView {
  status: FeedBuildStatus;
  stage: BuildStage | null;
  stageIndex: number;
  stageTotal: number;
  detail: string | null;
  error: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

// ── 阅读历史信号 ────────────────────────────────────────

/** 一个话题在窗口期内被推送 / 被点开的统计（只统计目标日期之前的天） */
export interface TopicEngagement {
  topicName: string;
  topicId: string | null;
  pushed: number;
  opened: number;
  /** opened / pushed，pushed 为 0 时为 0 */
  openRate: number;
  lastPushedDate: string | null;
  lastOpenedDate: string | null;
}

export interface RecentOpened {
  contentId: string;
  title: string;
  url: string;
  topicName: string | null;
  kind: FeedKind;
  /** 该内容所在 feed 的日期 */
  date: string;
  seenAt: string;
}

export interface DaySummary {
  date: string;
  main: number;
  light: number;
  perspectives: number;
  opened: number;
}

/** 经过 RSC 边界传给客户端，因此只用数组与纯对象 */
export interface HistorySignals {
  date: string;
  windowDays: number;
  /** opened desc, pushed desc */
  topics: TopicEngagement[];
  /** 最近点开的内容，seenAt desc，最多 8 条 */
  recentOpened: RecentOpened[];
  yesterday: DaySummary | null;
  /** 截至 date（或 date-1）连续有 feed 的天数 */
  streakDays: number;
  feedDays: number;
  totalPushed: number;
  totalOpened: number;
  /** date-1 有打开记录的话题（含视角卡里的条目） */
  continuityTopics: string[];
  /** 窗口期内点开过视角卡条目的话题 */
  openedPerspectiveTopics: string[];
}

// ── 每日简报 ────────────────────────────────────────────

export interface BriefHighlight {
  takeaway?: string;
  cardId: string;
  contentId: string | null;
  title: string;
  topicName: string | null;
  why: string;
}

/** 页面头部与语音向导共用的每日简报；spokenScript 是可直接朗读的口语文本 */
export interface DailyBrief {
  followups?: Array<{ reflectionId: string; jobId: string; topic: string; titles: string[]; question: string }>;
  date: string;
  /** ≤ 30 字 */
  headline: string;
  /** 2-3 句，给页面头部 */
  summary: string;
  /** 150-300 字口语化开场播报 */
  spokenScript: string;
  /** 最多三条，材料不足时不补齐 */
  highlights: BriefHighlight[];
  /** 与昨天 / 最近阅读的连续性说明 */
  continuity: string[];
  perspectiveHint?: string;
  generatedAt: string;
  model: string;
}

// ── 自然语言要求（「对 Feed 说话」） ────────────────────

export type DirectiveKind = "topic" | "rule";
export type DirectiveDirection = "more" | "less" | "mute";

/** feed_directives 行的投影，经 RSC 边界传给客户端 */
export interface DirectiveView {
  id: string;
  kind: DirectiveKind;
  topic: string | null;
  direction: DirectiveDirection | null;
  text: string;
  createdAt: string;
}

export type AskActionType = "rewrite" | "answer" | "search" | "adjust_topic" | "add_rule";

/** LLM 解释后、执行前的结构化计划（已经过 normalizePlan 清洗） */
export interface AskPlan {
  reply: string;
  /** 仅卡片级改写时存在 */
  summary?: string;
  actions: AskAction[];
}

export type AskAction =
  | { type: "rewrite" }
  | { type: "answer" }
  | { type: "search"; query: string }
  | { type: "adjust_topic"; topic: string; direction: DirectiveDirection }
  | { type: "add_rule"; rule: string };

export interface AskActionResult {
  type: AskActionType;
  ok: boolean;
  /** 给 UI 的短标签，例如「已改写」「已加 2 条」 */
  note: string;
  cardId?: string;
  cardIds?: string[];
  directive?: DirectiveView;
}

export interface AskResponse {
  reply: string;
  results: AskActionResult[];
  cards: FeedCard[];
  directives: DirectiveView[];
  /** 有话题增减时提示用户重建 */
  rebuildSuggested: boolean;
  live: boolean;
}
