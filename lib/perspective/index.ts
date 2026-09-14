import { eq, gt, and } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InterestTopic } from "@/db/schema";
import { findLexiconEntry } from "@/lib/ingest/lexicon";
import { llmObject } from "@/lib/llm/client";
import { extractEvidence, synthesizeEvidence } from "@/lib/cognition/dossiers";
import { snapshotItem, validateAnalysis, validateEvidence } from "@/lib/cognition/evidence";
import type { SourceSnapshot } from "@/lib/cognition/types";
import {
  CONTROVERSY_SYSTEM,
  STANCE_SYSTEM,
  controversyPrompt,
  controversySchema,
  stancePrompt,
  stanceBatchSchema,
  type ControversyAnalysis,
} from "@/lib/llm/prompts";
import { recallContent, searchZhihu } from "@/lib/zhihu/provider";
import { normalizeQuery, truncate } from "@/lib/zhihu/text";
import type { ZhihuItem } from "@/lib/zhihu/types";
import type { PerspectiveCard, PerspectiveItem, PerspectiveSide, PerspectiveStance } from "./types";

export * from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 12;

interface ClassifiedItem extends PerspectiveItem {
  side: PerspectiveSide;
}

interface TopicAnalysis {
  topicKey: string;
  topicName: string;
  isControversial: boolean;
  question: string;
  proLabel: string;
  conLabel: string;
  items: ClassifiedItem[];
  analysis: string | null;
  analysisModel: string | null;
}

function toPerspectiveItem(item: ZhihuItem, oneLine: string): PerspectiveItem {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    oneLine,
    excerpt: item.excerpt,
    authorName: item.author?.name,
    voteUp: item.voteUp,
    provider: item.provider,
  };
}

function bodyFor(item: ZhihuItem): string {
  return truncate(item.content ?? recallContent(item.id) ?? item.excerpt, 900);
}

// ── 1. 争议检测 ─────────────────────────────────────────

export async function detectControversy(topic: Pick<InterestTopic, "name" | "keywords" | "stanceLabel" | "controversial">): Promise<{ analysis: ControversyAnalysis; live: boolean }> {
  const lexicon = findLexiconEntry(topic.name);
  if (lexicon?.controversial && lexicon.pro && lexicon.con && lexicon.question) {
    return {
      analysis: {
        isControversial: true,
        question: lexicon.question,
        pro: { label: lexicon.pro.label, query: lexicon.pro.query },
        con: { label: lexicon.con.label, query: lexicon.con.query },
      },
      live: false,
    };
  }
  if (!topic.controversial && lexicon && !lexicon.controversial) {
    return {
      analysis: { isControversial: false, question: topic.name, pro: { label: "", query: "" }, con: { label: "", query: "" } },
      live: false,
    };
  }
  const result = await llmObject({
    schema: controversySchema,
    system: CONTROVERSY_SYSTEM,
    prompt: controversyPrompt(topic.name, topic.keywords, topic.stanceLabel ?? undefined),
    fallback: () => ({
      isControversial: topic.controversial,
      question: `关于「${topic.name}」，不同人怎么看？`,
      pro: { label: "支持", query: `${topic.name} 支持 理由` },
      con: { label: "反对", query: `${topic.name} 反对 理由` },
    }),
  });
  return { analysis: result.value, live: result.live };
}

// ── 2. 立场分类 ─────────────────────────────────────────

export async function classifyStances(
  question: string,
  proLabel: string,
  conLabel: string,
  candidates: Array<{ item: ZhihuItem; hint: PerspectiveSide }>,
): Promise<{ items: ClassifiedItem[]; live: boolean }> {
  if (candidates.length === 0) return { items: [], live: false };
  const result = await llmObject({
    schema: stanceBatchSchema,
    system: STANCE_SYSTEM,
    prompt: stancePrompt(
      question,
      proLabel,
      conLabel,
      candidates.map(({ item }) => ({ id: item.id, title: item.title, text: bodyFor(item) })),
    ),
    fallback: () => ({
      items: candidates.map(({ item }) => ({
        id: item.id,
        stance: "neutral" as const,
        oneLine: truncate(item.excerpt || item.title, 50),
      })),
    }),
  });
  const bySide = new Map(result.value.items.map((entry) => [entry.id.trim(), entry]));
  const items = candidates.map(({ item }) => {
    const entry = result.live ? bySide.get(item.id) : undefined;
    return {
      ...toPerspectiveItem(item, entry?.oneLine?.trim() || truncate(item.excerpt || item.title, 50)),
      side: entry?.stance ?? "neutral" as const,
    };
  });
  return { items, live: result.live };
}

