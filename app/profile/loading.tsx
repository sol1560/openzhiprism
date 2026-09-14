import { AppNav } from "@/components/app-nav";
import { SurfaceSkeleton } from "@/components/feed/feed-skeleton";
import { Skeleton } from "@/components/ui-primitives";

export default function ProfileLoading() {
  return (
    <>
      <AppNav user={null} pending="product" />
      <main className="product-page" aria-busy="true">
        <header className="product-heading">
          <div><span className="product-eyebrow">从你的对话中，慢慢清晰</span><h1>兴趣画像</h1><Skeleton className="mt-3 h-4 w-72 max-w-full rounded-full" /></div>
        </header>
        <div className="profile-layout">
          <section className="product-surface surface-stack" aria-hidden="true">
            <Skeleton className="h-5 w-48 rounded-md" />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-4/5 rounded-md" /><Skeleton className="h-6 w-3/5 rounded-md" /><Skeleton className="h-6 w-2/5 rounded-md" />
            </div>
            <div className="flex flex-col gap-2"><Skeleton className="h-3.5 w-full rounded-md" /><Skeleton className="h-3.5 w-11/12 rounded-md" /><Skeleton className="h-3.5 w-3/4 rounded-md" /></div>
          </section>
          <div className="flex min-w-0 flex-col gap-6"><SurfaceSkeleton lines={3} /><SurfaceSkeleton lines={4} /></div>
        </div>
        <dl className="profile-stats" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => <div key={index}><Skeleton className="h-3 w-16 rounded-full" /><Skeleton className="my-2 h-7 w-12 rounded-md" /><Skeleton className="h-3 w-24 rounded-full" /></div>)}
        </dl>
      </main>
    </>
  );
}
