import type { VoiceDataClient, VoiceToolDefinition, VoiceTools } from "@/lib/voice/tools";
import type { ContentFeedback, DossierView, InquiryView, ReflectionView } from "./types";

export interface CognitionContext { jobId?: string; inquiryId?: string; version?: string }
const string = { type: "string", description: "用户明确提供或上一工具返回的文本" };
const integer = { type: "integer", description: "上一工具返回的版本整数，不要猜测" };
const draft = { type: "object", properties: { judgment: string, conditions: { type: "array", items: string }, evidenceIds: { type: "array", items: string }, openQuestions: { type: "array", items: string }, nextStep: { type: "string", description: "用户确认的可选下一步，没有时留空字符串" } }, required: ["judgment", "conditions", "evidenceIds", "openQuestions", "nextStep"] };
const parameterDescriptions: Record<string, string> = {
  topic: "用户要核对的话题名", jobId: "已有话题返回的 jobId，省略时沿用页面话题", version: "话题的证据版本 ID，省略时沿用当前版本", evidenceId: "当前话题 evidence 列表中的证据 ID",
  refresh: "用户要求查找新材料时为 true", action: "本次用户明确要求的操作", inquiryId: "已有思辨返回的 id，省略时沿用页面思辨", revision: "已有思辨的 revision 整数", requestId: "本次请求的 8-100 字幂等键，重试原样复用",
  text: "用户这轮实际表达的回答，不补写立场", dossierId: "思辨返回的 dossierId", reflectionId: "要修改的已保存判断 ID", expectedVersion: "当前判断版本整数；新建为 0", confirmed: "仅当用户已看过草稿并明确确认保存或删除时为 true",
  following: "用户明确要求继续关注未解问题时为 true", draft: "用户已看过并确认的完整判断草稿", judgment: "用户确认的当前判断", conditions: "用户确认的成立条件数组", evidenceIds: "选用的当前话题证据 ID 数组", openQuestions: "用户保留的疑问数组", id: "要回看的正式判断 ID", contentId: "当前 Feed 或证据来源的内容 ID", kind: "useful 有帮助、known 已知道、irrelevant 不相关、misleading 归纳有误；clear 撤销反馈",
};
function describeParameters(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => {
    const field = value as Record<string, unknown>;
    return [name, { ...field, description: parameterDescriptions[name] ?? field.description ?? name,
      ...(field.properties ? { properties: describeParameters(field.properties as Record<string, unknown>) } : {}),
      ...(field.items ? { items: { ...(field.items as object), description: `一条${parameterDescriptions[name] ?? name}` } } : {}) }];
  }));
}
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): VoiceToolDefinition => ({ name, description, parameters: { type: "object", properties: describeParameters(properties), required }, expectsResponse: true, responseTimeoutSecs: 60 });
export const COGNITION_VOICE_DEFINITIONS: readonly VoiceToolDefinition[] = [
  tool("get_topic_dossier", "核对当前话题依据；topic 发起分析，jobId 读取状态，省略两者时读取页面话题。未完成时只说明进度，用返回 jobId 续查。evidenceId 展开一条原话及上下文。不要朗读 ID，不把样本当社区投票。", { topic: string, jobId: string, version: string, evidenceId: string, refresh: { type: "boolean" } }),
  tool("discuss_topic", "用户明确要求帮我想清楚后才 start；最多三轮。get 读取已有 inquiryId，reply/draft 要传当前 revision 和本次 requestId（8-100字，重试复用），text 为用户回答。草稿未保存，结束后必须向用户读出并等确认。可从页面当前会话接着讨论。", { action: { type: "string", enum: ["start", "get", "reply", "draft"] }, jobId: string, version: string, inquiryId: string, revision: integer, requestId: string, text: string }, ["action"]),
  tool("manage_reflection", "只有用户明确确认保存、修改、关注或删除才能调用。save 包含用户确认的 draft，confirmed=true，jobId、dossierId、expectedVersion（新建0）及requestId。修改提供reflectionId，追加版本。follow 更新following；delete要求用户明确确认删除，不能自动保存AI草稿。", { action: { type: "string", enum: ["save", "follow", "delete"] }, jobId: string, dossierId: string, inquiryId: string, reflectionId: string, expectedVersion: integer, requestId: string, confirmed: { type: "boolean" }, following: { type: "boolean" }, draft }, ["action", "expectedVersion"]),
  tool("get_reflections", "回看用户确认保存的判断与未决问题；可按id或topic筛选。默认短读最近五条，用具体id继续展开。不能凭阅读记录声称用户已经认同。", { id: string, topic: string }),
  tool("set_content_feedback", "记录用户明确说出的阅读反馈：useful有帮助、known已知道、irrelevant不相关、misleading归纳有误，clear撤销。这不是对作者立场的赞同。", { contentId: string, kind: { type: "string", enum: ["useful", "known", "irrelevant", "misleading", "clear"] } }, ["contentId", "kind"]),
];
export function createCognitionVoiceTools(data: VoiceDataClient, context: () => CognitionContext = () => ({}), onFeedback?: (id: string, kind: ContentFeedback | null) => void): VoiceTools {
  const post = (url: string, body: unknown) => data.fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const wrap = (fn: (p: Record<string, unknown>) => Promise<unknown>) => async (p: Record<string, unknown>) => {
    try { return JSON.stringify(await fn(p ?? {})); } catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : "暂时无法读取" }); }
  };
  return {
    get_topic_dossier: wrap(async (p) => {
      const ctx = context(); let id = String(p.jobId ?? (p.topic ? "" : ctx.jobId) ?? "");
      if (!id || p.refresh) {
        const topic = p.topic ?? (id ? (await data.fetchJson(`/api/dossiers?id=${encodeURIComponent(id)}`) as DossierView).topic : "");
        const started = await post("/api/dossiers", { topic, refresh: Boolean(p.refresh) }) as { jobId: string }; id = started.jobId;
      }
      const version = p.version ?? (id === ctx.jobId ? ctx.version : undefined);
      const view = await data.fetchJson(`/api/dossiers?id=${encodeURIComponent(id)}${version ? `&version=${encodeURIComponent(String(version))}` : ""}`) as DossierView;
      if (!view.dossier) return { jobId: id, status: view.status, stage: view.stage, error: view.error, materials: view.materials?.map((s) => ({ title: s.title, url: s.url, scope: s.scope })), note: "分析尚未就绪，用 jobId 稍后读取；可以说明已找到哪些材料，不要宣称分析已完成。" };
      const d = view.dossier;
      if (p.evidenceId) {
        const e = d.evidence.find((e) => e.id === p.evidenceId); const source = d.sources.find((s) => s.id === e?.snapshotId);
        if (!e || !source) throw new Error("没有这条证据，请先读取当前话题的依据列表");
        return { jobId: id, dossierId: d.id, evidence: e, source: { title: source.title, author: source.author, url: source.url, scope: source.scope, fetchedAt: source.fetchedAt, truncated: source.truncated } };
      }
      return { jobId: id, dossierId: d.id, status: view.status, error: view.error, note: view.status === "ready" ? undefined : "本次更新未完成，以下为之前已保存的分析。", topic: view.topic, quality: d.quality, summary: d.summary, dimensions: d.dimensions,
        conditions: d.conditions, counterexamples: d.counterexamples, openQuestions: d.openQuestions,
        evidence: d.evidence.map((e) => ({ id: e.id, claim: e.claim, sourceTitle: d.sources.find((s) => s.id === e.snapshotId)?.title })), notices: d.notices };
    }),
    discuss_topic: wrap(async (p) => {
      const ctx = context(); const input = { ...p, jobId: p.jobId ?? ctx.jobId, version: p.version ?? ctx.version, inquiryId: p.inquiryId ?? ctx.inquiryId };
      const result = p.action === "get" ? await data.fetchJson(`/api/inquiries?id=${encodeURIComponent(String(input.inquiryId ?? ""))}`) : await post("/api/inquiries", input);
      const inquiry = result as InquiryView;
      return { ...inquiry, turns: inquiry.turns.slice(-1), note: inquiry.savedReflectionId ? "这次思辨已经保存，可用 get_reflections 回看；不要再次新建判断。" : inquiry.status === "draft" ? "先向用户呈现草稿；用户明确确认后才能保存。" : "只问当前这一个问题，等待用户回答。" };
    }),
    manage_reflection: wrap((p) => post("/api/reflections", p)),
    get_reflections: wrap(async (p) => {
      const query = new URLSearchParams(); if (p.id) query.set("id", String(p.id)); if (p.topic) query.set("topic", String(p.topic));
      const result = await data.fetchJson(`/api/reflections?${query}`) as { reflections: ReflectionView[] };
      return { total: result.reflections.length, items: result.reflections.slice(0, p.id ? 1 : 5).map((r) => ({ ...r, versions: r.versions.slice(0, p.id ? 6 : 1) })) };
    }),
    set_content_feedback: wrap(async (p) => { const kind = p.kind === "clear" ? null : p.kind as ContentFeedback | null; const result = await post("/api/content-feedback", { ...p, kind }); onFeedback?.(String(p.contentId), kind); return result; }),
  };
}
