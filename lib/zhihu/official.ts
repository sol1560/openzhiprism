import { prepareSource } from "@/lib/ai-detection/text";
import { env, ZHIHU_OFFICIAL_BASE_URL } from "@/lib/env";
import { stripHtml, truncate } from "./text";
import {
  ZhihuProviderError,
  type FolloweeProfile,
  type HotItem,
  type SearchOptions,
  type ZhihuItem,
  type ZhihuSearchProvider,
} from "./types";

/**
 * 知乎开放平台（developer.zhihu.com）。
 * 鉴权：Authorization: Bearer <secret> + X-Request-Timestamp(秒)。
 * 响应信封：{ Code, Message, Data }，Code === 0 成功。
 */

interface Envelope<T> {
  Code: number;
  Message: string;
  Data: T;
}

export interface QuotaEntry {
  APIID: string;
  APIName: string;
  TotalQuota: number;
  TotalUsed: number;
  RemainingQuota: number;
}

interface OfficialSearchItem {
  Title: string;
  ContentType: string;
  ContentID: string;
  ContentText?: string;
  Url: string;
  CommentCount?: number;
  VoteUpCount?: number;
  AuthorName?: string;
  AuthorAvatar?: string;
  EditTime?: number;
  AuthorityLevel?: string;
  RankingScore?: number;
}

interface OfficialHotItem {
  Title: string;
  Url: string;
  ThumbnailUrl?: string;
  Summary?: string;
}

interface OfficialFollowee {
  Fullname: string;
  UrlToken: string;
  Url: string;
  AvatarUrl?: string;
  Headline?: string;
  FollowerCount?: number;
}

export function isOfficialConfigured(): boolean {
  return Boolean(env.zhihuAccessSecret);
}

async function officialRequest<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const secret = env.zhihuAccessSecret;
  if (!secret) {
    throw new ZhihuProviderError("official", path, "ZHIHU_ACCESS_SECRET 未配置");
  }
  const url = new URL(path, ZHIHU_OFFICIAL_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new ZhihuProviderError("official", path, `HTTP ${response.status}`, response.status);
  }
  const json = (await response.json()) as Envelope<T> | T;
  if (json && typeof json === "object" && "Code" in json) {
    const envelope = json as Envelope<T>;
    if (envelope.Code !== 0) {
      throw new ZhihuProviderError("official", path, envelope.Message, envelope.Code);
    }
    return envelope.Data;
  }
  return json as T;
}

// ── 额度 ────────────────────────────────────────────────

let quotaCache: { at: number; entries: QuotaEntry[] } | null = null;
let quotaInFlight: Promise<QuotaEntry[]> | null = null;
const QUOTA_TTL_MS = 30_000;

/** /api/v1/quota 不消耗业务额度，可以放心轮询；并发调用共享同一个请求 */
export async function getQuota(force = false): Promise<QuotaEntry[]> {
  if (!force && quotaCache && Date.now() - quotaCache.at < QUOTA_TTL_MS) {
    return quotaCache.entries;
  }
  if (!quotaInFlight) {
    quotaInFlight = officialRequest<QuotaEntry[]>("/api/v1/quota")
      .then((entries) => {
        quotaCache = { at: Date.now(), entries };
        return entries;
      })
      .finally(() => {
        quotaInFlight = null;
      });
  }
  return quotaInFlight;
}

export async function remainingQuota(apiId: string): Promise<number | null> {
  try {
    const entries = await getQuota();
    return entries.find((entry) => entry.APIID === apiId)?.RemainingQuota ?? null;
  } catch {
    return null;
  }
}

/** 调用后手动扣减本地缓存，避免 30s 内重复读到旧值 */
function consumeCachedQuota(apiId: string) {
  const entry = quotaCache?.entries.find((item) => item.APIID === apiId);
  if (entry) {
    entry.RemainingQuota = Math.max(0, entry.RemainingQuota - 1);
    entry.TotalUsed += 1;
  }
}

// ── 归一化 ──────────────────────────────────────────────

