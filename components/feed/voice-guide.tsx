"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Spinner } from "@heroui/react";
import { TextShimmer } from "@heroui-pro/react";
import { AlertTriangle, MessageSquareText, Mic, MicOff, PhoneOff, Send } from "lucide-react";
import type { useVoiceGuide, VoiceGuideState } from "@/lib/voice/use-voice-guide";

export type VoiceGuideHandle = ReturnType<typeof useVoiceGuide>;

const STATE_LABEL: Record<VoiceGuideState, string> = {
  unconfigured: "", idle: "", preparing: "准备中…", connecting: "正在连接小棱…", listening: "小棱在听", speaking: "小棱在说", ended: "这次聊完了", error: "出了点问题",
};

function reduceMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 光球：说话时按输出频谱缩放；减少动画时只显示静态环 */
function Orb({ state, getFrequencyData }: { state: VoiceGuideState; getFrequencyData: () => Uint8Array | null }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== "speaking" || reduceMotion()) { node.current?.style.removeProperty("--voice-level"); return; }
    let frame = 0;
    const tick = () => {
      const data = getFrequencyData();
      if (data && data.length > 0 && node.current) {
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        node.current.style.setProperty("--voice-level", (1 + Math.min(0.45, (sum / data.length / 255) * 1.2)).toFixed(3));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [state, getFrequencyData]);
  return <div ref={node} className={`voice-orb ${state === "speaking" ? "is-speaking" : ""} ${state === "listening" ? "is-listening" : ""} ${state === "connecting" || state === "preparing" ? "is-idle" : ""}`} aria-hidden="true" />;
}

/** 标题区里的入口：一颗按钮开始语音，旁边一个安静的「用文字聊」。只在 idle 时出现。 */
export function VoiceStart({ guide, label }: { guide: VoiceGuideHandle; label: string }) {
  if (guide.state !== "idle") return null;
  return (
    <>
      <button type="button" className="pill-button pill-secondary pill-small" onClick={() => void guide.start({ textMode: false })}>
        <Mic size={14} /> {label}
      </button>
      <button type="button" className="text-control" onClick={() => void guide.start({ textMode: true })}>
        <MessageSquareText size={14} /> 用文字聊
      </button>
    </>
  );
}

/**
 * 语音面板：连接、进行中、结束、出错时占标题下整宽一块；idle / 未配置时不渲染。
 * 状态机由 useVoiceGuide 持有（在页面层调用），这里只画。
 */
export function VoicePanel({ guide }: { guide: VoiceGuideHandle }) {
  const [draft, setDraft] = useState("");
  const { state } = guide;
  if (state === "unconfigured" || state === "idle") return null;

  const live = state === "listening" || state === "speaking";
  const busy = state === "preparing" || state === "connecting";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    guide.sendText(draft);
    setDraft("");
  };

  return (
    <section className={`product-surface voice-panel voice-guide-${state}`} data-text-mode={guide.textMode || undefined} aria-label="小棱">
      <div className="voice-guide-row">
        <Orb state={state} getFrequencyData={guide.getFrequencyData} />
        <div className="voice-guide-status">
          {busy ? (
            <span className="flex items-center gap-2 text-sm"><Spinner size="sm" /><TextShimmer className="text-sm">{STATE_LABEL[state]}</TextShimmer></span>
          ) : (
            <span className={state === "error" ? "tag tag-warm" : "tag tag-accent"}>{STATE_LABEL[state]}{guide.textMode && live ? " · 文字" : ""}</span>
          )}
        </div>
        {live ? (
          <div className="voice-guide-controls">
            {!guide.textMode ? (
              <button type="button" className="icon-control" aria-label={guide.muted ? "取消静音" : "静音"} aria-pressed={guide.muted} onClick={guide.toggleMute}>
                {guide.muted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            ) : null}
            <button type="button" className="icon-control" aria-label="结束" onClick={() => void guide.end()}><PhoneOff size={16} /></button>
          </div>
        ) : null}
      </div>

      {live || busy ? (
        <div className="voice-transcript" role="log" aria-live="polite">
          {guide.transcript.user ? <p className="is-user">{guide.transcript.user}</p> : null}
          {guide.transcript.agent ? <p>{guide.transcript.agent}</p> : busy ? null : <p className="text-muted">{guide.textMode ? "打字问小棱，比如「今天有什么」" : "直接说，或者打字，比如「今天有什么」"}</p>}
        </div>
      ) : null}

      {live ? (
        <form className="voice-input" onSubmit={submit}>
          <input className="text-control" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="也可以打字问小棱…" aria-label="给小棱发文字" />
          <button type="submit" className="icon-control" aria-label="发送" disabled={!draft.trim()}><Send size={16} /></button>
        </form>
      ) : null}

      {state === "ended" ? (
        <div className="voice-guide-ended">
          {guide.recap ? <p className="voice-recap">{guide.recap}</p> : null}
          <div className="voice-guide-actions">
            <button type="button" className="pill-button pill-secondary pill-small" onClick={() => void guide.start({ textMode: false })}><Mic size={14} /> 再听一遍</button>
            <button type="button" className="text-control" onClick={() => void guide.start({ textMode: true })}><MessageSquareText size={14} /> 用文字聊</button>
          </div>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="inline-note inline-note-warm">
          <AlertTriangle size={16} />
          <div className="inline-note-body"><strong>小棱暂时连不上</strong>{guide.error ?? "请稍后再试"}</div>
          <div className="inline-note-actions">
            <button type="button" className="pill-button pill-secondary pill-small" onClick={() => void guide.start({ textMode: false })}>再试一次</button>
            <button type="button" className="text-control" onClick={() => void guide.start({ textMode: true })}>改用文字</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
