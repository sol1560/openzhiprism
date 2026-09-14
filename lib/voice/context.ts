"use client";

import { createContext, useContext } from "react";
import type { ContentFeedback } from "@/lib/cognition/types";

/** 页面 → 语音向导的事件总线：卡片被手动打开、Feed 重建完成 / 失败。Set 订阅，零依赖。 */

export type VoiceEvent =
  | { type: "content_feedback"; contentId: string; kind: ContentFeedback | null }
  | { type: "card_opened"; cardId: string; contentId: string; title: string }
  | { type: "feed_rebuilt"; count: number }
  | { type: "build_failed"; error: string };

export interface VoiceBus {
  emit(event: VoiceEvent): void;
  subscribe(listener: (event: VoiceEvent) => void): () => void;
}

export function createVoiceBus(): VoiceBus {
  const listeners = new Set<(event: VoiceEvent) => void>();
  return {
    emit(event) { for (const listener of listeners) listener(event); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const VoiceBusContext = createContext<VoiceBus | null>(null);

export function useVoiceBus(): VoiceBus | null {
  return useContext(VoiceBusContext);
}
