import { sourceValues } from "@/lib/ai-detection/source";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { fixtureProvider } from "./fixture";
import { isJustoneConfigured, justoneProvider } from "./justone";
import { isOfficialConfigured, officialProvider, remainingQuota } from "./official";
import { normalizeQuery, todayKey } from "./text";
import type { ContentProvider, HotItem, ZhihuItem, ZhihuSearchProvider } from "./types";

/**
 * 内容源编排：official（配额守卫）→ justone → fixture。
 * 所有搜索结果写入 content_cache（跨用户共享），24h 内同一检索词直接命中缓存。
 */

const SEARCH_CACHE_TTL_S = 24 * 60 * 60;
const HOT_CACHE_TTL_S = 6 * 60 * 60;
/** 官方搜索保留额度，留给「换个角度看」等关键调用 */
const OFFICIAL_SEARCH_RESERVE = 2;
const HOT_QUERY_KEY = "__hot_list__";

export interface SourceStatus {
  strategy: string;
  official: { configured: boolean; searchRemaining: number | null; hotRemaining: number | null; zhidaRemaining: number | null };
  justone: { configured: boolean };
  fixture: { available: boolean };
  /** auto 策略下当前会选中的搜索源 */
  active: ContentProvider;
}

export interface SearchResult {
  items: ZhihuItem[];
  provider: ContentProvider;
  fromCache: boolean;
  errors: string[];
}

async function bumpUsage(provider: ContentProvider, endpoint: string) {
  const database = await db();
  await database
    .insert(schema.apiUsage)
    .values({ provider, endpoint, date: todayKey(), count: 1 })
    .onConflictDoUpdate({
      target: [schema.apiUsage.provider, schema.apiUsage.endpoint, schema.apiUsage.date],
      set: { count: sql`${schema.apiUsage.count} + 1` },
    });
}

