import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
const https = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:dns/promises", () => dns);
vi.mock("node:https", () => https);
import { fetchPublicJson, isPublicIp, NetError } from "@/lib/security/net";

type Reply = { status?: number; type?: string; body?: string | Buffer; cacheControl?: string };
function respondWith(reply: Reply) {
  const calls: { options: Record<string, unknown> }[] = [];
  https.request.mockImplementation((_url: URL, options: Record<string, unknown>, onResponse: (res: EventEmitter & Record<string, unknown>) => void) => {
    calls.push({ options });
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
      res.statusCode = reply.status ?? 200;
      res.headers = { "content-type": reply.type ?? "application/json", "cache-control": reply.cacheControl ?? "max-age=300" };
      res.resume = () => undefined; res.destroy = () => undefined;
      onResponse(res);
      const body = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body ?? "{}");
      setImmediate(() => { for (let i = 0; i < body.length; i += 4096) res.emit("data", body.subarray(i, i + 4096)); res.emit("end"); });
    };
    return req;
  });
  return calls;
}
afterEach(() => { vi.clearAllMocks(); });

describe("isPublicIp", () => {
  it("classifies private, special and public ranges", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "172.16.5.5", "192.168.1.1", "0.0.0.0", "224.0.0.1", "198.18.0.1",
      "::1", "::", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "2001:db8::1", "2002:0a00::1", "ff02::1", "not-an-ip"]) expect(isPublicIp(ip), ip).toBe(false);
    for (const ip of ["1.1.1.1", "8.8.8.8", "203.0.112.1", "2606:4700::1111", "2600:1f18::1", "::ffff:1.1.1.1", "[2606:4700::1111]"]) expect(isPublicIp(ip), ip).toBe(true);
  });
});

describe("fetchPublicJson", () => {
  const url = new URL("https://claude.ai/oauth/mcp-oauth-client-metadata");
  it("pins the first public IPv4 answer even when AAAA comes first and serves both lookup callback shapes", async () => {
    dns.lookup.mockResolvedValue([{ address: "2606:4700::1111", family: 6 }, { address: "1.1.1.1", family: 4 }]);
    const calls = respondWith({ body: JSON.stringify({ client_id: url.href }) });
    const result = await fetchPublicJson(url);
    expect(result.json).toEqual({ client_id: url.href }); expect(result.cacheControl).toBe("max-age=300");
    const lookup = calls[0].options.lookup as (h: string, o: unknown, cb: (...args: unknown[]) => void) => void;
    const scalar = vi.fn(); lookup("claude.ai", {}, scalar); expect(scalar).toHaveBeenCalledWith(null, "1.1.1.1", 4);
    const all = vi.fn(); lookup("claude.ai", { all: true }, all); expect(all).toHaveBeenCalledWith(null, [{ address: "1.1.1.1", family: 4 }]);
    expect(calls[0].options.servername).toBe("claude.ai");
  });
  it("refuses non-https, private answers, redirects, non-JSON and oversized bodies", async () => {
    await expect(fetchPublicJson(new URL("http://claude.ai/x"))).rejects.toThrow(NetError);
    dns.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "地址不是公网地址" });
    dns.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    respondWith({ status: 302 }); await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "不允许重定向" });
    respondWith({ type: "text/html" }); await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "响应不是 JSON" });
    respondWith({ body: Buffer.alloc(9000, 0x20) }); await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "文档超过 8192 字节" });
    respondWith({ body: "{oops" }); await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "不是合法 JSON" });
    respondWith({ type: "application/problem+json", body: "{\"ok\":true}" }); expect((await fetchPublicJson(url)).json).toEqual({ ok: true });
    dns.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(fetchPublicJson(url)).rejects.toMatchObject({ reason: "DNS 解析失败" });
  });
});
