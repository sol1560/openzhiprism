import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeScript } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "知棱 ZhiPrism — 从对话中发现兴趣，主动打破信息茧房",
  description:
    "知棱从你与 AI 的日常对话中自动发现兴趣，生成个性化知乎内容 feed，并主动补充不同立场的优质观点。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
