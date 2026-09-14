import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InterestTopic, User } from "@/db/schema";
import type { ExtractedInterests } from "@/lib/llm/prompts";
import { mergeTopics, type TopicSource } from "./merge";
import { writeTransaction, type WriteTx } from "@/lib/security/transaction";

export async function getUser(userId: string): Promise<User | null> {
  const database = await db();
  const rows = await database.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUser(input: {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  headline?: string | null;
  zhihuUrlToken?: string | null;
  loginSource: string;
}): Promise<User> {
  const database = await db();
  await database
    .insert(schema.users)
    .values({
      id: input.id,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      headline: input.headline ?? null,
      zhihuUrlToken: input.zhihuUrlToken ?? null,
      loginSource: input.loginSource,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
        headline: input.headline ?? null,
        zhihuUrlToken: input.zhihuUrlToken ?? null,
        loginSource: input.loginSource,
      },
    });
  return (await getUser(input.id))!;
}

export async function getProfile(userId: string): Promise<InterestTopic[]> {
  const database = await db();
  return database
    .select()
    .from(schema.interestTopics)
    .where(eq(schema.interestTopics.userId, userId))
    .orderBy(desc(schema.interestTopics.weight));
}

/** 把一次提取结果合并进用户画像，并重算所有话题的归一化权重 */
export async function applyExtraction(
  userId: string,
  interests: ExtractedInterests,
  source: TopicSource,
  now = new Date(),
): Promise<InterestTopic[]> {
  const database = await db();
  return writeTransaction(database, (tx) => applyExtractionInTransaction(tx, userId, interests, source, now));
}

export async function applyExtractionInTransaction(database: WriteTx, userId: string, interests: ExtractedInterests, source: TopicSource, now: Date): Promise<InterestTopic[]> {
  const existing = await database.select().from(schema.interestTopics).where(eq(schema.interestTopics.userId, userId));
  const merged = mergeTopics(existing, interests.topics, source, now);

  for (const draft of merged) {
    const values = {
      userId,
      name: draft.name,
      weight: draft.weight,
      rawScore: draft.rawScore,
      hits: draft.hits,
      keywords: draft.keywords,
      questions: draft.questions,
      evidence: draft.evidence,
      searchQueries: draft.searchQueries,
      controversial: draft.controversial,
      stance: draft.stance,
      stanceLabel: draft.stanceLabel,
      source: draft.source,
      lastSeenAt: draft.lastSeenAt,
    };
    if (draft.id) {
      await database.update(schema.interestTopics).set(values).where(eq(schema.interestTopics.id, draft.id));
    } else {
      await database.insert(schema.interestTopics).values({ id: randomUUID(), ...values });
    }
  }
  return database.select().from(schema.interestTopics).where(eq(schema.interestTopics.userId, userId)).orderBy(desc(schema.interestTopics.weight));
}

export async function clearProfile(userId: string) {
  const database = await db();
  await writeTransaction(database, async (database) => {
    await database.delete(schema.captureWorkers).where(eq(schema.captureWorkers.userId, userId));
    await database.delete(schema.captureJobs).where(eq(schema.captureJobs.userId, userId));
    await database.delete(schema.captureFeedRefreshes).where(eq(schema.captureFeedRefreshes.userId, userId));
    const archived = await database.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.userId, userId));
    for (const row of archived) await database.delete(schema.captureMessages).where(eq(schema.captureMessages.conversationId, row.id));
    await database.delete(schema.interestTopics).where(eq(schema.interestTopics.userId, userId));
    await database.delete(schema.conversations).where(eq(schema.conversations.userId, userId));
    await database.delete(schema.feedItems).where(eq(schema.feedItems.userId, userId));
    await database.delete(schema.feedDirectives).where(eq(schema.feedDirectives.userId, userId));
    await database.delete(schema.seenItems).where(eq(schema.seenItems.userId, userId));
    await database.delete(schema.feedRuns).where(eq(schema.feedRuns.userId, userId));
    await database.delete(schema.dailyBriefs).where(eq(schema.dailyBriefs.userId, userId));
  });
}
