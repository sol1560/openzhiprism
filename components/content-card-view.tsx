"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Coffee, ThumbsUp } from "lucide-react";

interface ContentCardViewProps {
  content: { title: string; summary: string; url: string; authorName?: string; voteUp: number };
  topic: string | null;
  source: ReactNode;
  /** 推荐理由；传了就在卡片底部折叠显示（首页沙盒用），正式 Feed 把它放进「更多」抽屉 */
  reason?: string;
  seen?: boolean;
  light?: boolean;
  compact?: boolean;
  onPreview?: () => void;
  onOpen?: () => void;
  onReasonChange?: (open: boolean) => void;
  /** 摘要下方的说明，例如「已按你的要求改写」 */
  summaryNote?: ReactNode;
  /** 署名行右侧的一行安静操作（text-control），和「去知乎阅读」排在一起 */
  actions?: ReactNode;
  /** 署名行下方的抽屉，例如「更多」展开后的内容 */
  drawer?: ReactNode;
}

/** Presentation only. Network operations belong to the product controller. */
export function ContentCardView({ content, topic, source, reason, seen, light, compact, onPreview, onOpen, onReasonChange, summaryNote, actions, drawer }: ContentCardViewProps) {
  return <article className={`reading-card ${compact ? "reading-card-compact" : ""}`}>
    <div className="reading-card-meta">
      <span className={`topic-label ${light ? "topic-label-warm" : ""}`}>
        {light ? <><Coffee size={13} /> 换换脑子</> : topic}
      </span>
      <span className="reading-source">{source}</span>
      {seen && <span className="reading-seen"><Check size={12} />已打开</span>}
    </div>
    <h3>{onPreview ? <button type="button" onClick={onPreview}>{content.title}</button>
      : <a href={content.url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>{content.title}</a>}</h3>
    <p className="reading-summary">{content.summary}</p>
    {summaryNote}
    <div className="reading-card-byline">
      {content.authorName && <span>{content.authorName}</span>}
      {content.voteUp > 0 && <span><ThumbsUp size={12} />{content.voteUp.toLocaleString("zh-CN")}</span>}
      <div className="card-actions">
        {actions}
        {onPreview ? <button type="button" className="reading-open" onClick={onPreview}>内容预览<ArrowUpRight size={14} /></button>
          : <a className="reading-open" href={content.url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>去知乎阅读<ArrowUpRight size={14} /></a>}
      </div>
    </div>
    {drawer}
    {reason !== undefined && <details className="reading-reason" onToggle={(e) => onReasonChange?.(e.currentTarget.open)}>
      <summary>为什么推荐{onPreview ? "" : "给你"}<ChevronDown size={13} /></summary>
      <p>{reason}</p>
    </details>}
  </article>;
}
