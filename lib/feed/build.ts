import { cognitionEnabled } from "@/lib/cognition/types";
import { canonicalText, digest } from "@/lib/cognition/evidence";
import { jobSummary } from "@/lib/ai-detection/service";
import { DETECTION_MODEL, PROCESSING_VERSION } from "@/lib/ai-detection/text";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import type { InterestTopic } from "@/db/schema";
import { llmObject, describeLlm } from "@/lib/llm/client";
import { HOT_PICK_SYSTEM, hotPickPrompt, hotPickSchema } from "@/lib/llm/prompts";
import { buildPerspectiveCards } from "@/lib/perspective";
import type { PerspectiveCard } from "@/lib/perspective/types";
import { getProfile } from "@/lib/profile/store";
import { writeTransaction } from "@/lib/security/transaction";
import { getHotList, searchZhihu, cacheItems } from "@/lib/zhihu/provider";
import { similarity, todayKey } from "@/lib/zhihu/text";
import type { ContentProvider, HotItem, ZhihuItem } from "@/lib/zhihu/types";
import { listDirectives } from "./directives";
import { engagementFor, getHistorySignals } from "./history";
import { restyleSummaries } from "./restyle";
import { allocateSlots, applyDirectives, applyHistoryBoost, buildHistoryReason, buildReason, interleaveFeed, pinTopics, rankItems } from "./select";
import { summarizeItems } from "./summarize";
import type { BuildFeedOptions, BuildProgress, FeedCard, FeedContent, FeedView } from "./types";

/**
 * 每日 Feed 生成：选题 → 搜索 → 去重 → 摘要 → 80/20 混排 → 视角卡 → 落库。
 */

const DEFAULT_MAIN = 12;

interface TopicPick {
  topic: InterestTopic;
  items: ZhihuItem[];
}

async function seenIds(userId: string, database?: Db): Promise<Set<string>> {
  database ??= await db();
  const rows = await database
    .select({ contentId: schema.seenItems.contentId })
    .from(schema.seenItems)
    .where(eq(schema.seenItems.userId, userId));
  return new Set(rows.map((row) => row.contentId));
}

/** 历史 feed 已推送过的内容也视为「已看过」，避免每天重复 */
async function pushedIds(userId: string, excludeDate: string): Promise<Set<string>> {
  const database = await db();
  const rows = await database
    .select({ contentId: schema.feedItems.contentId, date: schema.feedItems.date })
    .from(schema.feedItems)
    .where(eq(schema.feedItems.userId, userId));
  return new Set(rows.filter((row) => row.contentId && row.date !== excludeDate).map((row) => row.contentId!));
}

async function pickForTopic(
  topic: InterestTopic,
  count: number,
  exclude: Set<string>,
  providersUsed: Set<ContentProvider>,
): Promise<TopicPick> {
  const queries = topic.searchQueries.length > 0 ? topic.searchQueries : [topic.name];
  const pool: ZhihuItem[] = [];
  const localSeen = new Set<string>();
  for (const query of queries.slice(0, 2)) {
    const result = await searchZhihu(query, { count: 10 });
    providersUsed.add(result.provider);
    for (const item of result.items) {
      if (exclude.has(item.id) || localSeen.has(item.id) || item.type === "question") continue;
      localSeen.add(item.id);
      pool.push(item);
    }
    if (pool.length >= count * 3) break;
  }
  return { topic, items: rankItems(pool, count) };
}

