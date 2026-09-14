import { afterEach, expect, it, vi } from "vitest";
import type { CaptureView } from "@/lib/extension/contract";
const origin = "http://localhost:3000", chatUrl = "https://chatgpt.com/c/00000000-1111-2222-3333-444444444444";
const raw = { title: "AI Agent", current_node: "a", mapping: {
  root: { parent: null, message: null },
  u: { parent: "root", message: { author: { role: "user" }, content: { parts: ["我想了解 AI Agent 创业机会。"] } } },
  a: { parent: "u", message: { author: { role: "assistant" }, content: { parts: ["可以研究应用场景。"] } } },
} };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
it("one toolbar action submits the current chat, stores no transcript and resumes polling after worker restart", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("__APP_URL__", origin);
  const saved: Record<string, unknown> = { connection: { clientId: "client", accessToken: "t".repeat(43), expiresAt: Date.now() + 3600_000,
    account: { id: "alice", name: "Alice" } } };
  const event = () => ({ addListener: vi.fn() });
  const chromeMock = {
    storage: { local: {
      get: async (keys: string | string[]) => Object.fromEntries((typeof keys === "string" ? [keys] : keys).map((k) => [k, structuredClone(saved[k])])),
      set: async (data: Record<string, unknown>) => { Object.assign(saved, structuredClone(data)); },
      remove: async (keys: string | string[]) => { for (const k of typeof keys === "string" ? [keys] : keys) delete saved[k]; },
      setAccessLevel: vi.fn(async () => undefined),
    } },
    tabs: { get: async () => ({ id: 7, url: chatUrl }) },
    scripting: { executeScript: vi.fn(async (options: { func: { name: string } }) => options.func.name === "readCurrentPage"
      ? [{ result: { raw, url: chatUrl, visibleIds: ["u", "a"], visibleUserTexts: [] } }] : []) },
    action: { onClicked: event(), setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    runtime: { id: "test-extension", getURL: (p: string) => "chrome-extension://test-extension/" + p,
      openOptionsPage: vi.fn(), onMessage: event(), onInstalled: event(), onStartup: event() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), onAlarm: event() },
  };
  vi.stubGlobal("chrome", chromeMock);
  let view: CaptureView = { id: "job-1", status: "queued", stage: "等待分析", error: null, result: null, feedStatus: null };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ id: "job-1", alreadyImported: false, capture: view }, { status: 202 });
    return Response.json(view);
  });
  vi.stubGlobal("fetch", fetcher);
  const background = await import("@/extensions/browser/src/background");
  expect(chromeMock.action.onClicked.addListener).toHaveBeenCalledTimes(1);
  await background.captureTab({ id: 7, url: chatUrl } as chrome.tabs.Tab);
  await vi.advanceTimersByTimeAsync(1);
  const submits = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(submits).toHaveLength(1);
  expect(submits[0][0]).toBe(origin + "/api/extension/captures");
  expect(JSON.parse(String(submits[0][1]?.body)).messages).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toContain("创业机会");
  expect(JSON.stringify(saved)).not.toContain("可以研究");
  expect(chromeMock.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  vi.clearAllTimers(); vi.resetModules();
  view = { ...view, status: "ready", stage: "已导入", result: { newMessageCount: 2, newUserMessageCount: 1, topicCount: 1, newTopicNames: ["AI Agent"],
    redactedCount: 0, duplicate: false, profileUpdated: true, llm: null }, feedStatus: "ready" };
  await import("@/extensions/browser/src/background");
  const alarm = chromeMock.alarms.onAlarm.addListener.mock.calls.at(-1)![0] as (value: { name: string }) => void;
  alarm({ name: "capture-status" }); await vi.advanceTimersByTimeAsync(1);
  const tasks = saved.tasks as Array<{ view: CaptureView }>;
  expect(tasks[0].view.status).toBe("ready");
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(chromeMock.alarms.clear).toHaveBeenCalledWith("capture-status");
});
