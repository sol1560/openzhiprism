"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, label = "复制", onCopyResult }: { text: string; label?: string; onCopyResult?: (copied: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setFailed(false);
      onCopyResult?.(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); setFailed(true); onCopyResult?.(false); }
  };
  return (
    <Button variant="secondary" size="sm" aria-label={copied ? "已复制" : failed ? "复制失败，请重试" : label || "复制这段内容"} onPress={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span aria-live="polite">{copied ? "已复制" : failed ? "重试复制" : label}</span>
    </Button>
  );
}
