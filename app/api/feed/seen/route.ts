import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse } from "next/server";
import { z } from "zod";
import { markSeen } from "@/lib/feed";
import { getSessionUserId } from "@/lib/session";

const bodySchema = z.object({ contentIds: z.array(z.string().min(1)).min(1).max(50) });

export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  await markSeen(userId, parsed.data.contentIds);
  return NextResponse.json({ ok: true });
}
