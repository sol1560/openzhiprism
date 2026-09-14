import { z } from "zod";
import { getContentFeedback, setContentFeedback } from "@/lib/cognition/feedback";
import { CognitionError, feedbackSchema } from "@/lib/cognition/types";
import { cognitionFailure, cognitionUser, PRIVATE_HEADERS } from "@/lib/cognition/http";
const body = z.object({ contentId: z.string().min(1).max(200), kind: feedbackSchema.nullable() });
export async function GET() {
  try { return Response.json(await getContentFeedback(await cognitionUser()), { headers: PRIVATE_HEADERS }); }
  catch (error) { return cognitionFailure(error); }
}
export async function POST(request: Request) {
  try { const user = await cognitionUser(request, "feedback"); const input = body.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new CognitionError("反馈格式不正确");
    return Response.json(await setContentFeedback(user, input.data.contentId, input.data.kind), { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
