import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

/** 卡片公共层：宿主桥接、主题同步、DOM 小工具与「立场」渲染。所有数据只来自 structuredContent，不发任何网络请求。 */

export interface ToolResultLike {
  content?: { type: string; text?: string }[] | null;
  structuredContent?: Record<string, unknown> | null;
  isError?: boolean;
}
export interface StanceLike { side: "pro" | "con" | "neutral" | string; label: string; items: ItemLike[] }
export interface ItemLike { title: string; oneLine: string; url: string; voteUp: number; author?: string }

export function createApp(name: string) {
  return new App({ name: `zhiprism-${name}`, version: "1.0.0" });
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string | null | undefined)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}
export function root() { return document.getElementById("root")!; }

export function pickData<T>(params: ToolResultLike): T | null {
  if (params.structuredContent && Object.keys(params.structuredContent).length) return params.structuredContent as T;
  const text = params.content?.find((block) => block.type === "text")?.text;
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}
export function errorText(params: ToolResultLike) {
  return params.content?.find((block) => block.type === "text")?.text ?? "工具调用失败。";
}

/** 链接一律交给宿主打开；宿主拒绝时退回让用户手动复制。 */
export function link(app: App, href: string, children: (Node | string)[], className = "") {
  const anchor = el("a", { href, class: className, target: "_blank", rel: "noreferrer noopener" }, children);
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    void app.openLink({ url: href }).then((result) => { if (result.isError) anchor.title = `宿主未允许打开，请手动复制：${href}`; }).catch(() => undefined);
  });
  return anchor;
}

export const num = (value: number) => value.toLocaleString("zh-CN");
export const stripMd = (text: string) => text.replace(/^#+\s*/gm, "").replace(/\*\*/g, "");
export const modelLabel = (model: string | null) => model?.startsWith("zhida") ? "知乎直答" : model === "rules" || !model ? "规则整理" : model;

export function syncHostContext(context: Partial<McpUiHostContext> | undefined) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.locale) document.documentElement.lang = context.locale;
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

/** 统一的生命周期：toolinput 时显示占位（Feed 首次生成要 20-40 秒），toolresult 渲染，主题变化实时跟随。 */
export function boot(app: App, render: (params: ToolResultLike) => void, loadingText = "正在生成…") {
  app.addEventListener("toolinput", () => { root().replaceChildren(el("p", { class: "empty" }, [loadingText])); });
  app.addEventListener("toolresult", (params) => {
    try { render(params as ToolResultLike); }
    catch (error) { root().replaceChildren(el("div", { class: "error-box" }, [error instanceof Error ? error.message : "渲染失败"])); }
  });
  app.addEventListener("hostcontextchanged", (changed) => syncHostContext(changed));
  void app.connect().then(() => syncHostContext(app.getHostContext()));
}

export function renderError(params: ToolResultLike) {
  root().replaceChildren(el("div", { class: "error-box" }, [errorText(params)]));
}

export function stanceChip(stance: StanceLike, variant: "solid" | "soft" = "soft") {
  return el("span", { class: `chip ${stance.side} ${variant}` }, [stance.label]);
}

export function itemLink(app: App, item: ItemLike, dense = false) {
  const meta = el("div", { class: "item-meta" }, [
    el("span", { class: "truncate" }, [item.title]),
    item.author ? el("span", {}, [`· ${item.author}`]) : null,
    item.voteUp > 0 ? el("span", { class: "votes" }, [`赞 ${num(item.voteUp)}`]) : null,
  ]);
  return link(app, item.url, [el("p", { class: "item-line" }, [item.oneLine]), meta], dense ? "item dense" : "item");
}

/** 「换个角度看」/多元视角共用：对立面放大在左，其余与中立分析在右。 */
export function renderStances(app: App, stances: StanceLike[], options: { counterSide?: string | null; analysis?: string | null; analysisModel?: string | null } = {}) {
  const counter = stances.find((stance) => stance.side === options.counterSide);
  const others = stances.filter((stance) => stance !== counter && stance.items.length);
  const main = counter ? el("div", { class: "col" }, [
    el("div", { class: "row" }, [stanceChip(counter, "solid"), el("span", { class: "sub" }, ["你很少看到的一方"])]),
    ...counter.items.map((item) => itemLink(app, item)),
  ]) : null;
  const side = el("div", { class: "col" }, [
    ...others.map((stance) => el("div", { class: "col" }, [stanceChip(stance), ...stance.items.map((item) => itemLink(app, item, true))])),
    options.analysis ? el("div", { class: "analysis" }, [
      el("div", { class: "row sub" }, [el("strong", {}, ["中立分析"]), el("span", {}, [`· ${modelLabel(options.analysisModel ?? null)}`])]),
      el("p", {}, [stripMd(options.analysis)]),
    ]) : null,
  ]);
  return el("div", { class: main ? "cols" : "cols single" }, [main, side]);
}
