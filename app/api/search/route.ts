import { NextResponse, type NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { searchZhihu } from "@/lib/zhihu/provider";
import { truncate } from "@/lib/zhihu/text";

export const maxDuration = 30;

/** 语音向导的临时搜索：最多 5 条；provider 层已按检索词缓存 24 小时并守卫官方额度 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 2 || query.length > 40) return NextResponse.json({ error: "检索词需要 2-40 个字" }, { status: 400 });
  try {
    const result = await searchZhihu(query, { count: 5 });
    return NextResponse.json({
      query,
      provider: result.provider,
      fromCache: result.fromCache,
      items: result.items.slice(0, 5).map((item) => ({ id: item.id, title: item.title, url: item.url, voteUp: item.voteUp, excerpt: truncate(item.excerpt, 120) })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
