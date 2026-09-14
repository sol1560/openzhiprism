import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * MCP Apps（SEP-1865）卡片：scripts/build-widgets.mjs 把 widgets/src/<name>.ts 打成自包含 HTML，
 * 这里以 ui:// 资源提供。工具通过 `_meta: uiMeta("<name>")` 选择卡片；不支持 Apps 的宿主忽略元数据、照常读 JSON 文本。
 */

export const WIDGET_MIME = "text/html;profile=mcp-app";
export const WIDGETS = {
  cognition: { uri: "ui://zhiprism/cognition.html", title: "证据与我的判断" },
  feed: { uri: "ui://zhiprism/feed.html", title: "今日 Feed" },
  profile: { uri: "ui://zhiprism/profile.html", title: "兴趣画像" },
  perspectives: { uri: "ui://zhiprism/perspectives.html", title: "多元视角" },
  result: { uri: "ui://zhiprism/result.html", title: "通用结果视图" },
} as const;
export type WidgetName = keyof typeof WIDGETS;

// resourceDomains 会同时映射到 script/style-src，只放 Claude 字体源；知乎图片域绝不加入。
const RESOURCE_UI = { prefersBorder: false, csp: { resourceDomains: ["https://assets.claude.ai"] } } as const;

export function uiMeta(name: WidgetName, options: { modelOnly?: boolean } = {}): Record<string, unknown> {
  const resourceUri = WIDGETS[name].uri;
  // 嵌套 ui.resourceUri 是规范形式；"ui/resourceUri" 旧键给尚未迁移的宿主。
  return { ui: { resourceUri, ...(options.modelOnly ? { visibility: ["model"] } : {}) }, "ui/resourceUri": resourceUri };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 没有专属卡片的工具回退到通用结果视图（仅模型可见），已声明的卡片与其他 _meta 原样保留。 */
export function ensureUiMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const nested = isRecord(meta?.ui) ? meta.ui : undefined;
  const existing = typeof nested?.resourceUri === "string" ? nested.resourceUri : typeof meta?.["ui/resourceUri"] === "string" ? String(meta["ui/resourceUri"]) : undefined;
  if (existing?.startsWith("ui://")) return { ...meta, ui: { ...nested, resourceUri: existing }, "ui/resourceUri": existing };
  const fallback = uiMeta("result", { modelOnly: true });
  return { ...meta, ...fallback, ui: { ...nested, ...(fallback.ui as Record<string, unknown>) } };
}

const htmlCache = new Map<string, string>();
async function loadWidgetHtml(dir: string, name: WidgetName) {
  const key = `${dir}:${name}`;
  const cached = htmlCache.get(key);
  if (cached) return cached;
  let html: string;
  try { html = await fs.readFile(path.join(dir, `${name}.html`), "utf8"); }
  catch { throw new Error(`小组件 ${name} 未构建，请运行 pnpm build:widgets`); }
  htmlCache.set(key, html);
  return html;
}

export function registerWidgetResources(server: McpServer, dir = path.join(process.cwd(), "widgets", "dist")) {
  for (const [name, meta] of Object.entries(WIDGETS) as [WidgetName, typeof WIDGETS[WidgetName]][]) {
    server.registerResource(`widget-${name}`, meta.uri,
      { title: meta.title, description: `知棱工具结果的「${meta.title}」卡片`, mimeType: WIDGET_MIME, _meta: { ui: RESOURCE_UI } },
      async () => ({ contents: [{ uri: meta.uri, mimeType: WIDGET_MIME, text: await loadWidgetHtml(dir, name), _meta: { ui: RESOURCE_UI } }] }));
  }
}
