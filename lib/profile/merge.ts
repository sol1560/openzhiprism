import type { InterestTopic } from "@/db/schema";
import type { ExtractedTopic } from "@/lib/llm/prompts";
import { normalizeQuery, similarity } from "@/lib/zhihu/text";
import { findLexiconEntry } from "@/lib/ingest/lexicon";

/**
 * 画像合并（纯函数）：跨 session 累积分数、时间衰减、归一化权重。
 * rawScore 增量 = mentions × depth；半衰期 14 天。
 */

export const HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TopicSource = "conversation" | "zhihu_follow" | "mixed";

export interface TopicDraft {
  id?: string;
  name: string;
  rawScore: number;
  weight: number;
  hits: number;
  keywords: string[];
  questions: string[];
  evidence: string[];
  searchQueries: string[];
  controversial: boolean;
  stance: string | null;
  stanceLabel: string | null;
  source: TopicSource;
  lastSeenAt: Date;
}

export function decayScore(rawScore: number, lastSeenAt: Date, now: Date, halfLifeDays = HALF_LIFE_DAYS): number {
  const elapsedDays = Math.max(0, (now.getTime() - lastSeenAt.getTime()) / DAY_MS);
  return rawScore * Math.pow(0.5, elapsedDays / halfLifeDays);
}

export function topicsMatch(a: string, b: string): boolean {
  const na = normalizeQuery(a);
  const nb = normalizeQuery(b);
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const lexA = findLexiconEntry(a);
  const lexB = findLexiconEntry(b);
  if (lexA && lexB && lexA.name === lexB.name) return true;
  return similarity(na, nb) >= 0.6;
}

function mergeSource(existing: TopicSource, incoming: TopicSource): TopicSource {
  return existing === incoming ? existing : "mixed";
}

function uniqueConcat(a: string[], b: string[], limit: number): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...b, ...a]) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function normalizeWeights<T extends { rawScore: number }>(topics: T[]): Array<T & { weight: number }> {
  const max = Math.max(0, ...topics.map((topic) => topic.rawScore));
  return topics.map((topic) => ({ ...topic, weight: max > 0 ? Number((topic.rawScore / max).toFixed(4)) : 0 }));
}

export function mergeTopics(
  existing: InterestTopic[],
  extracted: ExtractedTopic[],
  source: TopicSource,
  now = new Date(),
): TopicDraft[] {
  const drafts: TopicDraft[] = existing.map((topic) => ({
    id: topic.id,
    name: topic.name,
    rawScore: decayScore(topic.rawScore, topic.lastSeenAt, now),
    weight: topic.weight,
    hits: topic.hits,
    keywords: topic.keywords,
    questions: topic.questions,
    evidence: topic.evidence,
    searchQueries: topic.searchQueries,
    controversial: topic.controversial,
    stance: topic.stance,
    stanceLabel: topic.stanceLabel,
    source: topic.source as TopicSource,
    lastSeenAt: topic.lastSeenAt,
  }));

  for (const incoming of extracted) {
    const increment = incoming.mentions * incoming.depth;
    const target = drafts.find((draft) => topicsMatch(draft.name, incoming.name));
    const stance = incoming.stance === "unknown" ? null : incoming.stance;
    if (target) {
      target.rawScore += increment;
      target.hits += incoming.mentions;
      target.keywords = uniqueConcat(target.keywords, incoming.keywords, 8);
      target.questions = uniqueConcat(target.questions, incoming.questions, 5);
      target.evidence = uniqueConcat(target.evidence, incoming.evidence, 3);
      target.searchQueries = uniqueConcat(target.searchQueries, incoming.searchQueries, 4);
      target.controversial = target.controversial || incoming.controversial;
      if (stance) {
        target.stance = stance;
        target.stanceLabel = incoming.stanceLabel ?? target.stanceLabel;
      }
      target.source = mergeSource(target.source, source);
      target.lastSeenAt = now;
    } else {
      drafts.push({
        name: incoming.name,
        rawScore: increment,
        weight: 0,
        hits: incoming.mentions,
        keywords: incoming.keywords,
        questions: incoming.questions,
        evidence: incoming.evidence,
        searchQueries: incoming.searchQueries,
        controversial: incoming.controversial,
        stance,
        stanceLabel: incoming.stanceLabel ?? null,
        source,
        lastSeenAt: now,
      });
    }
  }

  return normalizeWeights(drafts).sort((a, b) => b.weight - a.weight);
}
