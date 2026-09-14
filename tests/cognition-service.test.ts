import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { startDossier, getDossier, getArtifact } from "@/lib/cognition/dossiers";
import { discussTopic, discussSchema, getInquiry } from "@/lib/cognition/inquiries";
import { getReflections, manageReflection, manageReflectionSchema, reflectionExport } from "@/lib/cognition/reflections";
import { setContentFeedback } from "@/lib/cognition/feedback";
import { readingFollowups } from "@/lib/cognition/followups";
import type { DailyBrief, FeedView } from "@/lib/feed/types";
import type { ReflectionDraft } from "@/lib/cognition/types";
import { seedUser, testDatabase } from "./helpers/database";
import { cognitionSources, cognitionModels } from "./helpers/cognition";

let store: Awaited<ReturnType<typeof testDatabase>>;
beforeEach(async () => { store = await testDatabase(); await seedUser(store.database, "alice"); await seedUser(store.database, "bob"); });
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });
async function build(user = "alice", topic = "考研与就业") {
  const start = await startDossier(user, { topic }, { database: store.database, search: async () => cognitionSources, ...cognitionModels });
  await start.promise; return getDossier(user, start.jobId, undefined, store.database);
}
describe("dossier lifecycle and privacy", () => {
  it("coalesces concurrent requests and retains distinct same-title answers", async () => {
    const search = vi.fn(async () => cognitionSources);
    const extract = vi.fn(cognitionModels.extract!);
    const requests = await Promise.all(Array.from({ length: 6 }, () => startDossier("alice", { topic: "同一个问题" }, { database: store.database, search, ...cognitionModels, extract })));
    await Promise.all(requests.map((r) => r.promise));
    expect(new Set(requests.map((r) => r.jobId)).size).toBe(1); expect(search).toHaveBeenCalledTimes(1); expect(extract).toHaveBeenCalledTimes(1);
    const view = await getDossier("alice", requests[0].jobId, undefined, store.database);
    expect(view.status).toBe("ready"); expect(view.dossier?.sources).toHaveLength(2); expect(view.dossier?.quality).toBe("grounded");
  });
  it("reuses public analysis without sharing private questions or access", async () => {
    const a = await build("alice", "我的私人处境-考研"); const b = await build("bob", "另一位读者的处境-考研");
    expect(a.dossier?.id).toBe(b.dossier?.id);
    expect(JSON.stringify(a.dossier)).not.toContain("私人处境");
    await expect(getDossier("bob", a.jobId, undefined, store.database)).rejects.toMatchObject({ status: 404 });
  });
  it("resumes extraction failures from persisted sources and keeps original source versions", async () => {
    const search = vi.fn(async () => cognitionSources); const extract = vi.fn().mockRejectedValueOnce(new Error("interrupted")).mockImplementation(cognitionModels.extract!);
    const first = await startDossier("alice", { topic: "失败恢复" }, { database: store.database, search, ...cognitionModels, extract }); await first.promise;
    expect((await getDossier("alice", first.jobId, undefined, store.database)).status).toBe("error");
    const retry = await startDossier("alice", { topic: "失败恢复" }, { database: store.database, search, ...cognitionModels, extract }); await retry.promise;
    expect(search).toHaveBeenCalledTimes(1);
    const old = (await getDossier("alice", retry.jobId, undefined, store.database)).dossier!;
    const updated = await startDossier("alice", { topic: "失败恢复", refresh: true }, { database: store.database, search: async () => [{ ...cognitionSources[0], content: cognitionSources[0].content + "出现了新条件。" }], ...cognitionModels }); await updated.promise;
    const current = (await getDossier("alice", updated.jobId, undefined, store.database)).dossier!;
    expect(current.id).not.toBe(old.id);
    expect((await getArtifact("alice", retry.jobId, old.id, store.database)).sources[0].text).toBe(old.sources[0].text);
  });
  it("keeps retrieved materials but refuses analysis when none address the actual question", async () => {
    const extract = vi.fn(cognitionModels.extract!);
    const started = await startDossier("alice", { topic: "主动回忆与反复阅读" }, { database: store.database, search: async () => cognitionSources, ...cognitionModels, extract, relevant: async () => [] });
    await started.promise;
    const view = await getDossier("alice", started.jobId, undefined, store.database);
    expect(view.status).toBe("error"); expect(view.error).toContain("直接相关");
    expect(view.materials).toHaveLength(2); expect(view.dossier).toBeNull(); expect(extract).not.toHaveBeenCalled();
  });
  it("recovers a stale worker lease; unavailable models expose only material", async () => {
    const view = await build();
    await store.database.update(schema.dossierJobs).set({ status: "running", stage: "extract", evidence: [], updatedAt: Date.now() - 400000 }).where(eq(schema.dossierJobs.id, view.jobId));
    const request = await startDossier("alice", { topic: view.topic, refresh: true }, { database: store.database, search: async () => [{ ...cognitionSources[0], content: "这里是尚未进行模型分析的原始材料，只有有限的片段。" }], extract: async () => ({ live: false, model: "rules", value: { items: [] } }), ...{ synthesize: cognitionModels.synthesize, relevant: cognitionModels.relevant } });
    await request.promise; const result = await getDossier("alice", request.jobId, undefined, store.database);
    expect(result.status).toBe("ready"); expect(result.dossier?.quality).toBe("materials_only"); expect(result.dossier?.dimensions).toEqual([]);
  });
});

