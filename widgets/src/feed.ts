import type { DossierView } from "@/lib/cognition/types";
import type { FeedOut, FeedCardOut } from "@/lib/mcp/views";
import { boot, createApp, el, link, num, pickData, renderError, renderStances, root } from "./shared";

const app = createApp("feed");
let current: FeedOut | null = null;

function evidenceEntry(topic: string) {
  const area = el("div", { class: "stack tight" });
  const button = el("button", { class: "btn", type: "button" }, ["看分歧与依据"]);
  area.append(button);
  button.addEventListener("click", async () => {
    button.disabled = true; button.textContent = "正在获取依据…";
    try {
      const result = await app.callServerTool({ name: "get_topic_dossier", arguments: { topic } });
      if (result.isError) throw new Error("未能读取");
      const value = pickData<{ data: DossierView; links: Record<string, string> }>(result);
      if (!value?.links.topic) throw new Error("未返回话题入口");
      area.replaceChildren(el("p", { class: "sub" }, [value.data.dossier?.summary.text ?? "已开始整理材料，可在网页查看进度并继续同一话题。"]), link(app, value.links.topic, ["展开依据与继续思辨 ↗"], "btn"));
    } catch { button.disabled = false; button.textContent = "暂未读到，重新获取依据"; }
  });
  return area;
}

function contentCard(card: Extract<FeedCardOut, { kind: "main" | "light" }>) {
  const seenMark = el("span", { class: "seen" }, ["已打开"]);
  const markButton = el("button", { class: "btn", type: "button" }, ["标记已打开"]);
  markButton.addEventListener("click", async () => {
    markButton.setAttribute("disabled", ""); markButton.textContent = "标记中…";
    try {
      const result = await app.callServerTool({ name: "mark_seen", arguments: { contentIds: [card.contentId] } });
      if (result.isError) throw new Error("宿主未允许");
      card.seen = true; render(current!);
    } catch { markButton.removeAttribute("disabled"); markButton.textContent = "标记失败，重试"; }
  });
  return el("article", { class: `card ${card.seen ? "is-seen" : ""}` }, [
    el("div", { class: "meta" }, [
      el("span", { class: `topic ${card.kind === "light" ? "warm" : ""}` }, [card.kind === "light" ? "☕ 换换脑子" : card.topic ?? "推荐"]),
      card.seen ? seenMark : null,
    ]),
    el("h3", {}, [link(app, card.url, [card.title])]),
    el("p", { class: "summary" }, [card.summary]),
    el("div", { class: "byline" }, [
      card.author ? el("span", {}, [card.author]) : null,
      card.voteUp > 0 ? el("span", {}, [`赞 ${num(card.voteUp)}`]) : null,
      el("span", { class: "spacer" }),
      card.seen ? null : markButton,
      link(app, card.url, ["去知乎阅读 ↗"], "open"),
    ]),
    el("details", { class: "reason" }, [el("summary", {}, ["为什么推荐给你"]), el("p", {}, [card.reason])]),
    current?.cognitionEnabled ? evidenceEntry(card.topic ?? card.title) : null,
  ]);
}

function perspectiveCard(card: Extract<FeedCardOut, { kind: "perspective" }>) {
  return el("section", { class: "card prism" }, [
    el("div", { class: "meta" }, [el("span", { class: "prism-title" }, ["换个角度看"]), el("span", { class: "chip pro soft" }, [card.topic]), el("span", { class: "spacer" }), el("span", { class: "sub" }, ["为你补充的不同观点"])]),
    el("h3", {}, [card.question]),
    el("p", { class: "sub" }, ["观点概览 · 阅读记录不代表你赞同这些说法。依据可在对话中要求知棱展开核对。"]),
    renderStances(app, card.stances, { counterSide: card.counterSide, analysis: card.analysis, analysisModel: card.analysisModel }),
    current?.cognitionEnabled ? evidenceEntry(card.question) : null,
  ]);
}

function render(data: FeedOut) {
  current = data;
  const container = root();
  container.replaceChildren();
  container.append(el("div", { class: "bar" }, [
    el("span", { class: "title" }, [`今日 Feed · ${data.date}`]),
    el("span", { class: "spacer" }),
    data.run ? el("span", { class: "sub" }, [`来源 ${data.run.sourceUsed} · 摘要 ${data.run.llmUsed}`]) : null,
  ]));
  if (!data.cards.length) { container.append(el("p", { class: "empty" }, [data.hint ?? "今天还没有内容。"])); return; }
  const list = el("div", { class: "stack" });
  for (const card of data.cards) list.append(card.kind === "perspective" ? perspectiveCard(card) : contentCard(card));
  container.append(list);
}

boot(app, (params) => {
  if (params.isError) return renderError(params);
  const data = pickData<FeedOut>(params);
  if (!data) return renderError(params);
  render(data);
}, "正在为你生成今日 Feed（首次约 20-40 秒）…");
