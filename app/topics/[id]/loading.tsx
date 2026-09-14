import { AppNav } from "@/components/app-nav";
import { DossierSkeleton, SurfaceSkeleton } from "@/components/feed/feed-skeleton";
import { Skeleton } from "@/components/ui-primitives";

export default function TopicLoading() {
  return (
    <>
      <AppNav user={null} pending="product" />
      <main className="product-page" aria-busy="true">
        <div className="product-crumbs"><Skeleton className="h-4 w-28 rounded-full" /></div>
        <header className="product-heading">
          <div><span className="product-eyebrow">看分歧 · 核对依据</span><Skeleton className="h-12 w-72 max-w-full rounded-md" /><Skeleton className="mt-3 h-4 w-56 max-w-full rounded-full" /></div>
        </header>
        <div className="topic-layout">
          <DossierSkeleton />
          <aside className="product-stack"><SurfaceSkeleton lines={3} /><SurfaceSkeleton lines={2} /></aside>
        </div>
      </main>
    </>
  );
}
