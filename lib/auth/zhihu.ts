import { env } from "@/lib/env";
import { getPersona } from "@/lib/personas";
import { applyExtraction, extractFromFollowGraph, loadFollowGraph, upsertUser, type ColdStartOutcome } from "@/lib/profile";
import { newUserId } from "@/lib/session";
import type { User } from "@/db/schema";

/**
 * 登录 / 冷启动。
 *  - demo：选择一个 persona，创建干净用户
 *  - self：以 Access Secret 持有者的知乎账号登录（官方 user/followees，无需 OAuth）
 *  - token：输入任意知乎 url_token（JustOne 接口 / 快照）
 *  - oauth：官方 OAuth（需要 ZHIHU_OAUTH_APP_KEY，未配置时前端不展示）
 */

export type LoginMode = "demo" | "self" | "token";

export interface LoginResult {
  user: User;
  coldStart: ColdStartOutcome | null;
  topicsCreated: number;
}

export async function loginDemo(personaId: string): Promise<LoginResult> {
  if (env.publicMode) throw new Error("模拟登录仅限本地开发环境");
  const persona = await getPersona(personaId);
  if (!persona) throw new Error(`未找到 persona：${personaId}`);
  const user = await upsertUser({
    id: newUserId("demo"),
    displayName: persona.name,
    headline: persona.tagline,
    avatarUrl: null,
    loginSource: "demo",
  });
  return { user, coldStart: null, topicsCreated: 0 };
}

async function coldStartFor(userId: string, kind: "self" | "token", urlToken?: string): Promise<ColdStartOutcome & { topicsCreated: number }> {
  const graph = await loadFollowGraph(kind, urlToken);
  const outcome = await extractFromFollowGraph(graph);
  const topics = await applyExtraction(userId, outcome.interests, "zhihu_follow");
  return { ...outcome, topicsCreated: topics.length };
}

export async function loginSelf(): Promise<LoginResult> {
  if (env.publicMode) throw new Error("模拟登录仅限本地开发环境");
  const userId = newUserId("zh");
  const user = await upsertUser({
    id: userId,
    displayName: "我的知乎账号",
    headline: "通过知乎开放平台 Access Secret 登录",
    loginSource: "zhihu_self",
  });
  const outcome = await coldStartFor(userId, "self");
  return { user, coldStart: outcome, topicsCreated: outcome.topicsCreated };
}

export async function loginWithToken(urlToken: string): Promise<LoginResult> {
  if (env.publicMode) throw new Error("模拟登录仅限本地开发环境");
  const token = urlToken.trim().replace(/^@/, "").replace(/^https?:\/\/www\.zhihu\.com\/people\//, "");
  if (!token) throw new Error("请输入知乎 url_token");
  const userId = newUserId("zh");
  const graph = await loadFollowGraph("token", token);
  const outcome = await extractFromFollowGraph(graph);
  const user = await upsertUser({
    id: userId,
    displayName: graph.self?.name ?? `@${token}`,
    headline: graph.self?.headline ?? null,
    avatarUrl: graph.self?.avatarUrl ?? null,
    zhihuUrlToken: token,
    loginSource: "zhihu_token",
  });
  const topics = await applyExtraction(userId, outcome.interests, "zhihu_follow");
  return { user, coldStart: outcome, topicsCreated: topics.length };
}

export { buildOAuthAuthorizeUrl, exchangeOAuthCode } from "./oauth";
export { isOAuthConfigured } from "./readiness";
