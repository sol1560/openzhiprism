import { cognitionEnabled } from "@/lib/cognition/types";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, MessageSquareText, Mic, Plug, Puzzle, ShieldCheck, SlidersHorizontal, Sunrise } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { AmbientLight } from "@/components/ambient-light";
import { DemoSandbox } from "@/components/landing/demo-sandbox";
import { Logo, PrismMark } from "@/components/logo";
import { postLoginDestination } from "@/lib/auth/destination";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  const next = user ? await postLoginDestination(user.id) : "/login";
  const cognition = cognitionEnabled();
  const voice = env.voiceGuideEnabled;
  return <>
    <AppNav user={user} />
    <main id="main-content" className="landing-main">
      <AmbientLight />
      <section className="hero">
        <div className="hero-kicker"><PrismMark className="size-4" />知棱 · 从对话出发的知识发现</div>
        <h1>让每一次对话，<br />打开新的视角。</h1>
        <p>从你与 AI 的日常对话中发现兴趣，<br className="hidden sm:block" />为你整理值得读的知乎内容，也带来另一种看法。</p>
        <div className="hero-actions">
          <a href="#experience" className="pill-button pill-primary">直接体验<ArrowDown size={15} /></a>
          <Link href={next} className="pill-button pill-secondary">{user ? "进入我的 Feed" : "登录，开始使用"}<ArrowUpRight size={16} /></Link>
        </div>
      </section>
      <DemoSandbox cognition={cognition} />

      <div className="landing-stories" id="how-it-works">
        <section className="story-row">
          <div className="story-copy"><span className="story-number">01 / 对话如何成为兴趣</span><h2>你认真聊过的，<br />值得继续探索。</h2><p>一次职业选择，一个没弄懂的问题，一项刚开始的爱好。知棱从这些对话里发现线索，把零散的好奇，连成逐渐清晰的兴趣画像。</p><a className="text-control" href="#experience">看看对话里的线索<ArrowRight size={15} /></a></div>
          <div className="story-visual visual-blue" aria-label="示意：对话转化为考研、数据分析和实习兴趣">
            <div className="mini-chat"><MessageSquareText size={15} className="mb-3 text-muted" />「我想学数据分析，<br />也在纠结考研还是先实习。」</div>
            {[["考研与就业", 90], ["Python 数据分析", 65], ["实习求职", 45]].map(([name, weight]) => <div className="mini-interest" key={name}><span>{name}</span><div className="mini-track"><i style={{ width: `${weight}%` }} /></div></div>)}
          </div>
        </section>
        <section className="story-row">
          <div className="story-copy"><span className="story-number">02 / 为什么值得读</span><h2>少一点翻找，<br />多一点收获。</h2><p>先读摘要，再决定要不要深入。每条推荐都告诉你它为什么出现，原文始终留在知乎。专注之外，也穿插一点轻松内容。</p><a className="text-control" href="#experience">打开一份示例推荐<ArrowRight size={15} /></a></div>
          <div className="story-visual visual-neutral">
            <div className="mini-paper"><span className="topic-label">实习求职 · 示例</span><h3>一份好的实习，<br />能帮你回答什么？</h3><p>尝试真实的工作，也了解自己的偏好。把下一步选择，建立在亲身经历上。</p><div className="mini-paper-footer"><span>因为你最近在聊实习</span><ArrowUpRight size={14} /></div></div>
          </div>
        </section>
        <section className="story-row">
          <div className="story-copy"><span className="story-number">03 / 多看一种观点</span><h2>懂你的兴趣，<br />也拓宽你的视野。</h2><p>当一个话题只剩下熟悉的声音，知棱会主动补充另一种立场。不同观点会被明确标注，让你带着更多信息，做自己的判断。</p><a className="text-control" href="#experience">换个角度看看<ArrowRight size={15} /></a></div>
          <div className="story-visual visual-gold">
            <div className="mini-perspective"><span>一种想法</span><p>「先读研，<br />给未来更多选择。」</p></div>
            <div className="mini-perspective"><span>另一种可能</span><p>「先去实践，<br />也能找到想走的路。」</p></div>
          </div>
        </section>
        {cognition && <section className="story-row">
          <div className="story-copy"><span className="story-number">04 / 从阅读到判断</span><h2>先核对依据，<br />再留下自己的判断。</h2><p>一个话题有哪些分歧、哪些共识、在什么条件下成立，每一句都能点开原文核对。三个问题之后，判断由你自己写下；日后改了想法，旧版仍然保留。</p><a className="text-control" href="#experience">试试三步想清楚<ArrowRight size={15} /></a></div>
          <div className="story-visual visual-blue" aria-label="示意：分歧带出处，判断保留版本">
            <div className="mini-perspective"><span>主要分歧</span><p>「先读研还是先工作，<br />取决于你想验证什么。」</p><span className="mini-evidence">查看依据 2<ArrowUpRight size={11} /></span></div>
            <div className="mini-perspective mini-judgment"><span>我的判断 · 版本 2</span><p>「先实习一段，<br />再决定要不要读研。」</p><div className="mini-paper-footer">成立条件：实习能给出真实反馈<ArrowUpRight size={12} /></div></div>
          </div>
        </section>}
      </div>

      <section className="feature-section" id="features" aria-labelledby="features-title">
        <div className="feature-heading"><span className="story-number">功能一览</span><h2 id="features-title">除了今天读什么，<br />知棱还会做这些。</h2><p>登录后就能用。需要安装或连接的，卡片里有入口。</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-icon"><Sunrise size={16} /></span><h3>今日简报</h3><p>打开 Feed 先看一段简报：今天先看哪几条，昨天的话题接着看，还有一个值得接着想的问题。</p></article>
          <article className="feature-card"><span className="feature-icon"><MessageSquareText size={16} /></span><h3>对今天的 Feed 提要求</h3><p>一句话就行。「改成三条要点」「用大白话讲」会改写摘要，随时可以撤销；「少推这类」会被记下来。</p></article>
          <article className="feature-card"><span className="feature-icon"><SlidersHorizontal size={16} /></span><h3>我的要求</h3><p>多推、少推、不再推，加上你自己写的规则，都留在 Feed 侧栏。画像重新计算，它们也不会丢。</p></article>
          <article className="feature-card"><span className="feature-icon"><CalendarDays size={16} /></span><h3>往日 · 最近打开</h3><p>最近两周你打开过什么，会轻轻影响之后的推荐；昨天在读的话题，今天保证有一条。往日的 Feed 随时可以回看。</p></article>
          {voice && <article className="feature-card"><span className="feature-icon"><Mic size={16} /></span><h3>语音向导「小棱」</h3><p>在 Feed 里「听今日播报」，在话题页「和小棱一起想清楚」。开口说就行，边听边看。</p></article>}
          <article className="feature-card"><span className="feature-icon"><Puzzle size={16} /></span><h3>浏览器插件「知棱 · 聊天捕捉」</h3><p>在 ChatGPT 或 Claude 的聊天里点一下图标，只捕捉这一段，脱敏后更新画像和 Feed。不会自动扫描。</p><Link className="text-control" href="/extension">安装插件<ArrowUpRight size={14} /></Link></article>
          <article className="feature-card"><span className="feature-icon"><Plug size={16} /></span><h3>连接 AI</h3><p>通过 MCP 接入 Claude、ChatGPT、Claude Code、Codex 和 Cursor；在 claude.ai 里，Feed、画像和视角能以卡片直接操作。要不要「自动采集」，每个客户端单独决定。</p><Link className="text-control" href="/connect">查看接入方式<ArrowUpRight size={14} /></Link></article>
          <article className="feature-card"><span className="feature-icon"><ShieldCheck size={16} /></span><h3>隐私脱敏</h3><p>手机号、证件号、邮箱、银行卡、地址、收入和姓名，在模型看到文字之前就已隐去。只保存话题层面的画像，原文留在知乎。</p></article>
        </div>
      </section>

      <section id="connect-assistant" className="connection-section">
        <div className="connection-platforms"><span>Claude</span><span>ChatGPT</span><span>Claude Code</span><span>Codex</span><span>Cursor</span></div>
        <h2>好奇心，从这里继续。</h2>
        <p>通过 MCP 把知棱接入你已经在用的 AI 助手，聊过的问题，成为下一次发现的起点。<br className="hidden sm:block" />也可以装一个浏览器插件，在聊天页点一下图标，把这一段对话交给知棱。</p>
        <div className="connection-cta">
          <Link href="/connect" className="pill-button pill-primary">连接 AI<ArrowUpRight size={16} /></Link>
          <Link href="/extension" className="pill-button pill-secondary">安装浏览器插件<ArrowUpRight size={16} /></Link>
        </div>
      </section>
    </main>
    <footer className="landing-footer"><Logo /><p>知乎黑客松 2026 · 知识炼金场赛道<br />© 2026 知棱 ZhiPrism · Sol</p></footer>
  </>;
}
