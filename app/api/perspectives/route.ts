import { NextResponse, type NextRequest } from "next/server";
import { perspectivesView } from "@/lib/mcp/views";
import { analyzeTopicForUser } from "@/lib/perspective/lookup";
import { getSessionUserId } from "@/lib/session";

// 首次分析要做三路检索 + 立场分类 + 中立分析
export const maxDuration = 60;

/** 对一个话题做「换个角度看」分析；结果按话题缓存 7 天 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const topic = (request.nextUrl.searchParams.get("topic") ?? "").trim();
  if (topic.length < 2 || topic.length > 40) return NextResponse.json({ error: "话题需要 2-40 个字" }, { status: 400 });
  const refresh = request.nextUrl.searchParams.get("refresh") === "true";
  try {
    const { analysis, userStance } = await analyzeTopicForUser(userId, topic, { refresh });
    return NextResponse.json(perspectivesView(analysis, userStance), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
