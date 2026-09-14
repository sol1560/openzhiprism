import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { postLoginDestination } from "@/lib/auth/destination";
import { sendLoginCode } from "@/lib/auth/email";
import { parseGoogleClaims } from "@/lib/auth/google";
import { persistIdentity } from "@/lib/auth/identity";
import { consumeLoginCode, createLoginCode, LoginError } from "@/lib/auth/login-code";
import { issueCredential, resolveCredential } from "@/lib/security/credentials";
import { seedEmailUser, testDatabase } from "./helpers/database";
let store: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => { store = await testDatabase(); });
afterEach(async () => { vi.unstubAllEnvs(); await store.close(); });
const T0 = 1_800_000_000_000;
describe("email login codes", () => {
  it("issues hashed one-time codes bound to the requesting browser", async () => {
    const issued = await createLoginCode("  Person@Example.COM ", store.database, T0);
    expect(issued.email).toBe("person@example.com");
    expect(JSON.stringify(await store.database.select().from(schema.loginCodes))).not.toContain(issued.code);
    expect(await consumeLoginCode(issued.cookie, issued.code, store.database, T0 + 1000)).toEqual({ status: "ok", email: "person@example.com" });
    expect(await consumeLoginCode(issued.cookie, issued.code, store.database, T0 + 2000)).toEqual({ status: "expired" });
  });
  it("locks after five wrong attempts and does not distinguish expiry from cookie mismatch", async () => {
    const issued = await createLoginCode("a@b.co", store.database, T0);
    const wrong = issued.code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await consumeLoginCode(issued.cookie, wrong, store.database, T0)).toEqual({ status: "invalid", attemptsLeft: 5 - attempt });
    }
    expect(await consumeLoginCode(issued.cookie, wrong, store.database, T0)).toEqual({ status: "locked" });
    expect(await consumeLoginCode(issued.cookie, issued.code, store.database, T0)).toEqual({ status: "locked" });
    const fresh = await createLoginCode("c@d.co", store.database, T0 + 61000);
    expect(await consumeLoginCode(fresh.cookie, fresh.code, store.database, T0 + 61000 + 600001)).toEqual({ status: "expired" });
    const [id] = fresh.cookie.split(".");
    expect(await consumeLoginCode(`${id}.${"x".repeat(43)}`, fresh.code, store.database, T0 + 61000)).toEqual({ status: "expired" });
  });
  it("rate limits sends and invalidates earlier codes", async () => {
    const first = await createLoginCode("a@b.co", store.database, T0);
    await expect(createLoginCode("a@b.co", store.database, T0 + 1000)).rejects.toBeInstanceOf(LoginError);
    const second = await createLoginCode("a@b.co", store.database, T0 + 61000);
    expect(await consumeLoginCode(first.cookie, first.code, store.database, T0 + 62000)).toEqual({ status: "expired" });
    expect(await consumeLoginCode(second.cookie, second.code, store.database, T0 + 62000)).toEqual({ status: "ok", email: "a@b.co" });
    for (let i = 2; i < 5; i++) await createLoginCode("a@b.co", store.database, T0 + i * 61000);
    await expect(createLoginCode("a@b.co", store.database, T0 + 5 * 61000)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    await expect(createLoginCode("not-an-email", store.database, T0 + 9 * 61000)).rejects.toMatchObject({ code: "invalid_email" });
  });
  it("prints the code locally and refuses to run unsent in public mode", async () => {
    const logger = vi.fn();
    await sendLoginCode("a@b.co", "123456", logger);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("login code"), "a@b.co", "123456");
    vi.stubEnv("APP_PUBLIC_MODE", "true");
    await expect(sendLoginCode("a@b.co", "123456", logger)).rejects.toThrow("邮件服务未配置");
  });
});
describe("identities", () => {
  it("keys accounts by provider + subject and merges verified emails", async () => {
    const google = { provider: "google" as const, subject: "g-1", email: "me@example.com", displayName: "Me", avatarUrl: "https://lh3.example/p.png" };
    const first = await persistIdentity(google, store.database, T0);
    expect(await persistIdentity({ ...google, displayName: "Renamed" }, store.database, T0)).toBe(first);
    const [user] = await store.database.select().from(schema.users).where(eq(schema.users.id, first));
    expect(user.displayName).toBe("Renamed"); expect(user.email).toBe("me@example.com"); expect(user.loginSource).toBe("google");
    expect(await persistIdentity({ provider: "email", subject: "g-1", email: null, displayName: "x" }, store.database, T0)).not.toBe(first);
    expect(await persistIdentity({ provider: "email", subject: "me@example.com", email: "me@example.com", displayName: "me" }, store.database, T0)).toBe(first);
    expect(await store.database.select().from(schema.oauthIdentities).where(eq(schema.oauthIdentities.userId, first))).toHaveLength(2);
    expect(await persistIdentity({ provider: "google", subject: "g-2", email: null, displayName: "Anon" }, store.database, T0)).not.toBe(first);
  });
  it("only trusts verified Google emails and requires a subject", () => {
    expect(parseGoogleClaims({ sub: "1", email: "A@B.co", email_verified: true, name: "N", picture: "https://x/y.png" })).toMatchObject({ provider: "google", subject: "1", email: "a@b.co", displayName: "N" });
    expect(parseGoogleClaims({ sub: "1", email: "a@b.co", email_verified: false }).email).toBeNull();
    expect(parseGoogleClaims({ sub: "1" }).displayName).toBe("Google 用户");
    expect(() => parseGoogleClaims({ email: "a@b.co" })).toThrow();
  });
  it("routes new users to onboarding and returning users to the feed", async () => {
    await seedEmailUser(store.database, "u1", "a@b.co");
    expect(await postLoginDestination("u1", store.database)).toBe("/onboarding");
    await store.database.insert(schema.interestTopics).values({ id: "t1", userId: "u1", name: "考研", weight: 1 });
    expect(await postLoginDestination("u1", store.database)).toBe("/feed");
  });
  it("accepts email-identity sessions in public mode", async () => {
    await seedEmailUser(store.database, "u1", "a@b.co");
    const session = await issueCredential("u1", "session", "", store.database);
    vi.stubEnv("APP_PUBLIC_MODE", "true");
    expect(await resolveCredential(session.token, "session", store.database)).toBe("u1");
  });
});
