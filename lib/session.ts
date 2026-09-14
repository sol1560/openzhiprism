import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@/db/schema";
import { env } from "@/lib/env";
import { getUser } from "@/lib/profile/store";
import { digest, issueCredential, resolveCredential, revokeCredential } from "@/lib/security/credentials";
export const SESSION_COOKIE = "zp_session";
export async function getSessionUserId(): Promise<string | null> {
  return resolveCredential((await cookies()).get(SESSION_COOKIE)?.value, "session");
}
export async function getSessionUser(): Promise<User | null> {
  const userId = await getSessionUserId();
  return userId ? getUser(userId) : null;
}
export async function setSessionUserId(userId: string) {
  await clearSession();
  const { token, expiresAt } = await issueCredential(userId, "session");
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: env.secureCookies, sameSite: "lax", path: "/", expires: new Date(expiresAt),
  });
}
export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const userId = await resolveCredential(token, "session");
  if (token && userId) await revokeCredential(digest(token), userId, "session");
  store.delete(SESSION_COOKIE);
  store.delete("zp_uid");
}
export function newUserId(prefix = "u"): string { return `${prefix}_${randomUUID()}`; }
