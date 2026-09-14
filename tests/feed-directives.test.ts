import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { addRuleDirective, addTopicDirective, clearCardOverride, listDirectives, MAX_DIRECTIVES, removeDirective, setCardOverride } from "@/lib/feed/directives";
import { getFeed } from "@/lib/feed/build";
import { seedContent, seedEmailUser, testDatabase } from "./helpers/database";

describe("feed directives", () => {
  let env: Awaited<ReturnType<typeof testDatabase>>;
  beforeEach(async () => {
    env = await testDatabase();
    await seedEmailUser(env.database, "u1", "u1@example.com");
    await seedEmailUser(env.database, "u2", "u2@example.com");
  });
  afterEach(async () => { await env.close(); });

  it("keeps one direction per topic and dedupes identical rules", async () => {
    await addTopicDirective("u1", { topic: "考研 vs 就业", direction: "less", sourceText: "少推考研" }, env.database);
    const latest = await addTopicDirective("u1", { topic: "考研 vs 就业", direction: "mute", sourceText: "别推了" }, env.database);
    expect(latest.text).toBe("不再推 · 考研 vs 就业");
    const first = await addRuleDirective("u1", { text: "摘要都用要点", sourceText: "摘要都用要点" }, env.database);
    const again = await addRuleDirective("u1", { text: " 摘要都用要点 ", sourceText: "再说一遍" }, env.database);
    expect(again.id).toBe(first.id);
    const list = await listDirectives("u1", env.database);
    expect(list.map((directive) => [directive.kind, directive.direction, directive.text])).toEqual([["topic", "mute", "不再推 · 考研 vs 就业"], ["rule", null, "摘要都用要点"]]);
    await removeDirective("u2", first.id, env.database);
    expect(await listDirectives("u1", env.database)).toHaveLength(2);
    await removeDirective("u1", first.id, env.database);
    expect(await listDirectives("u1", env.database)).toHaveLength(1);
  });

  it("refuses more than the cap", async () => {
    for (let i = 0; i < MAX_DIRECTIVES; i += 1) await addRuleDirective("u1", { text: `规则 ${i}`, sourceText: "" }, env.database);
    await expect(addRuleDirective("u1", { text: "再来一条", sourceText: "" }, env.database)).rejects.toThrow(/最多记住/);
    expect(await listDirectives("u1", env.database)).toHaveLength(MAX_DIRECTIVES);
  });

  it("overrides a card summary only for its owner and can revert", async () => {
    await seedContent(env.database, "u1", "answer:1");
    await seedContent(env.database, "u2", "answer:1");
    await setCardOverride("u2", "u1-answer:1", { summary: "别人的改写", note: "x" }, env.database);
    await setCardOverride("u1", "u1-answer:1", { summary: "· 第一点\n· 第二点", note: "改成要点" }, env.database);
    const feed = await getFeed("u1", "2026-09-09", env.database);
    expect(feed.cards[0].content?.summary).toBe("· 第一点\n· 第二点");
    expect(feed.cards[0].override).toEqual({ note: "改成要点", originalSummary: "这是 AI 生成的摘要，绝不能送检" });
    const other = await getFeed("u2", "2026-09-09", env.database);
    expect(other.cards[0].override).toBeNull();
    const [shared] = await env.database.select().from(schema.contentCache).where(eq(schema.contentCache.contentId, "answer:1"));
    expect(shared.summary).toBe("这是 AI 生成的摘要，绝不能送检");
    await clearCardOverride("u1", "u1-answer:1", env.database);
    const reverted = await getFeed("u1", "2026-09-09", env.database);
    expect(reverted.cards[0].override).toBeNull();
    expect(reverted.cards[0].content?.summary).toBe("这是 AI 生成的摘要，绝不能送检");
  });
});
