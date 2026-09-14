export type ContentProvider = "official" | "justone" | "fixture";

export type ZhihuContentType = "answer" | "article" | "question" | "hot" | "web";

export interface ZhihuAuthor {
  name: string;
  avatarUrl?: string;
  headline?: string;
  urlToken?: string;
  followerCount?: number;
}

/** 统一后的知乎内容模型，所有 provider 都归一化到这里 */
export interface ZhihuItem {
  /** 全局唯一：`${type}:${id}` */
  id: string;
  type: ZhihuContentType;
  title: string;
  /** 短摘录（纯文本） */
  excerpt: string;
  /** 较长正文（纯文本，截断到 ~4000 字），供 LLM 摘要与立场分类使用 */
  content?: string;
  contentTruncated?: boolean;
  sourceFetchedAt?: number;
  /** 用户可直接打开的知乎站内链接 */
  url: string;
  author?: ZhihuAuthor;
  voteUp: number;
  commentCount: number;
  thumbnailUrl?: string;
  publishedAt?: number;
  provider: ContentProvider;
  query?: string;
}

export interface HotItem {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  thumbnailUrl?: string;
  provider: ContentProvider;
}

export interface FolloweeProfile {
  name: string;
  urlToken: string;
  headline: string;
  avatarUrl?: string;
  followerCount: number;
}

export interface FollowedTopic {
  id: string;
  name: string;
  excerpt?: string;
  followersCount?: number;
}

export interface FollowedQuestion {
  id: string;
  title: string;
  url: string;
}

/** 冷启动用的知乎关注画像 */
export interface ZhihuFollowGraph {
  self?: { name: string; urlToken: string; headline?: string; avatarUrl?: string };
  followees: FolloweeProfile[];
  topics: FollowedTopic[];
  questions: FollowedQuestion[];
  provider: ContentProvider;
}

export interface SearchOptions {
  count?: number;
  signal?: AbortSignal;
}

export interface ZhihuSearchProvider {
  readonly name: ContentProvider;
  search(query: string, options?: SearchOptions): Promise<ZhihuItem[]>;
  hotList(limit?: number): Promise<HotItem[]>;
}

export class ZhihuProviderError extends Error {
  constructor(
    public readonly provider: ContentProvider,
    public readonly endpoint: string,
    message: string,
    public readonly code?: number | string,
  ) {
    super(`[${provider}] ${endpoint}: ${message}`);
    this.name = "ZhihuProviderError";
  }
}
