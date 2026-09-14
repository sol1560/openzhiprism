import Link from "next/link";
import { cn } from "tailwind-variants";

export function PrismMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
    <path d="M16 3 29 27H3L16 3Z" fill="none" stroke="var(--prism-cool, #accdec)" strokeWidth="2" strokeLinejoin="round" />
    <path d="M16 3 3 27h13" fill="none" stroke="var(--accent, #2878d0)" strokeWidth="2" strokeLinejoin="round" />
    <path d="M3 27 16 15l13 12" fill="none" stroke="var(--prism-warm, #f4d47a)" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return <Link href="/" aria-label="知棱 ZhiPrism 首页" className={cn("site-logo", className)}>
    <PrismMark />
    {withText && <span className="site-logo-name">知棱<span className="site-logo-latin">ZhiPrism</span></span>}
  </Link>;
}