function mapContentType(raw: string): ZhihuItem["type"] {
  const lower = raw.toLowerCase();
  if (lower.includes("article")) return "article";
  if (lower.includes("answer")) return "answer";
  if (lower.includes("question")) return "question";
  return "answer";
}

function normalizeSearchItem(item: OfficialSearchItem, query: string): ZhihuItem {
  const type = mapContentType(item.ContentType ?? "");
  const text = stripHtml(item.ContentText);
  return {
    id: `${type}:${item.ContentID}`,
    type,
    title: stripHtml(item.Title).replace(/\s*-\s*知乎$/, ""),
    excerpt: truncate(text, 160),
    content: prepareSource(text).text,
    contentTruncated: prepareSource(text).truncated,
    sourceFetchedAt: Date.now(),
    url: item.Url,
    author: item.AuthorName
      ? { name: item.AuthorName, avatarUrl: item.AuthorAvatar || undefined }
      : undefined,
    voteUp: item.VoteUpCount ?? 0,
    commentCount: item.CommentCount ?? 0,
    publishedAt: item.EditTime,
    provider: "official",
    query,
  };
}

// ── 业务接口 ────────────────────────────────────────────

export async function officialSearch(query: string, options: SearchOptions = {}): Promise<ZhihuItem[]> {
  const data = await officialRequest<{ Items?: OfficialSearchItem[] }>(
    "/api/v1/content/zhihu_search",
    { Query: query, Count: Math.min(options.count ?? 10, 10) },
    { signal: options.signal },
  );
  consumeCachedQuota("zhihu_search");
  return (data.Items ?? []).map((item) => normalizeSearchItem(item, query));
}

export async function officialGlobalSearch(query: string, options: SearchOptions = {}): Promise<ZhihuItem[]> {
  const data = await officialRequest<{ Items?: OfficialSearchItem[] }>(
    "/api/v1/content/global_search",
    { Query: query, Count: Math.min(options.count ?? 10, 20) },
    { signal: options.signal },
  );
  consumeCachedQuota("global_search");
  return (data.Items ?? []).map((item) => ({ ...normalizeSearchItem(item, query), type: "web" as const }));
}

export async function officialHotList(limit = 30): Promise<HotItem[]> {
  const data = await officialRequest<{ Items?: OfficialHotItem[] }>("/api/v1/content/hot_list", {
    Limit: Math.min(limit, 30),
  });
  consumeCachedQuota("hot_list");
  return (data.Items ?? []).map((item, index) => ({
    id: `hot:${item.Url.split("/").pop() ?? index}`,
    title: item.Title,
    url: item.Url,
    excerpt: truncate(stripHtml(item.Summary), 200),
    thumbnailUrl: item.ThumbnailUrl || undefined,
    provider: "official" as const,
  }));
}

/** 当前 Access Secret 持有者的关注列表（无需 OAuth） */
export async function officialFollowees(limit = 50): Promise<FolloweeProfile[]> {
  const data = await officialRequest<{ Items?: OfficialFollowee[] }>("/api/v1/user/followees", {
    Limit: limit,
  });
  return (data.Items ?? []).map((item) => ({
    name: item.Fullname,
    urlToken: item.UrlToken,
    headline: item.Headline ?? "",
    avatarUrl: item.AvatarUrl,
    followerCount: item.FollowerCount ?? 0,
  }));
}

// ── 直答（OpenAI 兼容） ─────────────────────────────────

export type ZhidaModel = "zhida-fast-1p5" | "zhida-thinking-1p5" | "zhida-agent";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function zhidaChat(messages: ChatMessage[], model: ZhidaModel = "zhida-fast-1p5"): Promise<string> {
  const data = await officialRequest<{
    choices?: Array<{ message?: { content?: string } }>;
  }>("/v1/chat/completions", {}, { method: "POST", body: { model, messages, stream: false } });
  consumeCachedQuota("zhida_openai");
  return data.choices?.[0]?.message?.content ?? "";
}

export const officialProvider: ZhihuSearchProvider = {
  name: "official",
  search: officialSearch,
  hotList: officialHotList,
};
