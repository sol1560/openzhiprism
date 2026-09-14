import { captureAuth, captureError, CaptureHttpError, captureJson, captureOptions, continueCapture } from "@/lib/extension/http";
import { getCapture } from "@/lib/extension/service";
export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = captureOptions;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await captureAuth(request), { id } = await context.params;
    const capture = await getCapture(auth.userId, id);
    if (!capture) throw new CaptureHttpError(404, "没有找到这次捕捉。");
    continueCapture(auth.userId, id);
    return captureJson(capture);
  } catch (error) { return captureError(error); }
}
