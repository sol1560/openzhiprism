import { boot, createApp, el, errorText, pickData, root } from "./shared";

/** 通用结果视图：扁平对象按键值表展示，其余以 JSON 原样展示。给没有专属卡片的工具兜底。 */
const app = createApp("result");

function scalar(value: unknown) {
  return value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

boot(app, (params) => {
  const container = root();
  const title = app.getHostContext()?.toolInfo?.tool?.title ?? "知棱";
  container.replaceChildren(el("div", { class: "bar" }, [el("span", { class: "title" }, [title])]));
  if (params.isError) { container.append(el("div", { class: "error-box" }, [errorText(params)])); return; }
  const data = pickData<unknown>(params);
  if (data && typeof data === "object" && !Array.isArray(data) && Object.values(data).every((value) => value === null || typeof value !== "object")) {
    container.append(el("div", { class: "kv" }, Object.entries(data).flatMap(([key, value]) => [el("span", { class: "sub" }, [key]), el("span", {}, [scalar(value)])])));
    return;
  }
  container.append(el("pre", { class: "raw" }, [JSON.stringify(data ?? errorText(params), null, 2)]));
}, "正在处理…");
