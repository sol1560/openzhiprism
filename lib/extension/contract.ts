/** Shared, browser-safe contract. No platform credentials or raw HTML cross this boundary. */
export const CAPTURE_VERSION = 1;
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
export type CapturePlatform = "chatgpt" | "claude";
export interface CaptureMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
}
export interface CapturePayload {
  version: 1;
  platform: CapturePlatform;
  externalId: string;
  sourceUrl: string;
  title: string;
  messages: CaptureMessage[];
}
export interface CaptureResult {
  newMessageCount: number;
  newUserMessageCount: number;
  topicCount: number;
  newTopicNames: string[];
  redactedCount: number;
  duplicate: boolean;
  profileUpdated: boolean;
  llm: { provider: string; model: string; live: boolean } | null;
}
export interface CaptureView {
  id: string;
  status: "queued" | "running" | "ready" | "error";
  stage: string;
  error: string | null;
  result: CaptureResult | null;
  feedStatus: "pending" | "running" | "ready" | "error" | null;
}

export function sourceIdentity(value: string): { platform: CapturePlatform; externalId: string; sourceUrl: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const platform = ["chatgpt.com", "chat.openai.com"].includes(url.hostname) ? "chatgpt" : url.hostname === "claude.ai" ? "claude" : null;
    const match = platform === "chatgpt"
      ? url.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})\/?$/i)
      : platform === "claude" ? url.pathname.match(/^\/chat\/([0-9a-f-]{36})\/?$/i) : null;
    if (!platform || !match) return null;
    return { platform, externalId: match[1], sourceUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}` };
  } catch { return null; }
}
