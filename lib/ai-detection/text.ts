import { createHash } from "node:crypto";
export const DETECTION_MODEL = "pangram-4";
export const PROCESSING_VERSION = "source-v1";
export const MAX_SOURCE_CHARS = 4000;
export function hashText(text: string) { return createHash("sha256").update(text).digest("hex"); }
export function prepareSource(input: string) {
  const points = Array.from(input.trim());
  const text = points.slice(0, MAX_SOURCE_CHARS).join("");
  return { text, hash: hashText(text), truncated: points.length > MAX_SOURCE_CHARS };
}
export function countWords(text: string) {
  return [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)].filter((part) => part.isWordLike).length;
}
export function estimateCents(text: string) {
  return Math.max(1, Math.ceil(Array.from(text).filter((char) => !/\s/u.test(char)).length / 100)) * 5;
}
