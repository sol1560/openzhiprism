import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { DemoVideoPlayer } from "@/components/video/demo-video-player";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "演示视频 · 知棱", description: "两分钟了解知棱：从对话中发现兴趣，主动打破信息茧房。提供中文与英文两个版本。" };

export default async function VideoPage() {
  const user = await getSessionUser();
  return <>
    <AppNav user={user} />
    <main id="main-content" className="product-page video-page">
      <span className="product-eyebrow">演示视频 · Demo</span>
      <h1 className="product-title">两分钟看懂知棱。</h1>
      <p className="video-intro">从你与 AI 的对话里发现兴趣，生成知乎内容 Feed，再主动补上不同立场。<br className="hidden sm:block" />视频有中文与英文两个版本，点视频上方的按钮切换。</p>
      <DemoVideoPlayer />
      <p className="video-meta">知乎黑客松 2026 · 知识炼金场赛道 · <Link href="/">回到首页</Link> · <Link href="/connect">连接 AI 助手</Link></p>
    </main>
  </>;
}
