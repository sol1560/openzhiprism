"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@heroui/react";
import { AlertTriangle, ArrowUpRight, Info, Sparkles } from "lucide-react";
import { VoiceBusContext, createVoiceBus } from "@/lib/voice/context";
import { useVoiceGuide } from "@/lib/voice/use-voice-guide";
import { ProgressPanel, type ProgressStage } from "@/components/progress-panel";
import { SourceBadge } from "@/components/source-badge";
import { TopicList } from "@/components/topic-list";
import type { InterestTopic } from "@/db/schema";
import type { AskResponse, DailyBrief, DirectiveView, FeedBuildView, FeedCard, FeedView, HistorySignals } from "@/lib/feed/types";
import type { SourceStatus } from "@/lib/zhihu/provider";
import { AskBox } from "./ask-box";
import { DirectiveList } from "./directive-list";
import { FeedContentCard } from "./feed-card";
import { FeedSkeleton } from "./feed-skeleton";
import { HistoryRail } from "./history-rail";
import { TodayHeader } from "./today-header";
import { VoicePanel, VoiceStart } from "./voice-guide";
import { PerspectiveCard } from "./perspective-card";

/** 轮询超过这个时长仍未完成就停下来，给用户一个手动重试入口 */
const POLL_BUDGET_MS = 150_000;
const DEFAULT_POLL_MS = 1500;

function feedStages(detail: string | null): ProgressStage[] {
  return [
    { key: "allocate", label: "按你的兴趣分配名额" },
    { key: "search", label: detail ? `在知乎找「${detail}」的高赞回答` : "在知乎找高赞回答" },
    { key: "enrich", label: "写摘要、找不同观点、挑热榜" },
    { key: "persist", label: "整理成卡片" },
  ];
}

function isActive(build: FeedBuildView | null): build is FeedBuildView {
  return build?.status === "queued" || build?.status === "running";
}

interface StatusPayload {
  build: FeedBuildView | null;
  feed?: FeedView;
  retryAfterMs?: number;
}

