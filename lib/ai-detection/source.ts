import type { ZhihuItem } from "@/lib/zhihu/types";
import { prepareSource } from "./text";

export function sourceValues(item: ZhihuItem) {
  // A newer result without body must invalidate a previously detected source.
  if (!item.content?.trim()) return { sourceText: null, sourceHash: null, sourceProvider: item.provider, sourceFetchedAt: item.sourceFetchedAt ? new Date(item.sourceFetchedAt) : null, sourceTruncated: null };
  const source = prepareSource(item.content);
  return {
    sourceText: source.text,
    sourceHash: source.hash,
    sourceProvider: item.provider,
    sourceFetchedAt: item.sourceFetchedAt ? new Date(item.sourceFetchedAt) : null,
    // Old snapshots did not retain truncation metadata. Do not claim completeness.
    sourceTruncated: source.truncated || item.contentTruncated === true || item.content.endsWith("…") ? true : item.contentTruncated ?? null,
  };
}

