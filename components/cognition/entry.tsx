"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen } from "lucide-react";
import type { ContentFeedback } from "@/lib/cognition/types";
import { cognitionJson } from "./client";
import { useVoiceBus } from "@/lib/voice/context";

/** 打开「看分歧与依据」：先建一份材料整理任务，再跳到话题页 */
export function TopicEntry({ topic, cardId, label = "看分歧与依据" }: { topic?: string; cardId?: string; label?: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <>
    <button type="button" className="text-control" disabled={busy} aria-busy={busy || undefined} onClick={async () => {
      setBusy(true); setError("");
      try { const result = await cognitionJson<{ jobId: string }>("/api/dossiers", { topic, cardId }); router.push(`/topics/${result.jobId}${cardId ? `?from=${encodeURIComponent(cardId)}` : ""}`); }
      catch (e) { setError(e instanceof Error ? e.message : "暂时无法打开"); setBusy(false); }
    }}><BookOpen size={14} />{busy ? "正在打开…" : label}<ArrowRight size={13} /></button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}

export const FEEDBACK_KINDS: ContentFeedback[] = ["useful", "known", "irrelevant", "misleading"];
export const FEEDBACK_LABELS: Record<ContentFeedback, string> = { useful: "有帮助", known: "已知道", irrelevant: "不相关", misleading: "归纳有误" };

/**
 * 阅读反馈的状态与保存。`initial` 一旦由父级提供（Feed 卡片），就以父级为准，
 * 这样语音向导通过 bus 改动的反馈能同步回卡片；未提供时组件自己记。
 */
export function useReadingFeedback(contentId: string, initial?: ContentFeedback | null) {
  const bus = useVoiceBus();
  const [local, setLocal] = useState<ContentFeedback | null>(initial ?? null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const value = initial === undefined ? local : initial;
  const choose = async (kind: ContentFeedback) => {
    if (busy || !contentId) return;
    const next = value === kind ? null : kind;
    setBusy(true); setError("");
    try { await cognitionJson("/api/content-feedback", { contentId, kind: next }); setLocal(next); bus?.emit({ type: "content_feedback", contentId, kind: next }); }
    catch (e) { setError(e instanceof Error ? e.message : "反馈没保存上"); } finally { setBusy(false); }
  };
  return { value, busy, error, choose };
}
export type ReadingFeedbackState = ReturnType<typeof useReadingFeedback>;

/** 一组反馈选项（胶囊按钮） */
export function FeedbackChoices({ feedback, kinds = FEEDBACK_KINDS }: { feedback: ReadingFeedbackState; kinds?: ContentFeedback[] }) {
  return <div className="choice-row" aria-label="反馈阅读内容">
    {kinds.map((kind) => <button key={kind} type="button" aria-pressed={feedback.value === kind} disabled={feedback.busy} onClick={() => void feedback.choose(kind)}>{FEEDBACK_LABELS[kind]}</button>)}
  </div>;
}

/** 自带状态的完整反馈块：选项 + 一句说明 + 错误 */
export function ReadingFeedback({ contentId, initial }: { contentId: string; initial?: ContentFeedback | null }) {
  const feedback = useReadingFeedback(contentId, initial);
  return <div className="card-drawer-section">
    <FeedbackChoices feedback={feedback} />
    {feedback.value && <p className="text-xs text-muted">记下了。这只影响推荐，不代表你同意作者。</p>}
    {feedback.error && <p role="alert" className="form-error">{feedback.error}</p>}
  </div>;
}
