import { describe, expect, it } from "vitest";
import type { FeedView } from "@/lib/feed/types";
import { DYNAMIC_VARIABLE_PLACEHOLDERS, FIRST_MESSAGE, PERSONA_PROMPT, buildAgentBody, buildToolBody } from "@/lib/voice/agent-config";
import { buildDynamicVariables, dateLabel } from "@/lib/voice/dynamic";
import { VOICE_TOOL_DEFINITIONS, createVoiceTools } from "@/lib/voice/tools";

const emptyFeed: FeedView = { userId: "u", date: "2026-09-14", cards: [], run: null };
const feed: FeedView = {
  ...emptyFeed,
  cards: [
    { id: "a", kind: "main", position: 1, topicName: "t", reason: "", seen: false, perspective: null, content: { id: "answer:a", type: "answer", title: "标题一", summary: "", excerpt: "", url: "", voteUp: 1, commentCount: 0, provider: "fixture" } },
    { id: "p", kind: "perspective", position: 2, topicName: "t", reason: "", seen: false, content: null, perspective: { topicKey: "k", topicName: "t", question: "q", userSide: null, userSideLabel: null, exposureRatio: 0, counterSide: "con", stances: [], analysis: null, analysisModel: null, reason: "" } },
  ],
};
const brief = { date: "2026-09-14", headline: "h", summary: "s", spokenScript: "这是简报口播。", highlights: [], continuity: [], generatedAt: "", model: "rules" };
const user = { displayName: "Sol" };

describe("agent config", () => {
  it("tool_ids 数量与顺序等于定义，工具名与实现一致", () => {
    const ids = VOICE_TOOL_DEFINITIONS.map((tool) => `id_${tool.name}`);
    const body = buildAgentBody({ toolIds: ids });
    expect(body.conversation_config.agent.prompt.tool_ids).toEqual(ids);
    expect(() => buildAgentBody({ toolIds: ids.slice(1) })).toThrow();
    const implemented = Object.keys(createVoiceTools({ data: { fetchJson: async () => ({}) }, ui: { focusCard: () => true, openCard: () => true, markSeen: async () => undefined, rebuild: async () => undefined } }));
    expect(implemented.sort()).toEqual(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name).sort());
    expect(new Set(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(VOICE_TOOL_DEFINITIONS.length);
  });

  it("supplies descriptions and scalar types required by the live voice tool API", () => {
    const check = (field: Record<string, unknown>) => {
      expect(typeof field.type).toBe("string");
      expect(typeof field.description).toBe("string");
      for (const child of Object.values((field.properties ?? {}) as Record<string, Record<string, unknown>>)) check(child);
      if (field.items) check(field.items as Record<string, unknown>);
    };
    for (const tool of VOICE_TOOL_DEFINITIONS) for (const field of Object.values(tool.parameters.properties)) check(field as Record<string, unknown>);
  });

  it("首句包含动态变量，中文、鉴权与文字模式 override 已开启，无 env 时不带 voice_id", () => {
    for (const name of ["user_name", "date_label", "spoken_script", "next_prompt"]) expect(FIRST_MESSAGE).toContain(`{{${name}}}`);
    for (const name of ["user_name", "date_label", "card_count", "has_perspective"]) expect(PERSONA_PROMPT).toContain(`{{${name}}}`);
    const body = buildAgentBody({ toolIds: VOICE_TOOL_DEFINITIONS.map(() => "x") });
    expect(body.conversation_config.agent.language).toBe("zh");
    expect(body.platform_settings.auth.enable_auth).toBe(true);
    expect(body.platform_settings.overrides.conversation_config_override.conversation.text_only).toBe(true);
    expect("voice_id" in body.conversation_config.tts).toBe(false);
    expect(buildAgentBody({ toolIds: VOICE_TOOL_DEFINITIONS.map(() => "x"), voiceId: "v1" }).conversation_config.tts).toMatchObject({ voice_id: "v1" });
    expect(Object.keys(DYNAMIC_VARIABLE_PLACEHOLDERS).some((key) => key.startsWith("system__"))).toBe(false);
    for (const tool of VOICE_TOOL_DEFINITIONS) {
      const config = buildToolBody(tool).tool_config;
      expect(config).toMatchObject({ type: "client", name: tool.name, expects_response: true });
      expect(config.response_timeout_secs).toBeGreaterThanOrEqual(1);
      expect(config.response_timeout_secs).toBeLessThanOrEqual(120);
      expect(config.parameters.type).toBe("object");
    }
  });
});

describe("buildDynamicVariables", () => {
  const base = { user, date: "2026-09-14", topicCount: 3, build: null };
  it("有简报时读简报，并邀请从第一条开始", () => {
    const vars = buildDynamicVariables({ ...base, feed, brief });
    expect(vars).toMatchObject({ user_name: "Sol", date_label: "9月14日", spoken_script: "这是简报口播。", next_prompt: "要我从第一条开始展开吗？", card_count: 2, has_perspective: true });
  });
  it("无简报有卡片 → 用标题兜底并提到换个角度看", () => {
    const vars = buildDynamicVariables({ ...base, feed, brief: null });
    expect(vars.spoken_script).toContain("《标题一》");
    expect(vars.spoken_script).toContain("换个角度看");
    expect(vars.next_prompt).toBe("想从哪一条开始？");
  });
  it("Feed 空但有画像 → 提议生成；无画像 → 引导去连接；构建中 → 稍等", () => {
    expect(buildDynamicVariables({ ...base, feed: emptyFeed, brief: null }).next_prompt).toContain("现在生成");
    expect(buildDynamicVariables({ ...base, feed: emptyFeed, brief: null, topicCount: 0 }).spoken_script).toContain("还没有兴趣画像");
    const building = { status: "running" as const, stage: "search" as const, stageIndex: 1, stageTotal: 5, detail: null, error: null, updatedAt: "", finishedAt: null };
    expect(buildDynamicVariables({ ...base, feed: emptyFeed, brief: null, build: building }).spoken_script).toContain("正在生成");
  });
  it("只产出 string / number / boolean，空名字回落到「读者」", () => {
    const vars = buildDynamicVariables({ ...base, user: { displayName: "  " }, feed, brief });
    expect(vars.user_name).toBe("读者");
    for (const value of Object.values(vars)) expect(["string", "number", "boolean"]).toContain(typeof value);
    expect(dateLabel("bad")).toBe("今天");
  });
});
