"use client";

import { Chip, Tooltip } from "@heroui/react";
import type { ContentProvider } from "@/lib/zhihu/types";

const LABELS: Record<ContentProvider | "cache" | "mixed", { label: string; hint: string; color: "accent" | "success" | "warning" | "default" }> = {
  official: { label: "知乎开放平台", hint: "实时调用 developer.zhihu.com 官方接口", color: "accent" },
  justone: { label: "JustOne", hint: "官方额度不足时的补充数据源（api.justoneapi.com）", color: "success" },
  fixture: { label: "离线快照", hint: "来自真实知乎数据的本地快照，无网络也能演示", color: "warning" },
  cache: { label: "缓存", hint: "命中本地内容缓存，未发起外部请求", color: "default" },
  mixed: { label: "混合来源", hint: "本次 feed 同时用到了多个数据源", color: "default" },
};

export function SourceBadge({ provider, size = "sm" }: { provider: string; size?: "sm" | "md" }) {
  const meta = LABELS[provider as keyof typeof LABELS] ?? { label: provider, hint: "", color: "default" as const };
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <Chip color={meta.color} variant="soft" size={size} className="cursor-help">
          {meta.label}
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content>{meta.hint}</Tooltip.Content>
    </Tooltip>
  );
}
