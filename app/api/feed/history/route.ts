import { NextResponse, type NextRequest } from "next/server";
import { getHistorySignals } from "@/lib/feed";
import { historyView } from "@/lib/mcp/views";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

/** 阅读历史信号：各话题推送 / 打开、最近打开、昨天与连续天数 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日期格式不合法" }, { status: 400 });
  const raw = Number(request.nextUrl.searchParams.get("days") ?? 14);
  const windowDays = Number.isInteger(raw) ? Math.min(60, Math.max(1, raw)) : 14;
  const signals = await getHistorySignals(userId, { date, windowDays });
  return NextResponse.json(historyView(signals), { headers: { "Cache-Control": "private, no-store" } });
}
