"use client";
import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "./copy-button";
type TokenInfo = { id: string; label: string; expiresAt: number };
export function McpTokens({ appUrl }: { appUrl: string }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [label, setLabel] = useState("我的 Agent");
  const [issued, setIssued] = useState<{ token: string; id: string }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/mcp-tokens");
    if (!response.ok) throw new Error("请先登录，再管理 MCP 访问令牌。");
    setTokens((await response.json()).tokens);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mcp-tokens", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("请先登录，再管理 MCP 访问令牌。");
        return response.json();
      })
      .then((data) => { if (!controller.signal.aborted) setTokens(data.tokens); })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  const change = async (method: "POST" | "DELETE", body: object) => {
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/mcp-tokens", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "操作失败");
      if (method === "POST") setIssued(data);
      else if ((body as { id: string }).id === issued?.id) setIssued(undefined);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
    finally { setBusy(false); }
  };
  const config = JSON.stringify({ mcpServers: { zhiprism: { url: `${appUrl}/api/mcp`, headers: { Authorization: `Bearer ${issued?.token ?? "<生成的访问令牌>"}` } } } }, null, 2);
  return <div className="surface-stack">
    <div className="action-row"><label className="form-field flex-1">连接名称<input id="mcp-token-label" type="text" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></label><button type="button" className="pill-button pill-primary pill-small" disabled={busy || !label.trim()} onClick={() => void change("POST", { label })}>生成令牌</button></div>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {issued ? <div>
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">令牌只显示这一次。请保存配置；令牌有效期为 90 天。</p><CopyButton text={config} /></div>
      <pre className="code-surface mt-2 overflow-x-auto">{config}</pre>
    </div> : null}
    <ul className="divide-y divide-border">{tokens.map((token) => <li key={token.id} className="flex items-center justify-between gap-2 py-2 text-sm">
      <span>{token.label}<span className="ml-2 text-xs text-muted">到期 {new Date(token.expiresAt).toLocaleDateString()}</span></span>
      <button type="button" className="text-control text-control-sm text-control-danger" disabled={busy} onClick={() => void change("DELETE", { id: token.id })}>撤销</button>
    </li>)}</ul>
  </div>;
}
