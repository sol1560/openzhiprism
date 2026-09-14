import { and, eq, inArray } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { writeTransaction } from "@/lib/security/transaction";
import { CognitionError, type ContentFeedback } from "./types";

export async function getContentFeedback(userId: string, database?: Db): Promise<Record<string, ContentFeedback>> {
  const rows = await (database ?? await db()).select().from(schema.contentFeedback).where(eq(schema.contentFeedback.userId, userId));
  return Object.fromEntries(rows.map((row) => [row.contentId, row.kind as ContentFeedback]));
}
export async function setContentFeedback(userId: string, contentId: string, kind: ContentFeedback | null, database?: Db) {
  const d = database ?? await db();
  const feed = await d.select({ contentId: schema.feedItems.contentId, payload: schema.feedItems.payload }).from(schema.feedItems).where(eq(schema.feedItems.userId, userId));
  let allowed = feed.some((row) => row.contentId === contentId || (row.payload as { stances?: Array<{ items?: Array<{ id: string }> }> } | null)?.stances?.some((s) => s.items?.some((i) => i.id === contentId)));
  if (!allowed) {
    const access = await d.select({ id: schema.dossierAccess.artifactId }).from(schema.dossierAccess).where(eq(schema.dossierAccess.userId, userId));
    const artifacts = access.length ? await d.select({ payload: schema.dossierArtifacts.payload }).from(schema.dossierArtifacts).where(inArray(schema.dossierArtifacts.id, access.map((a) => a.id))) : [];
    allowed = artifacts.some((a) => a.payload.sources.some((s) => s.contentId === contentId));
  }
  if (!allowed) throw new CognitionError("这条内容不在你的阅读材料中", 404);
  await writeTransaction(d, async (tx) => {
    if (kind === null) await tx.delete(schema.contentFeedback).where(and(eq(schema.contentFeedback.userId, userId), eq(schema.contentFeedback.contentId, contentId)));
    else await tx.insert(schema.contentFeedback).values({ userId, contentId, kind, updatedAt: Date.now() }).onConflictDoUpdate({ target: [schema.contentFeedback.userId, schema.contentFeedback.contentId], set: { kind, updatedAt: Date.now() } });
    // Rebuild the brief next time; don't rewrite a user's viewpoint or topic preferences.
    await tx.delete(schema.dailyBriefs).where(eq(schema.dailyBriefs.userId, userId));
  });
  return { contentId, kind };
}
