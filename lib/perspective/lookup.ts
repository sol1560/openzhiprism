import type { InterestTopic } from "@/db/schema";
import { getProfile } from "@/lib/profile/store";
import { analyzeTopic } from "./index";

/**
 * 按用户画像匹配话题后做多元视角分析；画像里没有就临时构造一个话题。
 * MCP get_perspectives 与 HTTP /api/perspectives 共用。
 */
export async function analyzeTopicForUser(userId: string, topic: string, options: { refresh?: boolean } = {}) {
  const profile = await getProfile(userId);
  const matched = profile.find((item) => item.name.includes(topic) || topic.includes(item.name));
  const now = new Date();
  const adhoc: InterestTopic = {
    id: "adhoc", userId, name: topic, weight: 0, rawScore: 0, hits: 0, keywords: [], questions: [], evidence: [],
    searchQueries: [topic], controversial: true, stance: null, stanceLabel: null, source: "conversation", lastSeenAt: now, createdAt: now,
  };
  const analysis = await analyzeTopic(matched ?? adhoc, { force: options.refresh });
  return { analysis, userStance: matched?.stanceLabel ?? null };
}
