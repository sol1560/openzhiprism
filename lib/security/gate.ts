import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { WriteTx } from "./transaction";
/** 跨进程共享的冷却门：同一 key 在 intervalMs 内只允许通过一次。必须在写事务内调用。 */
export async function claimGate(tx: WriteTx, key: string, intervalMs: number, now = Date.now()): Promise<boolean> {
  const [gate] = await tx.select().from(schema.requestGates).where(eq(schema.requestGates.key, key));
  if (gate && gate.nextAt > now) return false;
  await tx.insert(schema.requestGates).values({ key, nextAt: now + intervalMs })
    .onConflictDoUpdate({ target: schema.requestGates.key, set: { nextAt: now + intervalMs } });
  return true;
}
