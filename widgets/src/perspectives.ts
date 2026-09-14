import type { PerspectivesOut } from "@/lib/mcp/views";
import { boot, createApp, el, pickData, renderError, renderStances, root, type StanceLike } from "./shared";

const app = createApp("perspectives");

function render(data: PerspectivesOut) {
  const container = root();
  container.replaceChildren(el("div", { class: "bar" }, [
    el("span", { class: "title" }, ["多元视角"]), el("span", { class: "chip pro soft" }, [data.topic]), el("span", { class: "spacer" }),
    data.userStance ? el("span", { class: "sub" }, [`你的倾向：${data.userStance}`]) : null,
  ]));
  container.append(el("h3", { class: "question" }, [data.question]));
  if (!data.isControversial) { container.append(el("p", { class: "empty" }, ["这个话题争议不大，没有明显对立的观点。"])); return; }
  const stances: StanceLike[] = [
    { side: "pro", label: data.sides.pro.label, items: data.sides.pro.items },
    { side: "con", label: data.sides.con.label, items: data.sides.con.items },
    { side: "neutral", label: "中立", items: data.sides.neutral },
  ];
  // 用户已有倾向时，把另一面放大展示；分不清就三栏平铺
  const counterSide = data.userStance === data.sides.pro.label ? "con" : data.userStance === data.sides.con.label ? "pro" : null;
  container.append(el("section", { class: "card prism" }, [renderStances(app, stances, { counterSide, analysis: data.analysis, analysisModel: data.analysisModel })]));
}

boot(app, (params) => {
  if (params.isError) return renderError(params);
  const data = pickData<PerspectivesOut>(params);
  if (!data) return renderError(params);
  render(data);
}, "正在整理不同立场的观点…");