// ── 3. 话题级分析（缓存） ───────────────────────────────

async function readCache(topicKey: string): Promise<TopicAnalysis | null> {
  const database = await db();
  const rows = await database
    .select()
    .from(schema.perspectiveCache)
    .where(and(eq(schema.perspectiveCache.topicKey, topicKey), gt(schema.perspectiveCache.createdAt, new Date(Date.now() - CACHE_TTL_MS))))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const stored = row.stances as { proLabel: string; conLabel: string; items: ClassifiedItem[] } | ClassifiedItem[];
  const normalized = Array.isArray(stored) ? { proLabel: "支持", conLabel: "反对", items: stored } : stored;
  return {
    topicKey: row.topicKey,
    topicName: row.topicName,
    isControversial: row.isControversial,
    question: row.question,
    proLabel: normalized.proLabel,
    conLabel: normalized.conLabel,
    items: normalized.items,
    analysis: row.analysis,
    analysisModel: row.model,
  };
}

async function writeCache(analysis: TopicAnalysis) {
  const database = await db();
  const payload = { proLabel: analysis.proLabel, conLabel: analysis.conLabel, items: analysis.items };
  await database
    .insert(schema.perspectiveCache)
    .values({
      topicKey: analysis.topicKey,
      topicName: analysis.topicName,
      question: analysis.question,
      isControversial: analysis.isControversial,
      stances: payload,
      analysis: analysis.analysis,
      model: analysis.analysisModel,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.perspectiveCache.topicKey,
      set: {
        topicName: analysis.topicName,
        question: analysis.question,
        isControversial: analysis.isControversial,
        stances: payload,
        analysis: analysis.analysis,
        model: analysis.analysisModel,
        createdAt: new Date(),
      },
    });
}

async function neutralAnalysis(question: string, candidates: ZhihuItem[]): Promise<{ text: string | null; model: string | null }> {
  const selected = [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates.at(-1)].filter((item): item is ZhihuItem => Boolean(item));
  const sources = [...new Map(selected.map(snapshotItem).filter((source): source is SourceSnapshot => source !== null).map((source) => [source.id, source])).values()];
  if (!sources.length) return { text: null, model: null };
  const extracted = await extractEvidence(sources, { timeoutMs: 15_000 });
  if (!extracted.live) return { text: null, model: null };
  const { evidence } = validateEvidence(extracted.value, sources);
  if (!evidence.length) return { text: null, model: null };
  const result = await synthesizeEvidence(question, evidence, { timeoutMs: 15_000, sources });
  if (!result.live) return { text: null, model: null };
  const checked = validateAnalysis(result.value, evidence);
  return { text: checked.summary.evidenceIds.length ? checked.summary.text : null, model: result.model };
}

export async function analyzeTopic(topic: InterestTopic, options: { force?: boolean } = {}): Promise<TopicAnalysis> {
  const topicKey = `evidence-1:${normalizeQuery(topic.name)}`;
  if (!options.force) {
    const cached = await readCache(topicKey);
    if (cached) return cached;
  }

  const { analysis: controversy } = await detectControversy(topic);
  if (!controversy.isControversial) {
    const result: TopicAnalysis = {
      topicKey,
      topicName: topic.name,
      isControversial: false,
      question: controversy.question,
      proLabel: "",
      conLabel: "",
      items: [],
      analysis: null,
      analysisModel: null,
    };
    await writeCache(result);
    return result;
  }

  const [proSearch, conSearch, neutralSearch] = await Promise.all([
    searchZhihu(controversy.pro.query, { count: 6 }),
    searchZhihu(controversy.con.query, { count: 6 }),
    searchZhihu(topic.searchQueries[0] ?? topic.name, { count: 4 }),
  ]);
  const seen = new Set<string>();
  const candidates: Array<{ item: ZhihuItem; hint: PerspectiveSide }> = [];
  const push = (items: ZhihuItem[], hint: PerspectiveSide, limit: number) => {
    let added = 0;
    for (const item of items) {
      if (added >= limit || seen.has(item.id) || item.type === "question") continue;
      seen.add(item.id);
      candidates.push({ item, hint });
      added += 1;
    }
  };
  push(proSearch.items, "pro", 5);
  push(conSearch.items, "con", 5);
  push(neutralSearch.items, "neutral", MAX_CANDIDATES - candidates.length);

  const [classified, neutral] = await Promise.all([
    classifyStances(controversy.question, controversy.pro.label, controversy.con.label, candidates),
    neutralAnalysis(controversy.question, candidates.map(({ item }) => item)),
  ]);

  const result: TopicAnalysis = {
    topicKey,
    topicName: topic.name,
    isControversial: true,
    question: controversy.question,
    proLabel: controversy.pro.label,
    conLabel: controversy.con.label,
    items: classified.items,
    analysis: neutral.text,
    analysisModel: neutral.model,
  };
  await writeCache(result);
  return result;
}

