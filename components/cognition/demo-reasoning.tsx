"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, Info, Pencil } from "lucide-react";
import type { DemoArticle } from "@/lib/demo/types";
import { stripHtml } from "@/lib/zhihu/text";
import type { EvidenceRef, SourceSnapshot } from "@/lib/cognition/types";
import { EvidenceDialog } from "./evidence-dialog";

async function hash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const questions = ["你现在怎么看？也可以明确写还不确定。", "这段原文能支持你的判断到什么范围？", "什么条件变化时，你会重新考虑？"];
/** 首页沙盒里的示例：只在本页记录，不调用模型；样式和正式话题页同一套。 */
export function DemoReasoning({ article }: { article: DemoArticle }) {
  const [evidence, setEvidence] = useState<{ source: SourceSnapshot; ref: EvidenceRef } | null>(null);
  const [stage, setStage] = useState<"intro" | "inquiry" | "draft" | "saved">("intro");
  const [answers, setAnswers] = useState<string[]>([]); const [text, setText] = useState("");
  const [judgment, setJudgment] = useState(""); const [versions, setVersions] = useState<string[]>([]); const [error, setError] = useState("");
  const finish = (all: string[]) => { setAnswers(all); setJudgment(all[0] || "我目前仍不确定，需要核对更多材料。"); setStage("draft"); setText(""); };
  const openEvidence = async () => {
    try {
      const body = stripHtml(article.excerpt).normalize("NFC").trim(); const version = await hash(body); const id = await hash(`${article.id}:${version}`);
      setEvidence({ source: { id, contentId: article.id, hash: version, title: stripHtml(article.title), url: article.url, author: stripHtml(article.authorName), provider: "fixture", text: body, fetchedAt: article.fetchedAt, scope: "search_excerpt", truncated: true },
        ref: { id: await hash(`${id}:0:${body}`), snapshotId: id, quote: body, start: 0, end: body.length, before: "", after: "", claim: "这里展示的是样本原文片段，示例导读不代替原文。", condition: null } });
    } catch { setError("暂时打不开来源，可以从原卡片去知乎看原文。"); }
  };
  return <section className="product-surface surface-stack demo-reasoning" aria-label="证据与判断示例">
    <div><span className="product-eyebrow">示例：从核对到判断</span><h2 className="surface-subtitle">先核对，再留下自己的想法。</h2></div>
    <div className="action-row">
      <button type="button" className="text-control" onClick={() => void openEvidence()}><FileText size={14} />核对这条原话</button>
      {stage === "intro" && <button type="button" className="pill-button pill-secondary pill-small" onClick={() => setStage("inquiry")}>试试三步想清楚</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {stage === "inquiry" && <>
      <p className="inquiry-question">{questions[answers.length]}</p>
      <label className="form-field">我的想法<textarea rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="action-row">
        <button type="button" className="pill-button pill-primary pill-small" disabled={!text.trim()} onClick={() => { const next = [...answers, text.trim()]; if (next.length === 3) finish(next); else { setAnswers(next); setText(""); } }}>下一步</button>
        <button type="button" className="text-control" onClick={() => finish(text.trim() ? [...answers, text.trim()] : answers)}>先整理成草稿</button>
      </div>
    </>}
    {stage === "draft" && <>
      <div className="inline-note"><Info size={16} /><div className="inline-note-body">草稿只是你写的话，没有评分，也不会替你改立场。</div></div>
      <label className="form-field">我的判断<textarea rows={3} value={judgment} maxLength={1200} onChange={(e) => setJudgment(e.target.value)} /></label>
      {answers[2] && <p className="text-xs text-muted">我写下的条件：{answers[2]}</p>}
      <div><button type="button" className="pill-button pill-primary pill-small" disabled={!judgment.trim()} onClick={() => { setVersions((old) => [...old, judgment.trim()]); setStage("saved"); }}>保存示例</button></div>
    </>}
    {stage === "saved" && <>
      <p role="status">示例版本 {versions.length}：{versions.at(-1)}</p>
      {versions.length > 1 && <details className="reflection-history"><summary>早前的版本</summary>{versions.slice(0, -1).map((v, i) => <p key={i} className="text-sm">版本 {i + 1}：{v}</p>)}</details>}
      <div className="action-row">
        <button type="button" className="text-control" onClick={() => setStage("draft")}><Pencil size={14} />修改</button>
        <Link href="/login" className="text-control">登录后正式保存<ArrowUpRight size={13} /></Link>
      </div>
    </>}
    <p className="text-xs text-muted">示例只留在这个页面。登录后，核对、思辨和判断会在网页、AI 助手和语音里同步。</p>
    <EvidenceDialog source={evidence?.source ?? null} evidence={evidence?.ref} onClose={() => setEvidence(null)} />
  </section>;
}
