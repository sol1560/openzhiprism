import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import type { FeedItem } from "@/db/schema";
import type { PerspectiveCard } from "@/lib/perspective/types";
import { todayKey } from "@/lib/zhihu/text";
import type { DaySummary, FeedKind, HistorySignals, RecentOpened, TopicEngagement } from "./types";

/**
 * 阅读历史信号：seen_items ⋈ feed_items（同一用户、按 contentId），在内存里聚合。
 * 视角卡没有 contentId，靠 payload.stances[].items[].id 命中；MCP 写入的任意 id 若不在任何 feed 行里则忽略。
 * 视角卡是刻意插入的，不计入话题的 pushed/opened，只体现在 continuity / openedPerspectiveTopics / recentOpened。
 */

export const HISTORY_WINDOW_DAYS = 14;
const RECENT_LIMIT = 8;

/** 本地时间下的日期位移，与 todayKey 同族 */
export function shiftDateKey(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return todayKey(new Date(y, m - 1, d + days));
}

export interface HistoryInput {
  /** 该用户 date 及之前（窗口内）的 feed 行 */
  feedRows: FeedItem[];
  seenRows: Array<{ contentId: string; seenAt: Date }>;
  /** main / light 内容的标题与链接，缺失时 recentOpened 退化为 id */
  contentById: Map<string, { title: string; url: string }>;
}

interface Indexed {
  row: FeedItem;
  kind: FeedKind;
  topicName: string | null;
  title: string;
  url: string;
}

function perspectiveItems(row: FeedItem): Array<{ id: string; title: string; url: string }> {
  const card = row.payload as Partial<PerspectiveCard> | null | undefined;
  const stances = Array.isArray(card?.stances) ? card.stances : [];
  return stances.flatMap((stance) => (Array.isArray(stance?.items) ? stance.items : []))
    .filter((item) => typeof item?.id === "string")
    .map((item) => ({ id: item.id, title: item.title ?? "", url: item.url ?? "" }));
}

