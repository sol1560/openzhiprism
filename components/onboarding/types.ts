import type { InterestTopic } from "@/db/schema";
import type { FeedBuildView } from "@/lib/feed/types";

export interface IngestResponse {
  conversationCount: number;
  messageCount: number;
  redactions: Array<{ category: string; count: number; label: string }>;
  redactedCategoriesFromLlm: string[];
  topics: InterestTopic[];
  newTopicNames: string[];
  llm: { provider: string; model: string; live: boolean; error?: string };
  /** 服务端在画像更新后立刻发起的今日 feed 构建状态 */
  feedBuild: FeedBuildView | null;
}

export interface PreviewResponse {
  conversationCount: number;
  messageCount: number;
  redactions: Array<{ category: string; count: number; label: string }>;
  preview: Array<{ title: string; messages: Array<{ role: string; content: string }> }>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `请求失败（${response.status}）`);
  return data;
}
