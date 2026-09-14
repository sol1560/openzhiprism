import { captureAuth, captureError, CaptureHttpError, captureJson, captureOptions, continueCapture, readCaptureBody } from "@/lib/extension/http";
import { createCapture, getCapture } from "@/lib/extension/service";
import { validateCapture } from "@/lib/extension/validation";
export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = captureOptions;
export async function POST(request: Request) {
  try {
    const auth = await captureAuth(request);
    const raw = await readCaptureBody(request);
    let payload;
    try { payload = validateCapture(raw); } catch { throw new CaptureHttpError(400, "捕捉数据不完整，请刷新聊天页后重试。"); }
    const id = await createCapture(auth.userId, auth.grantId, payload);
    const capture = await getCapture(auth.userId, id);
    continueCapture(auth.userId, id);
    return captureJson({ id, alreadyImported: capture?.status === "ready", capture }, capture?.status === "ready" ? 200 : 202);
  } catch (error) { return captureError(error); }
}
