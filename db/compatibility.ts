import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { writeTransaction } from "@/lib/security/transaction";

/**
 * An early local 0009 draft was applied before the checkpoint column was added.
 * Its timestamp was already recorded, so replaying migrate cannot fix that DB.
 * Current databases are unchanged; explicit outbound migrations also use this.
 */
export async function repairCaptureCheckpoint(database: Db): Promise<boolean> {
  return writeTransaction(database, async (tx) => {
    const columns = await tx.all<{ name: string }>(sql.raw('PRAGMA table_info("capture_jobs")'));
    if (!columns.length || columns.some((column) => column.name === "checkpoint")) return false;
    await tx.run(sql.raw('ALTER TABLE "capture_jobs" ADD COLUMN "checkpoint" text'));
    return true;
  });
}
