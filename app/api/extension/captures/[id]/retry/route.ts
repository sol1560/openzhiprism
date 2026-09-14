import { captureAuth, captureError, CaptureHttpError, captureJson, captureOptions, continueCapture } from "@/lib/extension/http";
import { getCapture, retryCapture } from "@/lib/extension/service";
export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = captureOptions;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await captureAuth(request), { id } = await context.params;
    if (!await retryCapture(auth.userId, id, auth.grantId)) throw new CaptureHttpError(404, "没有找到这次捕捉。");
    continueCapture(auth.userId, id);
    return captureJson(await getCapture(auth.userId, id), 202);
  } catch (error) { return captureError(error); }
}