export function FeedStream({
  initialFeed,
  topics,
  initialBuild,
  llm,
  initialBrief,
  history,
  dates,
  today,
  readOnly,
  voiceEnabled,
  initialDirectives,
  cognition = true,
}: {
  initialFeed: FeedView;
  topics: InterestTopic[];
  initialBuild: FeedBuildView | null;
  llm: { provider: string; model: string };
  initialBrief: DailyBrief | null;
  history: HistorySignals;
  dates: string[];
  today: string;
  /** 回看往日：不可重建，仍可标记已读 */
  readOnly: boolean;
  voiceEnabled: boolean;
  initialDirectives: DirectiveView[];
  cognition?: boolean;
}) {
  const [feed, setFeed] = useState(initialFeed);
  const [brief, setBrief] = useState<DailyBrief | null>(initialBrief);
  const [briefLoading, setBriefLoading] = useState(false);
  const briefFailedFor = useRef<string | null>(null);
  const bus = useMemo(() => createVoiceBus(), []);
  const [build, setBuild] = useState<FeedBuildView | null>(initialBuild);
  const [error, setError] = useState<string | null>(initialBuild?.status === "error" ? initialBuild.error : null);
  /** 撤销、删除要求这类小操作失败时的一句提示；成功就静默 */
  const [notice, setNotice] = useState<string | null>(null);
  const [retryAfterMs, setRetryAfterMs] = useState(DEFAULT_POLL_MS);
  const [stalled, setStalled] = useState(false);
  const [directives, setDirectives] = useState<DirectiveView[]>(initialDirectives);
  const [rebuildHint, setRebuildHint] = useState<string | null>(null);
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const mounted = useRef(true);
  const pollUntil = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const kicked = useRef(false);
  useEffect(() => bus.subscribe((event) => {
    if (event.type !== "content_feedback") return;
    setFeed((current) => ({ ...current, cards: current.cards.map((card) => card.content?.id === event.contentId ? { ...card, feedback: event.kind } : card) }));
    setBrief(null); briefFailedFor.current = null;
  }), [bus]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const active = isActive(build);

  const applyStatus = useCallback((data: StatusPayload) => {
    if (!mounted.current) return;
    setBuild(data.build);
    if (typeof data.retryAfterMs === "number") setRetryAfterMs(Math.max(500, data.retryAfterMs));
    if (data.build?.status === "ready" && data.feed) {
      setFeed(data.feed);
      // 卡片变了，简报作废，下面的 effect 会重新拉
      setBrief(null);
      briefFailedFor.current = null;
      bus.emit({ type: "feed_rebuilt", count: data.feed.cards.length });
    }
    if (data.build?.status === "error") {
      setError(data.build.error ?? "生成失败");
      bus.emit({ type: "build_failed", error: data.build.error ?? "生成失败" });
    }
  }, [bus]);

  /** 发起（或复用）后台构建 */
  const kick = useCallback(async (force: boolean) => {
    setError(null);
    setStalled(false);
    pollUntil.current = Date.now() + POLL_BUDGET_MS;
    try {
      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await response.json()) as StatusPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "生成失败");
      applyStatus(data);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [applyStatus]);

  const poll = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const response = await fetch(`/api/feed/status?date=${encodeURIComponent(feed.date)}`, { signal: current.signal });
      const data = (await response.json()) as StatusPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "暂时读不到生成状态");
      if (!current.signal.aborted) applyStatus(data);
    } catch (err) {
      if (mounted.current && !current.signal.aborted) setError(err instanceof Error ? err.message : "连接中断");
    }
  }, [applyStatus, feed.date]);

  // 首次进入且还没有今日 feed：自动开始生成，不需要用户点按钮（回看往日不生成）
  useEffect(() => {
    if (kicked.current || readOnly) return;
    if (isActive(initialBuild)) pollUntil.current = Date.now() + POLL_BUDGET_MS;
    if (!(initialFeed.cards.length === 0 && topics.length > 0 && initialBuild === null)) { kicked.current = true; return; }
    // 放到下一个 tick 发请求：StrictMode 下的双重挂载只会真正触发一次
    const timer = setTimeout(() => { kicked.current = true; void kick(false); }, 0);
    return () => clearTimeout(timer);
  }, [initialFeed.cards.length, topics.length, initialBuild, kick, readOnly]);

  // 简报懒加载：有卡片、没在构建、还没有简报时拉一次；失败就不再重试，直到 feed 变化
  const feedStamp = feed.run?.createdAt ?? `${feed.date}:${feed.cards.length}`;
  useEffect(() => {
    if (brief || feed.cards.length === 0 || isActive(build) || briefFailedFor.current === feedStamp) return;
    const controller = new AbortController();
    setBriefLoading(true);
    fetch(`/api/feed/brief?date=${encodeURIComponent(feed.date)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as DailyBrief & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "简报读取失败");
        if (mounted.current && !controller.signal.aborted) setBrief(data);
      })
      .catch(() => { if (!controller.signal.aborted) briefFailedFor.current = feedStamp; })
      .finally(() => { if (mounted.current && !controller.signal.aborted) setBriefLoading(false); });
    return () => controller.abort();
  }, [brief, feed.cards.length, feed.date, build, feedStamp]);

  // 构建进行中：按服务端给的间隔轮询真实进度
  useEffect(() => {
    if (!active || stalled) return;
    const timer = setTimeout(() => {
      if (Date.now() > pollUntil.current) { setStalled(true); return; }
      void poll();
    }, retryAfterMs);
    return () => clearTimeout(timer);
  }, [active, stalled, retryAfterMs, poll, build]);

  const loadSource = useCallback(async () => {
    if (source || sourceBusy) return;
    setSourceBusy(true);
    try {
      const response = await fetch("/api/status");
      const data = (await response.json()) as { source: SourceStatus };
      if (mounted.current && response.ok) setSource(data.source);
    } catch {
      // 侧栏信息只是辅助，失败就保持折叠内容为空
    } finally {
      if (mounted.current) setSourceBusy(false);
    }
  }, [source, sourceBusy]);

  const markSeen = useCallback(
    async (contentIds: string[]) => {
      setFeed((current) => ({
        ...current,
        cards: current.cards.map((card) => (card.content && contentIds.includes(card.content.id) ? { ...card, seen: true } : card)),
      }));
      await fetch("/api/feed/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentIds }),
      }).catch(() => undefined);
    },
    [],
  );

  const guide = useVoiceGuide({ enabled: voiceEnabled && !readOnly, feed, markSeen, rebuild: kick, bus });

  /** 「对 Feed 说话」：服务端执行后返回整份卡片与最新要求，直接替换本地状态 */
  const ask = useCallback(async (text: string, cardId?: string): Promise<AskResponse> => {
    const response = await fetch("/api/feed/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, cardId, date: feed.date }),
    });
    const data = (await response.json()) as AskResponse & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "这次没处理成功");
    if (!mounted.current) return data;
    setFeed((current) => {
      if (current.cards.length !== data.cards.length) {
        // 追加了新卡片：简报作废，交给上面的 effect 懒重拉
        setBrief(null);
        briefFailedFor.current = null;
      }
      return { ...current, cards: data.cards };
    });
    setDirectives(data.directives);
    if (data.rebuildSuggested) setRebuildHint(data.results.filter((result) => result.type === "adjust_topic" && result.ok).map((result) => result.note).join("、"));
    return data;
  }, [feed.date]);

  const revertCard = useCallback(async (cardId: string) => {
    setNotice(null);
    try {
      const response = await fetch("/api/feed/ask", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, date: feed.date }),
      });
      const data = (await response.json()) as { cards?: FeedCard[]; error?: string };
      if (!response.ok || !data.cards) throw new Error(data.error ?? "撤销没成功");
      if (mounted.current) setFeed((current) => ({ ...current, cards: data.cards! }));
    } catch (err) {
      if (mounted.current) setNotice(`撤销没成功：${err instanceof Error ? err.message : "连接中断"}`);
    }
  }, [feed.date]);

  const removeDirective = useCallback(async (id: string) => {
    const previous = directives;
    setNotice(null);
    setDirectives((current) => current.filter((directive) => directive.id !== id));
    try {
      const response = await fetch("/api/feed/directives", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json().catch(() => null)) as { directives?: DirectiveView[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "删除没成功");
      if (data?.directives && mounted.current) setDirectives(data.directives);
    } catch (err) {
      if (!mounted.current) return;
      setDirectives(previous);
      setNotice(`这条要求没删掉：${err instanceof Error ? err.message : "连接中断"}`);
    }
  }, [directives]);

  const onOpenCard = (card: FeedCard) => {
    if (!card.content) return;
    void markSeen([card.content.id]);
    bus.emit({ type: "card_opened", cardId: card.id, contentId: card.content.id, title: card.content.title });
  };

  const stats = feed.run?.stats ?? {};
  const mainCount = feed.cards.filter((card) => card.kind === "main").length;
  const lightCount = feed.cards.filter((card) => card.kind === "light").length;
  const perspectiveCount = feed.cards.filter((card) => card.kind === "perspective").length;
  const hasCards = feed.cards.length > 0;
  const showSkeleton = active && !hasCards;
  const noProfile = topics.length === 0 && !hasCards;

  const countsLine = hasCards
    ? `${feed.date} · ${mainCount} 条推荐 · ${lightCount} 条换换脑子 · ${perspectiveCount} 条换个角度看`
    : active ? `${feed.date} · 正在生成今天的内容` : feed.date;

  return (
    <VoiceBusContext value={bus}><div className="product-page"><div className="feed-layout">
      <div className="product-stack">
        <TodayHeader
          date={feed.date}
          brief={brief}
          loading={briefLoading}
          readOnly={readOnly}
          building={active}
          countsLine={countsLine}
          showRebuild={!noProfile}
          onRebuild={() => kick(true)}
          voiceStart={<VoiceStart guide={guide} label="听今日播报" />}
          voicePanel={<VoicePanel guide={guide} />}
        />

        {readOnly ? (
          <div className="inline-note inline-note-accent">
            <Info size={16} />
            <div className="inline-note-body">你在看 {feed.date} 的内容。这一天不能重新生成，打开过的会记下来。</div>
            <div className="inline-note-actions"><Link href="/feed" className="pill-button pill-secondary pill-small">回到今天</Link></div>
          </div>
        ) : null}

        {error && !active ? (
          <div className="inline-note inline-note-danger" role="alert">
            <AlertTriangle size={16} />
            <div className="inline-note-body"><strong>这次没生成出来</strong>{error}</div>
            <div className="inline-note-actions"><button type="button" className="pill-button pill-secondary pill-small" onClick={() => kick(hasCards)}>再试一次</button></div>
          </div>
        ) : null}

        {notice ? (
          <div className="inline-note inline-note-danger" role="alert">
            <AlertTriangle size={16} />
            <div className="inline-note-body">{notice}</div>
            <div className="inline-note-actions"><button type="button" className="text-control" onClick={() => setNotice(null)}>知道了</button></div>
          </div>
        ) : null}

        {stalled && active ? (
          <div className="inline-note inline-note-warm" role="status">
            <AlertTriangle size={16} />
            <div className="inline-note-body"><strong>比平时慢一些</strong>可能还在生成，也可能卡住了。</div>
            <div className="inline-note-actions">
              <button type="button" className="text-control" onClick={() => { setStalled(false); pollUntil.current = Date.now() + POLL_BUDGET_MS; }}>再等等</button>
              <button type="button" className="pill-button pill-primary pill-small" onClick={() => kick(true)}>重新生成</button>
            </div>
          </div>
        ) : null}

        {active && build ? (
          <ProgressPanel
            title={build.status === "queued" || !build.stage ? "马上开始…" : "正在准备今天的内容"}
            stages={feedStages(build.detail)}
            current={build.stage}
            expected="第一次大约 20–40 秒，之后会快很多。离开页面也会继续。"
            slim={hasCards}
          />
        ) : null}

        {!readOnly && hasCards && !active ? (
          <AskBox
            placeholder="对今天的 Feed 提要求，比如「少推考研，多来点远程办公」"
            suggestions={["摘要都短一点", "我想看看…"]}
            onAsk={(text) => ask(text)}
          />
        ) : null}

        {rebuildHint && !active ? (
          <div className="inline-note inline-note-accent" role="status">
            <Info size={16} />
            <div className="inline-note-body"><strong>记下了：{rebuildHint}</strong>下次生成会按这个来，也可以现在就重新生成。</div>
            <div className="inline-note-actions">
              <button type="button" className="text-control" onClick={() => setRebuildHint(null)}>先这样</button>
              <button type="button" className="pill-button pill-primary pill-small" onClick={() => { setRebuildHint(null); void kick(true); }}>现在重新生成</button>
            </div>
          </div>
        ) : null}

        {showSkeleton ? <FeedSkeleton count={5} /> : null}

        {noProfile ? (
          <div className="empty-state product-surface">
            <Sparkles size={24} />
            <h3>还没有兴趣画像</h3>
            <p>先把知棱连进你常用的 AI，或导入一份聊天记录，知棱才知道你在关心什么。</p>
            <Link href="/onboarding" className="pill-button pill-primary">连接 AI 或导入历史</Link>
          </div>
        ) : null}

        {!hasCards && !active && !noProfile && !error ? (
          <div className="empty-state product-surface">
            <Sparkles size={24} />
            <h3>今天还没找到合适的内容</h3>
            <p>可以换个时间再试，或者接入更多对话让画像更清晰。</p>
            <button type="button" className="pill-button pill-primary" onClick={() => kick(true)}>再生成一次</button>
          </div>
        ) : null}

        {hasCards ? (
          <div className="reading-list">
            {feed.cards.map((card) => (
              <div key={card.id} id={`card-${card.id}`} data-card-id={card.id} className="feed-card-anchor">
                {card.kind === "perspective" && card.perspective ? (
                  <PerspectiveCard cognition={cognition} card={card.perspective} onOpen={(contentId) => markSeen([contentId])} />
                ) : (
                  <FeedContentCard cognition={cognition} card={card} onOpen={onOpenCard} onAsk={readOnly ? undefined : ask} onRevert={readOnly ? undefined : revertCard} />
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="feed-sidebar">
        <section className="product-surface">
          <h2 className="sidebar-title">今天的内容来自这些兴趣</h2>
          <TopicList topics={topics.slice(0, 6)} compact />
          <Link href="/profile" className="text-control text-control-sm">查看完整画像<ArrowUpRight size={13} /></Link>
        </section>

        <DirectiveList directives={directives} onRemove={(id) => void removeDirective(id)} />

        <HistoryRail dates={dates} current={feed.date} today={today} history={history} />

        <details className="source-details" onToggle={(event) => { if (event.currentTarget.open) void loadSource(); }}>
          <summary>数据源、模型与额度</summary>
          <dl className="flex flex-col gap-2">
            {feed.run ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">本次 Feed</dt>
                <dd>
                  <SourceBadge provider={feed.run.sourceUsed} />
                </dd>
              </div>
            ) : null}
            {source ? (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">当前策略</dt>
                  <dd className="flex items-center gap-1">
                    <span className="tag">{source.strategy}</span>
                    <SourceBadge provider={source.active} />
                  </dd>
                </div>
                {source.official.configured ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted">官方额度（今日剩余）</dt>
                    <dd className="tabular-nums text-xs">
                      搜索 {source.official.searchRemaining ?? "–"} · 热榜 {source.official.hotRemaining ?? "–"} · 直答 {source.official.zhidaRemaining ?? "–"}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : sourceBusy ? (
              <div className="flex items-center gap-2 text-xs text-muted"><Spinner size="sm" />读取数据源状态…</div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-muted">LLM</dt>
              <dd className="truncate text-xs">{feed.run?.llmUsed ?? `${llm.provider}/${llm.model}`}</dd>
            </div>
            {typeof stats.historyBoosted === "number" ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">历史加权</dt>
                <dd className="tabular-nums text-xs">加权 {stats.historyBoosted as number} · 降权 {(stats.historyDamped as number) ?? 0} · 延续 {(stats.continuity as number) ?? 0}</dd>
              </div>
            ) : null}
            {stats.directives && typeof stats.directives === "object" ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">我的要求</dt>
                <dd className="tabular-nums text-xs">话题 {(stats.directives as { topic?: number }).topic ?? 0} · 规则 {(stats.directives as { rule?: number }).rule ?? 0} · 改写 {(stats.directives as { restyled?: number }).restyled ?? 0}</dd>
              </div>
            ) : null}
            {typeof stats.summariesCached === "number" ? (
              <div className="flex items-center justify-between">
                <dt className="text-muted">摘要缓存命中</dt>
                <dd className="tabular-nums text-xs">
                  {stats.summariesCached as number} / {(stats.summariesCached as number) + ((stats.summariesGenerated as number) ?? 0)}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 text-xs text-muted">直答每日额度极少，同话题的立场分析结果按话题缓存 7 天，跨用户复用。</p>
        </details>
      </aside>
    </div></div></VoiceBusContext>
  );
}
