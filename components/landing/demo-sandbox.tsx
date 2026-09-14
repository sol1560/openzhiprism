"use client";

import { DemoReasoning } from "@/components/cognition/demo-reasoning";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, MessageSquareText, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { createDemoState, demoReducer, selectDemoFeed } from "@/lib/demo/state";
import type { DemoArticle, DemoTab } from "@/lib/demo/types";
import { ContentCardView } from "@/components/content-card-view";
import { PrismMark } from "@/components/logo";

const TABS: { id: DemoTab; label: string }[] = [
  { id: "feed", label: "今日推荐" }, { id: "interests", label: "兴趣画像" }, { id: "perspective", label: "换个角度" },
];

function ContentPreview({ article, onClose }: { article: DemoArticle | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!article || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [article]);
  return <dialog ref={ref} className="content-preview" aria-labelledby={titleId} onCancel={onClose}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const targets = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={(event) => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    {article && <>
      <div className="preview-topline"><span className="eyebrow">内容预览 · 示例体验</span><button type="button" className="icon-control" aria-label="关闭内容预览" onClick={onClose}><X size={19} /></button></div>
      <h2 id={titleId}>{article.title}</h2>
      <p className="preview-author">{article.authorName} · 知乎离线样本</p>
      <p className="preview-excerpt">{article.excerpt}</p>
      <p className="preview-note">这里只展示已获取的原文片段。快照采集于 {article.fetchedAt.slice(0, 10)}，完整内容请到知乎阅读。</p>
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="pill-button pill-primary">去知乎阅读原文<ArrowUpRight size={16} /></a>
    </>}
  </dialog>;
}

export function DemoSandbox({ cognition = true }: { cognition?: boolean }) {
  const [state, dispatch] = useReducer(demoReducer, DEMO_SCENARIOS[0], createDemoState);
  const [conversationOpen, setConversationOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const scenario = DEMO_SCENARIOS.find((item) => item.id === state.scenarioId)!;
  const feed = selectDemoFeed(scenario, state);
  const active = scenario.interests.filter((t) => state.weights[t.id] > 0);
  const allArticles = [...scenario.interests.flatMap((t) => t.articles), scenario.light, ...scenario.perspective.sides.flatMap((side) => side.article ? [side.article] : [])];
  const preview = allArticles.find((article) => article.id === state.previewId) ?? null;
  const currentSide = scenario.perspective.sides[state.side];

  useEffect(() => { panelRef.current?.scrollTo({ top: 0, behavior: "instant" }); }, [state.scenarioId, state.tab]);
  const reset = () => { dispatch({ type: "reset", scenario }); setConversationOpen(false); };
  const reason = (topicId: string, open: boolean) => {
    if (open) {
      dispatch({ type: "reason", topicId }); setConversationOpen(true);
    } else if (state.highlightedTopic === topicId) dispatch({ type: "reason", topicId: null });
  };

  return <section className="demo-section" id="experience" aria-label="知棱交互沙盒" tabIndex={-1}>
    <div className="demo-caption"><span><span className="live-dot" />示例体验</span><span>选一种生活，看看知棱如何理解它</span></div>
    <div className="demo-window">
      <aside className="demo-conversation">
        <div className="demo-brand"><PrismMark /><span>对话里的你</span><span className="window-dots" aria-hidden="true"><i /><i /><i /></span></div>
        <div className="scenario-picker" aria-label="选择示例场景">
          {DEMO_SCENARIOS.map((item, index) => <button type="button" key={item.id} aria-pressed={item.id === scenario.id} className={item.id === scenario.id ? "is-selected" : ""}
            onClick={() => { dispatch({ type: "reset", scenario: item }); setConversationOpen(false); }}>
            <span aria-hidden="true" className={`persona-avatar persona-${index}`}>{item.name.slice(0, 1)}</span><span>{item.name}</span>
          </button>)}
        </div>
        <div className="scenario-intro"><h2>{scenario.role}</h2><p>{scenario.description}</p></div>
        <button type="button" className="conversation-toggle" aria-expanded={conversationOpen} aria-controls={`${id}-conversation`} onClick={() => setConversationOpen(!conversationOpen)}>
          <MessageSquareText size={16} />{conversationOpen ? "收起示例对话" : "查看示例对话"}<ChevronDown size={15} />
        </button>
        <div id={`${id}-conversation`} className={`conversation-messages ${conversationOpen ? "is-open" : ""}`}>
          {scenario.interests.map((topic, index) => <div className={`conversation-exchange ${state.highlightedTopic === topic.id ? "is-highlighted" : ""}`} key={topic.id}>
            <div className="conversation-time"><span>对话 {String(index + 1).padStart(2, "0")}</span><span>{topic.name}</span></div>
            <p className="message-user">{topic.message}</p>
            <p className="message-assistant"><PrismMark className="size-4 shrink-0" />{topic.reply}</p>
            {state.highlightedTopic === topic.id && <span className="evidence-tag"><Check size={12} />这句话是推荐的线索</span>}
          </div>)}
        </div>
        <div className="conversation-footer"><span className="live-dot" />从聊天中发现 {active.length} 个兴趣<span className="conversation-footer-arrow"><ArrowRight size={16} /></span></div>
      </aside>

      <div className="demo-workspace">
        <div className="demo-toolbar">
          <div className="segmented-tabs" role="tablist" aria-label="示例视图" onKeyDown={(event) => {
            const index = TABS.findIndex((tab) => tab.id === state.tab);
            const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
            if (next < 0) return;
            event.preventDefault(); dispatch({ type: "tab", tab: TABS[next].id });
            (event.currentTarget.querySelectorAll('button')[next] as HTMLButtonElement).focus();
          }}>
            {TABS.map((tab) => <button type="button" role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-panel`} aria-selected={state.tab === tab.id} tabIndex={state.tab === tab.id ? 0 : -1} key={tab.id} onClick={() => dispatch({ type: "tab", tab: tab.id })}>{tab.label}</button>)}
          </div>
          <button type="button" className="icon-control reset-demo" aria-label="重置当前示例" title="重置当前示例" onClick={reset}><RotateCcw size={16} /></button>
        </div>
        <div ref={panelRef} className="demo-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${state.tab}`} tabIndex={0}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${scenario.id}-${state.tab}`} initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.16 }}>
              {state.tab === "feed" && <>
                <div className="demo-page-heading"><div><span className="eyebrow">为好奇心，留一点时间</span><h2>{scenario.name}的今日推荐</h2></div><button className="icon-control" type="button" aria-label="调整兴趣" onClick={() => dispatch({ type: "tab", tab: "interests" })}><SlidersHorizontal size={18} /></button></div>
                <div className="demo-filters" aria-label="按话题筛选">
                  {[{ id: "all", name: "全部" }, ...active].map((topic) => <button type="button" key={topic.id} aria-pressed={state.filter === topic.id} onClick={() => dispatch({ type: "filter", filter: topic.id })}>{topic.name}</button>)}
                </div>
                <p className="sr-only" role="status">{active.length} 个兴趣，{feed.length} 条示例推荐</p>
                {!feed.length ? <div className="demo-empty"><PrismMark className="size-10" /><h3>给好奇心一个方向</h3><p>所有兴趣都已关闭。恢复示例，或在兴趣画像里重新开启一个话题。</p><button type="button" className="pill-button pill-primary" onClick={reset}>恢复默认兴趣</button></div> : <div className="demo-feed-list">
                  {feed.map(({ article, interest, kind }) => <ContentCardView key={`${scenario.id}-${article.id}`} content={article} topic={interest?.name ?? null} source="知乎样本" compact light={kind === "light"} seen={state.seen.includes(article.id)}
                    reason={interest ? `因为这段对话正在关注「${interest.name}」：“${interest.message}”` : "在专注的话题之外，留一点空间给日常兴趣。"}
                    onPreview={() => dispatch({ type: "preview", articleId: article.id })}
                    onReasonChange={interest ? (open) => reason(interest.id, open) : undefined} />)}
                  <button type="button" className="perspective-invitation" onClick={() => dispatch({ type: "tab", tab: "perspective" })}><PrismMark className="size-6" /><span><strong>还有一种看法，值得听听</strong><small>{scenario.perspective.question}</small></span><ArrowRight size={18} /></button>
                </div>}
              </>}
              {state.tab === "interests" && <>
                <div className="demo-page-heading"><div><span className="eyebrow">由对话生长，也由你调整</span><h2>好奇心，有自己的刻度</h2></div></div>
                <p className="demo-description">拖动滑杆或关闭话题，看看推荐的顺序如何变化。这里的调整只在本页生效。</p>
                <div className="interest-controls">{scenario.interests.map((topic) => <section key={topic.id} className={`interest-control ${state.weights[topic.id] === 0 ? "is-disabled" : ""}`}>
                  <div className="interest-control-heading"><label htmlFor={`${id}-weight-${topic.id}`}>{topic.name}</label><span>{state.weights[topic.id]}</span><button className="interest-switch" role="switch" aria-checked={state.weights[topic.id] > 0} aria-label={`${topic.name}兴趣`} type="button" onClick={() => dispatch({ type: "weight", topicId: topic.id, weight: state.weights[topic.id] ? 0 : topic.weight })}><span /></button></div>
                  <input id={`${id}-weight-${topic.id}`} type="range" min="0" max="100" step="5" value={state.weights[topic.id]} onChange={(event) => dispatch({ type: "weight", topicId: topic.id, weight: Number(event.target.value) })} style={{ "--range-value": `${state.weights[topic.id]}%` } as React.CSSProperties} />
                  <p>“{topic.message}”</p>
                </section>)}</div>
                <div className="interest-actions"><button type="button" className="pill-button pill-primary" onClick={() => dispatch({ type: "tab", tab: "feed" })}>看看推荐的变化<ArrowRight size={16} /></button><button type="button" className="text-control" onClick={reset}>恢复默认</button></div>
              </>}
              {state.tab === "perspective" && <>
                <div className="perspective-intro"><span className="warm-label"><PrismMark className="size-4" />换个角度看</span><h2>{scenario.perspective.question}</h2><p>{scenario.perspective.context}</p></div>
                <div className="perspective-options" aria-label="选择观点">{scenario.perspective.sides.map((side, index) => <button type="button" key={side.label} aria-pressed={state.side === index} onClick={() => dispatch({ type: "side", side: index })}>{side.label}</button>)}</div>
                <div className="perspective-summary"><span className="eyebrow">{state.side === 2 ? "思考提示 · 示例" : "观点导读 · 示例"}</span><p>{currentSide.description}</p></div>
                {currentSide.article && <ContentCardView key={currentSide.article.id} content={currentSide.article} topic={currentSide.label} source="知乎样本" compact
                  seen={state.seen.includes(currentSide.article.id)} reason="刻意展示不同立场，帮助你把选择看得更完整。导读用于演示，完整论述以知乎原文为准。"
                  onPreview={() => dispatch({ type: "preview", articleId: currentSide.article!.id })} />}
                <p className="perspective-footnote">多一种视角，多一份自己判断的空间。</p>
                {cognition && <DemoReasoning key={scenario.id} article={currentSide.article ?? scenario.perspective.sides.find((side) => side.article)?.article ?? scenario.interests[0].articles[0]} />}
              </>}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="demo-statusbar"><span>示例体验 · 调整仅在本页生效</span><span>知棱 ZhiPrism</span></div>
      </div>
    </div>
    <p className="demo-bottom-note">不需要登录。试着切换场景、调整兴趣，或点开一条推荐。</p>
    <ContentPreview article={preview} onClose={() => dispatch({ type: "preview", articleId: null })} />
  </section>;
}
