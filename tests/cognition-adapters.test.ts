import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Db } from "@/db";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerCognitionTools } from "@/lib/cognition/mcp";
import { createCognitionVoiceTools } from "@/lib/cognition/voice";
import { startDossier, getDossier } from "@/lib/cognition/dossiers";
import { GET as inquiryGet, POST as inquiryPost } from "@/app/api/inquiries/route";
import { GET as reflectionsGet, POST as reflectionsPost } from "@/app/api/reflections/route";
import type { InquiryView, ReflectionView } from "@/lib/cognition/types";
import { testDatabase, seedUser } from "./helpers/database";
import { cognitionModels, cognitionSources } from "./helpers/cognition";

const state = vi.hoisted(() => ({ database: null as unknown as Db, user: "alice" }));
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: async () => state.database }));
vi.mock("@/lib/session", () => ({ getSessionUserId: async () => state.user || null }));
let store: Awaited<ReturnType<typeof testDatabase>>;
let clock: number;
beforeEach(async () => {
  vi.stubEnv("LLM_PROVIDER", "mock"); vi.stubEnv("COGNITION_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  store = await testDatabase(); state.database = store.database; state.user = "alice";
  await seedUser(store.database, "alice"); await seedUser(store.database, "bob");
  clock = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await store.close(); });
const advance = () => { clock += 2000; };
function post(body: unknown) {
  advance(); return new Request("http://localhost:3000/api/inquiries", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
type Envelope = { structuredContent: { kind: string; data: Record<string, unknown>; links: Record<string, string> } };
function mcp() {
  const handlers = new Map<string, (args: Record<string, unknown>, ctx: unknown) => Promise<Envelope>>();
  const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>, ctx: unknown) => Promise<Envelope>) => handlers.set(name, handler) } as unknown as McpServer;
  registerCognitionTools(server, async (ctx) => (ctx as { user: string }).user,
    async (_ctx, value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }));
  return async (name: string, args: Record<string, unknown>, user = "alice") => { advance(); return handlers.get(name)!(args, { user }); };
}
it("continues the same pinned inquiry through MCP, HTTP and voice, then exposes a confirmed version", async () => {
  const started = await startDossier("alice", { topic: "考研还是就业" }, { database: store.database, search: async () => cognitionSources, ...cognitionModels }); await started.promise;
  const dossier = (await getDossier("alice", started.jobId, undefined, store.database)).dossier!;
  const call = mcp();
  const mcpView = await call("get_topic_dossier", { jobId: started.jobId });
  expect(mcpView.structuredContent.data.jobId).toBe(started.jobId);
  const created = await call("discuss_topic", { action: "start", jobId: started.jobId, version: dossier.id, requestId: "cross-start" });
  const inquiry = created.structuredContent.data as unknown as InquiryView;
  const response = await inquiryPost(post({ action: "reply", inquiryId: inquiry.id, revision: 0, requestId: "cross-reply", text: "我仍不确定，想先核对岗位要求。" }));
  expect(response.status).toBe(200);
  const answered = await response.json() as InquiryView;
  const refreshed = await startDossier("alice", { topic: "考研还是就业", refresh: true }, { database: store.database, search: async () => [{ ...cognitionSources[0], content: cognitionSources[0].content + "有新的资料。" }], ...cognitionModels }); await refreshed.promise;
  const voice = createCognitionVoiceTools({ fetchJson: async (path, init) => {
    advance(); let res: Response;
    if (path.startsWith("/api/inquiries")) res = init?.method === "POST" ? await inquiryPost(post(JSON.parse(String(init.body)))) : await inquiryGet(new NextRequest(`http://localhost:3000${path}`));
    else if (path.startsWith("/api/reflections")) res = init?.method === "POST" ? await reflectionsPost(post(JSON.parse(String(init.body)))) : await reflectionsGet(new NextRequest(`http://localhost:3000${path}`));
    else throw new Error("Unexpected route");
    const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
  } }, () => ({ jobId: started.jobId, inquiryId: inquiry.id, version: dossier.id }));
  const resumed = JSON.parse(await voice.discuss_topic({ action: "get" })) as InquiryView;
  expect(resumed.id).toBe(inquiry.id); expect(resumed.revision).toBe(1); expect(resumed.dossierId).toBe(dossier.id);
  const drafted = JSON.parse(await voice.discuss_topic({ action: "draft", revision: answered.revision, requestId: "cross-draft" })) as InquiryView;
  expect(drafted.status).toBe("draft");
  expect((await call("get_reflections", {})).structuredContent.data.items).toEqual([]);
  const saved = JSON.parse(await voice.manage_reflection({ action: "save", jobId: started.jobId, dossierId: dossier.id, inquiryId: inquiry.id,
    expectedVersion: 0, requestId: "cross-save", confirmed: true, following: true, draft: { ...drafted.draft, judgment: "确认后的判断：先了解岗位要求。" } }));
  expect(saved.version).toBe(1);
  const records = (await call("get_reflections", {})).structuredContent.data.items as ReflectionView[];
  expect(records).toHaveLength(1); expect(records[0].versions[0].dossierId).toBe(dossier.id);
  expect(records[0].versions[0].judgment).toBe("确认后的判断：先了解岗位要求。");
});

it("rejects unauthenticated and cross-account reads at the HTTP boundary", async () => {
  state.user = "";
  expect((await inquiryGet(new NextRequest("http://localhost:3000/api/inquiries?id=anything"))).status).toBe(401);
  state.user = "bob";
  const response = await reflectionsGet(new NextRequest("http://localhost:3000/api/reflections?userId=alice"));
  expect(await response.json()).toEqual({ reflections: [] });
  const denied = await reflectionsPost(new Request("http://localhost:3000/api/reflections", { method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: "{}" }));
  expect(denied.status).toBe(403);
});