describe("bounded inquiry and confirmed reflections", () => {
  it("stops after three replies, resumes by id and rejects stale/cross-user updates", async () => {
    const dossier = await build();
    const deps = { database: store.database, respond: async () => ({ live: false, value: { focusQuote: "", feedback: "", evidenceIds: [], nextQuestion: "", draft: null } }) };
    let inquiry = await discussTopic("alice", { action: "start", jobId: dossier.jobId, requestId: "start-one" }, deps);
    expect(await getReflections("alice", {}, store.database)).toEqual([]);
    const input = { action: "reply" as const, inquiryId: inquiry.id, revision: 0, requestId: "reply-one", text: "我仍不确定，想先了解目标岗位。" };
    inquiry = await discussTopic("alice", input, deps);
    expect(await discussTopic("alice", input, deps)).toEqual(inquiry);
    await expect(discussTopic("alice", { ...input, requestId: "different-request" }, deps)).rejects.toMatchObject({ status: 409 });
    await expect(discussTopic("bob", input, deps)).rejects.toMatchObject({ status: 404 });
    for (const n of [2, 3]) inquiry = await discussTopic("alice", { action: "reply", inquiryId: inquiry.id, revision: inquiry.revision, requestId: `reply-number-${n}`, text: "暂时跳过，我保留疑问。" }, deps);
    expect(inquiry.round).toBe(3); expect(inquiry.status).toBe("draft"); expect(inquiry.question).toBeNull();
    expect(await getReflections("alice", {}, store.database)).toEqual([]);
    expect(discussSchema.safeParse({ action: "reply", inquiryId: inquiry.id, text: "没有版本和幂等键" }).success).toBe(false);
  });
  it("saves only explicit confirmed drafts, appends immutable versions and exports without conversation", async () => {
    const view = await build("alice", "PRIVATE-CONTEXT-考研"); const dossier = view.dossier!;
    const draft: ReflectionDraft = { judgment: "我会先确认岗位要求，暂时不做最终决定。", conditions: ["确认目标岗位"], openQuestions: ["岗位如何评价实习？"], evidenceIds: [dossier.evidence[0].id], nextStep: null };
    const input = { action: "save" as const, jobId: view.jobId, dossierId: dossier.id, requestId: "save-first", expectedVersion: 0, confirmed: true as const, following: true, draft };
    expect(manageReflectionSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
    const first = await manageReflection("alice", input, store.database);
    expect(await manageReflection("alice", input, store.database)).toEqual(first);
    const second = await manageReflection("alice", { ...input, reflectionId: first.id, expectedVersion: 1, requestId: "save-second", draft: { ...draft, judgment: "新判断：先用实习验证岗位兴趣。" } }, store.database);
    expect(second).toMatchObject({ version: 2 });
    const [record] = await getReflections("alice", { id: first.id }, store.database);
    expect(record.versions.map((v) => v.version)).toEqual([2, 1]); expect(record.versions[1].judgment).toBe(draft.judgment);
    await expect(manageReflection("alice", { ...input, reflectionId: first.id, requestId: "stale-save" }, store.database)).rejects.toMatchObject({ status: 409 });
    await expect(reflectionExport("bob", first.id, "md", store.database)).rejects.toMatchObject({ status: 404 });
    const md = await reflectionExport("alice", first.id, "md", store.database);
    expect(md).toContain("新判断"); expect(md).toContain(cognitionSources[0].url);
    expect(md).not.toContain("userId"); expect(md).not.toContain("inquiry");
    expect(md).not.toContain("PRIVATE-CONTEXT");
    const html = await reflectionExport("alice", first.id, "html", store.database); expect(html).not.toContain("<script"); expect(html).toContain("<blockquote>"); expect(html).not.toContain("PRIVATE-CONTEXT");
    await manageReflection("alice", { action: "delete", reflectionId: first.id, expectedVersion: 2, confirmed: true }, store.database);
    expect(await getReflections("alice", {}, store.database)).toEqual([]);
    expect(await store.database.select().from(schema.reflectionVersions)).toEqual([]);
  });
  it("continues only followed unanswered questions with actual new material and clears cached briefs", async () => {
    const view = await build(); const dossier = view.dossier!; const source = dossier.sources[0];
    const brief: DailyBrief = { date: "2026-09-14", headline: "今天", summary: "", spokenScript: "", highlights: [], continuity: [], generatedAt: new Date().toISOString(), model: "test" };
    const cache = () => store.database.insert(schema.dailyBriefs).values({ userId: "alice", date: brief.date, payload: brief });
    await cache();
    const saved = await manageReflection("alice", { action: "save", jobId: view.jobId, dossierId: dossier.id, expectedVersion: 0, requestId: "followup-save", confirmed: true, following: true,
      draft: { judgment: "先了解岗位要求。", conditions: [], evidenceIds: [], openQuestions: ["岗位怎么选？"], nextStep: null } }, store.database);
    expect(await store.database.select().from(schema.dailyBriefs)).toEqual([]);
    const feed: FeedView = { userId: "alice", date: brief.date, run: null, cards: [{ id: "card", kind: "main", position: 0, topicName: view.topic, reason: "", seen: false, perspective: null,
      content: { id: source.contentId, title: source.title, url: source.url, evidenceSourceVersion: source.hash, summary: "", excerpt: "", voteUp: 0, commentCount: 0, provider: "fixture", type: "answer" } }] };
    expect(await readingFollowups(feed, store.database)).toEqual([]);
    feed.cards[0].content!.evidenceSourceVersion = "changed-version";
    expect(await readingFollowups(feed, store.database)).toMatchObject([{ reflectionId: saved.id, question: "岗位怎么选？", titles: [source.title] }]);
    feed.cards[0].feedback = "irrelevant";
    expect(await readingFollowups(feed, store.database)).toEqual([]);
    feed.cards[0].feedback = null;
    await cache();
    await manageReflection("alice", { action: "follow", reflectionId: saved.id, following: false, expectedVersion: 1 }, store.database);
    expect(await store.database.select().from(schema.dailyBriefs)).toEqual([]);
    expect(await readingFollowups(feed, store.database)).toEqual([]);
  });
  it("does not create another reflection when the same inquiry is confirmed again after refresh", async () => {
    const view = await build();
    const inquiry = await discussTopic("alice", { action: "start", jobId: view.jobId, requestId: "saved-inquiry-start" }, { database: store.database });
    const input = { action: "save" as const, jobId: view.jobId, dossierId: view.dossier!.id, inquiryId: inquiry.id, expectedVersion: 0, requestId: "saved-inquiry-first", confirmed: true as const, following: false,
      draft: { judgment: "仍不确定。", conditions: [], evidenceIds: [], openQuestions: [], nextStep: null } };
    const first = await manageReflection("alice", input, store.database);
    expect(await manageReflection("alice", { ...input, requestId: "saved-inquiry-again" }, store.database)).toEqual(first);
    expect((await getInquiry("alice", inquiry.id, store.database)).savedReflectionId).toBe(first.id);
    expect(await store.database.select().from(schema.reflections)).toHaveLength(1);
    expect(await store.database.select().from(schema.reflectionVersions)).toHaveLength(1);
  });
  it("records usefulness separately from stance and refuses other users' sources", async () => {
    await build();
    await setContentFeedback("alice", cognitionSources[0].id, "misleading", store.database);
    await expect(setContentFeedback("bob", cognitionSources[0].id, "useful", store.database)).rejects.toMatchObject({ status: 404 });
    expect(await store.database.select().from(schema.interestTopics)).toEqual([]);
    await setContentFeedback("alice", cognitionSources[0].id, null, store.database);
    expect(await store.database.select().from(schema.contentFeedback)).toEqual([]);
  });
});
