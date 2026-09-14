import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerZhiprismTools } from "@/lib/mcp/tools";
import { TOOL_NAMES } from "@/lib/mcp/instructions";
import { WIDGETS, WIDGET_MIME, ensureUiMeta, registerWidgetResources, uiMeta } from "@/lib/mcp/widgets";
import { feedOut, feedView, perspectivesOut, perspectivesView, profileOut, topicView } from "@/lib/mcp/views";
import type { FeedView } from "@/lib/feed/types";
import type { InterestTopic } from "@/db/schema";

type ToolConfig = { _meta?: Record<string, unknown>; outputSchema?: unknown };
type ResourceConfig = { mimeType: string; _meta?: { ui?: unknown } };
type ReadResult = { contents: { uri: string; mimeType: string; text: string; _meta?: { ui?: unknown } }[] };

function capture() {
  const tools = new Map<string, ToolConfig>();
  const resources = new Map<string, { config: ResourceConfig; read: () => Promise<ReadResult> }>();
  const server = {
    registerTool: (name: string, config: ToolConfig) => { tools.set(name, config); },
    registerResource: (_name: string, uri: string, config: ResourceConfig, read: () => Promise<ReadResult>) => { resources.set(uri, { config, read }); },
  } as unknown as McpServer;
  return { server, tools, resources };
}

const names = Object.keys(WIDGETS).sort();
const srcDir = path.resolve("widgets/src"), distDir = path.resolve("widgets/dist");

