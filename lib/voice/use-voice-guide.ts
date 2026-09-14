"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/react";
import type { FeedView } from "@/lib/feed/types";
import type { CognitionContext } from "@/lib/cognition/voice";
import type { DossierView } from "@/lib/cognition/types";
import type { DynamicVariables } from "./agent-config";
import type { VoiceBus } from "./context";
import { createVoiceTools, type VoiceTools } from "./tools";

/**
 * 语音向导的会话控制：换取 signed URL → Conversation.startSession（WebSocket）→ clientTools 接本站 API 与页面。
 * 直接驱动 @elevenlabs/client 的 Conversation 实例，避免 Provider 层；所有页面回调走 ref，工具表在会话期间保持稳定。
 */

export type VoiceGuideState = "unconfigured" | "idle" | "preparing" | "connecting" | "listening" | "speaking" | "ended" | "error";

export interface TranscriptLine { source: "ai" | "user"; text: string; at: number }

export interface VoiceGuideOptions {
  cognitionContext?: CognitionContext;
  enabled: boolean;
  feed: FeedView;
  markSeen(contentIds: string[]): Promise<void>;
  rebuild(force: boolean): Promise<void>;
  bus: VoiceBus | null;
}

interface SessionPayload { signedUrl: string; dynamicVariables: DynamicVariables; expiresAt: number }

const FOCUS_MS = 2600;
const VIEWPORT_DEBOUNCE_MS = 1500;
const MAX_LINES = 40;

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `请求失败（${response.status}）`);
  return data;
}

function reduceMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "浏览器没有授权麦克风，可以改用文字模式。";
  if (name === "NotFoundError") return "没有检测到麦克风，可以改用文字模式。";
  if (name === "SecurityError" || name === "TypeError") return "麦克风需要 https 或 localhost 才能使用，可以改用文字模式。";
  return `麦克风不可用：${error instanceof Error ? error.message : String(error)}`;
}

