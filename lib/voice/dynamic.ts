import type { DailyBrief, FeedBuildView, FeedView } from "@/lib/feed/types";
import type { DynamicVariables } from "./agent-config";

/** 首句与 system prompt 里的动态变量；纯函数，服务端在换取 signed URL 时计算 */

export function dateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return Number.isFinite(m) && Number.isFinite(d) ? `${m}月${d}日` : "今天";
}

const chars = (value: string) => [...value].length;
const clip = (value: string, max: number) => (chars(value) <= max ? value : `${[...value].slice(0, max - 1).join("")}…`);

export interface DynamicInput {
  user: { displayName: string };
  date: string;
  feed: FeedView;
  topicCount: number;
  build: FeedBuildView | null;
  brief: DailyBrief | null;
}

export function fallbackSpokenScript(feed: FeedView): string {
  const titles = feed.cards.filter((card) => card.content).slice(0, 3).map((card) => `《${clip(card.content!.title, 24)}》`);
  const perspective = feed.cards.some((card) => card.kind === "perspective");
  return `今天为你准备了 ${feed.cards.length} 条内容${titles.length ? `，前几条是：${titles.join("、")}` : ""}。${perspective ? "其中有一张「换个角度看」。" : ""}`;
}

export function buildDynamicVariables(input: DynamicInput): DynamicVariables {
  const cardCount = input.feed.cards.length;
  const hasPerspective = input.feed.cards.some((card) => card.kind === "perspective");
  const building = input.build?.status === "queued" || input.build?.status === "running";
  let spoken: string;
  let next: string;
  if (input.brief && cardCount > 0) {
    spoken = input.brief.spokenScript;
    next = "要我从第一条开始展开吗？";
  } else if (cardCount > 0) {
    spoken = fallbackSpokenScript(input.feed);
    next = "想从哪一条开始？";
  } else if (building) {
    spoken = "今天的 Feed 正在生成，还差一点。";
    next = "生成好了我会告诉你，你也可以先问我你的兴趣画像。";
  } else if (input.topicCount > 0) {
    spoken = "今天的 Feed 还没有生成。";
    next = "要我现在生成吗？大约需要二三十秒。";
  } else {
    spoken = "你还没有兴趣画像，所以今天没有内容可以播报。";
    next = "先去「连接 AI 或导入对话」页面建立画像，我再来带你读。";
  }
  const spokenText = /[。！？]$/.test(spoken) ? spoken : `${spoken}。`;
  return {
    user_name: clip(input.user.displayName.trim() || "读者", 20),
    date_label: dateLabel(input.date),
    spoken_script: spokenText,
    next_prompt: next,
    card_count: cardCount,
    has_perspective: hasPerspective,
  };
}
