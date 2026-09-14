import type { NextRequest } from "next/server";
import { discussSchema, discussTopic, getInquiry } from "@/lib/cognition/inquiries";
import { cognitionFailure, cognitionUser, PRIVATE_HEADERS } from "@/lib/cognition/http";
import { CognitionError } from "@/lib/cognition/types";
export const maxDuration = 90;
export async function GET(request: NextRequest) {
  try { const user = await cognitionUser(); const id = request.nextUrl.searchParams.get("id"); if (!id) throw new CognitionError("缺少思辨标识");
    return Response.json(await getInquiry(user, id), { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
export async function POST(request: Request) {
  try { const user = await cognitionUser(request, "inquiry"); const input = discussSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new CognitionError("思辨参数不完整，请刷新后重试");
    return Response.json(await discussTopic(user, input.data), { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
