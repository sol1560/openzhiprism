import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { getDossier, startDossier } from "@/lib/cognition/dossiers";
import { cognitionFailure, cognitionUser, PRIVATE_HEADERS } from "@/lib/cognition/http";
import { CognitionError } from "@/lib/cognition/types";
export const maxDuration = 300;
const inputSchema = z.object({ topic: z.string().trim().min(2).max(300).optional(), cardId: z.string().max(100).optional(), refresh: z.boolean().optional() }).refine((v) => v.topic || v.cardId);
export async function GET(request: NextRequest) {
  try { const user = await cognitionUser(); const id = request.nextUrl.searchParams.get("id"); if (!id) throw new CognitionError("缺少话题标识");
    return Response.json(await getDossier(user, id, request.nextUrl.searchParams.get("version") ?? undefined), { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await cognitionUser(request, "dossier");
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new CognitionError("请提供话题或阅读卡片");
    let topic = parsed.data.topic;
    if (parsed.data.cardId) {
      const database = await db();
      const [card] = await database.select().from(schema.feedItems).where(and(eq(schema.feedItems.id, parsed.data.cardId), eq(schema.feedItems.userId, user)));
      if (!card) throw new CognitionError("没有找到你的阅读卡片", 404);
      if (card.kind === "perspective") topic = (card.payload as { question?: string })?.question ?? card.topicName ?? undefined;
      else if (card.contentId) { const [content] = await database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, card.contentId)); topic = card.topicName ?? content?.title ?? undefined; }
    }
    if (!topic) throw new CognitionError("这张卡片还没有可分析的主题");
    const result = await startDossier(user, { topic, refresh: parsed.data.refresh });
    after(() => result.promise);
    return Response.json({ jobId: result.jobId, started: result.started }, { status: 202, headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
