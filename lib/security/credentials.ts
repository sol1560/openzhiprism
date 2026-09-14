import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { env } from "@/lib/env";
import { writeTransaction } from "./transaction";
export type CredentialKind = "session" | "mcp";
const DAY = 86400000;
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function secret() { return randomBytes(32).toString("base64url"); }
export async function issueCredential(userId: string, kind: CredentialKind, label = "", database?: Db, now = Date.now()) {
  const databaseInstance = database ?? await db();
  const token = `zp_${kind === "session" ? "s" : "m"}_${secret()}`;
  const expiresAt = now + (kind === "session" ? 30 : 90) * DAY;
  await writeTransaction(databaseInstance, async (tx) => {
    if (kind === "mcp") {
      const active = await tx.select({ hash: schema.authCredentials.tokenHash }).from(schema.authCredentials).where(and(
        eq(schema.authCredentials.userId, userId), eq(schema.authCredentials.kind, "mcp"),
        isNull(schema.authCredentials.revokedAt), gt(schema.authCredentials.expiresAt, now),
      ));
      if (active.length >= 5) throw new Error("Too many active tokens");
    }
    await tx.insert(schema.authCredentials).values({ tokenHash: digest(token), userId, kind, label: label.slice(0, 80), createdAt: now, expiresAt });
  });
  return { token, expiresAt, id: digest(token) };
}
export async function resolveCredential(token: string | undefined, kind: CredentialKind, database?: Db, now = Date.now()): Promise<string | null> {
  if (!token || !new RegExp(`^zp_${kind === "session" ? "s" : "m"}_[A-Za-z0-9_-]{43}$`).test(token)) return null;
  const databaseInstance = database ?? await db();
  const [row] = await databaseInstance.select().from(schema.authCredentials).where(and(
    eq(schema.authCredentials.tokenHash, digest(token)), eq(schema.authCredentials.kind, kind),
    isNull(schema.authCredentials.revokedAt), gt(schema.authCredentials.expiresAt, now),
  ));
  if (!row) return null;
  const [user] = await databaseInstance.select().from(schema.users).where(eq(schema.users.id, row.userId));
  if (!user) return null;
  if (env.publicMode) {
    const [identity] = await databaseInstance.select().from(schema.oauthIdentities).where(eq(schema.oauthIdentities.userId, row.userId));
    if (!identity) return null;
  }
  return row.userId;
}
export async function revokeCredential(tokenHash: string, userId: string, kind: CredentialKind, database?: Db) {
  const databaseInstance = database ?? await db();
  await writeTransaction(databaseInstance, async (tx) => {
    await tx.update(schema.authCredentials).set({ revokedAt: Date.now() }).where(and(
      eq(schema.authCredentials.tokenHash, tokenHash), eq(schema.authCredentials.userId, userId), eq(schema.authCredentials.kind, kind),
    ));
  });
}
