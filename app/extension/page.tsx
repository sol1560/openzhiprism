import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { PrismMark } from "@/components/logo";
import { getSessionUser } from "@/lib/session";
import { connectorUrls } from "@/lib/connectors/oauth";
import { readFile } from "node:fs/promises";
import { Download, ArrowUpRight, Info } from "lucide-react";
export const dynamic = "force-dynamic";
export const metadata = { title: "浏览器插件 · 知棱", description: "一键捕捉当前 ChatGPT 或 Claude 聊天，更新知棱兴趣画像。" };
async function extensionVersion() {
  try { return (JSON.parse(await readFile("public/downloads/extension-version.json", "utf8")) as { version?: string }).version ?? "0.1.1"; } catch { return "0.1.1"; }
}
export default async function ExtensionPage() {
  const [user, version] = await Promise.all([getSessionUser(), extensionVersion()]), { issuer } = connectorUrls();
  const local = new URL(issuer).protocol === "http:";
  return <><AppNav user={user} /><main id="main-content" className="product-page extension-page">
    <header className="extension-heading"><PrismMark className="size-12" /><span className="product-eyebrow">知棱浏览器插件</span>
      <h1>这段聊天，<br />值得继续探索。</h1>
      <p>在 ChatGPT 或 Claude 中点一下知棱图标。聊天里的兴趣，成为你的下一份推荐。</p>
      <a className="pill-button pill-primary" href={local ? "/downloads/zhiprism-chrome-dev.zip" : "/downloads/zhiprism-chrome.zip"} download><Download size={16} />下载{local ? "本地开发版" : " Chrome"}插件</a>
      <small>版本 {version} · Chrome / Edge / Brave 120 及以上 · ZIP 安装包</small>
      {local && <div className="inline-note"><Info size={16} /><div className="inline-note-body">这是本地开发版：保持知棱开发服务器运行，插件的账户和数据都用这个环境。</div></div>}
    </header>
    <section className="product-surface extension-guide" aria-labelledby="install-title"><h2 id="install-title">安装一次，之后点一下</h2>
      <ol><li><span>01</span><div><h3>解压并加载插件</h3><p>下载 ZIP 并解压。在地址栏打开 <code>chrome://extensions</code>（Edge 使用 <code>edge://extensions</code>），开启「开发者模式」，点击「加载已解压的扩展程序」，选择包含 manifest.json 的目录。</p></div></li>
        <li><span>02</span><div><h3>连接你的知棱账户</h3><p>在插件设置页点击「连接知棱」，使用邮箱或 Google 登录并授权。你可以在<Link href="/connect">连接管理</Link>中随时撤销。</p></div></li>
        <li><span>03</span><div><h3>打开聊天，点击图标</h3><p>在浏览器扩展菜单中固定知棱。打开一段已保存的 ChatGPT 或 Claude 聊天，等回复完成，点击知棱图标。导入进度显示在聊天页右下角。</p></div></li></ol>
    </section>
    <div className="extension-details"><section><h2>只在你点击时捕捉</h2><p>捕捉当前完整聊天分支的文字、代码和链接，附件只记录名称。内容发送到知棱后先脱敏，再保存和提取兴趣；平台登录凭证留在原网站。</p><p>重复点击不会重复计分。继续聊了几轮，再点一次，只分析新增或修改的消息。</p></section>
      <section><h2>随时查看处理结果</h2><p>关闭提示或切换标签页不影响已经提交的任务。在扩展菜单中打开知棱「选项」，可查看最近捕捉、重新连接账户或重试失败任务。</p><p>暂不支持临时聊天、分享页、附件正文和图片。遇到平台改版或无法确认完整分支时，会提示重新捕捉。</p></section></div>
    <div className="flex flex-wrap gap-4"><Link className="text-control" href="/profile">查看兴趣画像<ArrowUpRight size={14} /></Link><Link className="text-control" href="/onboarding">上传导出文件或粘贴文字<ArrowUpRight size={14} /></Link></div>
  </main></>;
}
