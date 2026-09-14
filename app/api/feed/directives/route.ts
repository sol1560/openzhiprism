import { NextResponse } from "next/server";
import { z } from "zod";
import { listDirectives, removeDirective } from "@/lib/feed";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { getSessionUserId } from "@/lib/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** 用户记下的长期要求 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ directives: await listDirectives(userId) }, { headers: NO_STORE });
}

const bodySchema = z.object({ id: z.string().min(1).max(64) });

export async function DELETE(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  await removeDirective(userId, parsed.data.id);
  return NextResponse.json({ directives: await listDirectives(userId) }, { headers: NO_STORE });
}
