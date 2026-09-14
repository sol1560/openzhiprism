import { NextResponse } from "next/server";
import { describeLlm } from "@/lib/llm/client";
import { getSourceStatus, getUsageToday } from "@/lib/zhihu";

export const dynamic = "force-dynamic";

export async function GET() {
  const [source, usage] = await Promise.all([getSourceStatus(), getUsageToday()]);
  return NextResponse.json({ source, llm: describeLlm(), usage });
}
