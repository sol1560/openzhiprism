"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { ProgressPanel } from "@/components/progress-panel";
import { DETECTION_LABELS, DETECTION_NOTE_LABELS, type DetectionSummary, type DetectionView } from "@/lib/ai-detection/types";

const CONFIDENCE = { High: "高", Medium: "中", Low: "低", Unknown: "未提供" };
const PROVIDER = { fixture: "知乎离线快照", official: "知乎官方接口" } as Record<string, string>;

/** 卡片「更多」抽屉里的一项：原文是不是 AI 写的。展开才读取状态，检测中每 2.5s 轮询一分钟。 */
export function AiDetection({ contentId, initial }: { contentId: string; initial?: DetectionSummary }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DetectionView>({ contentId, ...initial, status: initial?.status ?? "not_requested" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [resume, setResume] = useState(true);
  const mounted = useRef(true);
  const pollUntil = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const request = useCallback(async (submit: boolean) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(submit ? "/api/ai-detection" : `/api/ai-detection?contentId=${encodeURIComponent(contentId)}`, {
        method: submit ? "POST" : "GET", signal: current.signal,
        headers: submit ? { "Content-Type": "application/json" } : undefined,
        body: submit ? JSON.stringify({ contentId }) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "暂时读不到检测结果");
      if (mounted.current && !current.signal.aborted) setView(data);
    } catch (err) {
      if (mounted.current && !current.signal.aborted) { setError(err instanceof Error ? err.message : "连接中断"); setResume(false); }
    } finally { if (mounted.current && !current.signal.aborted) setBusy(false); }
  }, [contentId]);
  useEffect(() => {
    if (!open || busy || !resume || view.status !== "pending") return;
    const timer = setTimeout(() => {
      if (Date.now() > pollUntil.current) { setResume(false); return; }
      void request(false);
    }, view.retryAfterMs ?? 2500);
    return () => clearTimeout(timer);
  }, [open, busy, resume, request, view]);
  const start = (submit: boolean) => { pollUntil.current = Date.now() + 60000; setResume(true); void request(submit); };
  const toggle = (next: boolean) => { if (next === open) return; setOpen(next); if (next) start(false); };
  const suffix = view.label ? ` · ${DETECTION_LABELS[view.label]}` : view.status === "pending" ? " · 检测中" : "";
  const showRepoll = !busy && (view.retry === "poll" || Boolean(error) || (view.status === "pending" && !resume));
  const showSubmit = !busy && !error && (view.status === "not_requested" || view.retry === "submit");
  const result = view.result;
  return (
    <details className="detect-details" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
      <summary><strong>原文是不是 AI 写的？</strong>{suffix}<ChevronDown size={13} /></summary>
      <div className="detect-body">
        <p>只检测已抓到的原文片段，会把它发给检测服务 Pangram；摘要和推荐理由不会发送。</p>
        {busy ? <ProgressPanel slim title="正在读取结果…" /> : null}
        {view.message ? <p role="status">{view.message}</p> : null}
        {view.status === "pending" && !busy ? <p>还在检测，先读别的，稍后回来看。</p> : null}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        {showSubmit || showRepoll ? (
          <div className="action-row">
            {showSubmit ? <button type="button" className="pill-button pill-secondary pill-small" onClick={() => start(true)}>{view.retry === "submit" ? "重新检测" : "开始检测"}</button> : null}
            {showRepoll ? <button type="button" className="text-control text-control-sm" onClick={() => start(false)}><RefreshCw size={13} />{view.retry === "poll" ? "再读一次结果" : "再查一次"}</button> : null}
          </div>
        ) : null}
        {result ? <>
          <p><strong className="text-foreground">检测结果：{DETECTION_LABELS[result.label]}</strong></p>
          <dl className="detect-grid">
            {([["AI 生成", result.fractions.ai], ["AI 辅助", result.fractions.assisted], ["人工写作", result.fractions.human]] as const).map(([label, fraction]) => (
              <div key={label}><dt>{label}</dt><dd>{(fraction * 100).toFixed(1)}%</dd></div>
            ))}
          </dl>
          {result.notes?.map((note) => <p key={note}>{DETECTION_NOTE_LABELS[note]}</p>)}
          <p>百分比是各类文字所占的份额，不是作者用了 AI 的概率。检测可能出错，也说明不了内容可不可靠。</p>
          {result.segments.length ? <details>
            <summary className="text-control text-control-sm">分段看（{result.segments.length} 段）</summary>
            <div className="surface-stack">{result.segments.map((segment, index) => <div key={index} className="detect-segment">
              <p>{DETECTION_LABELS[segment.label]} · 置信度{CONFIDENCE[segment.confidence]}</p>
              <p>{segment.text}</p>
            </div>)}</div>
          </details> : <p>这次没有分段结果。</p>}
          <p>Pangram {result.version} · {view.checkedAt ? new Date(view.checkedAt).toLocaleString("zh-CN") : "检测时间未知"}</p>
        </> : null}
        {view.source ? <details>
          <summary className="text-control text-control-sm">送检的原文（{Array.from(view.source.text).length} 字）</summary>
          <p>来源：{PROVIDER[view.source.provider] ?? "JustOne"}，{view.source.fetchedAt ? `抓取于 ${new Date(view.source.fetchedAt).toLocaleString("zh-CN")}` : "抓取时间未记录"}。{view.source.truncated ? "正文不完整。" : "可能不是全文。"}</p>
          <pre className="detect-source">{view.source.text}</pre>
        </details> : null}
      </div>
    </details>
  );
}
