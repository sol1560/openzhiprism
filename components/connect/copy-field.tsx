"use client";
import { CopyButton } from "@/components/copy-button";
import { useState } from "react";

/** The selectable field stays available when clipboard permission is denied. */
export function CopyField({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return <div className="connect-copy-wrapper"><div className="connect-copy-field">
    <label className="connect-copy-label"><span>{label}</span>
      {multiline ? <textarea aria-label={label} readOnly value={value} rows={Math.min(value.split("\n").length + 1, 9)} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} /> :
        <input aria-label={label} readOnly value={value} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />}
    </label>
    <CopyButton text={value} label="复制" onCopyResult={setCopied} />
  </div>{copied === false ? <p role="status" className="mt-2 text-xs leading-relaxed text-muted">复制受限，可点选上方文字后手动复制，或点击按钮重试。</p> : null}</div>;
}
