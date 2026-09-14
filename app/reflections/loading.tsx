import { AppNav } from "@/components/app-nav";
import { SurfaceSkeleton } from "@/components/feed/feed-skeleton";

export default function ReflectionsLoading() {
  return (
    <>
      <AppNav user={null} pending="product" />
      <main className="product-page" aria-busy="true">
        <header className="product-heading">
          <div><span className="product-eyebrow">读过之后，留下你的判断</span><h1>我的判断</h1><p>只有你确认过的想法才会存在这里。可以留着不确定，也可以随时改。</p></div>
        </header>
        <div className="feed-layout">
          <div className="reading-list"><SurfaceSkeleton lines={4} /><SurfaceSkeleton lines={3} /></div>
          <aside className="feed-sidebar"><SurfaceSkeleton lines={2} /></aside>
        </div>
      </main>
    </>
  );
}
