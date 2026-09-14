import { NextResponse } from "next/server";
import { env, ELEVENLABS_BASE_URL } from "@/lib/env";
import { getBuildStatus, getFeed, getOrBuildDailyBrief } from "@/lib/feed";
import { getProfile } from "@/lib/profile/store";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { getSessionUser } from "@/lib/session";
import { buildDynamicVariables } from "@/lib/voice/dynamic";
import { todayKey } from "@/lib/zhihu/text";

const NO_STORE = { "Cache-Control": "private, no-store" };
/** signed URL 有效 15 分钟，会话必须在此之前发起 */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
// 首次会话可能要顺带生成简报（一次 LLM 调用）
export const maxDuration = 60;

/**
 * 为当前登录用户换取一次性的 ElevenLabs signed URL，并在服务端算好首句需要的动态变量。
 * API key 不出服务端；未配置时 503，前端据此隐藏面板。
 */
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!env.voiceGuideEnabled) return NextResponse.json({ error: "语音向导未配置" }, { status: 503, headers: NO_STORE });

  const date = todayKey();
  const [feed, topics, build, brief] = await Promise.all([
    getFeed(user.id, date),
    getProfile(user.id),
    getBuildStatus(user.id, date),
    getOrBuildDailyBrief(user.id, date).catch(() => null),
  ]);
  const dynamicVariables = buildDynamicVariables({ user: { displayName: user.displayName }, date, feed, topicCount: topics.length, build, brief });

  let signedUrl: string;
  try {
    const url = `${ELEVENLABS_BASE_URL}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.elevenLabsAgentId!)}`;
    const response = await fetch(url, { headers: { "xi-api-key": env.elevenLabsApiKey! }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) {
      console.warn("elevenlabs_signed_url_failed", response.status);
      return NextResponse.json({ error: "语音服务暂时不可用" }, { status: 502, headers: NO_STORE });
    }
    const data = (await response.json()) as { signed_url?: string };
    if (!data.signed_url) throw new Error("missing signed_url");
    signedUrl = data.signed_url;
  } catch (error) {
    console.warn("elevenlabs_signed_url_error", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "语音服务暂时不可用" }, { status: 502, headers: NO_STORE });
  }

  return NextResponse.json({ signedUrl, dynamicVariables, expiresAt: Date.now() + SIGNED_URL_TTL_MS }, { headers: NO_STORE });
}
