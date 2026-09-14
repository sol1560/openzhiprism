import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import type { FeedDirectiveRow } from "@/db/schema";
import type { WriteTx } from "@/lib/security/transaction";
import { writeTransaction } from "@/lib/security/transaction";
import type { DirectiveDirection, DirectiveView } from "./types";

/**
 * 用户对 Feed 的长期要求：话题增减 / 屏蔽（kind=topic）与自由规则（kind=rule）。
 * 与 interest_topics 分开存，画像重算不会把它们冲掉。
 */

export const MAX_DIRECTIVES = 20;

const DIRECTION_LABEL: Record<DirectiveDirection, string> = { more: "多推", less: "少推", mute: "不再推" };

export function directiveText(topic: string, direction: DirectiveDirection): string {
  return `${DIRECTION_LABEL[direction]} · ${topic}`;
}

function toView(row: FeedDirectiveRow): DirectiveView {
  return {
    id: row.id,
    kind: row.kind as DirectiveView["kind"],
    topic: row.topic,
    direction: row.direction as DirectiveDirection | null,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listDirectives(userId: string, database?: Db): Promise<DirectiveView[]> {
  const database_ = database ?? (await db());
  const rows = await database_.select().from(schema.feedDirectives)
    .where(eq(schema.feedDirectives.userId, userId))
    .orderBy(asc(schema.feedDirectives.createdAt));
  return rows.map(toView);
}

/** 同一话题只保留最新一条方向 */
export async function addTopicDirective(
  userId: string,
  input: { topic: string; direction: DirectiveDirection; sourceText: string },
  database?: Db,
): Promise<DirectiveView> {
  const database_ = database ?? (await db());
  const row: typeof schema.feedDirectives.$inferInsert = {
    id: randomUUID(), userId, kind: "topic", topic: input.topic, direction: input.direction,
    text: directiveText(input.topic, input.direction), sourceText: input.sourceText,
  };
  await writeTransaction(database_, async (tx) => {
    await tx.delete(schema.feedDirectives).where(and(
      eq(schema.feedDirectives.userId, userId), eq(schema.feedDirectives.kind, "topic"), eq(schema.feedDirectives.topic, input.topic),
    ));
    await assertCapacity(tx, userId);
    await tx.insert(schema.feedDirectives).values(row);
  });
  const [inserted] = await database_.select().from(schema.feedDirectives).where(eq(schema.feedDirectives.id, row.id));
  return toView(inserted);
}

/** 相同文字去重；超过上限时提示用户先删几条 */
export async function addRuleDirective(
  userId: string,
  input: { text: string; sourceText: string },
  database?: Db,
): Promise<DirectiveView> {
  const database_ = database ?? (await db());
  const text = input.text.trim();
  const id = randomUUID();
  const existingId = await writeTransaction(database_, async (tx) => {
    const [existing] = await tx.select().from(schema.feedDirectives).where(and(
      eq(schema.feedDirectives.userId, userId), eq(schema.feedDirectives.kind, "rule"), eq(schema.feedDirectives.text, text),
    ));
    if (existing) return existing.id;
    await assertCapacity(tx, userId);
    await tx.insert(schema.feedDirectives).values({ id, userId, kind: "rule", text, sourceText: input.sourceText });
    return id;
  });
  const [row] = await database_.select().from(schema.feedDirectives).where(eq(schema.feedDirectives.id, existingId));
  return toView(row);
}

async function assertCapacity(tx: WriteTx, userId: string) {
  const rows = await tx.select({ id: schema.feedDirectives.id }).from(schema.feedDirectives).where(eq(schema.feedDirectives.userId, userId));
  if (rows.length >= MAX_DIRECTIVES) throw new Error(`最多记住 ${MAX_DIRECTIVES} 条要求，先在侧栏删掉几条再试`);
}

export async function removeDirective(userId: string, id: string, database?: Db): Promise<void> {
  const database_ = database ?? (await db());
  await database_.delete(schema.feedDirectives).where(and(eq(schema.feedDirectives.userId, userId), eq(schema.feedDirectives.id, id)));
}

/** 按用户覆盖某张卡片的摘要；where 带 userId，不能改到别人的行 */
export async function setCardOverride(
  userId: string,
  cardId: string,
  input: { summary: string; note: string },
  database?: Db,
): Promise<void> {
  const database_ = database ?? (await db());
  await database_.update(schema.feedItems)
    .set({ summaryOverride: input.summary, overrideNote: input.note })
    .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.id, cardId)));
}

export async function clearCardOverride(userId: string, cardId: string, database?: Db): Promise<void> {
  const database_ = database ?? (await db());
  await database_.update(schema.feedItems)
    .set({ summaryOverride: null, overrideNote: null })
    .where(and(eq(schema.feedItems.userId, userId), eq(schema.feedItems.id, cardId)));
}
