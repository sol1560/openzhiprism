import type { DossierView, EvidenceRef, InquiryView, ReflectionDraft, ReflectionView, TopicDossier } from "@/lib/cognition/types";
import { boot, createApp, el, link, pickData, renderError, root, type ToolResultLike } from "./shared";
const app = createApp("cognition");
interface Envelope { kind: string; data: Record<string, unknown>; links: Record<string, string> }
let last: Envelope | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollingUntil = 0;
let pollingJob = "";

function action(label: string, tool: string, args: () => Record<string, unknown>) {
  const button = el("button", { class: "btn", type: "button" }, [label]);
  const error = el("span", { class: "sub", role: "status" });
  button.addEventListener("click", async () => {
    button.disabled = true; error.textContent = "处理中…";
    try { const result = await app.callServerTool({ name: tool, arguments: args() }); if (result.isError) throw new Error("操作未完成，请在对话中继续或打开网页");
      const data = pickData<Envelope>(result as ToolResultLike); if (!data) throw new Error("没有返回有效内容"); render(data);
    } catch (e) { error.textContent = e instanceof Error ? e.message : "操作未完成"; button.disabled = false; }
  });
  return el("div", { class: "row" }, [button, error]);
}
function evidencePanel(dossier: TopicDossier, evidence: EvidenceRef) {
  const source = dossier.sources.find((s) => s.id === evidence.snapshotId);
  return el("div", { class: "item" }, [el("strong", {}, [source?.title ?? "原始依据"]),
    el("p", { class: "sub" }, [`${source?.author ?? "作者未提供"} · ${source?.scope === "search_excerpt" ? "搜索摘录" : "正文片段"} · ${source?.fetchedAt.slice(0, 10) ?? ""}`]),
    el("blockquote", {}, [evidence.quote]), el("p", { class: "sub" }, [`上下文：${evidence.before}${evidence.quote}${evidence.after}`]),
    el("p", { class: "sub" }, ["仅核对文字出处，不代表作者主张已被事实验证。"]), source ? link(app, source.url, ["去知乎核对原文 ↗"], "btn") : null]);
}
function renderDossier(data: DossierView) {
  const container = root(); const dossier = data.dossier;
  container.append(el("h2", { class: "question" }, [data.topic]));
  if (dossier && data.status !== "ready") container.append(el("p", { class: "sub" }, [data.error ?? "本次更新未完成，以下保留上一次的分析。"]));
  if (!dossier) {
    container.append(el("p", { class: "empty" }, [data.error ?? `正在准备：${data.stage}`]), action("读取最新进度", "get_topic_dossier", () => ({ jobId: data.jobId })));
    for (const source of data.materials ?? []) container.append(link(app, source.url, [source.title], "item"));
    if (["queued", "running"].includes(data.status)) {
      if (pollingJob !== data.jobId) { pollingJob = data.jobId; pollingUntil = Date.now() + 350_000; }
      if (Date.now() < pollingUntil) pollTimer = setTimeout(async () => {
        try { const response = await app.callServerTool({ name: "get_topic_dossier", arguments: { jobId: data.jobId } }); const next = pickData<Envelope>(response as ToolResultLike); if (next && !response.isError) render(next); } catch { /* The visible manual refresh remains usable. */ }
      }, 2500);
    }
    return;
  }
  container.append(el("p", { class: "summary" }, [dossier.summary.text]), el("p", { class: "sub" }, [`${dossier.sources.length} 条来源 · ${dossier.evidence.length} 条已核对摘录 · ${dossier.quality === "materials_only" ? "仅材料，尚无有效综合分析" : "AI 根据材料归纳"}`]));
  const cited = (item: { text: string; evidenceIds: string[] }) => {
    const evidenceArea = el("div");
    const buttons = item.evidenceIds.flatMap((id) => {
      const evidence = dossier.evidence.find((e) => e.id === id); if (!evidence) return [];
      const button = el("button", { class: "btn", type: "button" }, [`依据 ${dossier.evidence.indexOf(evidence) + 1} ↗`]);
      button.addEventListener("click", () => evidenceArea.replaceChildren(evidencePanel(dossier, evidence)));
      return [button];
    });
    return el("div", { class: "stack tight" }, [el("p", {}, [item.text]), el("div", { class: "row" }, buttons), evidenceArea]);
  };
  for (const dim of dossier.dimensions) container.append(el("section", { class: "card" }, [el("h3", {}, [dim.title]), ...dim.positions.map((p) => el("div", { class: "stack tight" }, [el("strong", {}, [p.label]), ...p.claims.map(cited)]))]));
  for (const [title, rows] of [["材料中的共识", dossier.consensus], ["成立条件", dossier.conditions], ["反例与边界", dossier.counterexamples]] as const) container.append(el("details", { class: "reason" }, [el("summary", {}, [title]), ...rows.map(cited), !rows.length ? el("p", { class: "sub" }, ["本次材料尚未提供足够依据。"]): null]));
  container.append(el("details", { class: "reason" }, [el("summary", {}, ["原始来源与获取范围"]), ...dossier.sources.map((source) => el("div", { class: "item" }, [link(app, source.url, [source.title]), el("p", { class: "sub" }, [`${source.author ?? ""} · ${source.scope === "search_excerpt" ? "搜索摘录" : "正文片段"} · ${source.fetchedAt.slice(0, 10)}${source.truncated ? " · 有截断或完整性未确认" : ""}`])]))]));
  for (const notice of dossier.notices) container.append(el("p", { class: "sub" }, [notice]));
  if (dossier.quality === "materials_only") container.append(action("重新分析已有材料", "get_topic_dossier", () => ({ topic: data.topic })));
  const requestId = crypto.randomUUID();
  container.append(action("帮我想清楚 · 最多三轮", "discuss_topic", () => ({ action: "start", jobId: data.jobId, version: dossier.id, requestId })));
}
function draftFields(initial: ReflectionDraft) {
  const judgment = el("textarea", { rows: "5", "aria-label": "我确认的判断", style: "width:100%;font:inherit" }); judgment.value = initial.judgment;
  const conditions = el("textarea", { rows: "3", "aria-label": "成立条件，每行一条", style: "width:100%;font:inherit" }); conditions.value = initial.conditions.join("\n");
  const questions = el("textarea", { rows: "3", "aria-label": "保留疑问，每行一条", style: "width:100%;font:inherit" }); questions.value = initial.openQuestions.join("\n");
  const nextStep = el("textarea", { rows: "2", "aria-label": "下一步，可留空", style: "width:100%;font:inherit" }); nextStep.value = initial.nextStep ?? "";
  const clean = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);
  return { node: el("div", { class: "stack" }, [el("label", {}, ["我确认的判断", judgment]), el("label", {}, ["成立条件", conditions]), el("label", {}, ["保留疑问", questions]), el("label", {}, ["可选的下一步", nextStep])]),
    value: () => ({ ...initial, judgment: judgment.value, conditions: clean(conditions.value), openQuestions: clean(questions.value), nextStep: nextStep.value || null }) };
}
function renderInquiry(data: InquiryView) {
  const container = root(); container.append(el("h2", { class: "question" }, [data.topic]), el("p", { class: "sub" }, [`${data.round}/3 轮 · ${data.status === "draft" ? "尚未保存的草稿" : "每次只想清楚一个问题"}`]));
  for (const turn of data.turns) container.append(el("details", { class: "reason" }, [el("summary", {}, ["我的回答与反馈"]), el("blockquote", {}, [turn.text]), el("p", {}, [turn.feedback.text])]));
  if (data.notice) container.append(el("p", { class: "sub" }, [data.notice]));
  if (data.savedReflectionId) { container.append(el("p", {}, ["这次思辨已保存。可在「我的判断」回看或明确修改，重复读取不会再保存一份。"])); }
  else if (data.status === "draft" && data.draft) {
    container.append(el("p", {}, ["请编辑并确认：这确实是我的判断。保存前不会进入判断历史。"]));
    const fields = draftFields(data.draft); container.append(fields.node);
    let signature = ""; let requestId = crypto.randomUUID();
    container.append(action("确认，保存我的判断", "manage_reflection", () => {
      const draft = fields.value(); const key = JSON.stringify(draft); if (signature && signature !== key) requestId = crypto.randomUUID(); signature = key;
      return { action: "save", jobId: data.jobId, dossierId: data.dossierId, inquiryId: data.id, expectedVersion: 0, confirmed: true, following: false, requestId, draft };
    }));
  } else {
    container.append(el("p", { class: "question" }, [data.question ?? ""]));
    const textarea = el("textarea", { rows: "4", "aria-label": "我的回答", placeholder: "也可以说仍不确定，或暂时跳过", style: "width:100%;font:inherit" }); container.append(textarea);
    let signature = ""; let requestId = crypto.randomUUID();
    const args = (action: string) => { const key = action + textarea.value; if (signature && signature !== key) requestId = crypto.randomUUID(); signature = key; return { action, inquiryId: data.id, revision: data.revision, requestId, text: textarea.value || undefined }; };
    container.append(action("继续", "discuss_topic", () => args("reply")), action("结束并整理", "discuss_topic", () => args("draft")));
  }
  container.append(action("同步其他入口的进度", "discuss_topic", () => ({ action: "get", inquiryId: data.id })));
}
function render(envelope: Envelope) {
  clearTimeout(pollTimer);
  last = envelope; root().replaceChildren(el("div", { class: "bar" }, [el("strong", {}, ["知棱 · 依据与我的判断"])]));
  if (envelope.kind === "dossier") renderDossier(envelope.data as unknown as DossierView);
  else if (envelope.kind === "inquiry") renderInquiry(envelope.data as unknown as InquiryView);
  else if (envelope.kind === "reflections") {
    const items = (envelope.data.items ?? []) as ReflectionView[];
    for (const item of items) root().append(el("article", { class: "card" }, [el("h3", {}, [item.topic]), el("p", { class: "summary" }, [item.versions[0]?.judgment ?? ""]), el("p", { class: "sub" }, [`版本 ${item.versions[0]?.version ?? 0} · ${item.following ? "继续关注" : "私有保存"}`]), ...item.versions.slice(1).map((v) => el("details", {}, [el("summary", {}, [`旧版 ${v.version}`]), el("p", {}, [v.judgment])]))]));
    if (!items.length) root().append(el("p", { class: "empty" }, ["还没有亲自确认保存的判断。"]));
    if (envelope.data.exportPreview) root().append(el("pre", { class: "raw" }, [String(envelope.data.exportPreview)]));
  } else if (envelope.kind === "evidence") {
    const e = envelope.data.evidence as EvidenceRef; const source = envelope.data.source as TopicDossier["sources"][number];
    if (e && source) root().append(evidencePanel({ sources: [source] } as TopicDossier, e));
  } else root().append(el("p", {}, [envelope.kind === "feedback" ? "阅读反馈已记录，不代表赞同作者立场。" : envelope.data.deleted ? "这条判断已删除。" : "你的操作已保存，可以在网页回看。"]));
  const links = el("div", { class: "row" });
  if (envelope.links.topic) links.append(link(app, envelope.links.topic, ["在网页继续 ↗"], "btn"));
  if (envelope.links.reflections) links.append(link(app, envelope.links.reflections, ["我的判断与导出 ↗"], "btn"));
  root().append(links);
}
boot(app, (params) => { if (params.isError) return renderError(params); const data = pickData<Envelope>(params); if (data) render(data); else if (last) render(last); }, "正在核对原文依据…");
