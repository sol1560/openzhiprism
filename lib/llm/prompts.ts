import { z } from "zod";

// ── 兴趣提取 ────────────────────────────────────────────

export const stanceEnum = z.enum(["pro", "con", "neutral", "unknown"]);
export type Stance = z.infer<typeof stanceEnum>;

export const extractedTopicSchema = z.object({
  name: z.string().min(1).max(20).describe("话题名，2-10 个字，例如「考研 vs 就业」「远程办公效率」"),
  keywords: z.array(z.string()).max(6).describe("相关关键词"),
  questions: z.array(z.string()).max(3).describe("用户提出过的问题，改写成第三人称且去掉个人信息"),
  evidence: z.array(z.string()).max(2).describe("能说明用户关心此话题的简短证据句（脱敏、不超过 40 字）"),
  depth: z.number().min(1).max(5).describe("讨论深度 1-5：1 顺带提及，5 反复深入追问"),
  mentions: z.number().min(1).describe("在对话中被提及的次数"),
  stance: stanceEnum.describe("用户在该话题上表现出的立场倾向"),
  stanceLabel: z.string().max(40).optional().describe("立场的一句话描述，例如「倾向认为考研比就业更稳妥」"),
  controversial: z.boolean().describe("该话题在公共讨论中是否存在明显对立观点"),
  searchQueries: z.array(z.string()).min(1).max(3).describe("适合在知乎搜索的检索词，每个 4-12 字"),
});

export const extractedInterestsSchema = z.object({
  topics: z.array(extractedTopicSchema).max(12),
  redactedCategories: z.array(z.string()).describe("被主动跳过的敏感信息类别，例如「身份信息」「财务」「医疗」"),
});

export type ExtractedTopic = z.infer<typeof extractedTopicSchema>;
export type ExtractedInterests = z.infer<typeof extractedInterestsSchema>;

export const EXTRACT_SYSTEM = `你是「知棱」的兴趣分析引擎。输入是一位用户与 AI 助手的对话记录，你要从中提取用户真实关心的话题。

规则：
1. 只提取话题层面的兴趣，绝不输出任何个人身份、联系方式、财务数字、健康诊断、公司机密等隐私。若对话涉及这些内容，只保留其话题面（例如「租房合同注意事项」而不是具体地址和金额），并在 redactedCategories 中登记类别。
2. 话题名要像知乎话题一样具体、可检索，避免「生活」「工作」这类过宽的词。
3. mentions 与 depth 要基于对话中的实际轮数和追问程度判断，不要凭空放大。
4. 如果用户在某个话题上明显只听一种声音（例如反复寻求「为什么 X 更好」的论据），把 stance 标出来，并用 stanceLabel 描述其倾向的那一方（例如「倾向先考研而非先工作」），不要描述行动或状态。
5. controversial 只在公共讨论中确实存在价值判断或人生选择上的对立阵营时才为 true（例如考研 vs 就业、大城市 vs 回老家、AI 是否会取代程序员、大厂 vs 创业公司）；纯技术选型、学习方法类话题不算。
6. searchQueries 要能直接搜到高质量知乎回答，优先用中文短语。
7. 最多输出 12 个话题，按重要性排序。`;

export function extractPrompt(conversationText: string, priorTopics: string[]): string {
  const prior = priorTopics.length > 0 ? `\n\n用户历史画像中已有的话题（若对话中再次出现请沿用同名）：${priorTopics.join("、")}` : "";
  return `对话记录如下（已做初步脱敏，[已隐去] 表示被过滤的内容）：\n\n"""\n${conversationText}\n"""${prior}`;
}

// ── 摘要 ────────────────────────────────────────────────

export const batchSummarySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      summary: z.string().max(160).describe("两三句话概括核心观点，不要复述标题"),
    }),
  ),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

export const SUMMARY_SYSTEM = `你是知乎内容的摘要助手。对每条内容用两三句话（60-120 字）概括作者的核心观点和最有信息量的论据，语气客观，不加评价，不复述标题，不出现「本文」「作者认为」等套话。保持输入的 id 原样返回。`;

export function summaryPrompt(items: Array<{ id: string; title: string; text: string }>): string {
  return items
    .map((item, index) => `### 第 ${index + 1} 条\nid: ${item.id}\n标题：${item.title}\n正文：\n${item.text}`)
    .join("\n\n");
}

