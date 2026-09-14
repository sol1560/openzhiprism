import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse } from "next/server";
import { clearProfile } from "@/lib/profile/store";
import { getSessionUserId } from "@/lib/session";

/** 清空当前用户的画像、对话、feed 与已读记录（demo 重来用） */
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  await clearProfile(userId);
  return NextResponse.json({ ok: true });
}
