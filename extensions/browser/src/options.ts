import { APP_URL } from "./config";
import type { CaptureView } from "../../../lib/extension/contract";
const error = document.querySelector<HTMLElement>("#error")!;
const controls = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-action]"));
async function send(type: string, id?: string) {
  const response = await chrome.runtime.sendMessage({ type, id });
  if (response.error) throw new Error(response.error);
  return response.data;
}
async function refresh() {
  const data = await send("status") as { account: { name: string } | null; tasks: Array<{ id: string; url: string; view?: CaptureView }>; lastError: string | null };
  document.querySelector("#account")!.textContent = data.account?.name ?? "尚未连接知棱";
  document.querySelector<HTMLButtonElement>('[data-action="connect"]')!.textContent = data.account ? "更换账户" : "连接知棱";
  document.querySelector<HTMLButtonElement>('[data-action="disconnect"]')!.hidden = !data.account;
  error.textContent = data.lastError ?? "";
  const list = document.querySelector("#tasks")!; list.replaceChildren();
  if (!data.tasks.length) { const p = document.createElement("p"); p.textContent = "打开一段 ChatGPT 或 Claude 聊天，点击工具栏上的知棱图标。"; list.append(p); }
  for (const task of data.tasks.slice().reverse()) {
    const item = document.createElement("li"), heading = document.createElement("strong"), detail = document.createElement("p"), link = document.createElement("a");
    heading.textContent = (new URL(task.url).hostname === "claude.ai" ? "Claude" : "ChatGPT") + " · " + (task.view?.stage ?? "等待分析");
    const feedLabels = { pending: "等待更新", running: "生成中", ready: "已更新", error: "生成失败" };
    detail.textContent = task.view?.error ?? (task.view?.result ? "新增 " + task.view.result.newUserMessageCount + " 条用户消息 · " + task.view.result.topicCount + " 个兴趣话题" + (task.view.feedStatus ? " · Feed " + feedLabels[task.view.feedStatus] : "") : "可以继续聊天，进度会自动保存。");
    link.href = task.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "打开原聊天 ↗";
    item.append(heading, detail, link);
    if (task.view?.status === "error" || task.view?.feedStatus === "error") {
      const retry = document.createElement("button"); retry.textContent = "重试"; retry.className = "secondary";
      retry.onclick = () => { retry.disabled = true; void send("retry", task.id).then(refresh).catch(showError).finally(() => { retry.disabled = false; }); }; item.append(retry);
    }
    list.append(item);
  }
}
function showError(err: unknown) { error.textContent = err instanceof Error ? err.message : "连接暂时不可用，请重试。"; }
for (const button of controls) button.onclick = () => {
  controls.forEach((b) => { b.disabled = true; });
  void send(button.dataset.action!).then(refresh).catch(showError).finally(() => controls.forEach((b) => { b.disabled = false; }));
};
for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-path]")) link.href = APP_URL + link.dataset.path;
void refresh().catch(showError);
setInterval(() => { if (!document.hidden) void refresh().catch(showError); }, 5000);