// ── 争议检测 ────────────────────────────────────────────

export const controversySchema = z.object({
  isControversial: z.boolean(),
  question: z.string().max(60).describe("把话题改写成一个有争议的核心问题，例如「应届生应该先考研还是先工作？」"),
  pro: z.object({
    label: z.string().max(20).describe("支持方立场的短标签，例如「先考研」"),
    query: z.string().max(20).describe("能搜到支持方高赞回答的知乎检索词"),
  }),
  con: z.object({
    label: z.string().max(20).describe("反对方立场的短标签，例如「先工作」"),
    query: z.string().max(20).describe("能搜到反对方高赞回答的知乎检索词"),
  }),
});
export type ControversyAnalysis = z.infer<typeof controversySchema>;

export const CONTROVERSY_SYSTEM = `你是「知棱」的多元视角引擎。给定一个用户感兴趣的话题，判断它在公共讨论中是否存在明显对立的立场。若存在，把它改写成一个中立的核心问题，并为正反两方各给出立场标签和一条能在知乎搜到对应立场高赞回答的检索词。检索词要带立场倾向（例如「为什么建议先工作再考研」），而不是中性词。`;

export function controversyPrompt(topic: string, keywords: string[], userStanceLabel?: string): string {
  return `话题：${topic}\n关键词：${keywords.join("、") || "无"}\n用户当前立场：${userStanceLabel ?? "未知"}`;
}

// ── 立场分类 ────────────────────────────────────────────

export const stanceBatchSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      stance: z.enum(["pro", "con", "neutral"]),
      oneLine: z.string().max(60).describe("用一句话说出这条回答的核心主张"),
    }),
  ),
});
export type StanceBatch = z.infer<typeof stanceBatchSchema>;

export const STANCE_SYSTEM = `你是观点立场分类器。给定一个争议问题以及若干知乎回答，把每条回答归类为 pro（支持第一种立场）、con（支持第二种立场）或 neutral（中立分析 / 两边都谈 / 视情况而定），并用一句话概括其核心主张。保持 id 原样返回。`;

