"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import type { User } from "@/db/schema";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV_ITEMS = [
  { href: "/feed", label: "今日 Feed" },
  { href: "/reflections", label: "我的判断" },
  { href: "/profile", label: "兴趣画像" },
  { href: "/connect", label: "连接 AI" },
];
const HOME_ITEMS = [
  { href: "/#experience", label: "亲自体验" },
  { href: "/#how-it-works", label: "工作方式" },
  { href: "/#connect-assistant", label: "连接 AI" },
];

/**
 * 全站同一个导航。`pending` 给 loading.tsx 用：还没拿到用户数据时先画出同样高度的壳，
 * 产品页显示产品导航，公开页留空，右侧留一个占位保证不跳动。
 */
export function AppNav({ user, pending }: { user: User | null; pending?: "product" | "public" }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const home = pathname === "/";
  // 导航只看登录态：登录后无论在哪一页都是同一套产品导航，不会在首页变成营销锚点
  const items = pending ? (pending === "product" ? NAV_ITEMS : []) : user ? NAV_ITEMS : HOME_ITEMS;
  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      router.push("/"); router.refresh();
    } catch { setLogoutError(true); }
  };
  const navigation = items.map((item) => <Link key={item.href} href={item.href} className="nav-link" aria-current={pathname === item.href ? "page" : undefined} onClick={() => setMenuOpen(false)}>{item.label}</Link>);
  return <header className="site-header" aria-busy={pending ? true : undefined} onKeyDown={(event) => {
    if (event.key === "Escape" && menuOpen) { setMenuOpen(false); trigger.current?.focus(); }
  }}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className="nav-inner">
      <Logo />
      <nav className="desktop-nav" aria-label="主导航">{navigation}</nav>
      <div className="nav-actions">
        <ThemeToggle />
        {pending ? <span className="icon-control" aria-hidden="true" /> : user ? <>
          {home ? <Link href="/feed" className="pill-button pill-primary nav-cta">进入 Feed</Link> : null}
          <span className="hidden text-xs text-muted sm:block">{user.displayName}</span>
          <button type="button" className="icon-control" aria-label="退出" title="退出登录" onClick={logout}><LogOut size={16} /></button>
        </> : <Link href="/login" className="pill-button pill-primary nav-cta">登录</Link>}
        <button type="button" ref={trigger} className="icon-control mobile-menu-button" aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"} aria-expanded={menuOpen} aria-controls="mobile-navigation" disabled={Boolean(pending)} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
    </div>
    {menuOpen && <nav id="mobile-navigation" className="mobile-navigation" aria-label="移动端主导航">{navigation}{user && <button type="button" className="nav-link" onClick={logout}>退出登录</button>}</nav>}
    {logoutError && <p role="alert" className="px-6 pb-3 text-sm text-danger">暂时无法退出，请重试。</p>}
  </header>;
}
