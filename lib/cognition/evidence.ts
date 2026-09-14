import { createHash } from "node:crypto";
import { stripHtml } from "@/lib/zhihu/text";
import type { ZhihuItem } from "@/lib/zhihu/types";
import type { CitedText, DossierAnalysis, EvidenceRef, ExtractionDraft, SourceSnapshot } from "./types";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const canonicalText = (text: string) => stripHtml(text).normalize("NFC").replace(/\r\n/g, "\n").trim();
/** Provider IDs may differ for the same answer. Public URL identity is stable across providers. */
export function sourceIdentity(item: { id: string; url: string }): string {
  try {
    const url = new URL(item.url);
    if (url.hostname === "zhihu.com" || url.hostname.endsWith(".zhihu.com")) {
      const answer = url.pathname.match(/\/answer\/(\d+)/)?.[1];
      if (answer) return `answer:${answer}`;
      const article = url.pathname.match(/^\/p\/(\d+)/)?.[1];
      if (article) return `article:${article}`;
    }
  } catch { /* Invalid URLs are rejected by snapshotItem. */ }
  return item.id;
}
export function snapshotItem(item: ZhihuItem): SourceSnapshot | null {
  let url: URL;
  try { url = new URL(item.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "zhihu.com" || url.hostname.endsWith(".zhihu.com"))) return null;
  const body = item.content?.trim();
  const original = canonicalText(body || item.excerpt || "");
  if (original.length < 8 || item.type === "question" || item.type === "hot") return null;
  const text = [...original].slice(0, 4000).join("");
  const hash = digest(text);
  const identity = sourceIdentity(item);
  return { id: digest(`${identity}:${hash}`), contentId: item.id, identity, hash,
    title: canonicalText(item.title), url: url.href, author: item.author?.name ? canonicalText(item.author.name) : null,
    provider: item.provider, text, fetchedAt: new Date(item.sourceFetchedAt || Date.now()).toISOString(),
    scope: body ? "body_fragment" : "search_excerpt", truncated: !body || item.contentTruncated !== false || text !== original };
}

/** Quotes are accepted only when they occur verbatim in the immutable source. */
export function validateEvidence(draft: ExtractionDraft, sources: SourceSnapshot[]): { evidence: EvidenceRef[]; rejected: number } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>(); const evidence: EvidenceRef[] = []; let rejected = 0;
  const perSource = new Map<string, number>();
  for (const item of draft.items) {
    const source = byId.get(item.snapshotId);
    const quote = item.quote.normalize("NFC").trim();
    const start = source?.text.indexOf(quote) ?? -1;
    if (!source || quote.length < 8 || start < 0 || !item.claim.trim()) { rejected++; continue; }
    const id = digest(`${source.id}:${start}:${quote}`);
    if (seen.has(id)) continue;
    if (evidence.length >= 24 || (perSource.get(source.id) ?? 0) >= 2) continue;
    seen.add(id);
    perSource.set(source.id, (perSource.get(source.id) ?? 0) + 1);
    const end = start + quote.length;
    evidence.push({ id, snapshotId: source.id, quote, start, end,
      before: source.text.slice(Math.max(0, start - 140), start), after: source.text.slice(end, end + 140),
      claim: item.claim.trim(), condition: item.condition?.trim() || null });
  }
  return { evidence, rejected };
}

export function validateCitedText(value: CitedText, evidence: EvidenceRef[]): CitedText | null {
  const known = new Set(evidence.map((e) => e.id));
  if (!value.text.trim() || !value.evidenceIds.length || value.evidenceIds.some((id) => !known.has(id))) return null;
  return { text: value.text.trim(), evidenceIds: [...new Set(value.evidenceIds)] };
}
export function validateAnalysis(raw: DossierAnalysis, evidence: EvidenceRef[]): DossierAnalysis {
  const clean = (rows: CitedText[]) => rows.flatMap((row) => { const v = validateCitedText(row, evidence); return v ? [v] : []; });
  return {
    summary: validateCitedText(raw.summary, evidence) ?? { text: "材料不足以支持综合判断，请先核对下方来源。", evidenceIds: [] },
    dimensions: raw.dimensions.slice(0, 4).map((d) => ({ title: d.title, positions: d.positions.map((p) => ({ label: p.label, claims: clean(p.claims) })).filter((p) => p.claims.length) })).filter((d) => d.positions.length),
    consensus: clean(raw.consensus).filter((c) => new Set(c.evidenceIds.map((id) => evidence.find((e) => e.id === id)?.snapshotId)).size >= 2), conditions: clean(raw.conditions), counterexamples: clean(raw.counterexamples),
    openQuestions: raw.openQuestions.filter(Boolean),
  };
}
export function materialsOnly(): DossierAnalysis {
  return { summary: { text: "已保留检索材料；尚无通过证据校验的综合分析。", evidenceIds: [] }, dimensions: [], consensus: [], conditions: [], counterexamples: [], openQuestions: [] };
}
