import { Chip } from "@/components/ui-primitives";
import { cn } from "tailwind-variants";
import { MessageSquareText, Scale, UserRoundCheck } from "lucide-react";
import type { InterestTopic } from "@/db/schema";

function stanceChip(topic: InterestTopic) {
  if (!topic.stance || topic.stance === "neutral") return null;
  return (
    <Chip size="sm" color="warning" variant="soft" className="gap-1">
      <Scale className="size-3" />
      {topic.stanceLabel ?? "有明显倾向"}
    </Chip>
  );
}

function sourceIcon(source: string) {
  if (source === "zhihu_follow") return <UserRoundCheck className="size-3.5" aria-label="来自知乎关注" />;
  return <MessageSquareText className="size-3.5" aria-label="来自对话" />;
}

export function TopicList({ topics, highlight = [], compact = false }: { topics: InterestTopic[]; highlight?: string[]; compact?: boolean }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted">还没有兴趣画像。</p>;
  }
  const highlighted = new Set(highlight);
  return (
    <ul className="flex flex-col gap-2">
      {topics.map((topic) => (
        <li key={topic.id} className={cn("topic-item", highlighted.has(topic.name) ? "bg-accent-soft/30" : "bg-surface")}>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted">{sourceIcon(topic.source)}</span>
            <span className="min-w-0 truncate font-medium">{topic.name}</span>
            {topic.controversial ? (
              compact ? (
                <Scale className="size-3.5 shrink-0 text-accent" aria-label="争议话题" />
              ) : (
                <Chip size="sm" variant="soft" color="accent" className="shrink-0">
                  争议话题
                </Chip>
              )
            ) : null}
            {!compact ? stanceChip(topic) : null}
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{Math.round(topic.weight * 100)}</span>
          </div>
          {compact && topic.stance && topic.stance !== "neutral" && topic.stanceLabel ? (
            <p className="mt-1 truncate text-xs text-warning">{topic.stanceLabel}</p>
          ) : null}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(4, topic.weight * 100)}%` }} />
          </div>
          {!compact ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {topic.keywords.slice(0, 6).map((keyword) => (
                <Chip key={keyword} size="sm" variant="tertiary">
                  {keyword}
                </Chip>
              ))}
            </div>
          ) : null}
          {!compact && topic.evidence[0] ? <p className="mt-2 text-xs text-muted">“{topic.evidence[0]}”</p> : null}
        </li>
      ))}
    </ul>
  );
}
