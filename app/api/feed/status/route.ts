import { NextResponse, type NextRequest } from "next/server";
import { BUILD_POLL_MS, getBuildStatus, getFeed } from "@/lib/feed";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

/** 当日 feed 构建状态；已完成时顺带返回 feed，前端少一次往返 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? todayKey();
  const build = await getBuildStatus(userId, date);
  const feed = build?.status === "ready" ? await getFeed(userId, date) : undefined;
  return NextResponse.json({ build, feed, retryAfterMs: BUILD_POLL_MS }, { headers: { "Cache-Control": "private, no-store" } });
}
