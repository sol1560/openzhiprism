import { api, connect, connection, disconnect } from "./auth";
import { APP_URL } from "./config";
import { readCurrentPage } from "./page-reader";
import { normalizeCapture } from "./normalize";
import { showToast } from "./toast";
import { sourceIdentity, type CaptureView } from "../../../lib/extension/contract";

interface Task { id: string; tabId: number; url: string; accountId: string; view?: CaptureView }
let storageQueue: Promise<unknown> = Promise.resolve();
function updateTasks(fn: (tasks: Task[]) => Task[]) {
  const next = storageQueue.catch(() => undefined).then(async () => {
    const tasks = ((await chrome.storage.local.get("tasks")).tasks ?? []) as Task[];
    const updated = fn(tasks);
    const active = (t: Task) => !t.view || ["queued", "running"].includes(t.view.status) || ["pending", "running"].includes(t.view.feedStatus ?? "");
    await chrome.storage.local.set({ tasks: [...updated.filter((t) => !active(t)).slice(-20), ...updated.filter(active)] });
  });
  storageQueue = next; return next;
}
const initialized = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const capturing = new Set<number>();
let authBusy = false;
async function notify(tabId: number, url: string, title: string, detail: string, error = false) {
  await chrome.action.setBadgeText({ tabId, text: error ? "!" : title === "无新增" ? "=" : ["已更新", "已导入"].includes(title) ? "✓" : "…" }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: error ? "#ae4b35" : "#2878d0" }).catch(() => undefined);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || sourceIdentity(tab.url)?.sourceUrl !== sourceIdentity(url)?.sourceUrl) return;
  await chrome.scripting.executeScript({ target: { tabId }, func: showToast, args: [title, detail, APP_URL, error] }).catch(() => undefined);
}
function describe(view: CaptureView): [string, string, boolean] {
  if (view.status === "error") return ["分析失败", (view.error ?? "请重试。") + " 可在插件设置中重试。", true];
  if (view.status !== "ready") return ["分析中", view.stage + "。可以继续聊天，完成后会更新提示。", false];
  if (view.result?.duplicate) return ["无新增", "这段聊天已经导入，画像没有重复计分。", false];
  const feed = view.feedStatus === "ready" ? "Feed 已更新。" : view.feedStatus === "error" ? "Feed 生成失败，可在设置中重试。" : view.feedStatus ? "Feed 正在更新。" : "";
  return [view.result?.profileUpdated ? "已更新" : "已导入", "新增 " + (view.result?.newUserMessageCount ?? 0) + " 条用户消息。" + (view.result?.profileUpdated ? "兴趣画像已更新。" : "没有发现新增兴趣。") + feed, false];
}
let polling: Promise<void> | undefined;
async function poll() {
  if (polling) return polling;
  polling = (async () => {
    await initialized;
    if (!await connection()) { await chrome.alarms.clear("capture-status"); return; }
    const tasks = ((await chrome.storage.local.get("tasks")).tasks ?? []) as Task[];
    for (const task of tasks) {
      if (task.view?.status === "error" || (task.view?.status === "ready" && !["pending", "running"].includes(task.view.feedStatus ?? ""))) continue;
      try {
        const auth = await connection(); if (auth?.account.id !== task.accountId) continue;
        const view = await api<CaptureView>("/captures/" + encodeURIComponent(task.id));
        const updated = { ...task, view };
        await updateTasks((all) => all.map((t) => t.id === task.id ? updated : t));
        await chrome.storage.local.set({ lastResult: updated });
        await notify(task.tabId, task.url, ...describe(view));
      } catch {
        await notify(task.tabId, task.url, "等待连接", "暂时无法获取进度。已提交的任务会保留，可在插件设置中查看。", true);
      }
    }
    const remaining = ((await chrome.storage.local.get("tasks")).tasks ?? []) as Task[];
    if (!remaining.some((t) => !t.view || ["queued", "running"].includes(t.view.status) || ["pending", "running"].includes(t.view.feedStatus ?? ""))) await chrome.alarms.clear("capture-status");
  })();
  try { await polling; } finally { polling = undefined; }
}
async function startPolling() {
  await chrome.alarms.create("capture-status", { periodInMinutes: 0.5 });
  void poll();
  // Alarms take over if the worker is suspended.
  for (const delay of [2000, 5000, 10_000, 20_000]) setTimeout(() => void poll(), delay);
}
export async function captureTab(tab: chrome.tabs.Tab) {
  await initialized;
  if (tab.id === undefined) return;
  const tabId = tab.id, identity = sourceIdentity(tab.url ?? "");
  if (!identity) {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setTitle({ tabId, title: "请在 ChatGPT 或 Claude 的已保存聊天页点击插件" });
    await chrome.runtime.openOptionsPage(); return;
  }
  if (capturing.has(tabId) || authBusy) return;
  capturing.add(tabId);
  try {
    if (!await connection()) {
      authBusy = true;
      await notify(tabId, identity.sourceUrl, "连接知棱", "首次使用需要登录并授权，之后点击图标即可导入。");
      try { await connect(); } finally { authBusy = false; }
    }
    const account = (await connection())!.account;
    await notify(tabId, identity.sourceUrl, "捕捉中", "正在读取当前完整聊天，仅包含文字、代码、链接和附件名称。");
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readCurrentPage, args: [identity.sourceUrl] });
    const page = results[0]?.result;
    if (!page) throw new Error("无法读取聊天，请刷新页面后重试。");
    const payload = normalizeCapture(page);
    if ((await connection())?.account.id !== account.id) throw new Error("连接账户已更换，请重新捕捉。");
    const result = await api<{ id: string; alreadyImported: boolean; capture: CaptureView }>("/captures", { method: "POST", body: JSON.stringify(payload) });
    const task: Task = { id: result.id, tabId, url: identity.sourceUrl, accountId: account.id, view: result.capture };
    await updateTasks((all) => [...all.filter((t) => t.id !== task.id), task]);
    await chrome.storage.local.set({ lastResult: task });
    if (result.alreadyImported) await notify(tabId, identity.sourceUrl, "无新增", "这段聊天已经导入，画像没有重复计分。");
    else await notify(tabId, identity.sourceUrl, ...describe(result.capture));
    await startPolling();
  } catch (error) {
    const message = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "捕捉没有完成，请刷新聊天页后重试。";
    await chrome.storage.local.set({ lastError: message });
    await notify(tabId, identity.sourceUrl, "捕捉失败", message, true);
  } finally { capturing.delete(tabId); }
}
chrome.action.onClicked.addListener((tab) => { void captureTab(tab); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "capture-status") void poll(); });
chrome.runtime.onInstalled.addListener(({ reason }) => { void initialized; if (reason === "install") void chrome.runtime.openOptionsPage(); });
chrome.runtime.onStartup.addListener(() => { void startPolling(); });
chrome.runtime.onMessage.addListener((message: { type?: string; id?: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("options.html")) return;
  const run = async () => {
    await initialized;
    if (message.type === "status") {
      await poll();
      const auth = await connection(), saved = await chrome.storage.local.get(["tasks", "lastError"]);
      return { account: auth?.account ?? null, tasks: saved.tasks ?? [], lastError: saved.lastError ?? null };
    }
    if (authBusy || capturing.size) throw new Error("操作正在进行，请稍后重试。");
    authBusy = true;
    try {
      if (message.type === "connect") { if (await connection()) await disconnect(); await connect(); }
      else if (message.type === "disconnect") await disconnect();
      else if (message.type === "retry" && message.id) {
        const view = await api<CaptureView>("/captures/" + encodeURIComponent(message.id) + "/retry", { method: "POST" });
        await updateTasks((tasks) => tasks.map((t) => t.id === message.id ? { ...t, view } : t));
        await startPolling();
      } else throw new Error("不支持的操作。");
      await chrome.storage.local.remove("lastError");
      return { ok: true };
    } finally { authBusy = false; }
  };
  void run().then((data) => sendResponse({ data }), (error: unknown) => sendResponse({ error: error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "操作失败，请稍后重试。" }));
  return true;
});
