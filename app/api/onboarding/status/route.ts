import { NextResponse } from "next/server";
import { listConnections } from "@/lib/connectors/oauth";
import { getProfile } from "@/lib/profile/store";
import { getSessionUserId } from "@/lib/session";

/** onboarding 第一步轮询：连接是否出现、画像是否已经有话题（连接后由 MCP 端写入） */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [topics, connections] = await Promise.all([getProfile(userId), listConnections(userId)]);
  return NextResponse.json({
    topicCount: topics.length,
    connections: connections.filter((item) => item.status !== "expired" && item.kind !== "extension").map((item) => ({ id: item.id, clientName: item.clientName, status: item.status, autoIngest: item.autoIngest })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
