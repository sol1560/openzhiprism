"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, ChevronDown, FileText, Info, RefreshCw } from "lucide-react";
import type { CitedText, ContentFeedback, DossierView, EvidenceRef, InquiryView, SourceSnapshot } from "@/lib/cognition/types";
import type { FeedView } from "@/lib/feed/types";
import { createVoiceBus, VoiceBusContext } from "@/lib/voice/context";
import { useVoiceGuide } from "@/lib/voice/use-voice-guide";
import { VoicePanel, VoiceStart } from "@/components/feed/voice-guide";
import { DossierSkeleton } from "@/components/feed/feed-skeleton";
import { ProgressPanel, type ProgressStage } from "@/components/progress-panel";
import { DraftEditor } from "./draft-editor";
import { EvidenceDialog } from "./evidence-dialog";
import { cognitionJson, useRequestId } from "./client";
import { ReadingFeedback } from "./entry";

const DOSSIER_STAGES: ProgressStage[] = [
  { key: "search", label: "找原文和不同角度" },
  { key: "extract", label: "逐条核对原话" },
  { key: "synthesize", label: "整理分歧和条件" },
];
const SUMMARY_LIMIT = 180;
const markSeen = async (contentIds: string[]) => { await cognitionJson("/api/feed/seen", { contentIds }); };
const rebuild = async (force: boolean) => { await cognitionJson("/api/feed", { force }); };

/**
 * 「看分歧与依据」话题页。和 Feed 页同一套版式：标题区 + 一行操作，
 * 生成中是进度面板 + 骨架，就绪后左边材料归纳、右边「帮我想清楚」。
 */
