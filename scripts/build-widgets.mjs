// 把 widgets/src/<name>.ts 打成自包含 HTML 写到 widgets/dist/，作为 ui:// MCP 资源提供。
// 修改卡片源码后运行：node scripts/build-widgets.mjs（pnpm build 会自动跑一次），产物需要提交。
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve("widgets/src");
const DIST = path.resolve("widgets/dist");

// 颜色 token 对应 app/globals.css 的 :root / .dark；宿主给了 --color-* 变量时优先用宿主的。
const CSS = `
:root { --bg: var(--color-background-primary, #fafbf9); --fg: var(--color-text-primary, #202124); --surface: var(--color-background-secondary, #ffffff);
  --surface-2: #f0f3f4; --muted: var(--color-text-secondary, #56616e); --line: var(--color-border-secondary, #e1e6e9);
  --accent: #2878d0; --accent-soft: #e7f0fb; --accent-ink: #235f9d; --warn: #b7791f; --warn-soft: #fbf1d8;
  --warm-surface: #fcf4dc; --warm-ink: #735719; --prism-warm: #f4d47a; --bad: #c2410c; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: var(--color-background-primary, #15191e); --fg: var(--color-text-primary, #edf1f5); --surface: var(--color-background-secondary, #1e242b);
  --surface-2: #252d36; --muted: var(--color-text-secondary, #b6c1cc); --line: var(--color-border-secondary, #35404c);
  --accent: #82b5ee; --accent-soft: #253c56; --accent-ink: #bad8fa; --warn: #e2b458; --warn-soft: #3a3427;
  --warm-surface: #3a3427; --warm-ink: #ead291; --prism-warm: #d9b765; --bad: #f59e7a; } }
:root[data-theme="dark"] { --bg: var(--color-background-primary, #15191e); --fg: var(--color-text-primary, #edf1f5); --surface: var(--color-background-secondary, #1e242b);
  --surface-2: #252d36; --muted: var(--color-text-secondary, #b6c1cc); --line: var(--color-border-secondary, #35404c);
  --accent: #82b5ee; --accent-soft: #253c56; --accent-ink: #bad8fa; --warn: #e2b458; --warn-soft: #3a3427;
  --warm-surface: #3a3427; --warm-ink: #ead291; --prism-warm: #d9b765; --bad: #f59e7a; }
* { box-sizing: border-box; }
html, body { background: transparent; }
body { margin: 0; padding: 12px; color: var(--fg); font-size: 14px; line-height: 1.6;
  font-family: var(--font-sans, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif); }
a { color: inherit; text-decoration: none; }
p { margin: 0; }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.title { font-weight: 600; font-size: 15px; }
.spacer { flex: 1; }
.sub { color: var(--muted); font-size: 12px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.truncate { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--muted); padding: 8px 0; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.stack.tight { gap: 8px; }
.card { background: var(--surface); border: 1px solid color-mix(in srgb, var(--line) 65%, transparent); border-radius: 16px; padding: 18px 20px 8px; }
.card.is-seen { opacity: .62; }
.card h3 { margin: 10px 0 0; font-size: 17px; line-height: 1.6; font-weight: 550; text-wrap: pretty; }
.card h3 a:hover { color: var(--accent); }
.meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 11px; }
.topic { color: var(--accent-ink); }
.topic.warm { color: var(--warm-ink); }
.seen { color: var(--muted); }
.summary { font-size: 14px; line-height: 1.85; margin-top: 8px; color: color-mix(in srgb, var(--fg) 84%, var(--surface)); }
.byline { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--muted); font-size: 11px; margin-top: 12px; }
.open { color: var(--muted); } .open:hover { color: var(--accent); }
.btn { border: 1px solid var(--line); background: var(--surface); color: var(--fg); border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn[disabled] { opacity: .5; cursor: default; }
.reason { border-top: 1px solid var(--line); margin-top: 8px; font-size: 11px; }
.reason summary { cursor: pointer; color: var(--muted); padding: 10px 0; list-style: none; }
.reason summary::-webkit-details-marker { display: none; }
.reason p { line-height: 1.85; padding: 0 0 10px; color: var(--accent-ink); }
.prism { background: linear-gradient(125deg, var(--surface), var(--warm-surface)); border-color: color-mix(in srgb, var(--prism-warm) 45%, var(--line)); padding-bottom: 18px; }
.prism-title { font-weight: 600; font-size: 13px; background: linear-gradient(90deg, var(--accent), var(--warm-ink)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.exposure { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--surface-2) 70%, transparent); font-size: 12px; }
.bar-track { display: flex; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 16%, transparent); overflow: hidden; margin: 8px 0; }
.bar-fill { display: block; height: 100%; background: var(--accent); }
.bar-fill.con { background: var(--warn); } .bar-fill.neutral { background: var(--muted); }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; border-radius: 999px; padding: 2px 9px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.chip.pro.soft { background: var(--accent-soft); color: var(--accent-ink); border-color: transparent; }
.chip.con.soft { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.chip.pro.solid { background: var(--accent); color: #fff; border-color: transparent; }
.chip.con.solid { background: var(--warn); color: #fff; border-color: transparent; }
.chip.neutral.solid { background: var(--muted); color: var(--bg); border-color: transparent; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; margin-top: 14px; }
.cols.single { grid-template-columns: 1fr; }
.col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.item { display: block; border: 1px solid var(--line); background: var(--surface); border-radius: 12px; padding: 12px 14px; }
.item:hover { border-color: var(--accent); }
.item.dense { background: color-mix(in srgb, var(--surface-2) 60%, transparent); border-color: transparent; padding: 10px 12px; }
.item-line { font-weight: 500; line-height: 1.55; }
.item.dense .item-line { font-weight: 400; font-size: 13px; }
.item-meta { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 11px; color: var(--muted); min-width: 0; }
.votes { margin-left: auto; white-space: nowrap; }
.analysis { border: 1px dashed var(--line); border-radius: 12px; padding: 10px 12px; font-size: 13px; }
.analysis p { margin-top: 6px; white-space: pre-line; line-height: 1.75; color: color-mix(in srgb, var(--fg) 85%, var(--surface)); display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }
.question { margin: 0 0 12px; font-size: 17px; font-weight: 550; line-height: 1.55; }
.topic-item { background: var(--surface); border: 1px solid color-mix(in srgb, var(--line) 65%, transparent); border-radius: 12px; padding: 10px 12px; }
.weight { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.quote { margin-top: 6px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 13px; overflow-wrap: anywhere; }
.raw { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 ui-monospace, "SF Mono", Menlo, monospace; border: 1px solid var(--line); border-radius: 12px; padding: 12px; max-height: 420px; overflow: auto; margin: 0; }
.error-box { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--bad); border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent); border-radius: 12px; padding: 12px; }
@media (max-width: 520px) { body { padding: 8px; } .card { padding: 14px 14px 6px; } .cols { grid-template-columns: 1fr; } }
`;

