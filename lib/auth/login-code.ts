import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@/db";
import { digest, secret } from "@/lib/security/credentials";
import { claimGate } from "@/lib/security/gate";
import { writeTransaction } from "@/lib/security/transaction";
export const LOGIN_CODE_COOKIE = "zp_email_login";
export const LOGIN_CODE_TTL_MS = 600000;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 5;
const RESEND_INTERVAL_MS = 60000;
export class LoginError extends Error {
  constructor(readonly code: "invalid_email" | "rate_limited", readonly status: number, message: string) { super(message); }
}
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
function codeHash(id: string, code: string) { return digest(`${id}:${code}`); }
/** 生成一次性验证码。同一邮箱 60 秒一次、每小时最多 5 次；新码使旧码失效。返回明文码仅用于发信。 */
export async function createLoginCode(rawEmail: string, database?: Db, now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new LoginError("invalid_email", 400, "邮箱格式不正确");
  const databaseInstance = database ?? await db();
  return writeTransaction(databaseInstance, async (tx) => {
    const perEmail = await claimGate(tx, `email_send:${digest(email)}`, RESEND_INTERVAL_MS, now);
    const global = perEmail && await claimGate(tx, "email_send:global", 1000, now);
    if (!perEmail || !global) throw new LoginError("rate_limited", 429, "发送太频繁，请稍后再试");
    const [recent] = await tx.select({ value: count() }).from(schema.loginCodes)
      .where(and(eq(schema.loginCodes.email, email), gt(schema.loginCodes.createdAt, now - 3600000)));
    if ((recent?.value ?? 0) >= MAX_PER_HOUR) throw new LoginError("rate_limited", 429, "一小时内发送次数过多，请稍后再试");
    await tx.update(schema.loginCodes).set({ consumedAt: now }).where(and(eq(schema.loginCodes.email, email), isNull(schema.loginCodes.consumedAt)));
    await tx.delete(schema.loginCodes).where(lt(schema.loginCodes.createdAt, now - 86400000));
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const browser = secret();
    const expiresAt = now + LOGIN_CODE_TTL_MS;
    await tx.insert(schema.loginCodes).values({ id, email, codeHash: codeHash(id, code), browserHash: digest(browser), createdAt: now, expiresAt });
    return { id, code, email, cookie: `${id}.${browser}`, expiresAt };
  });
}
export type ConsumeResult =
  | { status: "ok"; email: string }
  | { status: "invalid"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "locked" };
/** 校验验证码。过期、Cookie 不匹配、已使用一律返回 expired，不区分原因。 */
export async function consumeLoginCode(cookieValue: string | undefined, code: string, database?: Db, now = Date.now()): Promise<ConsumeResult> {
  const [id, browser] = (cookieValue ?? "").split(".");
  if (!/^[0-9a-f-]{36}$/.test(id ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(browser ?? "") || !/^\d{6}$/.test(code)) return { status: "expired" };
  const databaseInstance = database ?? await db();
  return writeTransaction(databaseInstance, async (tx) => {
    const [row] = await tx.select().from(schema.loginCodes).where(and(
      eq(schema.loginCodes.id, id), eq(schema.loginCodes.browserHash, digest(browser)),
      isNull(schema.loginCodes.consumedAt), gt(schema.loginCodes.expiresAt, now),
    ));
    if (!row) return { status: "expired" };
    if (row.attempts >= MAX_ATTEMPTS) return { status: "locked" };
    const expected = Buffer.from(row.codeHash, "hex"), actual = Buffer.from(codeHash(id, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = row.attempts + 1;
      await tx.update(schema.loginCodes).set({ attempts }).where(eq(schema.loginCodes.id, id));
      return attempts >= MAX_ATTEMPTS ? { status: "locked" } : { status: "invalid", attemptsLeft: MAX_ATTEMPTS - attempts };
    }
    await tx.update(schema.loginCodes).set({ consumedAt: now }).where(eq(schema.loginCodes.id, id));
    return { status: "ok", email: row.email };
  });
}
