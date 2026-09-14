import { AppNav } from "@/components/app-nav";
import { PrismMark } from "@/components/logo";
import { Skeleton } from "@/components/ui-primitives";

export default function ExtensionLoading() {
  return (
    <>
      <AppNav user={null} pending="public" />
      <main className="product-page extension-page" aria-busy="true">
        <header className="extension-heading"><PrismMark className="size-12" /><span className="product-eyebrow">知棱浏览器插件</span>
          <h1>这段聊天，<br />值得继续探索。</h1>
          <p>在 ChatGPT 或 Claude 中点一下知棱图标。聊天里的兴趣，成为你的下一份推荐。</p>
          <Skeleton className="h-11 w-52 rounded-full" />
        </header>
        <section className="product-surface surface-stack" aria-hidden="true"><Skeleton className="h-5 w-40 rounded-md" /><Skeleton className="h-40 w-full rounded-xl" /></section>
      </main>
    </>
  );
}