export function stancePrompt(
  question: string,
  proLabel: string,
  conLabel: string,
  items: Array<{ id: string; title: string; text: string }>,
): string {
  const header = `争议问题：${question}\npro = ${proLabel}\ncon = ${conLabel}\n\n回答列表：`;
  const body = items
    .map((item, index) => `### ${index + 1}\nid: ${item.id}\n标题：${item.title}\n内容：${item.text}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}

// ── 热榜相关性 ──────────────────────────────────────────

export const hotPickSchema = z.object({
  picks: z.array(
    z.object({
      id: z.string(),
      reason: z.string().max(40).describe("为什么它和用户兴趣有关，或者为什么适合作为轻松阅读"),
    }),
  ).max(6),
});
export type HotPick = z.infer<typeof hotPickSchema>;

export const HOT_PICK_SYSTEM = `你是内容编辑。给定用户的兴趣话题和今日知乎热榜，挑出最多 6 条适合穿插进用户 feed 的热榜条目：优先与兴趣相关的，其次是轻松有趣、能调节阅读节奏的。避开纯负面社会新闻。保持 id 原样返回。`;

export function hotPickPrompt(topics: string[], items: Array<{ id: string; title: string; excerpt: string }>, avoid: string[] = []): string {
  const list = items.map((item) => `- id: ${item.id} | ${item.title} | ${item.excerpt.slice(0, 60)}`).join("\n");
  const rules = avoid.length > 0 ? `\n用户提过的要求（挑选时遵守）：${avoid.join("；")}` : "";
  return `用户兴趣：${topics.join("、")}${rules}\n\n今日热榜：\n${list}`;
}

// ── 多元视角中立分析（直答） ────────────────────────────

export const PERSPECTIVE_ANALYSIS_SYSTEM = `你是知乎直答，擅长在争议话题上给出平衡的分析。请用 120-200 字说明这个问题为什么存在分歧、双方各自最有力的论据是什么、以及决策时真正该看的变量，不站队。`;

export function perspectiveAnalysisPrompt(question: string, proLabel: string, conLabel: string): string {
  return `问题：${question}\n一方立场：${proLabel}\n另一方立场：${conLabel}`;
}

// ── 每日简报 ────────────────────────────────────────────

export const dailyBriefSchema = z.object({
  headline: z.string().max(30).describe("今天这份 Feed 的一句话标题，不超过 30 字"),
  summary: z.string().max(160).describe("2-3 句总结，给页面头部"),
  spokenScript: z.string().min(120).max(320).describe("150-300 字口语化中文开场播报，给语音向导直接朗读；不含链接、markdown、编号"),
  highlights: z.array(z.object({
    cardId: z.string().describe("必须是输入卡片列表里的 cardId"),
    why: z.string().max(40).describe("一句话说明为什么值得先看"),
    takeaway: z.string().max(80).optional().describe("阅读这条材料可以进一步弄清的具体问题；不要承诺学习效果"),
  })).max(3),
  continuity: z.array(z.string().max(60)).max(3).describe("和昨天 / 最近阅读的连续性说明，没有就空数组"),
  perspectiveHint: z.string().max(80).optional().describe("若有「换个角度看」卡片，一句提醒"),
});
export type DailyBriefDraft = z.infer<typeof dailyBriefSchema>;

export const DAILY_BRIEF_SYSTEM = `你是「知棱」的每日播报编辑。输入是用户今天的知乎内容 Feed（每张卡片有 cardId、话题、标题、摘要）、兴趣画像和最近的阅读记录，你要写一份简报。

规则：
1. highlights 只能从给定卡片里选 cardId，不要编造标题或观点；优先选用户最近在读的话题、点开率高的话题，若有「换个角度看」卡片至少选一张。
2. spokenScript 像一段对朋友说的话：先用一句话说最近在看什么（有阅读记录才说），再点出两三条今天最值得看的内容和理由，若有「换个角度看」提一句「这是另一方的看法」，结尾邀请用户说想展开哪条。不要出现链接、markdown、编号、英文字段名。
3. headline 不超过 30 字；summary 2-3 句，写给页面头部，语气客观。
4. continuity 描述和昨天 / 最近阅读的关系，例如「昨天你点开了 X，今天接着有新内容」；没有阅读记录就返回空数组。`;

export function dailyBriefPrompt(input: {
  date: string;
  topics: Array<{ name: string; weight: number }>;
  cards: Array<{ cardId: string; kind: string; topic: string | null; title: string; summary: string }>;
  history: {
    yesterday: { date: string; pushed: number; opened: number } | null;
    recentOpened: Array<{ title: string; topic: string | null }>;
    streakDays: number;
    topEngaged: Array<{ topic: string; opened: number; pushed: number }>;
  };
}): string {
  const topics = input.topics.map((topic) => `${topic.name}（${topic.weight.toFixed(2)}）`).join("、") || "无";
  const cards = input.cards
    .map((card) => `- cardId: ${card.cardId} | ${card.kind} | 话题：${card.topic ?? "热榜"} | ${card.title} | ${card.summary}`)
    .join("\n");
  const yesterday = input.history.yesterday
    ? `昨天（${input.history.yesterday.date}）推送 ${input.history.yesterday.pushed} 条，用户打开 ${input.history.yesterday.opened} 条`
    : "昨天没有 Feed";
  const recent = input.history.recentOpened.map((item) => `《${item.title}》（${item.topic ?? "热榜"}）`).join("、") || "无";
  const engaged = input.history.topEngaged.map((item) => `${item.topic} ${item.opened}/${item.pushed}`).join("、") || "无";
  return `日期：${input.date}
兴趣话题（权重）：${topics}

今天的卡片：
${cards}

阅读记录：
- ${yesterday}
- 连续有 Feed 的天数：${input.history.streakDays}
- 最近打开：${recent}
- 各话题打开/推送：${engaged}`;
}

// ── Feed 要求（用自然语言对 Feed 提要求） ───────────────

export const askActionTypes = ["rewrite", "answer", "search", "adjust_topic", "add_rule"] as const;
export const askDirections = ["more", "less", "mute"] as const;

/** 扁平的动作对象：字段按 type 选用；不用 discriminatedUnion，文本模式的 JSON Schema 更稳 */
export const askPlanSchema = z.object({
  reply: z.string().max(160).describe("给用户的一句话回复，说明做了什么；用户提问时这里就是答案。不要 markdown"),
  summary: z.string().max(400).optional().describe("仅当用户要求改写「这一篇」的摘要时填：改写后的新摘要，忠于原文"),
  actions: z.array(
    z.object({
      type: z.enum(askActionTypes),
      topic: z.string().max(30).optional().describe("adjust_topic：必须是给定话题列表里的名字"),
      direction: z.enum(askDirections).optional().describe("adjust_topic：more 多推 / less 少推 / mute 不再推"),
      query: z.string().max(40).optional().describe("search：适合知乎搜索的检索词"),
      rule: z.string().max(60).optional().describe("add_rule：用一句话记下的长期要求，例如「摘要都用三条要点」"),
    }),
  ).max(3),
});
export type AskPlanDraft = z.infer<typeof askPlanSchema>;

export const ASK_SYSTEM = `你是「知棱」的 Feed 编辑助手。用户会用一句话对今天的知乎内容 Feed 提要求，你要把它解释成结构化动作，并给一句简短回复。

动作类型：
- rewrite：用户想改写「当前这一篇」的摘要（更短、要点列表、大白话、翻译、换个侧重）。只在给了当前卡片时可用；把改写结果放进 summary，不要产生其他动作。
- answer：用户在问当前这一篇的内容（细节、论据、立场）。只填 reply，不改摘要，不填 summary。
- search：用户想看某个新东西（「我想看看 X」「来点关于 X 的」）。query 是适合知乎搜索的 2-10 字检索词。
- adjust_topic：用户想以后多推 / 少推 / 不再推某个话题，且该话题在给定的画像话题列表里。topic 必须原样取自列表。
- add_rule：长期性的要求，无法归到上面（「摘要都用要点」「少推营销号文章」「不要标题党」），或想少推 / 屏蔽的东西不在话题列表里。

规则：
1. 只改这篇 → rewrite；带「以后」「都」「每次」「少推」「多推」「别推」→ adjust_topic 或 add_rule；问问题 → answer。
2. 想看新东西且不在话题列表 → search；想多看且在列表 → adjust_topic more（可同时给 search）。
3. 最多 2 个动作。summary 必须只依据给定正文，不编造，不复述标题，遵守用户已有规则。
4. reply 是一句温和的中文，说清你做了什么或答案；不要 markdown、不要英文字段名。`;

export function askPrompt(input: {
  date: string;
  text: string;
  focusedCard?: { cardId: string; title: string; summary: string; body: string; topic: string | null };
  cards: Array<{ cardId: string; kind: string; topic: string | null; title: string; summary: string }>;
  topics: string[];
  directives: string[];
}): string {
  const topics = input.topics.join("、") || "无";
  const rules = input.directives.length > 0 ? input.directives.map((line) => `- ${line}`).join("\n") : "- 无";
  const focused = input.focusedCard
    ? `当前这一篇（cardId: ${input.focusedCard.cardId}，话题：${input.focusedCard.topic ?? "热榜"}）：
标题：${input.focusedCard.title}
当前摘要：${input.focusedCard.summary}
正文：
"""
${input.focusedCard.body}
"""

`
    : "";
  const cards = input.cards
    .map((card) => `- cardId: ${card.cardId} | ${card.kind} | 话题：${card.topic ?? "热榜"} | ${card.title} | ${card.summary}`)
    .join("\n");
  return `日期：${input.date}
画像话题列表：${topics}
用户已有的要求：
${rules}

${focused}今天的卡片：
${cards}

用户的话：${input.text}`;
}

export const restyleSchema = z.object({
  items: z.array(z.object({ id: z.string(), summary: z.string().max(400).describe("按用户要求重写后的摘要") })),
});

export const RESTYLE_SYSTEM = `你是知乎内容的摘要助手。用户对摘要风格提出了长期要求，请按要求重写每条摘要：只依据给定正文，保持事实，不复述标题，不出现「本文」「作者认为」等套话，每条不超过 200 字。保持输入的 id 原样返回。`;

export function restylePrompt(items: Array<{ id: string; title: string; summary: string; text: string }>, rules: string[]): string {
  const header = `用户的要求：\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
  const body = items
    .map((item, index) => `### 第 ${index + 1} 条\nid: ${item.id}\n标题：${item.title}\n当前摘要：${item.summary}\n正文：\n${item.text}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}
