import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { askFeed, clearCardOverride, getFeed, ASK_LIMITS } from "@/lib/feed";
import { claimGate } from "@/lib/security/gate";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { writeTransaction } from "@/lib/security/transaction";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

const NO_STORE = { "Cache-Control": "private, no-store" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 一次 LLM 解释，可能再加一次搜索 + 摘要，或对今日卡片的批量改写 */
export const maxDuration = 60;

const askSchema = z.object({
  text: z.string().trim().min(2).max(ASK_LIMITS.text),
  cardId: z.string().min(1).max(64).optional(),
  date: z.string().regex(DATE).optional(),
});

/** 用自然语言对今天的 Feed（或其中一张卡片）提要求 */
export async function POST(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = askSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  const today = todayKey();
  const date = parsed.data.date ?? today;
  if (date < today) return NextResponse.json({ error: "往日 Feed 只读" }, { status: 400 });

  const database = await db();
  const allowed = await writeTransaction(database, (tx) => claimGate(tx, `ask:${userId}`, 2000));
  if (!allowed) return NextResponse.json({ error: "慢一点，一次处理一条要求" }, { status: 429, headers: NO_STORE });

  try {
    const result = await askFeed(userId, { text: parsed.data.text, cardId: parsed.data.cardId, date });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    const status = message.includes("不在今天的 Feed") ? 404 : 500;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}

const revertSchema = z.object({ cardId: z.string().min(1).max(64), date: z.string().regex(DATE).optional() });

/** 撤销某张卡片的改写，恢复共享摘要 */
export async function DELETE(request: Request) {
  const denied = rejectCrossOrigin(request); if (denied) return denied;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = revertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  await clearCardOverride(userId, parsed.data.cardId);
  const feed = await getFeed(userId, parsed.data.date ?? todayKey());
  return NextResponse.json({ cards: feed.cards }, { headers: NO_STORE });
}