async function orderedProviders(kind: "search" | "hot"): Promise<ZhihuSearchProvider[]> {
  const strategy = env.sourceStrategy;
  switch (strategy) {
    case "official":
      return [officialProvider, fixtureProvider];
    case "justone":
      return [justoneProvider, fixtureProvider];
    case "fixture":
      return [fixtureProvider];
    case "auto": {
      const chain: ZhihuSearchProvider[] = [];
      if (isOfficialConfigured()) {
        const apiId = kind === "search" ? "zhihu_search" : "hot_list";
        const remaining = await remainingQuota(apiId);
        const reserve = kind === "search" ? OFFICIAL_SEARCH_RESERVE : 0;
        if (remaining !== null && remaining > reserve) chain.push(officialProvider);
      }
      if (kind === "hot") {
        // JustOne 没有真正的热榜端点，真实热榜快照优先于它的搜索替代方案
        chain.push(fixtureProvider);
        if (isJustoneConfigured()) chain.push(justoneProvider);
        return chain;
      }
      if (isJustoneConfigured()) chain.push(justoneProvider);
      chain.push(fixtureProvider);
      return chain;
    }
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

export async function getSourceStatus(): Promise<SourceStatus> {
  const official = isOfficialConfigured();
  const [searchRemaining, hotRemaining, zhidaRemaining] = official
    ? await Promise.all([remainingQuota("zhihu_search"), remainingQuota("hot_list"), remainingQuota("zhida_openai")])
    : [null, null, null];
  const chain = await orderedProviders("search");
  return {
    strategy: env.sourceStrategy,
    official: { configured: official, searchRemaining, hotRemaining, zhidaRemaining },
    justone: { configured: isJustoneConfigured() },
    fixture: { available: true },
    active: chain[0]?.name ?? "fixture",
  };
}

function rowToItem(row: typeof schema.contentCache.$inferSelect): ZhihuItem {
  return {
    id: row.contentId,
    type: row.type as ZhihuItem["type"],
    title: row.title,
    excerpt: row.excerpt,
    content: row.sourceText ?? undefined,
    contentTruncated: row.sourceTruncated ?? undefined,
    sourceFetchedAt: row.sourceFetchedAt?.getTime(),
    url: row.url,
    author: row.authorName ? { name: row.authorName, avatarUrl: row.authorAvatar ?? undefined } : undefined,
    voteUp: row.voteUp,
    commentCount: row.commentCount,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    provider: row.provider as ContentProvider,
    query: row.query ?? undefined,
  };
}

export async function cacheItems(items: ZhihuItem[], query: string) {
  if (items.length === 0) return;
  const database = await db();
  const key = normalizeQuery(query);
  for (const item of items) {
    const source = sourceValues(item);
    await database
      .insert(schema.contentCache)
      .values({
        contentId: item.id,
        ...source,
        provider: item.provider,
        type: item.type,
        title: item.title,
        excerpt: item.excerpt,
        url: item.url,
        authorName: item.author?.name,
        authorAvatar: item.author?.avatarUrl,
        voteUp: item.voteUp,
        commentCount: item.commentCount,
        thumbnailUrl: item.thumbnailUrl,
        query: key,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.contentCache.contentId,
        set: {
          ...source,
          provider: item.provider,
          title: item.title,
          excerpt: item.excerpt,
          url: item.url,
          voteUp: item.voteUp,
          commentCount: item.commentCount,
          query: key,
          fetchedAt: new Date(),
        },
      });
  }
}

async function readSearchCache(query: string, ttlSeconds: number): Promise<ZhihuItem[]> {
  const database = await db();
  const since = new Date(Date.now() - ttlSeconds * 1000);
  const rows = await database
    .select()
    .from(schema.contentCache)
    .where(and(eq(schema.contentCache.query, normalizeQuery(query)), gt(schema.contentCache.fetchedAt, since)))
    .orderBy(sql`${schema.contentCache.voteUp} desc`);
  return rows.map(rowToItem);
}

/** 同一请求的摘要/立场分析可复用内存；检测一律读取持久化正文。 */
const contentMemory = new Map<string, string>();

export function rememberContent(items: ZhihuItem[]) {
  for (const item of items) if (item.content) contentMemory.set(item.id, item.content);
}

export function recallContent(contentId: string): string | undefined {
  return contentMemory.get(contentId);
}

export async function searchZhihu(
  query: string,
  options: { count?: number; bypassCache?: boolean } = {},
): Promise<SearchResult> {
  const count = options.count ?? 10;
  if (!options.bypassCache) {
    const cached = await readSearchCache(query, SEARCH_CACHE_TTL_S);
    if (cached.length > 0) {
      return { items: cached.slice(0, count), provider: cached[0].provider, fromCache: true, errors: [] };
    }
  }
  const errors: string[] = [];
  for (const provider of await orderedProviders("search")) {
    try {
      const items = await provider.search(query, { count });
      if (provider.name !== "fixture") await bumpUsage(provider.name, "search");
      if (items.length === 0) {
        errors.push(`${provider.name}: 无结果`);
        continue;
      }
      rememberContent(items);
      await cacheItems(items, query);
      return { items: items.slice(0, count), provider: provider.name, fromCache: false, errors };
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { items: [], provider: "fixture", fromCache: false, errors };
}

export async function getHotList(limit = 30): Promise<{ items: HotItem[]; provider: ContentProvider; fromCache: boolean }> {
  const cached = await readSearchCache(HOT_QUERY_KEY, HOT_CACHE_TTL_S);
  if (cached.length > 0) {
    return {
      items: cached.slice(0, limit).map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        excerpt: item.excerpt,
        thumbnailUrl: item.thumbnailUrl,
        provider: item.provider,
      })),
      provider: cached[0].provider,
      fromCache: true,
    };
  }
  for (const provider of await orderedProviders("hot")) {
    try {
      const items = await provider.hotList(limit);
      if (items.length === 0) continue;
      if (provider.name !== "fixture") await bumpUsage(provider.name, "hot_list");
      await cacheItems(
        items.map((item) => ({
          id: item.id,
          type: "hot" as const,
          title: item.title,
          excerpt: item.excerpt,
          url: item.url,
          voteUp: 0,
          commentCount: 0,
          thumbnailUrl: item.thumbnailUrl,
          provider: item.provider,
        })),
        HOT_QUERY_KEY,
      );
      return { items, provider: provider.name, fromCache: false };
    } catch {
      // 继续尝试下一个 provider
    }
  }
  return { items: [], provider: "fixture", fromCache: false };
}

export async function getUsageToday() {
  const database = await db();
  return database.select().from(schema.apiUsage).where(eq(schema.apiUsage.date, todayKey()));
}
