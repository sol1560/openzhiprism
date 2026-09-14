import {
  ZhihuProviderError,
  type FolloweeProfile,
  type FollowedQuestion,
  type FollowedTopic,
  type HotItem,
  type SearchOptions,
  type ZhihuItem,
  type ZhihuSearchProvider,
} from "@/lib/zhihu/types";

/**
 * 公开版本占位：JustOne（api.justoneapi.com）知乎适配器未随开源仓库发布。
 * 内容源请使用 ZHIHU_SOURCE=fixture（离线知乎快照，默认可用）或 official（知乎开放平台）。
 * 导出脚本 scripts/export-public.mjs 用本文件覆盖私有实现；导出符号与私有版本一一对应，
 * provider.ts 的 auto 策略链先查 isJustoneConfigured()，这里恒为 false，运行时自动跳过。
 */

const NOT_BUNDLED = "JustOne 适配器未随公开版本发布，请使用 ZHIHU_SOURCE=fixture 或 official";

/** 接收并忽略调用参数，让占位函数保持与私有版本相同的签名 */
function unavailable(endpoint: string, ...context: unknown[]): never {
  void context;
  throw new ZhihuProviderError("justone", endpoint, NOT_BUNDLED);
}

export function isJustoneConfigured(): boolean {
  return false;
}

export async function justoneSearch(query: string, options: SearchOptions = {}): Promise<ZhihuItem[]> {
  return unavailable("search", query, options);
}

export async function justoneHotList(limit = 20): Promise<HotItem[]> {
  return unavailable("hot-list", limit);
}

export async function justoneUserInfo(
  urlToken: string,
): Promise<{ name: string; urlToken: string; headline?: string; avatarUrl?: string } | null> {
  return unavailable("get-user-info", urlToken);
}

export async function justoneUserFollowees(urlToken: string): Promise<FolloweeProfile[]> {
  return unavailable("get-user-followees", urlToken);
}

export async function justoneUserFollowTopics(urlToken: string): Promise<FollowedTopic[]> {
  return unavailable("get-user-follow-topics", urlToken);
}

export async function justoneUserFollowQuestions(urlToken: string): Promise<FollowedQuestion[]> {
  return unavailable("get-user-follow-questions", urlToken);
}

export const justoneProvider: ZhihuSearchProvider = {
  name: "justone",
  search: justoneSearch,
  hotList: justoneHotList,
};
