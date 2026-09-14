"use client";

import type { ReactNode } from "react";
import { ProgressBar, Spinner } from "@heroui/react";
import { TextShimmer } from "@heroui-pro/react";
import { Check } from "lucide-react";

export interface ProgressStage { key: string; label: string }

/**
 * 统一的等待面板：一句话 + 进度条。完整版再列出阶段、预期时长和骨架；
 * `slim` 版只占一行，用于简报、语音连接、检测读取这类小等待。
 */
export function ProgressPanel({ title, stages, current, expected, slim = false, actions, children }: {
  title: string;
  stages?: ProgressStage[];
  /** 当前阶段 key；缺省或未知表示排队中 */
  current?: string | null;
  expected?: string;
  slim?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const index = stages && current ? stages.findIndex((stage) => stage.key === current) : -1;
  const value = stages && index >= 0 ? Math.round(((index + 0.5) / stages.length) * 100) : undefined;
  return (
    <section className={`progress-panel${slim ? " progress-panel-slim" : ""}`} role="status" aria-live="polite">
      <div className="progress-head">
        <Spinner size="sm" />
        <TextShimmer className="text-sm">{title}</TextShimmer>
        {stages && index >= 0 ? <span className="progress-count">{index + 1}/{stages.length}</span> : null}
      </div>
      <ProgressBar aria-label={title} value={value} isIndeterminate={value === undefined} color="accent" size="sm">
        <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
      </ProgressBar>
      {!slim && stages ? (
        <ol className="progress-stages">
          {stages.map((stage, i) => {
            const state = i < index ? "done" : i === index ? "active" : "todo";
            return (
              <li key={stage.key} data-state={state}>
                <span className="progress-mark">{state === "done" ? <Check size={11} /> : state === "active" ? <span className="live-dot" /> : null}</span>
                {stage.label}
              </li>
            );
          })}
        </ol>
      ) : null}
      {!slim && expected ? <p className="progress-expected">{expected}</p> : null}
      {actions ? <div className="action-row">{actions}</div> : null}
      {children}
    </section>
  );
}
