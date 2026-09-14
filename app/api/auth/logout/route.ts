import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  await clearSession();
  return NextResponse.json({ ok: true });
}
