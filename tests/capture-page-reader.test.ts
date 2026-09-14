import { afterEach, expect, it, vi } from "vitest";
import { readCurrentPage } from "@/extensions/browser/src/page-reader";
const id = "00000000-1111-2222-3333-444444444444";
function page(origin: string, pathname: string) {
  vi.stubGlobal("location", { origin, pathname, hostname: new URL(origin).hostname });
  vi.stubGlobal("document", { cookie: "", querySelectorAll: () => [], querySelector: () => null });
}
afterEach(() => vi.unstubAllGlobals());
it("selects the organization containing this conversation instead of assuming the first", async () => {
  page("https://claude.ai", "/chat/" + id);
  const first = "11111111-1111-1111-1111-111111111111", second = "22222222-2222-2222-2222-222222222222";
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/organizations") return Response.json([{ uuid: first }, { uuid: second }]);
    if (url.includes(first)) return new Response(null, { status: 404 });
    return Response.json({ uuid: id, name: "correct organization" });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await readCurrentPage("https://claude.ai/chat/" + id);
  expect(result.raw.name).toBe("correct organization");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.slice(1).every(([url]) => url.includes("/chat_conversations/" + id + "?"))).toBe(true);
});
it("keeps ChatGPT session credentials inside the page and returns only the conversation", async () => {
  page("https://chatgpt.com", "/c/" + id);
  const fetcher = vi.fn(async (url: string) => url === "/api/auth/session" ? Response.json({ accessToken: "platform-secret" }) : Response.json({ conversation_id: id, mapping: {} }));
  vi.stubGlobal("fetch", fetcher);
  const result = await readCurrentPage("https://chatgpt.com/c/" + id);
  expect(JSON.stringify(result)).not.toContain("platform-secret");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/session", "/backend-api/conversation/" + id]);
});
it("rejects streaming and navigation during the capture", async () => {
  page("https://chatgpt.com", "/c/" + id);
  vi.stubGlobal("document", { querySelectorAll: () => [{ getClientRects: () => [1] }] });
  await expect(readCurrentPage("https://chatgpt.com/c/" + id)).rejects.toThrow("正在生成");
  page("https://chatgpt.com", "/c/" + id);
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/auth/session") return Response.json({ accessToken: "secret" });
    location.pathname = "/c/another"; return Response.json({ mapping: {} });
  });
  await expect(readCurrentPage("https://chatgpt.com/c/" + id)).rejects.toThrow("已切换");
});
