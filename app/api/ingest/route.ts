import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { startFeedBuild } from "@/lib/feed";
import { ingestConversations } from "@/lib/ingest";
import { redactConversations } from "@/lib/ingest";
import { parseConversations } from "@/lib/ingest/parse";
import { redactionLabel } from "@/lib/ingest/privacy";
import { getPersona } from "@/lib/personas";
import { getSessionUserId } from "@/lib/session";

const bodySchema = z.object({
  source: z.enum(["paste", "upload", "persona", "mcp"]).default("paste"),
  raw: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  personaId: z.string().optional(),
  /** 只做解析 + 脱敏预览，不入库、不调用 LLM */
  previewOnly: z.boolean().default(false),
});

export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法", issues: parsed.error.issues }, { status: 400 });

  let raw: unknown = parsed.data.raw;
  let source = parsed.data.source;
  if (parsed.data.personaId) {
    const persona = await getPersona(parsed.data.personaId);
    if (!persona) return NextResponse.json({ error: "未找到 persona" }, { status: 404 });
    raw = { conversations: persona.conversations };
    source = "persona";
  }
  if (raw === undefined) return NextResponse.json({ error: "缺少对话内容" }, { status: 400 });

  try {
    if (parsed.data.previewOnly) {
      const conversations = parseConversations(raw);
      const { conversations: redacted, redactions } = redactConversations(conversations);
      return NextResponse.json({
        conversationCount: redacted.length,
        messageCount: redacted.reduce((sum, conversation) => sum + conversation.messages.length, 0),
        redactions: redactions.map((item) => ({ ...item, label: redactionLabel(item.category) })),
        preview: redacted.slice(0, 3).map((conversation) => ({
          title: conversation.title,
          messages: conversation.messages.slice(0, 4),
        })),
      });
    }
    const result = await ingestConversations({ userId, source, raw });
    // 画像更新后立刻在后台重建今日 feed：用户点到 /feed 时通常已经跑了一半
    let feedBuild = null;
    if (result.topics.length > 0) {
      const { build, promise } = await startFeedBuild(userId, { force: true });
      after(() => promise.catch(() => undefined));
      feedBuild = build;
    }
    return NextResponse.json({ ...result, feedBuild });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
