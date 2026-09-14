import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrBuildDailyBrief } from "@/lib/feed";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

const NO_STORE = { "Cache-Control": "private, no-store" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 首次生成会调一次 LLM（3-8 秒）
export const maxDuration = 60;

async function respond(userId: string, date: string, force: boolean) {
  const brief = await getOrBuildDailyBrief(userId, date, { force });
  if (!brief) return NextResponse.json({ error: "该日期还没有 Feed" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(brief, { headers: NO_STORE });
}

/** 读取（懒生成）某天的简报 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? todayKey();
  if (!DATE.test(date)) return NextResponse.json({ error: "日期格式不合法" }, { status: 400 });
  return respond(userId, date, false);
}

const bodySchema = z.object({ force: z.boolean().default(true), date: z.string().regex(DATE).optional() });

/** 重新生成简报（换个说法） */
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  return respond(userId, parsed.data.date ?? todayKey(), parsed.data.force);
}
