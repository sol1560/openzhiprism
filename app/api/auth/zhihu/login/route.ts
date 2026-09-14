import { env } from "@/lib/env";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loginDemo, loginSelf, loginWithToken, type LoginMode } from "@/lib/auth/zhihu";
import { setSessionUserId } from "@/lib/session";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("demo"), personaId: z.string().min(1) }),
  z.object({ mode: z.literal("self") }),
  z.object({ mode: z.literal("token"), urlToken: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法", issues: parsed.error.issues }, { status: 400 });
  }
  if (env.publicMode) return NextResponse.json({ error: "请使用正式知乎 OAuth 登录" }, { status: 403 });
  const body = parsed.data;
  try {
    const mode: LoginMode = body.mode;
    let result;
    switch (mode) {
      case "demo":
        result = await loginDemo((body as { personaId: string }).personaId);
        break;
      case "self":
        result = await loginSelf();
        break;
      case "token":
        result = await loginWithToken((body as { urlToken: string }).urlToken);
        break;
      default: {
        const exhaustive: never = mode;
        return exhaustive;
      }
    }
    await setSessionUserId(result.user.id);
    return NextResponse.json({
      user: result.user,
      topicsCreated: result.topicsCreated,
      coldStart: result.coldStart
        ? {
            provider: result.coldStart.graph.provider,
            followees: result.coldStart.graph.followees.slice(0, 12),
            topics: result.coldStart.graph.topics.slice(0, 12),
            interests: result.coldStart.interests.topics,
            llm: result.coldStart.llm,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