export function sourceHash(name) {
  const hash = createHash("sha1");
  for (const file of [`${name}.ts`, "shared.ts"]) hash.update(readFileSync(path.join(SRC, file)));
  hash.update(CSS);
  return hash.digest("hex").slice(0, 16);
}

// 测试只需要 sourceHash，设置 WIDGETS_NO_BUILD=1 时导入本模块不触发构建
if (!process.env.WIDGETS_NO_BUILD) await buildAll();

async function buildAll() {
mkdirSync(DIST, { recursive: true });
const entries = readdirSync(SRC).filter((file) => file.endsWith(".ts") && file !== "shared.ts");
for (const entry of entries) {
  const name = entry.replace(/\.ts$/, "");
  const result = await build({ entryPoints: [path.join(SRC, entry)], bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, write: false,
    alias: { "@": path.resolve(".") } });
  const js = result.outputFiles[0].text;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="zhiprism-widget-src" content="${sourceHash(name)}"><title>知棱 ${name}</title>
<style>${CSS}</style></head>
<body><div id="root"><p class="empty">加载中…</p></div>
<script>${js}</script>
</body></html>`;
  writeFileSync(path.join(DIST, `${name}.html`), html);
  console.log(`built widgets/dist/${name}.html (${(html.length / 1024).toFixed(1)} KB)`);
}
}
