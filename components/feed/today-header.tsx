"use client";

import type { ReactNode } from "react";
import { Spinner } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { ProgressPanel } from "@/components/progress-panel";
import type { DailyBrief } from "@/lib/feed/types";

/**
 * Today 头部：标题固定（不随简报替换，避免跳动），右侧一行操作；
 * 下面是语音面板槽（连接/进行中才出现）和简报卡。
 */
export function TodayHeader({
  date, brief, loading, readOnly, building, countsLine, showRebuild, onRebuild, voiceStart, voicePanel,
}: {
  date: string;
  brief: DailyBrief | null;
  loading: boolean;
  readOnly: boolean;
  building: boolean;
  countsLine: string;
  showRebuild: boolean;
  onRebuild: () => void;
  voiceStart?: ReactNode;
  voicePanel?: ReactNode;
}) {
  const highlights = brief?.highlights.slice(0, 3) ?? [];
  const hasBrief = Boolean(brief && (brief.summary || highlights.length > 0 || brief.continuity.length > 0));
  return (
    <header className="today-header">
      <div className="product-heading">
        <div>
          <span className="product-eyebrow">{readOnly ? `${date} 的阅读` : "属于你的阅读时间"}</span>
          <h1>{readOnly ? `${date} 的 Feed` : "今日 Feed"}</h1>
          <p>{countsLine}</p>
        </div>
        <div className="product-heading-actions">
          {voiceStart}
          {showRebuild && !readOnly ? (
            <button type="button" className="text-control" disabled={building} onClick={onRebuild}>
              {building ? <Spinner size="sm" color="current" /> : <RefreshCw size={14} />}
              {building ? "生成中…" : "重新生成"}
            </button>
          ) : null}
        </div>
      </div>

      {voicePanel}

      {loading && !brief ? (
        <div className="today-brief product-surface"><ProgressPanel slim title="小棱在整理今天的导读…" /></div>
      ) : null}

      {brief && hasBrief ? (
        <section className="today-brief product-surface prism-border" aria-label="今日导读">
          {brief.headline ? <p className="brief-headline">{brief.headline}</p> : null}
          {brief.summary ? <p className="brief-summary">{brief.summary}</p> : null}
          {highlights.length > 0 ? (
            <ul className="brief-list">
              {highlights.map((item) => (
                <li key={item.cardId}>
                  <a className="brief-item" href={`#card-${item.cardId}`}>
                    <span className="tag tag-warm">先看</span>
                    <span className="brief-item-body">
                      <span className="brief-item-title">{item.title}</span>
                      <span className="brief-item-why">{item.topicName ? `${item.topicName} · ` : ""}{item.why}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {brief.continuity.map((line) => <p key={line} className="brief-summary"><span className="tag tag-warm">接着看</span>{line}</p>)}
          {brief.followups?.map((item) => (
            <a key={item.reflectionId} className="brief-item" href={`/topics/${item.jobId}`}>
              <span className="tag tag-accent">接着想</span>
              <span className="brief-item-body">
                <span className="brief-item-title">{item.question}</span>
                <span className="brief-item-why">有新材料：{item.titles.join("；")}。要不要改判断，由你决定。</span>
              </span>
            </a>
          ))}
          {brief.perspectiveHint ? <p className="brief-summary">{brief.perspectiveHint}</p> : null}
        </section>
      ) : null}
    </header>
  );
}
