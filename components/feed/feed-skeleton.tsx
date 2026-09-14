import { Skeleton } from "@/components/ui-primitives";

/** 与 `.reading-card` 同几何的骨架卡，构建中占位，避免页面空白 */
export function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <article className={`reading-card ${compact ? "reading-card-compact" : ""}`} aria-hidden="true">
      <div className="reading-card-meta">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-4/5 rounded-md" />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full rounded-md" />
        <Skeleton className="h-3.5 w-11/12 rounded-md" />
        <Skeleton className="h-3.5 w-2/3 rounded-md" />
      </div>
      <div className="reading-card-byline">
        <Skeleton className="h-3 w-14 rounded-full" />
        <Skeleton className="h-3 w-10 rounded-full" />
      </div>
      <div className="h-9" />
    </article>
  );
}

export function FeedSkeleton({ count = 5, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className="reading-list" role="status" aria-label="正在生成内容">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} compact={compact} />
      ))}
    </div>
  );
}

/** 与 `.product-surface` 同几何的骨架块：标题一行 + 若干文字行 */
export function SurfaceSkeleton({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <section className="product-surface surface-stack" aria-hidden="true">
      {title ? <Skeleton className="h-4 w-32 rounded-full" /> : null}
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className={`h-3.5 rounded-md ${index === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </section>
  );
}

/** 「看分歧与依据」页的骨架：核心问题卡 + 一组立场卡 */
export function DossierSkeleton() {
  return (
    <div className="product-stack" aria-hidden="true">
      <section className="product-surface surface-lead surface-stack">
        <Skeleton className="h-3 w-16 rounded-full" />
        <Skeleton className="h-6 w-4/5 rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full rounded-md" />
          <Skeleton className="h-3.5 w-11/12 rounded-md" />
          <Skeleton className="h-3.5 w-3/4 rounded-md" />
        </div>
      </section>
      <section className="product-surface surface-stack">
        <Skeleton className="h-4 w-24 rounded-full" />
        <div className="position-grid">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </section>
    </div>
  );
}
