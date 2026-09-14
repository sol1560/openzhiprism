"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bell, BellRing, Download, FileSearch, Pencil, PenLine, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import type { DossierView, ReflectionView, TopicDossier } from "@/lib/cognition/types";
import { cognitionJson } from "./client";
import { DraftEditor } from "./draft-editor";

/** 「我的判断」：只放用户确认过的想法；每条一张 surface，操作是一行安静的 text-control。 */
export function ReflectionList({ initial }: { initial: ReflectionView[] }) {
  const [items, setItems] = useState(initial); const [filter, setFilter] = useState(""); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ reflection: ReflectionView; dossier: TopicDossier } | null>(null);
  const [preview, setPreview] = useState<{ id: string; format: "md" | "html"; text: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const exportOpener = useRef<HTMLButtonElement | null>(null);
  const previewOpen = Boolean(preview);
  useEffect(() => { if (!previewOpen || !dialog.current) return; const node = dialog.current; node.showModal(); return () => { node.close(); exportOpener.current?.focus(); }; }, [previewOpen]);
  // 从话题页「去「我的判断」看」跳过来时定位到那一条
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id) document.getElementById(`reflection-${id}`)?.scrollIntoView({ block: "start" }); }, []);
  const reload = async () => { const data = await cognitionJson<{ reflections: ReflectionView[] }>("/api/reflections"); setItems(data.reflections); };
  const run = async (fn: () => Promise<void>) => { setError(""); setBusy(true); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "这次没成功"); } finally { setBusy(false); } };
  const exportPreview = (id: string, format: "md" | "html") => run(async () => {
    const res = await fetch(`/api/reflections?id=${encodeURIComponent(id)}&format=${format}`, { cache: "no-store" });
    if (!res.ok) throw new Error("导出预览没生成出来");
    setPreview({ id, format, text: await res.text() });
  });
  const download = () => {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.text], { type: preview.format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `知棱-我的判断.${preview.format}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const filtered = items.filter((item) => item.topic.toLowerCase().includes(filter.toLowerCase()));
  const withNew = items.filter((item) => item.newSources.length > 0);
  return <main id="main-content" className="product-page">
    <header className="product-heading">
      <div><span className="product-eyebrow">读过之后，留下你的判断</span><h1>我的判断</h1><p>只有你确认过的想法才会存在这里。可以留着不确定，也可以随时改。</p></div>
      <div className="product-heading-actions">
        <label className="search-field"><Search size={14} /><input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="按话题找" aria-label="按话题找" /></label>
        <button type="button" className="text-control" disabled={busy} onClick={() => run(reload)}><RefreshCw size={14} />刷新</button>
      </div>
    </header>
    <div className="feed-layout">
      <div className="reading-list">
        {error && <div className="inline-note inline-note-danger" role="alert"><AlertTriangle size={16} /><div className="inline-note-body">{error}</div></div>}
        {!items.length && <div className="empty-state product-surface"><PenLine size={24} /><h3>还没有保存过判断。</h3><p>在任意一张卡片点「看分歧与依据」，和小棱聊几轮，确认草稿就会出现在这里。</p><Link href="/feed" className="pill-button pill-primary">去读今天的内容</Link></div>}
        {items.length > 0 && !filtered.length && <p className="text-sm text-muted">没有和「{filter}」相关的判断。</p>}
        {filtered.map((item) => {
          const latest = item.versions[0]; if (!latest) return null;
          const hasFacts = latest.conditions.length > 0 || latest.openQuestions.length > 0 || Boolean(latest.nextStep);
          return <article key={item.id} id={`reflection-${item.id}`} className="product-surface surface-stack">
            <div className="reflection-head">
              <span className="product-eyebrow">版本 {latest.version} · {latest.createdAt.slice(0, 10)}</span>
              {item.following && <span className="tag tag-accent">在关注</span>}
              {item.newSources.length > 0 && <span className="tag tag-warm">有 {item.newSources.length} 条新材料</span>}
              <h2 className="reflection-topic">{item.topic}</h2>
            </div>
            <p className="reflection-judgment">{latest.judgment}</p>
            {hasFacts && <dl className="reflection-facts">
              {latest.conditions.length > 0 && <div><dt>什么情况下成立</dt><dd><ul>{latest.conditions.map((text, i) => <li key={i}>{text}</li>)}</ul></dd></div>}
              {latest.openQuestions.length > 0 && <div><dt>还没想清楚的</dt><dd><ul>{latest.openQuestions.map((text, i) => <li key={i}>{text}</li>)}</ul></dd></div>}
              {latest.nextStep && <div><dt>下一步</dt><dd>{latest.nextStep}</dd></div>}
            </dl>}
            {item.newSources.length > 0 && <div className="inline-note inline-note-warm"><Sparkles size={16} /><div className="inline-note-body"><strong>有 {item.newSources.length} 条新材料</strong>{item.newSources.slice(0, 3).map((source) => source.title).join("；")}</div><div className="inline-note-actions"><Link className="text-control text-control-sm" href={`/topics/${item.jobId}`}>去核对，判断不会自动改<ArrowUpRight size={13} /></Link></div></div>}
            <div className="action-row">
              <Link className="text-control" href={`/topics/${item.jobId}?version=${latest.dossierId}`}><FileSearch size={14} />看当时的依据（{latest.evidenceIds.length} 条）</Link>
              <button type="button" className="text-control" disabled={busy} onClick={() => run(async () => { const view = await cognitionJson<DossierView>(`/api/dossiers?id=${item.jobId}&version=${latest.dossierId}`); if (view.dossier) setEditing({ reflection: item, dossier: view.dossier }); })}><Pencil size={14} />修改</button>
              <button type="button" className="text-control" aria-pressed={item.following} disabled={busy} onClick={() => run(async () => { await cognitionJson("/api/reflections", { action: "follow", reflectionId: item.id, following: !item.following, expectedVersion: latest.version }); await reload(); })}>{item.following ? <BellRing size={14} /> : <Bell size={14} />}{item.following ? "已关注" : "关注新材料"}</button>
              <button type="button" className="text-control" disabled={busy} onClick={(event) => { exportOpener.current = event.currentTarget; void exportPreview(item.id, "md"); }}><Download size={14} />导出</button>
              <button type="button" className="text-control text-control-danger" disabled={busy} onClick={() => setDeleting(item.id)}><Trash2 size={14} />删除</button>
            </div>
            {deleting === item.id && <div className="inline-note inline-note-danger"><AlertTriangle size={16} /><div className="inline-note-body">删掉这条判断和它的全部版本？原文和其他话题不受影响。</div><div className="inline-note-actions"><button type="button" className="pill-button pill-primary pill-small" disabled={busy} onClick={() => run(async () => { await cognitionJson("/api/reflections", { action: "delete", reflectionId: item.id, expectedVersion: latest.version, confirmed: true }); setDeleting(null); await reload(); })}>删除</button><button type="button" className="text-control" onClick={() => setDeleting(null)}>保留</button></div></div>}
            {editing?.reflection.id === item.id && <div className="reflection-editor surface-stack"><h3 className="surface-subtitle">修改判断</h3><DraftEditor key={`${item.id}:${editing.reflection.versions[0].version}`} initial={editing.reflection.versions[0]} dossier={editing.dossier} jobId={item.jobId} reflectionId={item.id} expectedVersion={editing.reflection.versions[0].version} following={editing.reflection.following} onSaved={() => { setEditing(null); void run(reload); }} /><div><button type="button" className="text-control" onClick={() => setEditing(null)}>取消</button></div></div>}
            {item.versions.length > 1 && <details className="reflection-history"><summary>早前的版本（{item.versions.length - 1}）</summary>
              {item.versions.slice(1).map((version) => <div className="reflection-history-item" key={version.version}><span className="product-eyebrow">版本 {version.version} · {version.createdAt.slice(0, 10)}</span><p>{version.judgment}</p>{version.conditions.length > 0 && <p className="text-xs text-muted">当时的条件：{version.conditions.join("；")}</p>}<Link href={`/topics/${item.jobId}?version=${version.dossierId}`} className="text-control text-control-sm">看当时的依据<ArrowUpRight size={13} /></Link></div>)}
            </details>}
          </article>;
        })}
      </div>
      <aside className="feed-sidebar">
        <section className="product-surface">
          <h2 className="sidebar-title">有新材料</h2>
          {withNew.length ? <ul className="recent-opened">{withNew.map((item) => <li key={item.id}><a href={`#reflection-${item.id}`}>{item.topic}</a><div className="recent-opened-meta"><span>{item.newSources.length} 条新材料</span></div></li>)}</ul> : <p className="text-xs text-muted">你关注的问题有新材料时，会列在这里。</p>}
        </section>
      </aside>
    </div>
    <dialog ref={dialog} className="content-preview content-preview-wide" aria-labelledby="export-heading" onCancel={() => setPreview(null)}>
      {preview && <>
        <div className="preview-topline"><span className="product-eyebrow">导出</span><button type="button" className="icon-control" aria-label="关闭" onClick={() => setPreview(null)}><X size={17} /></button></div>
        <h2 id="export-heading">导出前看一眼</h2>
        <p className="preview-note">只导出你确认过的判断和公开引用，不含对话和草稿。分享前再看一眼内容。</p>
        <div className="form-stack">
          <div className="segmented-tabs" role="tablist" aria-label="导出格式">
            <button type="button" role="tab" aria-selected={preview.format === "md"} disabled={busy} onClick={() => exportPreview(preview.id, "md")}>Markdown</button>
            <button type="button" role="tab" aria-selected={preview.format === "html"} disabled={busy} onClick={() => exportPreview(preview.id, "html")}>可打印 HTML</button>
          </div>
          {preview.format === "md" ? <textarea className="export-text" aria-label="Markdown 导出预览" readOnly value={preview.text} /> : <iframe title="打印预览" className="export-frame" sandbox="" srcDoc={preview.text} />}
          <div className="action-row"><button type="button" className="pill-button pill-primary" onClick={download}><Download size={14} />下载</button></div>
        </div>
      </>}
    </dialog>
  </main>;
}
