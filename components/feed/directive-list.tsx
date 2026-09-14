"use client";

import { X } from "lucide-react";
import type { DirectiveView } from "@/lib/feed/types";

const DIRECTION_LABEL = { more: "多推", less: "少推", mute: "不再推" } as const;

/** 侧栏「我的要求」：用户记下的话题增减与长期规则，可逐条删除 */
export function DirectiveList({ directives, onRemove }: { directives: DirectiveView[]; onRemove: (id: string) => void }) {
  if (directives.length === 0) return null;
  return (
    <section className="product-surface">
      <h2 className="sidebar-title">我的要求</h2>
      <ul className="directive-list">
        {directives.map((directive) => (
          <li key={directive.id}>
            <span className={directive.kind === "topic" ? "tag tag-accent" : "tag"}>
              {directive.kind === "topic" && directive.direction ? DIRECTION_LABEL[directive.direction] : "规则"}
            </span>
            <span className="directive-text">{directive.kind === "topic" ? directive.topic : directive.text}</span>
            <button type="button" className="icon-control directive-remove" aria-label={`删除要求：${directive.text}`} onClick={() => onRemove(directive.id)}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="history-subtitle">下次生成会按这些来。</p>
    </section>
  );
}