describe("MCP Apps widgets", () => {
  it("keeps WIDGETS, widgets/src and widgets/dist in sync and dist not stale", async () => {
    expect(readdirSync(srcDir).filter((file) => file.endsWith(".ts") && file !== "shared.ts").map((file) => file.replace(/\.ts$/, "")).sort()).toEqual(names);
    expect(readdirSync(distDir).filter((file) => file.endsWith(".html")).map((file) => file.replace(/\.html$/, "")).sort()).toEqual(names);
    process.env.WIDGETS_NO_BUILD = "1";
    const { sourceHash } = await import("../scripts/build-widgets.mjs") as { sourceHash: (name: string) => string };
    for (const name of names) {
      const html = readFileSync(path.join(distDir, `${name}.html`), "utf8");
      expect(html.match(/name="zhiprism-widget-src" content="([0-9a-f]+)"/)?.[1], `${name} dist 已过期，请运行 pnpm build:widgets`).toBe(sourceHash(name));
      expect(html.startsWith("<!DOCTYPE html>")).toBe(true); expect(html).toContain('lang="zh-CN"'); expect(html).toContain('<div id="root">');
      expect(html).not.toMatch(/<script[^>]+src=/); expect(html).not.toMatch(/<link[^>]+href=/);
    }
  });

  it("gives every tool a ui resource and keeps mark_seen callable from the feed card", () => {
    const { server, tools } = capture();
    registerZhiprismTools(server, () => "u1");
    expect([...tools.keys()].sort()).toEqual([...TOOL_NAMES].sort());
    const uriOf = (name: string) => (tools.get(name)?._meta?.ui as { resourceUri: string; visibility?: string[] });
    for (const name of TOOL_NAMES) {
      const meta = tools.get(name)!._meta!;
      expect(uriOf(name).resourceUri).toMatch(/^ui:\/\/zhiprism\/[a-z]+\.html$/);
      expect(meta["ui/resourceUri"]).toBe(uriOf(name).resourceUri);
    }
    expect(uriOf("get_daily_feed").resourceUri).toBe(WIDGETS.feed.uri);
    expect(uriOf("get_interest_profile").resourceUri).toBe(WIDGETS.profile.uri);
    expect(uriOf("get_perspectives").resourceUri).toBe(WIDGETS.perspectives.uri);
    expect(uriOf("mark_seen")).toEqual({ resourceUri: WIDGETS.result.uri });
    expect(uriOf("get_connection_status").visibility).toBeUndefined();
    expect(uriOf("ingest_conversation").visibility).toEqual(["model"]); expect(uriOf("get_status").visibility).toEqual(["model"]);
    for (const name of ["get_daily_feed", "get_interest_profile", "get_perspectives", "mark_seen"]) expect(tools.get(name)?.outputSchema).toBeTruthy();
    expect(ensureUiMeta(undefined)).toEqual(uiMeta("result", { modelOnly: true }));
    expect(ensureUiMeta({ ui: { resourceUri: WIDGETS.feed.uri, visibility: ["app"] }, extra: 1 })).toEqual({ ui: { resourceUri: WIDGETS.feed.uri, visibility: ["app"] }, "ui/resourceUri": WIDGETS.feed.uri, extra: 1 });
  });

  it("registers the four ui:// resources with a font-only CSP", async () => {
    const { server, resources } = capture();
    registerWidgetResources(server);
    expect([...resources.keys()].sort()).toEqual(names.map((name) => WIDGETS[name as keyof typeof WIDGETS].uri).sort());
    const csp = { prefersBorder: false, csp: { resourceDomains: ["https://assets.claude.ai"] } };
    for (const [uri, entry] of resources) {
      expect(entry.config.mimeType).toBe(WIDGET_MIME); expect(entry.config._meta?.ui).toEqual(csp);
      const read = await entry.read();
      expect(read.contents[0]).toMatchObject({ uri, mimeType: WIDGET_MIME, _meta: { ui: csp } });
      expect(read.contents[0].text.length).toBeGreaterThan(10_000);
    }
    const { server: broken, resources: missing } = capture();
    registerWidgetResources(broken, path.resolve("widgets/nope"));
    await expect(missing.get(WIDGETS.feed.uri)!.read()).rejects.toThrow("pnpm build:widgets");
  });

  it("produces structuredContent that satisfies the declared output schemas", () => {
    const now = new Date("2026-09-12T00:00:00Z");
    const topic: InterestTopic = { id: "t1", userId: "u1", name: "考研还是工作", weight: 0.8, rawScore: 3, hits: 2, keywords: ["考研", "就业"], questions: ["值得吗"],
      evidence: [], searchQueries: [], controversial: true, stance: "pro", stanceLabel: "偏向考研", source: "conversation", lastSeenAt: now, createdAt: now };
    expect(profileOut.parse({ userId: "u1", topics: [topicView(topic)] }).topics[0].lastSeenAt).toBe(now.toISOString());
    const item = { id: "a1", title: "回答", url: "https://www.zhihu.com/answer/1", oneLine: "一句话", excerpt: "", voteUp: 12, provider: "fixture", authorName: "某人" };
    const feed: FeedView = { userId: "u1", date: "2026-09-12", run: { sourceUsed: "fixture", llmUsed: "mock", stats: { n: 1 }, createdAt: now.toISOString() }, cards: [
      { id: "c1", kind: "main", position: 0, topicName: "考研", reason: "你聊过", seen: false, perspective: null,
        content: { id: "answer:1", type: "answer", title: "标题", summary: "摘要", excerpt: "", url: item.url, voteUp: 3, commentCount: 0, provider: "fixture", authorName: "作者" } },
      { id: "c2", kind: "light", position: 1, topicName: null, reason: "热榜", seen: true, perspective: null, content: null },
      { id: "c3", kind: "perspective", position: 2, topicName: "考研", reason: "换个角度", seen: false, content: null, perspective: {
        topicKey: "kaoyan", topicName: "考研还是工作", question: "该考研吗？", userSide: "pro", userSideLabel: "考研", exposureRatio: 0.7, counterSide: "con",
        stances: [{ side: "pro", label: "考研", items: [item] }, { side: "con", label: "工作", items: [item] }, { side: "neutral", label: "中立", items: [] }],
        analysis: "## 分析\n**看情况**", analysisModel: "rules", reason: "你只看到了一面" } },
    ] };
    const view = feedOut.parse(feedView(feed));
    expect(view.cards.map((card) => card.kind)).toEqual(["main", "perspective"]); // 无内容的卡片被过滤
    expect(view.run).toMatchObject({ sourceUsed: "fixture", stats: { n: 1 } });
    expect(feedOut.parse({ date: "2026-09-12", cards: [], run: null, hint: "空" }).hint).toBe("空");
    const analysis = { topicKey: "k", topicName: "考研还是工作", isControversial: true, question: "该考研吗？", proLabel: "考研", conLabel: "工作",
      items: [{ ...item, side: "pro" as const }, { ...item, side: "neutral" as const }], analysis: null, analysisModel: null };
    const perspectives = perspectivesOut.parse(perspectivesView(analysis, "偏向考研"));
    expect(perspectives.sides.pro.items).toHaveLength(1); expect(perspectives.sides.neutral).toHaveLength(1); expect(perspectives.sides.con.items).toHaveLength(0);
    expect(perspectivesOut.parse(perspectivesView({ ...analysis, isControversial: false, proLabel: "", conLabel: "", items: [] }, null)).userStance).toBeNull();
  });
});
