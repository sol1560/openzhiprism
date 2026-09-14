"use client";

import { useRouter } from "next/navigation";
import { Button, Chip } from "@heroui/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { TopicList } from "@/components/topic-list";
import type { InterestTopic } from "@/db/schema";
import type { FeedBuildView } from "@/lib/feed/types";

export interface ResultStats {
  conversationCount: number;
  messageCount: number;
  redactedCount: number;
}

export function ResultStep({
  topics,
  newTopicNames,
  stats,
  redactions,
  redactedCategoriesFromLlm,
  llm,
  feedBuild,
}: {
  topics: InterestTopic[];
  newTopicNames: string[];
  stats: ResultStats;
  redactions?: Array<{ category: string; count: number; label: string }>;
  redactedCategoriesFromLlm?: string[];
  llm?: { provider: string; model: string; live: boolean; error?: string };
  /** ingest 成功时后端已经发起的 feed 构建；为空说明是刷新后从数据库恢复的第 2 步 */
  feedBuild: FeedBuildView | null;
}) {
  const router = useRouter();
  const building = feedBuild?.status === "queued" || feedBuild?.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">这是从对话里读出的你</h2>
        <p className="mt-1 text-muted">
          分析了 {stats.conversationCount} 段对话、{stats.messageCount} 条消息，提取出 {topics.length} 个兴趣话题
          {newTopicNames.length > 0 && newTopicNames.length < topics.length ? `（新增 ${newTopicNames.length} 个）` : ""}。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-secondary/50 p-4 text-sm">
        <ShieldCheck className="size-4 text-success" />
        {stats.redactedCount > 0 ? (
          <>
            <span>进入模型前已隐去 {stats.redactedCount} 处个人信息{redactions ? "：" : "。"}</span>
            {redactions?.map((item) => (
              <Chip key={item.category} size="sm" color="warning" variant="soft">
                {item.label} ×{item.count}
              </Chip>
            ))}
          </>
        ) : (
          <span>规则层未发现需要脱敏的个人信息。</span>
        )}
        {redactedCategoriesFromLlm && redactedCategoriesFromLlm.length > 0 ? (
          <span className="text-muted">模型侧另跳过：{redactedCategoriesFromLlm.join("、")}</span>
        ) : null}
        {llm ? (
          <span className="ml-auto text-xs text-muted">
            {llm.live ? `模型：${llm.model}` : "模型不可用，已用规则提取"}
          </span>
        ) : null}
      </div>

      <TopicList topics={topics} highlight={newTopicNames} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onPress={() => router.push("/feed")}>
            去看今日 Feed
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="ghost" size="lg" onPress={() => router.push("/profile")}>
            先看看完整画像
          </Button>
        </div>
        <p className="text-xs text-muted">
          {building
            ? "今日 Feed 已在后台开始生成，通常需要 20–40 秒；现在过去就能看到实时进度。"
            : "进入 Feed 后会按最新画像检索知乎内容并生成摘要，通常需要 20–40 秒。"}
        </p>
      </div>
    </div>
  );
}