export function computeHistorySignals(input: HistoryInput, date: string, windowDays = HISTORY_WINDOW_DAYS): HistorySignals {
  const windowStart = shiftDateKey(date, -windowDays);
  const yesterdayKey = shiftDateKey(date, -1);
  const rows = [...input.feedRows].filter((row) => row.date <= date).sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  const seenAt = new Map<string, Date>();
  for (const seen of input.seenRows) {
    const prev = seenAt.get(seen.contentId);
    if (!prev || seen.seenAt > prev) seenAt.set(seen.contentId, seen.seenAt);
  }

  // contentId → 首次出现的 feed 行
  const index = new Map<string, Indexed>();
  for (const row of rows) {
    if (row.kind === "perspective") {
      for (const item of perspectiveItems(row)) {
        if (!index.has(item.id)) index.set(item.id, { row, kind: "perspective", topicName: row.topicName, title: item.title, url: item.url });
      }
    } else if (row.contentId && !index.has(row.contentId)) {
      const content = input.contentById.get(row.contentId);
      index.set(row.contentId, { row, kind: row.kind as FeedKind, topicName: row.topicName, title: content?.title ?? row.contentId, url: content?.url ?? "" });
    }
  }

  const topics = new Map<string, TopicEngagement>();
  let totalPushed = 0;
  let totalOpened = 0;
  for (const row of rows) {
    if (row.date >= date || row.date < windowStart) continue;
    if (row.kind === "perspective" || !row.contentId) continue;
    const opened = seenAt.has(row.contentId);
    totalPushed += 1;
    if (opened) totalOpened += 1;
    if (row.kind !== "main" || !row.topicName) continue;
    const entry = topics.get(row.topicName) ?? {
      topicName: row.topicName, topicId: row.topicId, pushed: 0, opened: 0, openRate: 0, lastPushedDate: null, lastOpenedDate: null,
    };
    entry.pushed += 1;
    entry.topicId ??= row.topicId;
    if (!entry.lastPushedDate || row.date > entry.lastPushedDate) entry.lastPushedDate = row.date;
    if (opened) {
      entry.opened += 1;
      const openedDay = todayKey(seenAt.get(row.contentId)!);
      if (!entry.lastOpenedDate || openedDay > entry.lastOpenedDate) entry.lastOpenedDate = openedDay;
    }
    topics.set(row.topicName, entry);
  }
  for (const entry of topics.values()) entry.openRate = entry.pushed > 0 ? entry.opened / entry.pushed : 0;

  // 已打开的内容（任意日期 ≤ date），按 seenAt 倒序
  const opened = [...seenAt.entries()]
    .map(([contentId, at]) => ({ contentId, at, hit: index.get(contentId) }))
    .filter((entry): entry is { contentId: string; at: Date; hit: Indexed } => Boolean(entry.hit))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const recentOpened: RecentOpened[] = opened.slice(0, RECENT_LIMIT).map(({ contentId, at, hit }) => ({
    contentId, title: hit.title, url: hit.url, topicName: hit.topicName, kind: hit.kind, date: hit.row.date, seenAt: at.toISOString(),
  }));

  const continuityTopics: string[] = [];
  const openedPerspectiveTopics: string[] = [];
  for (const { at, hit } of opened) {
    if (!hit.topicName) continue;
    const day = todayKey(at);
    if (day === yesterdayKey && !continuityTopics.includes(hit.topicName)) continuityTopics.push(hit.topicName);
    if (hit.kind === "perspective" && day >= windowStart && day < date && !openedPerspectiveTopics.includes(hit.topicName)) {
      openedPerspectiveTopics.push(hit.topicName);
    }
  }

  const dates = [...new Set(rows.map((row) => row.date))].sort();
  let yesterday: DaySummary | null = null;
  if (dates.includes(yesterdayKey)) {
    const dayRows = rows.filter((row) => row.date === yesterdayKey);
    let openedCount = 0;
    for (const row of dayRows) {
      if (row.kind === "perspective") openedCount += perspectiveItems(row).filter((item) => seenAt.has(item.id)).length;
      else if (row.contentId && seenAt.has(row.contentId)) openedCount += 1;
    }
    yesterday = {
      date: yesterdayKey,
      main: dayRows.filter((row) => row.kind === "main").length,
      light: dayRows.filter((row) => row.kind === "light").length,
      perspectives: dayRows.filter((row) => row.kind === "perspective").length,
      opened: openedCount,
    };
  }

  const dateSet = new Set(dates);
  let streakDays = 0;
  let cursor = dateSet.has(date) ? date : yesterdayKey;
  while (dateSet.has(cursor)) {
    streakDays += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return {
    date,
    windowDays,
    topics: [...topics.values()].sort((a, b) => b.opened - a.opened || b.pushed - a.pushed || a.topicName.localeCompare(b.topicName)),
    recentOpened,
    yesterday,
    streakDays,
    feedDays: dates.length,
    totalPushed,
    totalOpened,
    continuityTopics,
    openedPerspectiveTopics,
  };
}

export function engagementFor(signals: HistorySignals, topicName: string): TopicEngagement | undefined {
  return signals.topics.find((topic) => topic.topicName === topicName);
}

export async function historySignalsFrom(
  database: Db,
  userId: string,
  options: { date?: string; windowDays?: number } = {},
): Promise<HistorySignals> {
  const date = options.date ?? todayKey();
  const windowDays = options.windowDays ?? HISTORY_WINDOW_DAYS;
  const windowStart = shiftDateKey(date, -(windowDays + 1));
  const [feedRows, seenRows] = await Promise.all([
    database.select().from(schema.feedItems)
      .where(and(eq(schema.feedItems.userId, userId), gte(schema.feedItems.date, windowStart), lte(schema.feedItems.date, date))),
    database.select({ contentId: schema.seenItems.contentId, seenAt: schema.seenItems.seenAt })
      .from(schema.seenItems).where(eq(schema.seenItems.userId, userId)),
  ]);
  const seenIds = new Set(seenRows.map((row) => row.contentId));
  const wanted = feedRows.map((row) => row.contentId).filter((id): id is string => Boolean(id) && seenIds.has(id!));
  const contents = wanted.length > 0
    ? await database.select({ contentId: schema.contentCache.contentId, title: schema.contentCache.title, url: schema.contentCache.url })
      .from(schema.contentCache).where(inArray(schema.contentCache.contentId, wanted))
    : [];
  return computeHistorySignals(
    { feedRows, seenRows, contentById: new Map(contents.map((row) => [row.contentId, { title: row.title, url: row.url }])) },
    date,
    windowDays,
  );
}

export async function getHistorySignals(userId: string, options: { date?: string; windowDays?: number } = {}): Promise<HistorySignals> {
  return historySignalsFrom(await db(), userId, options);
}
