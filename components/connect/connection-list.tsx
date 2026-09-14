"use client";
import { useCallback, useEffect, useState } from "react";
import { Switch } from "@heroui/react";
import { Check, Link2, RefreshCw } from "lucide-react";

type Connection = { kind?: "connector" | "extension"; id: string; clientName: string; createdAt: number; expiresAt: number; lastUsedAt: number | null; autoIngest: boolean; status: "authorized" | "verified" | "expired" };
const labels = { authorized: "已授权，等待首次调用", verified: "已验证", expired: "已失效" };
export function ConnectionList() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/connections", { signal });
      if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录后查看连接。" : "连接状态加载失败，请重试。");
      const data = await response.json();
      if (!signal?.aborted) { setConnections(data.connections); setError(undefined); setLoaded(true); }
    } catch (err) { if (!signal?.aborted) { setError(err instanceof Error ? err.message : "网络异常，请重试。"); setLoaded(true); } }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/connections", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("连接状态加载失败，请刷新重试。");
      return response.json();
    }).then((data) => {
      if (!controller.signal.aborted) { setConnections(data.connections); setLoaded(true); }
    }).catch((err: Error) => {
      if (!controller.signal.aborted) { setError(err.message); setLoaded(true); }
    });
    const refresh = () => { if (!document.hidden) void load(controller.signal); };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 15_000);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  async function toggleAutoIngest(id: string, autoIngest: boolean) {
    setConnections((items) => items.map((item) => item.id === id ? { ...item, autoIngest } : item));
    try {
      const response = await fetch("/api/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, autoIngest }) });
      if (!response.ok) throw new Error("自动采集设置保存失败，请重试。");
      setError(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : "网络异常，请重试。"); await load(); }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("撤销失败，请重试。");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "网络异常，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="connect-management" aria-label="我的连接">
    <div className="connect-section-heading"><h2>我的连接</h2><button type="button" className="text-control text-control-sm" onClick={() => void load()}><RefreshCw size={14} />刷新</button></div>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!loaded ? <p className="my-4 text-sm text-muted">正在读取连接…</p> : !connections.length && !error ? <div className="connect-empty"><Link2 size={18} /><p>还没有连接。完成上面的授权后，连接会出现在这里。</p></div> : null}
    <ul className="connection-list">{connections.map((item) => <li key={item.id}>
      <div className="connection-identity"><strong>{item.clientName}</strong><span className={`connection-state state-${item.status}`}>
        {item.status === "verified" ? <Check size={13} /> : null}{labels[item.status]}</span>
        <p>{item.lastUsedAt ? `最近调用 ${new Date(item.lastUsedAt).toLocaleString()}` : `授权于 ${new Date(item.createdAt).toLocaleDateString()}`} · 到期 {new Date(item.expiresAt).toLocaleDateString()}</p></div>
      {item.status !== "expired" ? <div className="connection-actions">
        {item.kind !== "extension" && <Switch size="sm" isSelected={item.autoIngest} onChange={(value) => void toggleAutoIngest(item.id, value)} aria-label={`${item.clientName} 自动采集`}>
          <Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content>自动采集</Switch.Content></Switch>}
        <button type="button" className="text-control text-control-sm text-control-danger" disabled={busy} onClick={() => void revoke(item.id)}>撤销</button>
      </div> : <span className="text-xs text-muted">请在客户端重新连接</span>}
    </li>)}</ul>
    <p className="mt-3 text-xs leading-relaxed text-muted">成功调用知棱工具或通过插件导入聊天后，状态才会变为「已验证」。插件只在点击时捕捉。「自动采集」开启后，该客户端会在你聊到新兴趣时主动提交那段对话；默认关闭。撤销后需要在客户端重新授权。</p>
  </section>;
}
