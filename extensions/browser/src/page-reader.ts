export interface PageCapture {
  raw: Record<string, unknown>;
  url: string;
  visibleIds: string[];
  visibleUserTexts: string[];
}

/** Serialized by chrome.scripting: keep every dependency inside this function. */
export async function readCurrentPage(expectedUrl: string): Promise<PageCapture> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pathname = new URL(expectedUrl).pathname;
  const checkPage = () => {
    if (location.origin !== new URL(expectedUrl).origin || location.pathname !== pathname) throw new Error("聊天页面已切换，请在目标聊天中重新点击插件。");
    const stops = document.querySelectorAll('[data-testid="stop-button"], [data-testid="stop-response-button"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], [data-is-streaming="true"]');
    if (Array.from(stops).some((stop) => stop.getClientRects().length)) throw new Error("回复正在生成，请完成后再捕捉。");
  };
  checkPage();
  const getJson = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(path, { credentials: "include", headers, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) return { status: response.status, data: null };
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  };
  let raw: Record<string, unknown> | null = null;
  if (["chatgpt.com", "chat.openai.com"].includes(location.hostname)) {
    const id = pathname.match(/^\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})\/?$/i)?.[1];
    if (!id) throw new Error("请先打开一段已保存的 ChatGPT 聊天。");
    const session = await getJson("/api/auth/session");
    const token = session.data?.accessToken;
    if (typeof token !== "string") throw new Error("请先登录 ChatGPT，再重新捕捉。");
    const response = await getJson(`/backend-api/conversation/${id}`, { Authorization: `Bearer ${token}` });
    raw = response.data;
  } else if (location.hostname === "claude.ai") {
    const id = pathname.match(/^\/chat\/([0-9a-f-]{36})\/?$/i)?.[1];
    if (!id) throw new Error("请先打开一段已保存的 Claude 聊天。");
    const response = await getJson("/api/organizations");
    if (!Array.isArray(response.data)) throw new Error("请先登录 Claude，再重新捕捉。");
    const ids = response.data.map((o: { uuid?: unknown }) => o.uuid).filter((id): id is string => typeof id === "string" && uuid.test(id));
    // Read only the active-organization hint, never return cookies or session data.
    const activeOrg = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("lastActiveOrg="))?.slice(14);
    if (activeOrg && ids.includes(activeOrg)) ids.splice(0, 0, ...ids.splice(ids.indexOf(activeOrg), 1));
    for (const org of ids) {
      const candidate = await getJson(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages`);
      if (candidate.data) { raw = candidate.data; break; }
      if (![403, 404].includes(candidate.status)) break;
    }
  } else throw new Error("请在 ChatGPT 或 Claude 聊天页使用插件。");
  if (!raw) throw new Error("暂时无法读取完整聊天，请刷新页面后重试。");
  checkPage();
  const main = document.querySelector("main") ?? document;
  const visibleIds = Array.from(main.querySelectorAll("[data-message-id], [data-message-uuid]"))
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.getAttribute("data-message-id") ?? el.getAttribute("data-message-uuid") ?? "").filter((id) => uuid.test(id));
  const visibleUserTexts = Array.from(main.querySelectorAll('[data-message-author-role="user"], [data-testid="user-message"], .font-user-message'))
    .filter((el) => el.getClientRects().length > 0).map((el) => (el.textContent ?? "").trim()).filter(Boolean);
  return { raw, url: `${location.origin}${location.pathname}`, visibleIds, visibleUserTexts };
}
