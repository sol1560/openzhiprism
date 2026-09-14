import { z } from "zod";

export const COGNITION_VERSION = "evidence-3";
export const citationSchema = z.object({ text: z.string().max(600), evidenceIds: z.array(z.string()).max(12) });
export type CitedText = z.infer<typeof citationSchema>;
export interface SourceSnapshot {
  id: string; contentId: string; identity?: string; hash: string; title: string; url: string;
  author: string | null; provider: string; text: string; fetchedAt: string;
  scope: "body_fragment" | "search_excerpt"; truncated: boolean;
}
export interface EvidenceRef {
  id: string; snapshotId: string; quote: string; start: number; end: number;
  before: string; after: string; claim: string; condition: string | null;
}
export const extractionSchema = z.object({
  items: z.array(z.object({ snapshotId: z.string(), quote: z.string().min(8).max(180), claim: z.string().min(2).max(140), condition: z.string().max(160).nullable() })).max(24),
});
export type ExtractionDraft = z.infer<typeof extractionSchema>;
export const synthesisSchema = z.object({
  summary: citationSchema,
  dimensions: z.array(z.object({
    title: z.string().max(100),
    positions: z.array(z.object({ label: z.string().max(70), claims: z.array(citationSchema).max(4) })).max(4),
  })).max(4),
  consensus: z.array(citationSchema).max(5), conditions: z.array(citationSchema).max(6),
  counterexamples: z.array(citationSchema).max(5), openQuestions: z.array(z.string().max(160)).max(6),
});
export type DossierAnalysis = z.infer<typeof synthesisSchema>;
export interface TopicDossier extends DossierAnalysis {
  id: string; question: string; processorVersion: string; createdAt: string;
  sources: SourceSnapshot[]; evidence: EvidenceRef[]; model: string | null;
  quality: "grounded" | "materials_only"; notices: string[];
}
export interface DossierView {
  materials?: SourceSnapshot[];
  jobId: string; topic: string; status: "queued" | "running" | "ready" | "error";
  stage: string; error: string | null; updatedAt: string; dossier: TopicDossier | null;
}
export const reflectionDraftSchema = z.object({
  judgment: z.string().max(2400), conditions: z.array(z.string().max(300)).max(8),
  evidenceIds: z.array(z.string()).max(24), openQuestions: z.array(z.string().max(300)).max(8),
  nextStep: z.string().max(600).nullable(),
});
export type ReflectionDraft = z.infer<typeof reflectionDraftSchema>;
export interface InquiryTurn { text: string; feedback: CitedText; at: string }
export interface InquiryView {
  savedReflectionId?: string;
  id: string; jobId: string; dossierId: string; topic: string; revision: number;
  round: number; status: "discussing" | "draft"; question: string | null;
  turns: InquiryTurn[]; draft: ReflectionDraft | null; notice: string | null;
}
export interface ReflectionVersion extends ReflectionDraft {
  version: number; dossierId: string; inquiryId: string | null; createdAt: string;
}
export interface ReflectionView {
  id: string; jobId: string; topic: string; following: boolean; updatedAt: string;
  versions: ReflectionVersion[]; newSources: Array<{ id: string; title: string; url: string }>;
}
export const feedbackSchema = z.enum(["useful", "known", "irrelevant", "misleading"]);
export type ContentFeedback = z.infer<typeof feedbackSchema>;
export class CognitionError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "CognitionError"; }
}
export function cognitionEnabled() { return process.env.COGNITION_ENABLED !== "false"; }
