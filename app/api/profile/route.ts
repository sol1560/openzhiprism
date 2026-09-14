import { NextResponse } from "next/server";
import { listConversations } from "@/lib/ingest";
import { getProfile } from "@/lib/profile/store";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [topics, conversations] = await Promise.all([getProfile(user.id), listConversations(user.id, 20)]);
  return NextResponse.json({
    user,
    topics,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      source: conversation.source,
      messageCount: conversation.messageCount,
      redactedCount: conversation.redactedCount,
      createdAt: conversation.createdAt,
    })),
  });
}
