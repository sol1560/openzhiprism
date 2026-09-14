import { z } from "zod";
import type { DetectionLabel, DetectionNote, DetectionResult } from "./types";
import { DETECTION_MODEL } from "./text";

const BASE = "https://text.external-api.pangram.com/task";
export class PangramError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
const fraction = z.number().finite().min(0).max(1);
const windowSchema = z.object({
  text: z.string().max(20000), label: z.string().max(200), confidence: z.string().max(80),
  start_index: z.number().int().nonnegative(), end_index: z.number().int().nonnegative(),
});
const successSchema = z.object({
  text: z.string(), version: z.string().min(1).max(80), prediction_short: z.string().max(200).default(""),
  fraction_ai: fraction, fraction_ai_assisted: fraction, fraction_human: fraction,
  windows: z.array(windowSchema).max(4000).default([]),
});
function label(value: string): DetectionLabel {
  if (["AI", "AI-Generated"].includes(value)) return "ai";
  if (["AI-Assisted", "Lightly AI-Assisted", "Moderately AI-Assisted"].includes(value)) return "assisted";
  if (["Human", "Human Written"].includes(value)) return "human";
  return value === "Mixed" ? "mixed" : "unknown";
}
/** Whitespace and Unicode-form differences between what we sent and what Pangram echoes are not integrity failures. */
const normalize = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
/** Diagnostics never include source text, only shape facts that reveal a provider contract drift. */
function warn(reason: string, facts: Record<string, unknown>) { console.warn(`[ai-detection] ${reason}`, facts); }

export function parseResult(raw: unknown, input: string): DetectionResult {
  const parsed = successSchema.safeParse(raw);
  if (!parsed.success) {
    warn("invalid_result: unexpected response shape", {
      keys: raw && typeof raw === "object" ? Object.keys(raw).slice(0, 20) : typeof raw,
      issues: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.code}`),
    });
    throw new PangramError("invalid_result");
  }
  const data = parsed.data;
  const total = data.fraction_ai + data.fraction_ai_assisted + data.fraction_human;
  if (Math.abs(total - 1) > 0.05) { warn("invalid_result: fractions do not add up", { total }); throw new PangramError("invalid_result"); }
  const expected = normalize(input);
  const notes: DetectionNote[] = [];
  if (normalize(data.text) !== expected) notes.push("text_mismatch");
  if (!/^4(\.|$)/.test(data.version)) notes.push("unexpected_version");
  // Windows are shown as supplied excerpts; one that cannot be located in the sent text is dropped, not fatal.
  let dropped = 0;
  const segments = data.windows.flatMap((window) => {
    if (window.end_index < window.start_index || !expected.includes(normalize(window.text))) { dropped += 1; return []; }
    return [{
      text: window.text, label: label(window.label),
      confidence: ["High", "Medium", "Low"].includes(window.confidence) ? window.confidence as "High" | "Medium" | "Low" : "Unknown" as const,
      startIndex: window.start_index, endIndex: window.end_index,
    }];
  });
  if (dropped > 0) notes.push("dropped_windows");
  if (notes.length > 0) {
    warn("tolerated result differences", { notes, version: data.version, sentChars: expected.length, returnedChars: normalize(data.text).length, windows: data.windows.length, dropped });
  }
  return {
    version: data.version, label: label(data.prediction_short),
    fractions: { ai: data.fraction_ai, assisted: data.fraction_ai_assisted, human: data.fraction_human },
    segments, ...(notes.length > 0 ? { notes } : {}),
  };
}
export interface PangramClient {
  submit(text: string): Promise<string>;
  poll(taskId: string, text: string): Promise<{ stage: "pending" } | { stage: "failed"; code: string } | { stage: "ready"; result: DetectionResult }>;
}
export function createPangramClient(apiKey: string, fetcher: typeof fetch = fetch): PangramClient {
  async function request(url: string, method: "POST" | "GET", body?: unknown) {
    let response: Response;
    try {
      response = await fetcher(url, {
        method, headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "error",
      });
    } catch { throw new PangramError("network", method === "POST"); }
    if (!response.ok) {
      const codes: Record<number, string> = { 400: "invalid_text", 401: "provider_auth", 402: "provider_credits", 403: "provider_auth", 404: "task_missing", 422: "invalid_text", 429: "provider_rate" };
      throw new PangramError(codes[response.status] ?? "provider_error", method === "POST" && response.status >= 500);
    }
    try { return await response.json(); }
    catch { throw new PangramError("invalid_response", method === "POST"); }
  }
  return {
    async submit(text) {
      const raw = await request(BASE, "POST", { text, model: DETECTION_MODEL, public_dashboard_link: false });
      const parsed = z.object({ task_id: z.string().min(1).max(200) }).safeParse(raw);
      if (!parsed.success) throw new PangramError("invalid_response", true);
      return parsed.data.task_id;
    },
    async poll(taskId, text) {
      const raw = await request(`${BASE}/${encodeURIComponent(taskId)}`, "GET") as Record<string, unknown>;
      if (raw.stage === "STAGE_SUCCESS") return { stage: "ready", result: parseResult(raw, text) };
      if (raw.stage === "STAGE_FAILED") return { stage: "failed", code: "provider_failed" };
      if (typeof raw.stage !== "string" || !raw.stage.startsWith("STAGE_")) throw new PangramError("invalid_response");
      return { stage: "pending" };
    },
  };
}
