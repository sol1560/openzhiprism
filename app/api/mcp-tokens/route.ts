import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getSessionUserId } from "@/lib/session";
import { issueCredential, revokeCredential } from "@/lib/security/credentials";
import { rejectCrossOrigin } from "@/lib/security/origin";
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  const tokens = await (await db()).select({ id: schema.authCredentials.tokenHash, label: schema.authCredentials.label,
    createdAt: schema.authCredentials.createdAt, expiresAt: schema.authCredentials.expiresAt }).from(schema.authCredentials)
    .where(and(eq(schema.authCredentials.userId, userId), eq(schema.authCredentials.kind, "mcp"),
      isNull(schema.authCredentials.revokedAt), gt(schema.authCredentials.expiresAt, Date.now())));
  return Response.json({ tokens }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  const parsed = z.object({ label: z.string().trim().min(1).max(80) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
  try {
    return Response.json(await issueCredential(userId, "mcp", parsed.data.label), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "无法创建令牌；最多保留 5 个有效令牌，请先撤销旧令牌。" }, { status: 409 }); }
}
export async function DELETE(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });
  const parsed = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
  await revokeCredential(parsed.data.id, userId, "mcp");
  return Response.json({ ok: true });
}
