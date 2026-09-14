export type DetectionLabel = "ai" | "assisted" | "human" | "mixed" | "unknown";
export type DetectionStatus = "not_requested" | "pending" | "ready" | "unavailable" | "error" | "submission_unknown";
export interface DetectionSegment {
  text: string;
  label: DetectionLabel;
  confidence: "High" | "Medium" | "Low" | "Unknown";
  startIndex: number;
  endIndex: number;
}
/** Tolerated differences between the sent text and the provider's echo; shown to the reader, never fatal. */
export type DetectionNote = "text_mismatch" | "unexpected_version" | "dropped_windows";
export interface DetectionResult {
  label: DetectionLabel;
  version: string;
  fractions: { ai: number; assisted: number; human: number };
  segments: DetectionSegment[];
  notes?: DetectionNote[];
}
export interface DetectionSummary {
  status: DetectionStatus;
  message?: string;
  label?: DetectionLabel;
  checkedAt?: string;
}
export interface DetectionView extends DetectionSummary {
  contentId: string;
  source?: { text: string; hash: string; provider: string; fetchedAt: string | null; truncated: boolean | null };
  result?: DetectionResult;
  retryAfterMs?: number;
  /** "poll": the task exists and its result can be re-read for free; "submit": the submission never reached the provider. */
  retry?: "poll" | "submit";
}
export const DETECTION_LABELS: Record<DetectionLabel, string> = {
  ai: "疑似 AI 生成", assisted: "疑似 AI 辅助", human: "倾向人工写作", mixed: "混合写作特征", unknown: "暂无法分类",
};
export const DETECTION_NOTE_LABELS: Record<DetectionNote, string> = {
  text_mismatch: "检测服务返回的正文与送检片段略有差异，结果仍按返回值展示。",
  unexpected_version: "检测服务的版本与预期不同。",
  dropped_windows: "有些分段没能对上送检原文，已略去。",
};
