const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[entity] ?? match;
  });
}

/** 去掉 HTML 标签与 <em> 高亮，压缩空白 */
export function stripHtml(input: string | undefined | null): string {
  if (!input) return "";
  const withBreaks = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<noscript>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1).trimEnd()}…`;
}

/** 归一化检索词，用于缓存 key / fixture 文件名 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[“”"'‘’《》<>【】\[\]()（）:：,，。.!！?？]/g, "")
    .trim();
}

function bigrams(input: string): Set<string> {
  const normalized = normalizeQuery(input).replace(/\s+/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) grams.add(normalized.slice(i, i + 2));
  if (normalized.length === 1) grams.add(normalized);
  return grams;
}

/** 字符 2-gram Dice 相似度，0-1 */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  for (const gram of ga) if (gb.has(gram)) overlap += 1;
  return (2 * overlap) / (ga.size + gb.size);
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
