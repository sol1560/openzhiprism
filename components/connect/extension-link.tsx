import Link from "next/link";
import { ArrowUpRight, Puzzle } from "lucide-react";

export function ExtensionLink() {
  return <div className="extension-entry">
    <Puzzle size={20} aria-hidden="true" />
    <div><strong>点一下，导入当前聊天</strong><p>安装知棱浏览器插件，在 ChatGPT 或 Claude 中点击图标，自动更新兴趣画像。</p></div>
    <Link href="/extension" className="pill-button pill-secondary">安装浏览器插件<ArrowUpRight size={14} /></Link>
  </div>;
}
