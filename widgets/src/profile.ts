import type { ProfileOut } from "@/lib/mcp/views";
import { boot, createApp, el, pickData, renderError, root } from "./shared";

const app = createApp("profile");

function render(data: ProfileOut) {
  const container = root();
  container.replaceChildren(el("div", { class: "bar" }, [el("span", { class: "title" }, ["兴趣画像"]), el("span", { class: "spacer" }), el("span", { class: "sub" }, [`${data.topics.length} 个话题`])]));
  if (!data.topics.length) { container.append(el("p", { class: "empty" }, ["还没有兴趣画像。把一段对话交给知棱，就会出现在这里。"])); return; }
  const list = el("div", { class: "stack tight" });
  for (const topic of data.topics) {
    const stance = topic.stance && topic.stance !== "neutral" ? topic.stanceLabel ?? "有明显倾向" : null;
    list.append(el("div", { class: "topic-item" }, [
      el("div", { class: "row" }, [
        el("span", { class: "sub" }, [topic.source === "zhihu_follow" ? "知乎关注" : "对话"]),
        el("strong", { class: "truncate" }, [topic.name]),
        topic.controversial ? el("span", { class: "chip pro soft" }, ["争议话题"]) : null,
        stance ? el("span", { class: "chip con soft" }, [`⚖ ${stance}`]) : null,
        el("span", { class: "spacer" }),
        el("span", { class: "weight" }, [String(Math.round(topic.weight * 100))]),
      ]),
      el("div", { class: "bar-track" }, [el("span", { class: "bar-fill pro", style: `width:${Math.max(4, topic.weight * 100)}%` })]),
      topic.keywords.length ? el("div", { class: "chips" }, topic.keywords.slice(0, 6).map((keyword) => el("span", { class: "chip" }, [keyword]))) : null,
      topic.questions[0] ? el("p", { class: "sub quote" }, [`“${topic.questions[0]}”`]) : null,
    ]));
  }
  container.append(list);
}

boot(app, (params) => {
  if (params.isError) return renderError(params);
  const data = pickData<ProfileOut>(params);
  if (!data) return renderError(params);
  render(data);
}, "正在读取兴趣画像…");
