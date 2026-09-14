"use client";

import { useState, type FormEvent } from "react";
import { Spinner } from "@heroui/react";
import { TextShimmer } from "@heroui-pro/react";
import { Send } from "lucide-react";
import type { AskResponse } from "@/lib/feed/types";

/**
 * 「对 Feed 说话」的输入条。卡片级与 Feed 级共用；网络请求由上层的 onAsk 负责。
 * 提交后保留上一次回复与动作标签，直到下一次提交。
 */
export function AskBox({ placeholder, suggestions = [], compact = false, autoFocus = false, onAsk }: {
  placeholder: string;
  suggestions?: string[];
  compact?: boolean;
  autoFocus?: boolean;
  onAsk: (text: string) => Promise<AskResponse>;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onAsk(value);
      setReply(result);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "这次没处理成功");
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <div className={`ask-box ${compact ? "ask-box-compact" : ""}`}>
      <form className="voice-input" onSubmit={submit}>
        <input
          className="text-control ask-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={300}
          disabled={pending}
          autoFocus={autoFocus}
        />
        <button type="submit" className="icon-control" aria-label="发送要求" disabled={!draft.trim() || pending}>
          {pending ? <Spinner size="sm" color="current" /> : <Send size={16} />}
        </button>
      </form>

      {suggestions.length > 0 && !pending ? (
        <div className="ask-suggestions">
          {suggestions.map((item) => (
            <button key={item} type="button" className="ask-suggestion" onClick={() => void send(item)}>{item}</button>
          ))}
        </div>
      ) : null}

      {pending ? <TextShimmer className="ask-reply">小棱在处理…</TextShimmer> : null}

      {!pending && reply ? (
        <div className="ask-result" role="status" aria-live="polite">
          <p className="ask-reply">{reply.reply}</p>
          {reply.results.length > 0 ? (
            <div className="ask-chips">
              {reply.results.map((result, index) => (
                <span key={`${result.type}-${index}`} className={result.ok ? "tag tag-accent" : "tag"}>{result.note}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
  );
}
