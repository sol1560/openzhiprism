import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeQuery, similarity } from "./text";
import type { HotItem, SearchOptions, ZhihuItem, ZhihuSearchProvider } from "./types";

/**
 * 离线快照 provider：读取 fixtures/zhihu/search/*.json 与 fixtures/zhihu/hot.json。
 * 检索词没有精确命中时，按字符 2-gram 重叠度选最相近的快照，保证 demo 无网络也能跑。
 */

export const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures", "zhihu");

interface SearchFixture {
  query: string;
  items: ZhihuItem[];
}

let cache: { loadedAt: number; searches: SearchFixture[]; hot: HotItem[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadFixtures() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const searches: SearchFixture[] = [];
  let hot: HotItem[] = [];
  try {
    const dir = path.join(FIXTURE_ROOT, "search");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as Partial<SearchFixture>;
        if (raw.query && Array.isArray(raw.items)) {
          searches.push({
            query: raw.query,
            items: raw.items.map((item) => ({ ...item, provider: "fixture" as const })),
          });
        }
      } catch {
        // 单个损坏文件不影响其他快照
      }
    }
  } catch {
    // 目录不存在时返回空
  }
  try {
    const raw = JSON.parse(await readFile(path.join(FIXTURE_ROOT, "hot.json"), "utf8")) as HotItem[];
    hot = raw.map((item) => ({ ...item, provider: "fixture" as const }));
  } catch {
    hot = [];
  }
  cache = { loadedAt: Date.now(), searches, hot };
  return cache;
}

export function invalidateFixtureCache() {
  cache = null;
}

export async function fixtureSearch(query: string, options: SearchOptions = {}): Promise<ZhihuItem[]> {
  const { searches } = await loadFixtures();
  if (searches.length === 0) return [];
  const key = normalizeQuery(query);
  const exact = searches.find((fixture) => normalizeQuery(fixture.query) === key);
  const count = options.count ?? 10;
  if (exact) return exact.items.slice(0, count).map((item) => ({ ...item, query }));

  // 按 query 相似度 + 条目标题相似度打分，聚合所有快照的条目
  const scored = new Map<string, { item: ZhihuItem; score: number }>();
  for (const fixture of searches) {
    const queryScore = similarity(query, fixture.query);
    for (const item of fixture.items) {
      const score = queryScore * 0.6 + similarity(query, `${item.title} ${item.excerpt}`) * 0.4;
      const existing = scored.get(item.id);
      if (!existing || existing.score < score) scored.set(item.id, { item, score });
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ item }) => ({ ...item, query }));
}

export async function fixtureHotList(limit = 30): Promise<HotItem[]> {
  const { hot } = await loadFixtures();
  return hot.slice(0, limit);
}

export async function listFixtureQueries(): Promise<string[]> {
  const { searches } = await loadFixtures();
  return searches.map((fixture) => fixture.query);
}

export const fixtureProvider: ZhihuSearchProvider = {
  name: "fixture",
  search: fixtureSearch,
  hotList: fixtureHotList,
};

export async function findFixtureContent(contentId: string): Promise<ZhihuItem | undefined> {
  const { searches } = await loadFixtures();
  return searches.flatMap((entry) => entry.items).find((item) => item.id === contentId && item.content);
}
