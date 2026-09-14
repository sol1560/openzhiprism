import type { InterestTopic } from "@/db/schema";
import type { ZhihuItem } from "@/lib/zhihu/types";
import { shiftDateKey } from "./history";
import type { TopicEngagement } from "./types";

/**
 * Feed 选题与混排的纯函数部分，便于单测。
 */

export interface SlotAllocation<T extends { weight: number }> {
  topic: T;
  count: number;
}

/**
 * 按权重把 mainCount 个名额分给话题：先保证前 maxTopics 个话题各 1 条，
 * 剩余名额按权重比例分配（最大余数法）。
 */
export function allocateSlots<T extends { weight: number }>(
  topics: T[],
  mainCount: number,
  maxTopics = 6,
): SlotAllocation<T>[] {
  const chosen = [...topics].sort((a, b) => b.weight - a.weight).slice(0, Math.min(maxTopics, mainCount));
  if (chosen.length === 0) return [];
  const base = chosen.map((topic) => ({ topic, count: 1 }));
  let remaining = mainCount - chosen.length;
  if (remaining <= 0) return base;

  const totalWeight = chosen.reduce((sum, topic) => sum + Math.max(topic.weight, 0.05), 0);
  const shares = chosen.map((topic) => (Math.max(topic.weight, 0.05) / totalWeight) * remaining);
  shares.forEach((share, index) => {
    const whole = Math.floor(share);
    base[index].count += whole;
    remaining -= whole;
  });
  // 最大余数法分配零头
  const order = shares
    .map((share, index) => ({ index, frac: share - Math.floor(share) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remaining; i += 1) base[order[i % order.length].index].count += 1;
  return base;
}

/** 内容排序：赞同数为主，兼顾类型多样性（避免全是文章） */
export function rankItems(items: ZhihuItem[], count: number): ZhihuItem[] {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const picked: ZhihuItem[] = [];
  const typeCount = new Map<string, number>();
  for (const item of sorted) {
    if (picked.length >= count) break;
    const seenType = typeCount.get(item.type) ?? 0;
    // 同类型超过 2/3 时优先找别的类型
    if (seenType >= Math.max(2, Math.ceil((count * 2) / 3)) && sorted.some((other) => !picked.includes(other) && other.type !== item.type)) {
      continue;
    }
    picked.push(item);
    typeCount.set(item.type, seenType + 1);
  }
  for (const item of sorted) {
    if (picked.length >= count) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

function score(item: ZhihuItem): number {
  const vote = Math.log10(item.voteUp + 1);
  const comments = Math.log10(item.commentCount + 1) * 0.3;
  const hasBody = item.content && item.content.length > 300 ? 0.3 : 0;
  return vote + comments + hasBody;
}

export interface MixableCard<T> {
  kind: "main" | "light" | "perspective";
  topicName: string | null;
  payload: T;
}

/**
 * 混排：主内容按话题轮转交错；每 lightEvery 条主内容后插一条轻松内容；
 * 视角卡紧跟其话题的第一条主内容。
 */
export function interleaveFeed<T>(
  mainByTopic: Array<{ topicName: string; cards: T[] }>,
  light: T[],
  perspectives: Array<{ topicName: string; card: T }>,
  lightEvery = 4,
): MixableCard<T>[] {
  const result: MixableCard<T>[] = [];
  const queues = mainByTopic.map((entry) => ({ topicName: entry.topicName, cards: [...entry.cards] }));
  const pendingPerspectives = new Map(perspectives.map((entry) => [entry.topicName, entry.card]));
  const lightQueue = [...light];
  let mainSinceLight = 0;

  while (queues.some((queue) => queue.cards.length > 0)) {
    for (const queue of queues) {
      const card = queue.cards.shift();
      if (!card) continue;
      result.push({ kind: "main", topicName: queue.topicName, payload: card });
      mainSinceLight += 1;
      const perspective = pendingPerspectives.get(queue.topicName);
      if (perspective) {
        result.push({ kind: "perspective", topicName: queue.topicName, payload: perspective });
        pendingPerspectives.delete(queue.topicName);
      }
      if (mainSinceLight >= lightEvery && lightQueue.length > 0) {
        result.push({ kind: "light", topicName: null, payload: lightQueue.shift()! });
        mainSinceLight = 0;
      }
    }
  }
  // 未找到宿主话题的视角卡与剩余轻松内容放在末尾
  for (const [topicName, card] of pendingPerspectives) result.push({ kind: "perspective", topicName, payload: card });
  for (const card of lightQueue) result.push({ kind: "light", topicName: null, payload: card });
  return result;
}

export function buildReason(topic: Pick<InterestTopic, "name" | "evidence" | "source">): string {
  const evidence = topic.evidence[0];
  if (topic.source === "zhihu_follow") return `因为你在知乎关注了「${topic.name}」相关的话题和创作者`;
  if (evidence) return `因为你最近在聊「${topic.name}」：${evidence}`;
  return `因为你最近在聊「${topic.name}」`;
}

// ── 阅读历史加权 ────────────────────────────────────────

export const HISTORY_BOOST = {
  min: 0.6,
  max: 1.4,
  /** 从未推送过的话题给一点探索空间 */
  explore: 1.1,
  /** 打开率在这条线附近视为中性 */
  baselineRate: 0.25,
  /** 推送满这么多条后才完全相信统计 */
  confidencePushes: 5,
} as const;

export type HistoryKind = "boosted" | "damped" | "explore" | "neutral";

/**
 * 由话题的推送 / 打开统计得到权重系数：点开得多加权（≤1.4），推了不点降权（≥0.6），样本少时向 1 收缩。
 */
export function historyFactor(engagement?: Pick<TopicEngagement, "pushed" | "opened">): { factor: number; kind: HistoryKind } {
  if (!engagement || engagement.pushed === 0) return { factor: HISTORY_BOOST.explore, kind: "explore" };
  const rate = engagement.opened / engagement.pushed;
  const confidence = Math.min(1, engagement.pushed / HISTORY_BOOST.confidencePushes);
  const delta = rate >= HISTORY_BOOST.baselineRate
    ? Math.min(0.4, (rate - HISTORY_BOOST.baselineRate) * 0.8)
    : -(HISTORY_BOOST.baselineRate - rate) * 1.6;
  const factor = Math.min(HISTORY_BOOST.max, Math.max(HISTORY_BOOST.min, 1 + confidence * delta));
  const kind: HistoryKind = factor > 1.001 ? "boosted" : factor < 0.999 ? "damped" : "neutral";
  return { factor, kind };
}

export type HistoryWeighted<T> = T & { baseWeight: number; historyFactor: number; historyKind: HistoryKind };

/** 把历史系数乘进权重；allocateSlots 按比例分配，无需重新归一化 */
export function applyHistoryBoost<T extends { name: string; weight: number }>(
  topics: T[],
  engagement: TopicEngagement[],
): Array<HistoryWeighted<T>> {
  const byName = new Map(engagement.map((entry) => [entry.topicName, entry]));
  return topics.map((topic) => {
    const { factor, kind } = historyFactor(byName.get(topic.name));
    return { ...topic, baseWeight: topic.weight, weight: topic.weight * factor, historyFactor: factor, historyKind: kind };
  });
}

/**
 * 连续性名额：names 里的话题若排在前 maxTopics 之外，把权重抬到第 maxTopics 名之上，保证 allocateSlots 至少给 1 条。
 */
export function pinTopics<T extends { name: string; weight: number }>(topics: T[], names: string[], maxTopics = 6): T[] {
  const result = topics.map((topic) => ({ ...topic }));
  for (const name of names) {
    const sorted = [...result].sort((a, b) => b.weight - a.weight);
    const top = sorted.slice(0, maxTopics);
    if (top.some((topic) => topic.name === name)) continue;
    const target = result.find((topic) => topic.name === name);
    if (!target || top.length === 0) continue;
    target.weight = top[top.length - 1].weight + 1e-6;
  }
  return result;
}

/** 历史相关的推荐理由；没有可说的返回 null，由调用方回落到 buildReason */
export function buildHistoryReason(
  topic: Pick<InterestTopic, "name" | "evidence">,
  engagement: TopicEngagement | undefined,
  date: string,
  windowDays: number,
): string | null {
  if (!engagement) return null;
  const yesterday = shiftDateKey(date, -1);
  const evidence = topic.evidence[0] ? `：${topic.evidence[0]}` : "";
  if (engagement.lastOpenedDate === yesterday) return `昨天你点开了「${topic.name}」的内容，今天接着看${evidence}`;
  if (engagement.opened >= 2) return `最近 ${windowDays} 天你打开了「${topic.name}」的 ${engagement.opened} 条，今天多放一点${evidence}`;
  if (engagement.pushed >= 5 && engagement.opened === 0) return `「${topic.name}」推了 ${engagement.pushed} 条你都没点，今天少放一点${evidence}`;
  return null;
}

// ── 用户要求（directives） ───────────────────────────────

/** 「多推 / 少推」的权重系数；mute 直接剔除 */
export const DIRECTIVE_FACTOR = { more: 1.6, less: 0.5 } as const;

export interface TopicDirectiveLike {
  kind: string;
  topic: string | null;
  direction: string | null;
}

/** 把用户的话题要求乘进权重（不改输入）；在 allocateSlots 之前调用，与 applyHistoryBoost 并列 */
export function applyDirectives<T extends { name: string; weight: number }>(topics: T[], directives: TopicDirectiveLike[]): T[] {
  const byTopic = new Map<string, string>();
  for (const directive of directives) {
    if (directive.kind === "topic" && directive.topic && directive.direction) byTopic.set(directive.topic, directive.direction);
  }
  if (byTopic.size === 0) return topics.map((topic) => ({ ...topic }));
  const result: T[] = [];
  for (const topic of topics) {
    const direction = byTopic.get(topic.name);
    if (direction === "mute") continue;
    if (direction === "more") result.push({ ...topic, weight: topic.weight * DIRECTIVE_FACTOR.more });
    else if (direction === "less") result.push({ ...topic, weight: topic.weight * DIRECTIVE_FACTOR.less });
    else result.push({ ...topic });
  }
  return result;
}
