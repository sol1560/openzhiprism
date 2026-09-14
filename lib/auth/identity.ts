import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { writeTransaction } from "@/lib/security/transaction";
export type IdentityProvider = "email" | "google" | "zhihu";
export interface Identity {
  provider: IdentityProvider;
  /** 身份提供方的稳定标识：Google 的 sub、邮箱登录的邮箱本身 */
  subject: string;
  /** 已验证的邮箱；未验证时为 null，绝不用于合并账户 */
  email: string | null;
  displayName: string;
  avatarUrl?: string | null;
}
const ID_PREFIX: Record<IdentityProvider, string> = { email: "u", google: "g", zhihu: "zh" };
/**
 * 把外部身份落到用户：(provider, subject) 命中则复用；否则已验证邮箱命中现有用户则绑定；否则新建。
 * 返回用户 ID。名字和头像只从提供方同步（邮箱登录没有可信名字，保持用户现有名字）。
 */
export async function persistIdentity(identity: Identity, database?: Db, now = Date.now()): Promise<string> {
  const databaseInstance = database ?? await db();
  const email = identity.email?.trim().toLowerCase() || null;
  return writeTransaction(databaseInstance, async (tx) => {
    const [existing] = await tx.select().from(schema.oauthIdentities)
      .where(and(eq(schema.oauthIdentities.provider, identity.provider), eq(schema.oauthIdentities.subject, identity.subject)));
    if (existing) {
      if (identity.provider !== "email") {
        await tx.update(schema.users).set({ displayName: identity.displayName, avatarUrl: identity.avatarUrl ?? null }).where(eq(schema.users.id, existing.userId));
      }
      await backfillEmail(tx, existing.userId, email);
      return existing.userId;
    }
    let userId: string | undefined;
    if (email) {
      const [owner] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
      userId = owner?.id;
    }
    if (!userId) {
      userId = `${ID_PREFIX[identity.provider]}_${randomUUID()}`;
      await tx.insert(schema.users).values({ id: userId, displayName: identity.displayName, avatarUrl: identity.avatarUrl ?? null, email, loginSource: identity.provider });
    }
    await tx.insert(schema.oauthIdentities).values({ provider: identity.provider, subject: identity.subject, userId, email, createdAt: now });
    return userId;
  });
}
type Tx = Parameters<Parameters<typeof writeTransaction>[1]>[0];
async function backfillEmail(tx: Tx, userId: string, email: string | null) {
  if (!email) return;
  const [user] = await tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.email) return;
  const [taken] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (taken) return;
  await tx.update(schema.users).set({ email }).where(eq(schema.users.id, userId));
}
