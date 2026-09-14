import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as llms } from "@/app/llms.txt/route";
import { GET as serverCard } from "@/app/.well-known/mcp/server-card.json/route";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/[[...slug]]/route";
import { GET as authorizationServer } from "@/app/.well-known/oauth-authorization-server/route";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { TOOL_NAMES, buildInstructions } from "@/lib/mcp/instructions";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/tools";

const origin = "https://zhi.example.test";
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_PUBLIC_MODE", "false"); });
afterEach(() => vi.unstubAllEnvs());

describe("agent discovery files", () => {
  it("serves llms.txt from the same source as the MCP instructions", async () => {
    const response = llms();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const text = await response.text();
    for (const name of TOOL_NAMES) { expect(text).toContain(name); expect(SERVER_INSTRUCTIONS).toContain(name); }
    expect(text).toContain(`${origin}/api/mcp`);
    expect(text).toContain(`${origin}/.well-known/mcp/server-card.json`);
    expect(buildInstructions()).toContain(`${origin}/connect`);
  });

  it("keeps the instructions short and steers the client toward current-conversation ingest, opt-in auto ingest and in-chat perspectives", () => {
    const text = buildInstructions();
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toContain("把当前对话整理成");
    expect(text).toContain("autoIngest: true");
    expect(text).toContain("get_perspectives");
    expect(text).toContain("明确标注这是不同立场");
    expect(text).toContain("自动采集默认关闭");
    expect(text).toContain("source: recent_chats");
  });

  it("publishes a server card whose auth URLs resolve through the existing well-known handlers", async () => {
    const response = serverCard();
    expect(response.headers.get("content-type")).toBe("application/mcp-server-card+json; charset=utf-8");
    const card = await response.json();
    expect(card.protocolVersion).toBe("2025-11-25");
    expect(card.transports).toEqual([{ type: "streamable-http", endpoint: `${origin}/api/mcp` }]);
    expect(card.serverInfo).toMatchObject({ name: "zhiprism", title: "知棱 ZhiPrism" });
    const resourceUrl = new URL(card.authentication.protectedResourceMetadata);
    const slug = resourceUrl.pathname.replace("/.well-known/oauth-protected-resource/", "").split("/");
    expect(await (await protectedResource(new Request(origin), { params: Promise.resolve({ slug }) })).json()).toMatchObject({ resource: `${origin}/api/mcp` });
    expect(card.authentication.authorizationServerMetadata).toBe(`${origin}/.well-known/oauth-authorization-server`);
    expect(await authorizationServer().json()).toMatchObject({ issuer: origin });
  });

  it("emits robots and sitemap that expose the connector and hide private pages", () => {
    const rules = robots();
    const star = (rules.rules as { userAgent: string; allow: string[]; disallow: string[] }[]).find((rule) => rule.userAgent === "*")!;
    expect(star.allow).toContain("/api/mcp"); expect(star.allow).toContain("/llms.txt");
    expect(star.disallow).toContain("/feed"); expect(star.disallow).toContain("/connect/authorize");
    expect(rules.sitemap).toBe(`${origin}/sitemap.xml`);
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(expect.arrayContaining([`${origin}/`, `${origin}/connect`]));
    for (const privatePath of ["/feed", "/profile", "/topics", "/reflections"]) {
      expect(star.disallow).toContain(privatePath);
      expect(urls).not.toContain(`${origin}${privatePath}`);
    }
  });

  it("refuses to publish MCP discovery for an invalid public origin but keeps robots alive", async () => {
    vi.stubEnv("APP_PUBLIC_MODE", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://insecure.example.test");
    expect(llms().status).toBe(503);
    expect(serverCard().status).toBe(503);
    expect(robots().host).toBe("http://insecure.example.test");
  });
});