// ── 4. 生成卡片：判断用户偏向并挑选对立面 ─────────────

function opposite(side: PerspectiveSide): PerspectiveSide {
  switch (side) {
    case "pro":
      return "con";
    case "con":
      return "pro";
    case "neutral":
      return "neutral";
    default: {
      const exhaustive: never = side;
      return exhaustive;
    }
  }
}

export function computeExposure(
  userStance: string | null,
  classified: ClassifiedItem[],
  exposedIds: Set<string>,
): { userSide: PerspectiveSide | null; ratio: number } {
  const declared: PerspectiveSide | null = userStance === "pro" || userStance === "con" ? userStance : null;
  const exposed = classified.filter((item) => exposedIds.has(item.id) && item.side !== "neutral");
  const counts = { pro: 0, con: 0 };
  for (const item of exposed) counts[item.side as "pro" | "con"] += 1;
  // 用户在对话中明确表达的立场按 3 票计：一条反向曝光不足以抵消，两条以上则说明已经接触过另一面
  if (declared) counts[declared] += 3;
  const total = counts.pro + counts.con;
  if (total === 0) return { userSide: null, ratio: 0 };
  const userSide: PerspectiveSide = counts.pro >= counts.con ? "pro" : "con";
  return { userSide, ratio: counts[userSide] / total };
}

export function assembleCard(
  analysis: TopicAnalysis,
  userStance: string | null,
  userStanceLabel: string | null,
  exposedIds: Set<string>,
  threshold = 0.65,
): PerspectiveCard | null {
  if (!analysis.isControversial || analysis.items.length === 0) return null;
  const { userSide, ratio } = computeExposure(userStance, analysis.items, exposedIds);
  if (!userSide || ratio < threshold) return null;
  const counterSide = opposite(userSide);
  const counterItems = analysis.items.filter((item) => item.side === counterSide).sort((a, b) => b.voteUp - a.voteUp);
  if (counterItems.length === 0) return null;
  const neutralItems = analysis.items.filter((item) => item.side === "neutral").sort((a, b) => b.voteUp - a.voteUp);
  const sameItems = analysis.items.filter((item) => item.side === userSide).sort((a, b) => b.voteUp - a.voteUp);

  const labelFor = (side: PerspectiveSide) => (side === "pro" ? analysis.proLabel : side === "con" ? analysis.conLabel : "中立分析");
  const candidateStances: PerspectiveStance[] = [
    { side: counterSide, label: labelFor(counterSide), items: counterItems.slice(0, 2) },
    { side: "neutral", label: "中立分析", items: neutralItems.slice(0, 1) },
    { side: userSide, label: labelFor(userSide), items: sameItems.slice(0, 1) },
  ];
  const stances = candidateStances.filter((stance) => stance.items.length > 0);

  return {
    evidenceVersion: "evidence-1",
    topicKey: analysis.topicKey,
    topicName: analysis.topicName,
    question: analysis.question,
    userSide,
    userSideLabel: userStanceLabel ?? labelFor(userSide),
    exposureRatio: Number(ratio.toFixed(2)),
    counterSide,
    stances,
    analysis: analysis.analysis,
    analysisModel: analysis.analysisModel,
    reason: `围绕你关注的「${analysis.topicName}」，补充「${labelFor(counterSide)}」的相关材料；阅读记录不代表你赞同这些观点。`,
  };
}

/**
 * 为 feed 生成「换个角度看」卡片：只处理争议话题，最多 maxCards 张。
 */
export async function buildPerspectiveCards(
  topics: InterestTopic[],
  exposure: Map<string, ZhihuItem[]>,
  maxCards = 2,
): Promise<Array<{ topicName: string; card: PerspectiveCard }>> {
  const candidates = topics
    .filter((topic) => topic.controversial || findLexiconEntry(topic.name)?.controversial)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxCards + 1);
  const analyses = await Promise.all(candidates.map((topic) => analyzeTopic(topic).catch(() => null)));
  const cards: Array<{ topicName: string; card: PerspectiveCard }> = [];
  candidates.forEach((topic, index) => {
    const analysis = analyses[index];
    if (!analysis) return;
    const exposedIds = new Set((exposure.get(topic.name) ?? []).map((item) => item.id));
    const card = assembleCard(analysis, topic.stance, topic.stanceLabel, exposedIds);
    if (card && cards.length < maxCards) cards.push({ topicName: topic.name, card });
  });
  return cards;
}