async function pickLight(topics: InterestTopic[], count: number, exclude: Set<string>, avoid: string[] = []): Promise<Array<{ item: HotItem; reason: string }>> {
  if (count <= 0) return [];
  const hot = await getHotList(30);
  const candidates = hot.items.filter((item) => !exclude.has(item.id));
  if (candidates.length === 0) return [];
  const topicNames = topics.slice(0, 6).map((topic) => topic.name);
  const result = await llmObject({
    schema: hotPickSchema,
    system: HOT_PICK_SYSTEM,
    prompt: hotPickPrompt(topicNames, candidates.map((item) => ({ id: item.id, title: item.title, excerpt: item.excerpt })), avoid),
    fallback: () => ({
      picks: [...candidates]
        .map((item) => ({
          item,
          score: Math.max(...topicNames.map((name) => similarity(name, `${item.title} ${item.excerpt}`)), 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(({ item, score }) => ({ id: item.id, reason: score > 0.05 ? "今日热榜里和你兴趣相关的讨论" : "今日热榜 · 换换脑子" })),
    }),
  });
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const picks: Array<{ item: HotItem; reason: string }> = [];
  for (const pick of result.value.picks) {
    const item = byId.get(pick.id);
    if (item && picks.length < count) picks.push({ item, reason: pick.reason || "今日热榜 · 换换脑子" });
  }
  // 模型返回不足时按顺序补齐
  for (const item of candidates) {
    if (picks.length >= count) break;
    if (!picks.some((pick) => pick.item.id === item.id)) picks.push({ item, reason: "今日热榜 · 换换脑子" });
  }
  return picks;
}

export async function buildDailyFeed(userId: string, options: BuildFeedOptions = {}): Promise<FeedView> {
  const date = options.date ?? todayKey();
  const mainCount = options.mainCount ?? DEFAULT_MAIN;
  const lightCount = Math.max(1, Math.round(mainCount / 4));
  const database = await db();

  if (!options.force) {
    const existing = await getFeed(userId, date);
    if (existing.cards.length > 0) return existing;
  }

  const profile = await getProfile(userId);
  // 用户的话题要求（多推 / 少推 / 不再推）乘进权重；长期规则喂给热榜挑选与摘要改写
  const directives = await listDirectives(userId, database);
  const topics = applyDirectives(profile, directives);
  const rules = directives.filter((directive) => directive.kind === "rule").map((directive) => directive.text);
  if (topics.length === 0) {
    return { userId, date, cards: [], run: null };
  }

  const exclude = new Set([...(await seenIds(userId)), ...(await pushedIds(userId, date))]);
  const feedbackRows = cognitionEnabled() ? await database.select().from(schema.contentFeedback).where(eq(schema.contentFeedback.userId, userId)) : [];
  for (const row of feedbackRows) if (["known", "irrelevant", "misleading"].includes(row.kind)) exclude.add(row.contentId);
  const providersUsed = new Set<ContentProvider>();

  // 1. 主内容：画像权重 × 阅读历史系数分配名额，昨天在读的话题保证有名额，逐话题检索
  const history = await getHistorySignals(userId, { date });
  const boosted = applyHistoryBoost(topics, history.topics);
  const allocations = allocateSlots(pinTopics(boosted, history.continuityTopics), mainCount);
  // 进度：allocate(1) + 每个话题检索 + enrich(1) + persist(1)
  const total = allocations.length + 3;
  const progress = async (event: Omit<BuildProgress, "total">) => {
    await options.onProgress?.({ ...event, total });
  };
  await progress({ stage: "allocate", index: 1, detail: `${allocations.length} 个话题` });
  const picks: TopicPick[] = [];
  for (const [i, allocation] of allocations.entries()) {
    await progress({ stage: "search", index: i + 2, detail: allocation.topic.name });
    const pick = await pickForTopic(allocation.topic, allocation.count, exclude, providersUsed);
    for (const item of pick.items) exclude.add(item.id);
    if (pick.items.length > 0) picks.push(pick);
  }
  const mainItems = picks.flatMap((pick) => pick.items);

  // 2. 轻松内容、3. 视角卡、4. 摘要 —— 三者相互独立，并行执行
  await progress({ stage: "enrich", index: allocations.length + 2, detail: "摘要 · 视角 · 热榜" });
  const exposure = new Map(picks.map((pick) => [pick.topic.name, pick.items]));
  const [light, perspectives, summaries] = await Promise.all([
    pickLight(topics, lightCount, exclude, rules),
    options.withPerspectives === false ? Promise.resolve([]) : buildPerspectiveCards(topics, exposure),
    summarizeItems(mainItems),
  ]);

  // 4b. 用户有长期风格要求时，按用户改写今天的主内容摘要（写入 summary_override，不动共享缓存）
  const restyled = rules.length > 0
    ? await restyleSummaries(mainItems.map((item) => ({ id: item.id, title: item.title, summary: summaries.summaries.get(item.id) ?? item.excerpt, body: item.content ?? item.excerpt })), rules)
    : null;
  const restyleNote = rules.length > 0 ? rules.join("；") : null;

  // 5. 混排
  const mixed = interleaveFeed<
    | { kind: "main"; item: ZhihuItem; topic: InterestTopic }
    | { kind: "light"; item: HotItem; reason: string }
    | { kind: "perspective"; card: PerspectiveCard }
  >(
    picks.map((pick) => ({ topicName: pick.topic.name, cards: pick.items.map((item) => ({ kind: "main" as const, item, topic: pick.topic })) })),
    light.map((entry) => ({ kind: "light" as const, item: entry.item, reason: entry.reason })),
    perspectives.map((entry) => ({ topicName: entry.topicName, card: { kind: "perspective" as const, card: entry.card } })),
  );

  // 6. 落库：热榜内容先进缓存表，再在一个事务里替换当日 feed，失败不会留下空白的一天
  await progress({ stage: "persist", index: allocations.length + 3, detail: `${mixed.length} 张卡片` });
  await cacheItems(
    light.map((entry) => ({
      id: entry.item.id,
      type: "hot" as const,
      title: entry.item.title,
      excerpt: entry.item.excerpt,
      url: entry.item.url,
      voteUp: 0,
      commentCount: 0,
      thumbnailUrl: entry.item.thumbnailUrl,
      provider: entry.item.provider,
    })),
    "__hot_list__",
  );
  const rows: Array<typeof schema.feedItems.$inferInsert> = mixed.map((card, index) => {
    const position = index + 1;
    const payload = card.payload;
    switch (payload.kind) {
      case "main":
        return {
          id: randomUUID(),
          userId,
          date,
          position,
          kind: "main",
          contentId: payload.item.id,
          topicId: payload.topic.id,
          topicName: payload.topic.name,
          reason: buildHistoryReason(payload.topic, engagementFor(history, payload.topic.name), date, history.windowDays) ?? buildReason(payload.topic),
          summaryOverride: restyled?.summaries.get(payload.item.id) ?? null,
          overrideNote: restyled?.summaries.has(payload.item.id) ? restyleNote : null,
        };
      case "light":
        return {
          id: randomUUID(),
          userId,
          date,
          position,
          kind: "light",
          contentId: payload.item.id,
          topicName: null,
          reason: payload.reason,
        };
      case "perspective":
        return {
          id: randomUUID(),
          userId,
          date,
          position,
          kind: "perspective",
          contentId: null,
          topicName: payload.card.topicName,
          reason: payload.card.reason,
          payload: payload.card,
        };
      default: {
        const exhaustive: never = payload;
        return exhaustive;
      }
    }
  });

  const llm = describeLlm();
  const sourceUsed = providersUsed.size === 0 ? "cache" : providersUsed.size === 1 ? [...providersUsed][0] : "mixed";
  await writeTransaction(database, async (tx) => {
    await tx.delete(schema.feedItems).where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.date, date)));
    // 简报基于当日卡片生成，卡片变了就作废，下次读取时懒重建
    await tx.delete(schema.dailyBriefs).where(and(eq(schema.dailyBriefs.userId, userId), eq(schema.dailyBriefs.date, date)));
    for (const row of rows) await tx.insert(schema.feedItems).values(row);
    await tx.insert(schema.feedRuns).values({
      id: randomUUID(),
      userId,
      date,
      sourceUsed,
      llmUsed: summaries.live ? summaries.model : `${llm.provider}/${llm.model}`,
      stats: {
        topics: allocations.length,
        main: mainItems.length,
        light: light.length,
        perspectives: perspectives.length,
        summariesGenerated: summaries.generated,
        summariesCached: summaries.cached,
        providers: [...providersUsed],
        historyBoosted: boosted.filter((topic) => topic.historyKind === "boosted").length,
        historyDamped: boosted.filter((topic) => topic.historyKind === "damped").length,
        continuity: history.continuityTopics.length,
        directives: { topic: directives.length - rules.length, rule: rules.length, restyled: restyled?.summaries.size ?? 0 },
      },
    });
  });
  await progress({ stage: "done", index: total, detail: `${rows.length} 张卡片` });

  return getFeed(userId, date);
}

export async function getFeed(userId: string, date = todayKey(), database?: Db): Promise<FeedView> {
  database ??= await db();
  const rows = await database
    .select()
    .from(schema.feedItems)
    .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.date, date)))
    .orderBy(schema.feedItems.position);
  if (rows.length === 0) return { userId, date, cards: [], run: null };

  const contentIds = rows.map((row) => row.contentId).filter((id): id is string => Boolean(id));
  const contents = contentIds.length > 0
    ? await database.select().from(schema.contentCache).where(inArray(schema.contentCache.contentId, contentIds))
    : [];
  const contentById = new Map(contents.map((row) => [row.contentId, row]));
  const detectionJobs = contentIds.length ? await database.select().from(schema.detectionJobs).where(and(
    inArray(schema.detectionJobs.contentId, contentIds), eq(schema.detectionJobs.model, DETECTION_MODEL),
    eq(schema.detectionJobs.processingVersion, PROCESSING_VERSION),
  )) : [];
  const detectionsById = new Map(detectionJobs.filter((job) => job.status !== "rejected" && contentById.get(job.contentId)?.sourceHash === job.textHash)
    .map((job) => [job.contentId, jobSummary(job)]));
  const seen = await seenIds(userId, database);
  const feedbackRows = cognitionEnabled() ? await database.select().from(schema.contentFeedback).where(eq(schema.contentFeedback.userId, userId)) : [];
  const feedback = new Map(feedbackRows.map((row) => [row.contentId, row.kind]));

  const cards: FeedCard[] = rows.map((row) => {
    const content = row.contentId ? contentById.get(row.contentId) : undefined;
    const feedContent: FeedContent | null = content
      ? {
          id: content.contentId,
          aiDetection: detectionsById.get(content.contentId),
          sourceVersion: content.sourceHash ?? undefined,
          evidenceSourceVersion: content.sourceText ? digest([...canonicalText(content.sourceText)].slice(0, 4000).join("")) : undefined,
          type: content.type as FeedContent["type"],
          title: content.title,
          summary: row.summaryOverride ?? content.summary ?? content.excerpt,
          excerpt: content.excerpt,
          url: content.url,
          authorName: content.authorName ?? undefined,
          authorAvatar: content.authorAvatar ?? undefined,
          voteUp: content.voteUp,
          commentCount: content.commentCount,
          thumbnailUrl: content.thumbnailUrl ?? undefined,
          provider: content.provider as ContentProvider,
        }
      : null;
    return {
      id: row.id,
      feedback: row.contentId ? (feedback.get(row.contentId) as FeedCard["feedback"]) ?? null : null,
      kind: row.kind as FeedCard["kind"],
      position: row.position,
      topicName: row.topicName,
      reason: row.reason,
      content: feedContent,
      perspective: row.kind === "perspective" ? (row.payload as PerspectiveCard) : null,
      seen: row.contentId ? seen.has(row.contentId) : false,
      override: row.summaryOverride && content ? { note: row.overrideNote ?? "", originalSummary: content.summary ?? content.excerpt } : null,
    };
  });

  const runs = await database
    .select()
    .from(schema.feedRuns)
    .where(and(eq(schema.feedRuns.userId, userId), eq(schema.feedRuns.date, date)))
    .orderBy(desc(schema.feedRuns.createdAt))
    .limit(1);
  const run = runs[0];
  return {
    userId,
    date,
    cards,
    run: run
      ? { sourceUsed: run.sourceUsed, llmUsed: run.llmUsed, stats: run.stats as Record<string, unknown>, createdAt: run.createdAt.toISOString() }
      : null,
  };
}

/** 只判断当天是否已有 Feed 行，不加载内容；供连接自检使用。 */
export async function hasFeed(userId: string, date = todayKey()): Promise<boolean> {
  const database = await db();
  const rows = await database.select({ id: schema.feedItems.id }).from(schema.feedItems)
    .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.date, date))).limit(1);
  return rows.length > 0;
}

export async function markSeen(userId: string, contentIds: string[]) {
  if (contentIds.length === 0) return;
  const database = await db();
  for (const contentId of contentIds) {
    await database.insert(schema.seenItems).values({ userId, contentId }).onConflictDoNothing();
  }
}

export async function listFeedDates(userId: string): Promise<string[]> {
  const database = await db();
  const rows = await database
    .selectDistinct({ date: schema.feedItems.date })
    .from(schema.feedItems)
    .where(eq(schema.feedItems.userId, userId))
    .orderBy(desc(schema.feedItems.date));
  return rows.map((row) => row.date);
}
