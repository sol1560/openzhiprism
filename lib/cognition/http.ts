import { db } from "@/db";
import { getSessionUserId } from "@/lib/session";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { claimGate } from "@/lib/security/gate";
import { writeTransaction } from "@/lib/security/transaction";
import { CognitionError, cognitionEnabled } from "./types";
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
export async function cognitionUser(request?: Request, operation?: string) {
  if (!cognitionEnabled()) throw new CognitionError("证据与判断功能暂未开放", 503);
  const userId = await getSessionUserId();
  if (!userId) throw new CognitionError("请先登录", 401);
  if (request && operation) {
    if (rejectCrossOrigin(request)) throw new CognitionError("请求来源不匹配", 403);
    await cognitionGate(userId, operation);
  }
  return userId;
}
export async function cognitionGate(userId: string, operation: string) {
  if (!cognitionEnabled()) throw new CognitionError("证据与判断功能暂未开放", 503);
  const d = await db();
  const allowed = await writeTransaction(d, (tx) => claimGate(tx, `cognition:${operation}:${userId}`, operation === "feedback" ? 400 : 1500));
  if (!allowed) throw new CognitionError("上一条操作还在处理，请稍后再试", 429);
}
export function cognitionFailure(error: unknown) {
  return Response.json({ error: error instanceof CognitionError ? error.message : "暂时无法处理，请稍后重试" }, { status: error instanceof CognitionError ? error.status : 500, headers: PRIVATE_HEADERS });
}