export function useVoiceGuide(options: VoiceGuideOptions) {
  const { enabled, feed, bus } = options;
  const [rawState, setState] = useState<VoiceGuideState>("idle");
  // 未配置时无论内部状态如何都视为 unconfigured，不需要 effect 同步
  const state: VoiceGuideState = enabled ? rawState : "unconfigured";
  const [error, setError] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [recap, setRecap] = useState<string | null>(null);

  const conversation = useRef<Conversation | null>(null);
  const feedRef = useRef(feed);
  const cognitionRef = useRef(options.cognitionContext);
  useEffect(() => {
    cognitionRef.current = options.cognitionContext;
    if (options.cognitionContext) conversation.current?.sendContextualUpdate(`当前话题上下文（ID 不要朗读）：${JSON.stringify(options.cognitionContext)}。用这些标识继续，不要创建重复会话。`);
  }, [options.cognitionContext]);
  const markSeenRef = useRef(options.markSeen);
  const rebuildRef = useRef(options.rebuild);
  const stateRef = useRef(state);
  const focused = useRef<{ node: HTMLElement; timer: number } | null>(null);
  const lastAgentLine = useRef<string | null>(null);
  const lastViewed = useRef<string | null>(null);
  const viewTimer = useRef<number | null>(null);

  useEffect(() => { feedRef.current = feed; }, [feed]);
  useEffect(() => { markSeenRef.current = options.markSeen; }, [options.markSeen]);
  useEffect(() => { rebuildRef.current = options.rebuild; }, [options.rebuild]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const connected = () => conversation.current?.isOpen() === true;

  const focusCard = useCallback((cardId: string): boolean => {
    if (typeof document === "undefined") return false;
    const node = document.getElementById(`card-${cardId}`) ?? document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
    if (!node) return false;
    if (focused.current) { focused.current.node.removeAttribute("data-focused"); window.clearTimeout(focused.current.timer); }
    node.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    node.setAttribute("data-focused", "");
    focused.current = { node, timer: window.setTimeout(() => { node.removeAttribute("data-focused"); focused.current = null; }, FOCUS_MS) };
    return true;
  }, []);

  // 工具表在事件处理里按需创建一次；回调经 ref 取最新值，会话期间对象保持稳定
  const toolsRef = useRef<VoiceTools | null>(null);
  const getTools = useCallback((): VoiceTools => {
    toolsRef.current ??= createVoiceTools({
      data: { fetchJson },
      ui: {
        onContentFeedback: (contentId, kind) => bus?.emit({ type: "content_feedback", contentId, kind }),
        cognitionContext: () => cognitionRef.current ?? {},
        focusCard,
        openCard: (url) => Boolean(window.open(url, "_blank", "noopener,noreferrer")),
        markSeen: (ids) => markSeenRef.current(ids),
        rebuild: (force) => rebuildRef.current(force),
      },
    });
    return toolsRef.current;
  }, [focusCard, bus]);

  const pushLine = useCallback((source: "ai" | "user", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (source === "ai") lastAgentLine.current = trimmed;
    setLines((current) => [...current, { source, text: trimmed, at: Date.now() }].slice(-MAX_LINES));
  }, []);

  const end = useCallback(async () => {
    const current = conversation.current;
    conversation.current = null;
    if (current) await current.endSession().catch(() => undefined);
    setRecap(lastAgentLine.current);
    setState((value) => (value === "error" ? value : "ended"));
  }, []);

  const start = useCallback(async (opts: { textMode: boolean }) => {
    if (!enabled || stateRef.current === "preparing" || stateRef.current === "connecting" || connected()) return;
    setError(null);
    setLines([]);
    setRecap(null);
    lastAgentLine.current = null;
    setTextMode(opts.textMode);
    setState("preparing");
    if (!opts.textMode) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("insecure", "SecurityError");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch (caught) {
        setError(micErrorMessage(caught));
        setState("error");
        return;
      }
    }
    let session: SessionPayload;
    try {
      session = (await fetchJson("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })) as SessionPayload;
      if (Date.now() > session.expiresAt) session = (await fetchJson("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })) as SessionPayload;
      if (cognitionRef.current?.jobId) {
        const current = await fetchJson(`/api/dossiers?id=${encodeURIComponent(cognitionRef.current.jobId)}`) as DossierView;
        session.dynamicVariables = { ...session.dynamicVariables, spoken_script: `我们接着看「${current.topic}」。我可以帮你核对原文，或者一起想清楚。`, next_prompt: cognitionRef.current.inquiryId ? "要接着上次的思辨吗？" : "想先看哪条依据？" };
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
      return;
    }
    setState("connecting");
    try {
      const instance = await Conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: "websocket",
        dynamicVariables: session.dynamicVariables,
        clientTools: getTools(),
        textOnly: opts.textMode,
        onConnect: () => setState("listening"),
        onModeChange: ({ mode }) => { if (stateRef.current !== "error" && stateRef.current !== "ended") setState(mode === "speaking" ? "speaking" : "listening"); },
        onStatusChange: ({ status }) => {
          if (status === "disconnected") {
            conversation.current = null;
            setRecap(lastAgentLine.current);
            setState((value) => (value === "error" ? value : "ended"));
          }
        },
        onMessage: ({ message, source }) => pushLine(source === "ai" ? "ai" : "user", message),
        onError: (message) => { setError(message || "语音连接出错"); setState("error"); },
      });
      conversation.current = instance;
      if (cognitionRef.current) instance.sendContextualUpdate(`当前话题上下文（ID 不要朗读）：${JSON.stringify(cognitionRef.current)}。先读取证据或已有思辨，用同一组标识继续。`);
      setMuted(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
    }
  }, [enabled, pushLine, getTools]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !connected()) return;
    conversation.current?.sendUserMessage(trimmed);
    pushLine("user", trimmed);
  }, [pushLine]);

  const toggleMute = useCallback(() => {
    if (!connected()) return;
    setMuted((value) => { conversation.current?.setMicMuted(!value); return !value; });
  }, []);

  const getFrequencyData = useCallback((): Uint8Array | null => {
    try { return connected() ? conversation.current!.getOutputByteFrequencyData() : null; } catch { return null; }
  }, []);

  // 页面事件 → 上下文更新（不触发回复）
  useEffect(() => {
    if (!bus) return;
    return bus.subscribe((event) => {
      if (!connected()) return;
      const send = (text: string) => conversation.current?.sendContextualUpdate(text);
      if (event.type === "card_opened") send(`用户手动打开了卡片《${event.title}》（cardId ${event.cardId}），已标记已读。`);
      if (event.type === "feed_rebuilt") send(`Feed 已重新生成，共 ${event.count} 条。请用 get_today_feed 重新读取并简短汇报。`);
      if (event.type === "build_failed") send(`Feed 生成失败：${event.error}。告诉用户并建议稍后重试。`);
    });
  }, [bus]);

  // 视口里的卡片 → 上下文更新，agent 说话时不打扰
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (state !== "listening" && state !== "speaking") return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-card-id]"));
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const cardId = visible?.target.getAttribute("data-card-id");
      if (!cardId || cardId === lastViewed.current || document.hidden) return;
      if (viewTimer.current) window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => {
        if (stateRef.current !== "listening" || !connected()) return;
        const position = feedRef.current.cards.findIndex((card) => card.id === cardId);
        const card = feedRef.current.cards[position];
        if (!card) return;
        lastViewed.current = cardId;
        const title = card.content?.title ?? card.perspective?.question ?? "";
        conversation.current?.sendContextualUpdate(`用户现在看着第 ${position + 1} 条《${title}》（cardId ${cardId}）。`);
      }, VIEWPORT_DEBOUNCE_MS);
    }, { threshold: 0.6 });
    for (const node of nodes) observer.observe(node);
    return () => { observer.disconnect(); if (viewTimer.current) window.clearTimeout(viewTimer.current); };
  }, [state, feed.cards.length]);

  useEffect(() => () => { void conversation.current?.endSession().catch(() => undefined); conversation.current = null; }, []);

  const transcript = useMemo(() => ({
    lines,
    agent: [...lines].reverse().find((line) => line.source === "ai")?.text ?? null,
    user: [...lines].reverse().find((line) => line.source === "user")?.text ?? null,
  }), [lines]);

  return { state, error, textMode, muted, transcript, recap, start, end, sendText, toggleMute, getFrequencyData };
}
