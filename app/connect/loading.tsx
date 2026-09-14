import { AppNav } from "@/components/app-nav";
import { Skeleton } from "@/components/ui-primitives";

export default function ConnectLoading() {
  return (
    <>
      <AppNav user={null} pending="public" />
      <main className="product-page connect-page" aria-busy="true">
        <span className="product-eyebrow">连接 AI</span>
        <h1 className="product-title">把知棱带到你的 AI 助手。</h1>
        <p className="connect-intro">选一个你常用的助手，接好后直接问它：我的兴趣画像是什么？<br className="hidden sm:block" />聊过的问题，就有了继续探索的起点。</p>
        <div className="install-guide" aria-hidden="true">
          <div className="install-tabs">{[0, 1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div>
          <div className="install-panel surface-stack"><Skeleton className="h-5 w-40 rounded-md" /><Skeleton className="h-40 w-full rounded-xl" /></div>
        </div>
      </main>
    </>
  );
}
