import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { BUILD_POLL_MS, getFeed, startFeedBuild } from "@/lib/feed";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

const NO_STORE = { "Cache-Control": "private, no-store" };

// after() 里的后台 Feed 构建只在路由的 maxDuration 内运行；首次生成 20-40 秒
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? todayKey();
  return NextResponse.json(await getFeed(userId, date), { headers: NO_STORE });
}

const bodySchema = z.object({
  force: z.boolean().default(false),
  mainCount: z.number().int().min(4).max(24).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * 发起当日 feed 的后台构建（或复用正在跑的那次），立即返回 202 + 状态行。
 * 前端轮询 GET /api/feed/status 拿真实进度；构建耗时约 10-40s，取决于缓存命中。
 */
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  try {
    const { build, promise, started } = await startFeedBuild(userId, parsed.data);
    after(() => promise.catch(() => undefined));
    return NextResponse.json({ build, started, retryAfterMs: BUILD_POLL_MS }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
