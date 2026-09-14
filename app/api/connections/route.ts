import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { listConnections, revokeConnection, setConnectionAutoIngest } from "@/lib/connectors/oauth";
export const runtime = "nodejs";
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  return Response.json({ connections: await listConnections(userId) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid(), autoIngest: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请求不合法" }, { status: 400 });
  const updated = await setConnectionAutoIngest(parsed.data.id, userId, parsed.data.autoIngest);
  if (!updated) return Response.json({ error: "连接不存在或已失效" }, { status: 404 });
  return Response.json({ ok: true, autoIngest: parsed.data.autoIngest }, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请求不合法" }, { status: 400 });
  await revokeConnection(parsed.data.id, userId);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
