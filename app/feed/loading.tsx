import { AppNav } from "@/components/app-nav";
import { FeedSkeleton, SurfaceSkeleton } from "@/components/feed/feed-skeleton";
import { Skeleton } from "@/components/ui-primitives";

/** 页面是 force-dynamic：导航期间先给一个与真实布局同几何的壳，导航栏也是真的，不会闪 */
export default function FeedLoading() {
  return (
    <>
      <AppNav user={null} pending="product" />
      <main className="flex-1" aria-busy="true">
        <div className="product-page"><div className="feed-layout">
          <div className="product-stack">
            <header className="today-header"><div className="product-heading">
              <div><span className="product-eyebrow">属于你的阅读时间</span><h1>今日 Feed</h1><Skeleton className="mt-3 h-4 w-64 max-w-full rounded-full" /></div>
            </div></header>
            <FeedSkeleton count={4} />
          </div>
          <aside className="feed-sidebar"><SurfaceSkeleton lines={4} /><SurfaceSkeleton lines={2} /></aside>
        </div></div>
      </main>
    </>
  );
}
