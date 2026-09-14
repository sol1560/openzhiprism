"use client";
import { useState } from "react";
import { Info } from "lucide-react";
import type { ReflectionDraft, TopicDossier } from "@/lib/cognition/types";
import { cognitionJson, useRequestId } from "./client";

const lines = (text: string) => text.split("\n").map((t) => t.trim()).filter(Boolean);

/** 判断草稿：改成自己真正的想法再保存；保存前只在本页存在。 */
export function DraftEditor({ initial, dossier, jobId, inquiryId, reflectionId, expectedVersion = 0, following = false, onSaved }: {
  initial: ReflectionDraft; dossier: TopicDossier; jobId: string; inquiryId?: string; reflectionId?: string;
  expectedVersion?: number; following?: boolean; onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(initial); const [follow, setFollow] = useState(following);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const requestId = useRequestId();
  const patch = (value: Partial<ReflectionDraft>) => setDraft((d) => ({ ...d, ...value }));
  return <form className="form-stack" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    const body = { action: "save", jobId, dossierId: dossier.id, inquiryId, reflectionId, expectedVersion, confirmed: true, following: follow, draft: { ...draft, conditions: lines(draft.conditions.join("\n")), openQuestions: lines(draft.openQuestions.join("\n")) } };
    try { const result = await cognitionJson<{ id: string }>("/api/reflections", { ...body, requestId: requestId(body) }); onSaved(result.id); }
    catch (e) { setError(e instanceof Error ? e.message : "保存没成功"); } finally { setBusy(false); }
  }}>
    <div className="inline-note"><Info size={16} /><div className="inline-note-body">这是草稿，改成你真正的想法再保存。</div></div>
    <label className="form-field">我现在的判断<textarea rows={5} disabled={busy} required maxLength={2400} value={draft.judgment} onChange={(e) => patch({ judgment: e.target.value })} /></label>
    <label className="form-field">什么情况下成立（一行一条）<textarea rows={2} disabled={busy} value={draft.conditions.join("\n")} onChange={(e) => patch({ conditions: e.target.value.split("\n").slice(0, 8) })} /></label>
    <fieldset className="form-field"><legend>我采用的原话</legend>
      <div className="evidence-checks">{dossier.evidence.map((evidence, index) => <label key={evidence.id} className="form-check"><input disabled={busy} type="checkbox" checked={draft.evidenceIds.includes(evidence.id)} onChange={(e) => patch({ evidenceIds: e.target.checked ? [...draft.evidenceIds, evidence.id] : draft.evidenceIds.filter((id) => id !== evidence.id) })} /><span>{index + 1}. {evidence.claim}</span></label>)}</div>
      {!dossier.evidence.length && <span>这次没有核对过的原话，可以只保存你的判断。</span>}
    </fieldset>
    <label className="form-field">还没想清楚的（一行一条）<textarea rows={2} disabled={busy} value={draft.openQuestions.join("\n")} onChange={(e) => patch({ openQuestions: e.target.value.split("\n").slice(0, 8) })} /></label>
    <label className="form-field">下一步（可选）<input type="text" disabled={busy} maxLength={600} value={draft.nextStep ?? ""} onChange={(e) => patch({ nextStep: e.target.value || null })} /></label>
    <label className="form-check"><input disabled={busy} type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /><span>有新材料时提醒我</span></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="action-row">
      <button type="submit" className="pill-button pill-primary" disabled={busy || !draft.judgment.trim()}>{busy ? "保存中…" : reflectionId ? "保存为新版本" : "保存"}</button>
      <span className="text-xs text-muted">只有你能看到，随时能改或删。</span>
    </div>
  </form>;
}
