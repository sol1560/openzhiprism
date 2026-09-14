import { z } from "zod";
import { db } from "@/db";
import { env } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { loginReadiness } from "@/lib/auth/readiness";
import { createPangramClient } from "@/lib/ai-detection/pangram";
import { createDetectionService, DetectionError } from "@/lib/ai-detection/service";
export const runtime = "nodejs";
const bodySchema = z.object({ contentId: z.string().min(1).max(200) }).strict();
async function handle(request: Request, submit: boolean) {
  if (submit) { const denied = rejectCrossOrigin(request); if (denied) return denied; }
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  let raw: unknown;
  if (submit) {
    const text = await request.text();
    if (text.length > 1024) return Response.json({ error: "参数过长" }, { status: 400 });
    try { raw = JSON.parse(text); } catch { raw = null; }
  } else { raw = { contentId: new URL(request.url).searchParams.get("contentId") }; }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
  try {
    const service = createDetectionService(await db(), createPangramClient(env.pangramApiKey ?? ""), {
      ...env.detectionLimits, enabled: env.detectionEnabled, configured: Boolean(env.pangramApiKey), publicReady: loginReadiness().ready,
    });
    const view = await (submit ? service.start(userId, parsed.data.contentId) : service.get(userId, parsed.data.contentId));
    return Response.json(view, { status: view.status === "pending" ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DetectionError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "60" } : {} });
    return Response.json({ error: "检测暂不可用，请稍后查看已有任务。" }, { status: 503 });
  }
}
export function POST(request: Request) { return handle(request, true); }
export function GET(request: Request) { return handle(request, false); }
