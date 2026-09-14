"use client";

import Link from "next/link";
import { AppNav } from "@/components/app-nav";

/** 服务端渲染抛错时的兜底页，避免用户看到框架默认的错误遮罩 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <AppNav user={null} pending="public" />
      <main id="main-content" className="product-page flex flex-1 items-center justify-center">
        <div className="product-surface surface-stack w-full max-w-md">
          <div><span className="product-eyebrow">出了点问题</span><h1 className="product-section-title">这一页没打开</h1></div>
          <p className="text-sm leading-relaxed text-muted">{error.message || "刚才的请求没有完成。"}</p>
          {error.digest ? <p className="text-xs text-muted">错误编号 {error.digest}</p> : null}
          <div className="action-row">
            <button type="button" className="pill-button pill-primary" onClick={reset}>再试一次</button>
            <Link href="/feed" className="text-control">回到今日 Feed</Link>
          </div>
        </div>
      </main>
    </>
  );
}
