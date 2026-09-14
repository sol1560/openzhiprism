"use client";
import { useEffect, useId, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { EvidenceRef, SourceSnapshot } from "@/lib/cognition/types";

const PROVIDER: Record<string, string> = { official: "知乎", fixture: "离线样本", justone: "补充来源" };

/** 原话出处：和内容预览同一个弹窗样式，引文高亮在前后文里。 */
export function EvidenceDialog({ source, evidence, onClose }: { source: SourceSnapshot | null; evidence?: EvidenceRef | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => {
    if (!source || !ref.current) return;
    const old = document.activeElement as HTMLElement | null; const node = ref.current;
    node.showModal();
    return () => { node.close(); old?.focus(); };
  }, [source]);
  const scopeNote = !source ? "" : source.scope === "search_excerpt" ? "这条只有搜索摘录，不是完整回答。" : source.truncated ? "正文不完整，下结论前请看原文。" : "分析的是当时抓到的正文，原文可能已更新。";
  return <dialog ref={ref} className="content-preview" aria-labelledby={id} onCancel={onClose}>
    {source && <>
      <div className="preview-topline">
        <span className="product-eyebrow">原话出处</span>
        <button type="button" className="icon-control" aria-label="关闭" onClick={onClose}><X size={17} /></button>
      </div>
      <h2 id={id}>{source.title}</h2>
      <p className="preview-author">{source.author ?? "作者未知"} · {PROVIDER[source.provider] ?? "已获取来源"} · 抓取于 {source.fetchedAt.slice(0, 10)}</p>
      {evidence ? <>
        <blockquote className="evidence-quote">{evidence.quote}</blockquote>
        <p className="product-eyebrow">前后文</p>
        <p className="evidence-context">{evidence.before}<mark>{evidence.quote}</mark>{evidence.after}</p>
        <p className="preview-note">小棱的归纳：{evidence.claim}{evidence.condition ? <><br />原文里的条件：{evidence.condition}</> : null}</p>
      </> : <p className="evidence-context">{source.text}</p>}
      <p className="preview-note">{scopeNote} 能对上原话，不代表作者说的就是对的。</p>
      <div className="action-row">
        <a className="pill-button pill-primary" href={source.url} target="_blank" rel="noopener noreferrer">去知乎看原文<ArrowUpRight size={14} /></a>
        <button type="button" className="text-control" onClick={onClose}>返回</button>
      </div>
    </>}
  </dialog>;
}