export function TopicWorkspace({ initial, inquiryId, version, from, voiceEnabled, feed }: {
  initial: DossierView; inquiryId?: string; version?: string; from?: string; voiceEnabled: boolean; feed: FeedView;
}) {
  const router = useRouter(); const [view, setView] = useState(initial); const [inquiry, setInquiry] = useState<InquiryView | null>(null);
  const [reply, setReply] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ source: SourceSnapshot; evidence?: EvidenceRef } | null>(null);
  const [saved, setSaved] = useState<string | null>(null); const [expanded, setExpanded] = useState(false);
  const requestId = useRequestId(); const bus = useMemo(() => createVoiceBus(), []);
  const [feedback, setFeedback] = useState<Record<string, ContentFeedback | null>>({});
  useEffect(() => {
    let cancelled = false;
    cognitionJson<Record<string, ContentFeedback>>("/api/content-feedback").then((data) => { if (!cancelled) setFeedback((previous) => ({ ...data, ...previous })); }).catch(() => undefined);
    const stop = bus.subscribe((event) => { if (event.type === "content_feedback") setFeedback((previous) => ({ ...previous, [event.contentId]: event.kind })); });
    return () => { cancelled = true; stop(); };
  }, [bus]);
  const dossier = view.dossier;
  const building = view.status === "queued" || view.status === "running";
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [initial.jobId]);
  const voiceContext = useMemo(() => ({ jobId: view.jobId, inquiryId: inquiry?.id, version: dossier?.id }), [view.jobId, inquiry?.id, dossier?.id]);
  const guide = useVoiceGuide({ enabled: voiceEnabled, feed, bus, cognitionContext: voiceContext, markSeen, rebuild });
  const back = from && /^[\w:-]+$/.test(from) ? `/feed#card-${from}` : "/feed";
  const loadInquiry = async (id: string) => {
    const data = await cognitionJson<InquiryView>(`/api/inquiries?id=${encodeURIComponent(id)}`);
    if (data.jobId !== view.jobId) throw new Error("这次思辨属于另一个话题");
    const evidenceView = await cognitionJson<DossierView>(`/api/dossiers?id=${view.jobId}&version=${data.dossierId}`);
    setView(evidenceView); setInquiry(data); setSaved(data.savedReflectionId ?? null);
  };
  useEffect(() => {
    if (!inquiryId) return;
    let cancelled = false;
    cognitionJson<InquiryView>(`/api/inquiries?id=${encodeURIComponent(inquiryId)}`).then(async (data) => {
      if (data.jobId !== initial.jobId) throw new Error("这次思辨属于另一个话题");
      const pinned = await cognitionJson<DossierView>(`/api/dossiers?id=${initial.jobId}&version=${data.dossierId}`);
      if (!cancelled) { setInquiry(data); setView(pinned); setSaved(data.savedReflectionId ?? null); }
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [inquiryId, initial.jobId]);
  useEffect(() => {
    if (version || inquiry || !["queued", "running"].includes(view.status)) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; const until = Date.now() + 350_000;
    const poll = async () => {
      try { const next = await cognitionJson<DossierView>(`/api/dossiers?id=${view.jobId}`); if (cancelled) return; setView(next);
        if (["queued", "running"].includes(next.status) && Date.now() < until) timer = setTimeout(poll, 1500);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "读取中断，请刷新"); }
    };
    timer = setTimeout(poll, 800); return () => { cancelled = true; clearTimeout(timer); };
  }, [view.jobId, view.status, version, inquiry]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "暂时没完成"); } finally { setBusy(false); }
  };
  const refresh = () => run(async () => {
    await cognitionJson("/api/dossiers", { topic: view.topic, refresh: true }); setInquiry(null); setSaved(null);
    router.replace(`/topics/${view.jobId}`); setView(await cognitionJson(`/api/dossiers?id=${view.jobId}`));
  });
  const reanalyze = () => run(async () => { await cognitionJson("/api/dossiers", { topic: view.topic }); setView(await cognitionJson(`/api/dossiers?id=${view.jobId}`)); });
  const showEvidence = (id: string) => {
    const evidence = dossier?.evidence.find((e) => e.id === id); const source = dossier?.sources.find((s) => s.id === evidence?.snapshotId);
    if (source && evidence) setSelected({ source, evidence });
  };
  const cites = (ids: string[]) => ids.map((id) => {
    const n = (dossier?.evidence.findIndex((e) => e.id === id) ?? -1) + 1;
    return n > 0 ? <button key={id} type="button" className="cite" aria-label={`核对第 ${n} 条原话`} onClick={() => showEvidence(id)}>{n}</button> : null;
  });
  const cited = (item: CitedText, key: string | number) => <p key={key}>{item.text}{cites(item.evidenceIds)}</p>;
  const materialRows = (sources: SourceSnapshot[], note: string) => sources.map((source) => (
    <details className="source-row" key={source.id}>
      <summary>{source.title}<span className="source-row-meta">{source.author ?? "作者未知"} · {note}</span></summary>
      <div className="source-row-body"><button type="button" className="text-control text-control-sm" onClick={() => setSelected({ source })}><FileText size={13} />看抓到的片段</button></div>
    </details>
  ));
  const send = (action: "reply" | "draft") => run(async () => {
    if (!inquiry) return;
    const body = { action, inquiryId: inquiry.id, revision: inquiry.revision, text: reply.trim() || undefined };
    const next = await cognitionJson<InquiryView>("/api/inquiries", { ...body, requestId: requestId(body) });
    setInquiry(next); setReply("");
  });
  const summaryChars = dossier ? [...dossier.summary.text] : [];
  const summaryLong = summaryChars.length > SUMMARY_LIMIT;
  const summaryText = dossier ? (summaryLong && !expanded ? summaryChars.slice(0, SUMMARY_LIMIT).join("") + "…" : dossier.summary.text) : "";
  const headingNote = building ? "小棱正在找原文，通常要 1–3 分钟。" : version ? "这是早前的版本。" : "先看材料怎么说，再决定你怎么想。";

  return <VoiceBusContext value={bus}><main id="main-content" className="product-page">
    <div className="product-crumbs"><Link href={back} className="text-control text-control-sm"><ArrowLeft size={13} />回到今天的阅读</Link></div>
    <header className="product-heading">
      <div><span className="product-eyebrow">看分歧 · 核对依据</span><h1>{view.topic}</h1><p>{headingNote}</p></div>
      <div className="product-heading-actions">
        {voiceEnabled ? <VoiceStart guide={guide} label="和小棱一起想清楚" /> : null}
        <button type="button" className="text-control" disabled={busy || building} onClick={refresh}><RefreshCw size={14} />找找更新的材料</button>
      </div>
    </header>
    <div className="product-stack">
      {voiceEnabled ? <VoicePanel guide={guide} /> : null}
      {error && <div className="inline-note inline-note-danger" role="alert"><AlertTriangle size={16} /><div className="inline-note-body">{error}</div></div>}
      {view.error && <div className="inline-note inline-note-warm"><AlertTriangle size={16} /><div className="inline-note-body">{view.error}</div><div className="inline-note-actions"><button type="button" className="pill-button pill-secondary pill-small" disabled={busy} onClick={reanalyze}>用已找到的材料再试一次</button></div></div>}
      {building && !version && !inquiry && <ProgressPanel title="小棱在整理这个话题" stages={DOSSIER_STAGES} current={view.stage} expected="通常 1–3 分钟。离开也没关系，回到这个地址会接着显示。">{!dossier && !view.materials?.length ? <DossierSkeleton /> : null}</ProgressPanel>}
      {dossier && view.status !== "ready" && !version && !inquiry && <div className="inline-note"><Info size={16} /><div className="inline-note-body">这次更新还没整理出新结果，下面还是上一次的内容，你的判断和引用没变。{Boolean(view.materials?.length) && <details><summary className="text-control text-control-sm">看这次找到的材料</summary>{materialRows(view.materials!, "还没归纳")}</details>}</div></div>}
      {!dossier && view.materials?.length ? (
        <section className="product-surface surface-stack">
          <h2 className="product-section-title">先看看已经找到的原文</h2>
          <p className="text-sm text-muted">{view.status === "error" ? "这次没整理出结果，先把找到的原文留给你自己核对。" : "归纳还在进行，可以先读这些。"}</p>
          <div>{materialRows(view.materials, "还没归纳")}</div>
        </section>
      ) : null}
      {!dossier && !building && !view.materials?.length && !view.error ? (
        <div className="empty-state product-surface"><h3>这次没找到能用的材料</h3><p>换个说法再试，或者过会儿再来。</p><button type="button" className="pill-button pill-primary" disabled={busy} onClick={reanalyze}>再找一次</button></div>
      ) : null}
      {dossier && <div className="topic-layout">
        <div className="product-stack">
          <section className="product-surface surface-lead surface-stack">
            <div><span className="product-eyebrow">核心问题</span><h2 className="topic-question">{dossier.question}</h2></div>
            <p className="topic-summary">{summaryText}{cites(dossier.summary.evidenceIds)}</p>
            {summaryLong && <button type="button" className="text-control text-control-sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开全文"}<ChevronDown size={13} /></button>}
            <p className="topic-meta">由小棱根据 {dossier.sources.length} 条来源、{dossier.evidence.length} 段核对过的原话归纳 · {dossier.createdAt.slice(0, 10)}{version ? " · 早前版本" : ""}</p>
            {dossier.notices.length > 0 && <div className="inline-note"><Info size={16} /><div className="inline-note-body">{dossier.notices.map((notice) => <p key={notice}>{notice}</p>)}</div></div>}
            {dossier.quality === "materials_only" && !version && !inquiry && <div><button type="button" className="text-control" disabled={busy || building} onClick={reanalyze}><RefreshCw size={14} />再归纳一次</button></div>}
          </section>
          <section className="product-surface">
            <h2 className="product-section-title">主要分歧</h2>
            <p className="text-xs text-muted">只反映这批材料，不是全网投票。下面是对作者说法的归纳，点数字可以核对原话。</p>
            {!dossier.dimensions.length && <p className="inline-note topic-note">这批材料没有明显分歧，直接读来源就好。</p>}
            {dossier.dimensions.map((dimension, index) => <div className="topic-dimension" key={index}>
              <h3>{index + 1}. {dimension.title}</h3>
              <div className="position-grid">{dimension.positions.map((position, j) => <div className="position" key={j}><h4>{position.label}</h4>{position.claims.map((claim, k) => cited(claim, k))}</div>)}</div>
            </div>)}
          </section>
          <section className="product-surface">
            {[{ title: "大家都同意的", rows: dossier.consensus }, { title: "成立条件", rows: dossier.conditions }, { title: "反例和例外", rows: dossier.counterexamples }].map(({ title, rows }) => <div className="topic-block" key={title}>
              <h3>{title}</h3>{rows.length ? rows.map((item, i) => cited(item, i)) : <p className="text-muted">材料里没找到依据，先不下结论。</p>}
            </div>)}
            <div className="topic-block"><h3>还没答案的问题</h3>{dossier.openQuestions.length ? <ul>{dossier.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul> : <p className="text-muted">你的情况可能有材料没覆盖的前提，可以记在「帮我想清楚」里。</p>}</div>
          </section>
        </div>
        <aside className="product-stack">
          <section className="product-surface surface-stack" id="inquiry">
            <h2 className="product-section-title">帮我想清楚</h2>
            {!inquiry ? <>
              <p className="text-sm text-muted leading-loose">小棱最多问你三个问题，每次一个。可以坚持原想法、说不确定，也可以随时停。小棱整理的草稿要你确认才会保存。</p>
              <div><button type="button" className="pill-button pill-primary" disabled={busy} onClick={() => run(async () => {
                const body = { action: "start", jobId: view.jobId, version: dossier.id };
                const data = await cognitionJson<InquiryView>("/api/inquiries", { ...body, requestId: requestId(body) }); setInquiry(data);
                router.replace(`/topics/${view.jobId}?inquiry=${data.id}&version=${dossier.id}${from ? `&from=${encodeURIComponent(from)}` : ""}`, { scroll: false });
              })}>{busy ? "准备中…" : "开始"}</button></div>
            </> : <>
              <div className="action-row"><span className="tag">{inquiry.status === "draft" ? "草稿已整理" : `第 ${inquiry.round} 轮，共 3 轮`}</span><button type="button" className="text-control text-control-sm push-end" disabled={busy} onClick={() => run(() => loadInquiry(inquiry.id))}><RefreshCw size={13} />刷新</button></div>
              {inquiry.turns.map((turn, i) => <details className="inquiry-turn" key={i}><summary>第 {i + 1} 轮</summary><blockquote>{turn.text}</blockquote>{cited(turn.feedback, `turn-${i}`)}</details>)}
              {inquiry.notice && <div className="inline-note"><Info size={16} /><div className="inline-note-body">{inquiry.notice}</div></div>}
              {inquiry.status === "discussing" ? <>
                <p className="inquiry-question">{inquiry.question}</p>
                <label className="form-field">我的想法<textarea rows={4} disabled={busy} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1200} placeholder="也可以写「还不确定」" /></label>
                <div className="action-row"><button type="button" className="pill-button pill-primary" disabled={busy || !reply.trim()} onClick={() => send("reply")}>{busy ? "正在核对…" : "继续"}</button><button type="button" className="text-control" disabled={busy} onClick={() => send("draft")}>先整理成草稿</button></div>
                <p className="text-xs text-muted">你的回答只有你能看到，发给模型前会去掉明显的个人信息。</p>
              </> : inquiry.draft && !saved ? <DraftEditor key={`${inquiry.id}:${inquiry.revision}`} initial={inquiry.draft} dossier={dossier} jobId={view.jobId} inquiryId={inquiry.id} onSaved={setSaved} /> : null}
              {saved && <div className="inline-note inline-note-accent" role="status"><Info size={16} /><div className="inline-note-body">已保存。</div><div className="inline-note-actions"><Link className="text-control text-control-sm" href={`/reflections?id=${saved}`}>去「我的判断」看<ArrowUpRight size={13} /></Link></div></div>}
            </>}
          </section>
          <details className="product-surface">
            <summary className="text-control">原文材料 · {dossier.sources.length} 条<ChevronDown size={13} /></summary>
            <p className="text-xs text-muted">归纳只是辅助，原文才算数。</p>
            {dossier.sources.map((source) => <details className="source-row" key={source.id}>
              <summary>{source.title}<span className="source-row-meta">{source.author ?? "作者未知"} · {source.scope === "search_excerpt" ? "搜索摘录" : "正文片段"}</span></summary>
              <div className="source-row-body">
                <button type="button" className="text-control text-control-sm" onClick={() => setSelected({ source })}><FileText size={13} />看抓到的片段</button>
                <ReadingFeedback contentId={source.contentId} initial={feedback[source.contentId] ?? null} />
              </div>
            </details>)}
          </details>
        </aside>
      </div>}
    </div>
    <EvidenceDialog source={selected?.source ?? null} evidence={selected?.evidence} onClose={() => setSelected(null)} />
  </main></VoiceBusContext>;
}
