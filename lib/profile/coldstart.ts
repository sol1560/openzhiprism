import { readFile } from "node:fs/promises";
import path from "node:path";
import { llmObject } from "@/lib/llm/client";
import { EXTRACT_SYSTEM, extractedInterestsSchema, type ExtractedInterests, type ExtractedTopic } from "@/lib/llm/prompts";
import { findLexiconEntry } from "@/lib/ingest/lexicon";
import { sanitizeInterests } from "@/lib/ingest/extract";
import {
  isJustoneConfigured,
  isOfficialConfigured,
  justoneUserFollowTopics,
  justoneUserFollowees,
  justoneUserInfo,
  officialFollowees,
} from "@/lib/zhihu";
import type { FolloweeProfile, ZhihuFollowGraph } from "@/lib/zhihu/types";

/**
 * OAuth 冷启动：从知乎关注图谱（关注的人 / 话题）提取初始兴趣。
 *  - self：Access Secret 持有者本人（官方接口，无需 OAuth）
 *  - token：任意 url_token（JustOne 接口）
 *  - fixture：离线快照 fixtures/zhihu/follow-graph/*.json
 */

const FOLLOW_FIXTURE_DIR = path.resolve(process.cwd(), "fixtures", "zhihu", "follow-graph");

async function readFollowFixture(name: string): Promise<ZhihuFollowGraph | null> {
  try {
    const raw = await readFile(path.join(FOLLOW_FIXTURE_DIR, `${name}.json`), "utf8");
    return { ...(JSON.parse(raw) as ZhihuFollowGraph), provider: "fixture" };
  } catch {
    return null;
  }
}

export async function loadFollowGraph(kind: "self" | "token", urlToken?: string): Promise<ZhihuFollowGraph> {
  if (kind === "self") {
    if (isOfficialConfigured()) {
      try {
        const followees = await officialFollowees(50);
        if (followees.length > 0) return { followees, topics: [], questions: [], provider: "official" };
      } catch {
        // 降级到快照
      }
    }
    return (await readFollowFixture("self")) ?? { followees: [], topics: [], questions: [], provider: "fixture" };
  }

  const token = (urlToken ?? "").trim();
  if (!token) throw new Error("缺少知乎 url_token");
  const fixture = await readFollowFixture(token);
  if (isJustoneConfigured()) {
    try {
      const [self, followees, topics] = await Promise.allSettled([
        justoneUserInfo(token),
        justoneUserFollowees(token),
        justoneUserFollowTopics(token),
      ]);
      const graph: ZhihuFollowGraph = {
        self: self.status === "fulfilled" ? self.value ?? undefined : undefined,
        followees: followees.status === "fulfilled" ? followees.value : [],
        topics: topics.status === "fulfilled" ? topics.value : [],
        questions: [],
        provider: "justone",
      };
      if (graph.followees.length > 0 || graph.topics.length > 0) return graph;
    } catch {
      // 降级到快照
    }
  }
  if (fixture) return fixture;
  throw new Error(`无法获取 @${token} 的关注数据（JustOne 未配置且无快照）`);
}

function followGraphToText(graph: ZhihuFollowGraph): string {
  const lines: string[] = [];
  if (graph.topics.length > 0) {
    lines.push(`用户关注的知乎话题：${graph.topics.map((topic) => topic.name).join("、")}`);
  }
  if (graph.followees.length > 0) {
    lines.push("用户关注的创作者及其简介：");
    for (const followee of graph.followees.slice(0, 40)) {
      lines.push(`- ${followee.name}：${followee.headline || "（无简介）"}`);
    }
  }
  if (graph.questions.length > 0) {
    lines.push(`用户关注的问题：${graph.questions.map((question) => question.title).join("；")}`);
  }
  return lines.join("\n");
}

const COLDSTART_SYSTEM = `${EXTRACT_SYSTEM}

补充说明：本次输入不是对话，而是用户在知乎的关注列表（话题名、关注的创作者简介、关注的问题）。请据此推断用户可能感兴趣的话题：关注的话题直接映射；创作者简介中的专业领域（例如「AI 研究者」「注册营养师」）映射为对应知识领域。mentions 取该领域在列表中出现的次数，depth 统一给 2。`;

const GENERIC_HEADLINE_WORDS = ["ai", "人工智能", "大模型", "llm", "openai", "科普", "营养", "健身", "留学", "军事", "历史", "摄影", "投资", "理财", "编程", "程序员", "设计", "产品", "心理", "医学", "法律", "教育"];

export function ruleBasedColdStart(graph: ZhihuFollowGraph): ExtractedInterests {
  const topics = new Map<string, ExtractedTopic>();
  const bump = (name: string, keyword: string, evidence: string) => {
    const existing = topics.get(name);
    if (existing) {
      existing.mentions += 1;
      if (!existing.keywords.includes(keyword)) existing.keywords.push(keyword);
      return;
    }
    const lexicon = findLexiconEntry(name);
    topics.set(name, {
      name,
      keywords: [keyword],
      questions: [],
      evidence: [evidence.slice(0, 40)],
      depth: 2,
      mentions: 1,
      stance: "unknown",
      controversial: lexicon?.controversial ?? false,
      searchQueries: lexicon?.searchQueries ?? [name],
    });
  };
  for (const topic of graph.topics) {
    if (/计划|活动|大会|地震|画展|日记/.test(topic.name)) continue; // 过滤运营活动类话题
    bump(topic.name, topic.name, `关注了话题「${topic.name}」`);
  }
  for (const followee of graph.followees) {
    const lower = followee.headline.toLowerCase();
    for (const word of GENERIC_HEADLINE_WORDS) {
      if (lower.includes(word)) {
        const name = word === "llm" || word === "openai" || word === "大模型" ? "AI / 大模型" : word === "ai" || word === "人工智能" ? "AI / 大模型" : word;
        bump(name, word, `关注了 ${followee.name}（${followee.headline}）`);
      }
    }
  }
  return { topics: [...topics.values()].slice(0, 12), redactedCategories: [] };
}

export interface ColdStartOutcome {
  graph: ZhihuFollowGraph;
  interests: ExtractedInterests;
  llm: { provider: string; model: string; live: boolean };
}

export async function extractFromFollowGraph(graph: ZhihuFollowGraph): Promise<ColdStartOutcome> {
  const text = followGraphToText(graph);
  if (!text.trim()) {
    return { graph, interests: { topics: [], redactedCategories: [] }, llm: { provider: "mock", model: "rules", live: false } };
  }
  const result = await llmObject({
    schema: extractedInterestsSchema,
    system: COLDSTART_SYSTEM,
    prompt: text,
    fallback: () => ruleBasedColdStart(graph),
    temperature: 0.1,
  });
  const interests = result.value.topics.length > 0 ? result.value : ruleBasedColdStart(graph);
  return {
    graph,
    interests: sanitizeInterests(interests),
    llm: { provider: result.provider, model: result.model, live: result.live },
  };
}

export function describeFollowees(followees: FolloweeProfile[]): string {
  return followees
    .slice(0, 5)
    .map((followee) => followee.name)
    .join("、");
}
