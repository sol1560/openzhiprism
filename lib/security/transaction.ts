import type { Db } from "@/db";
export type WriteTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// The local libSQL native binding can leave a busy BEGIN statement active when
// two client handles write concurrently in one process. Serialize write sections
// across handles; the database transaction remains the cross-process authority.
let queue: Promise<unknown> = Promise.resolve();
/** SQLite write transactions serialize the durable guards across workers too. */
export function writeTransaction<T>(database: Db, fn: (tx: WriteTx) => Promise<T>): Promise<T> {
  const previous = queue;
  const next = previous.catch(() => undefined).then(async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await database.transaction(fn); }
      catch (error) {
        if (attempt >= 4 || !String(error).includes("SQLITE_BUSY")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  });
  queue = next;
  return next;
}
