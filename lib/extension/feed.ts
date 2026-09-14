import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { startFeedBuild, type StartBuildResult } from "@/lib/feed/jobs";
import { writeTransaction } from "@/lib/security/transaction";

type Starter = (userId: string, options: { force: boolean }) => Promise<StartBuildResult>;
/** A revision is acknowledged only by a build started after its profile commit. */
export async function refreshCapturedFeed(userId: string, deps: { database?: Db; start?: Starter; now?: () => number } = {}) {
  const database = deps.database ?? await db(), start = deps.start ?? startFeedBuild, now = deps.now ?? Date.now;
  const token = randomUUID();
  const claim = await writeTransaction(database, async (tx) => {
    const [row] = await tx.select().from(schema.captureFeedRefreshes).where(eq(schema.captureFeedRefreshes.userId, userId));
    if (!row || ["ready", "error"].includes(row.status) || (row.token && (row.leaseExpiresAt ?? 0) > now())) return null;
    await tx.update(schema.captureFeedRefreshes).set({ token, status: "running", leaseExpiresAt: now() + 240_000 }).where(eq(schema.captureFeedRefreshes.userId, userId));
    return row;
  });
  if (!claim) return;
  const owned = and(eq(schema.captureFeedRefreshes.userId, userId), eq(schema.captureFeedRefreshes.token, token));
  try {
    let built = await start(userId, { force: true });
    if (!built.started) {
      await built.promise.catch(() => undefined);
      built = await start(userId, { force: true });
    }
    await built.promise;
    await writeTransaction(database, async (tx) => {
      const [current] = await tx.select().from(schema.captureFeedRefreshes).where(owned);
      if (!current) return;
      await tx.update(schema.captureFeedRefreshes).set({ status: built.started && current.revision === claim.revision ? "ready" : "pending", token: null, leaseExpiresAt: null }).where(owned);
    });
  } catch {
    await database.update(schema.captureFeedRefreshes).set({ status: "error", token: null, leaseExpiresAt: null }).where(owned);
  }
}
