"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_STORAGE_KEY = "zp-theme";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function getServerSnapshot() {
  return false;
}

/** 在 <head> 里同步执行，避免首屏闪烁；主题初始值只在这里决定 */
export function ThemeScript() {
  const code = `try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="dark";if(d)document.documentElement.classList.add("dark")}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light"); } catch { /* The current theme still works when storage is unavailable. */ }
  };

  return (
    <button type="button" className="icon-control" aria-label="切换主题" aria-pressed={dark} title={dark ? "切换为浅色" : "切换为深色"} onClick={toggle}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
