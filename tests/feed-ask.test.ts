import { describe, expect, it } from "vitest";
import { heuristicPlan, normalizePlan, ruleRewrite } from "@/lib/feed/ask";
import { DIRECTIVE_FACTOR, applyDirectives } from "@/lib/feed/select";

const topics = ["考研 vs 就业", "远程办公效率", "公路车入门"];
const card = { cardId: "c1", title: "为什么建议先工作", summary: "先工作能看清行业。再考研也不晚。三年后再选也来得及。", body: "正文", topic: "考研 vs 就业" };

describe("heuristicPlan", () => {
  it("card scope: bullet request becomes a rewrite with a summary", () => {
    const plan = heuristicPlan({ text: "改成三条要点", focusedCard: card, topics });
    expect(plan.actions).toEqual([{ type: "rewrite" }]);
    expect(plan.summary?.split("\n")).toHaveLength(3);
    expect(plan.summary).toMatch(/^· /);
  });
  it("card scope: question becomes an answer without touching the summary", () => {
    const plan = heuristicPlan({ text: "作者的论据是什么？", focusedCard: card, topics });
    expect(plan.actions).toEqual([{ type: "answer" }]);
    expect(plan.summary).toBeUndefined();
  });
  it("card scope: unknown instruction yields no action instead of a broken rewrite", () => {
    expect(heuristicPlan({ text: "翻译成英文", focusedCard: card, topics }).actions).toEqual([]);
  });
  it("feed scope: less / mute / more resolve against profile topics", () => {
    expect(heuristicPlan({ text: "以后少推考研 vs 就业", focusedCard: null, topics }).actions).toEqual([{ type: "adjust_topic", topic: "考研 vs 就业", direction: "less" }]);
    expect(heuristicPlan({ text: "别再推公路车入门了", focusedCard: null, topics }).actions).toEqual([{ type: "adjust_topic", topic: "公路车入门", direction: "mute" }]);
    expect(heuristicPlan({ text: "多推点远程办公效率", focusedCard: null, topics }).actions).toEqual([{ type: "adjust_topic", topic: "远程办公效率", direction: "more" }]);
  });
  it("feed scope: wanting something new becomes a search", () => {
    expect(heuristicPlan({ text: "我想看看 Rust 异步", focusedCard: null, topics }).actions).toEqual([{ type: "search", query: "Rust 异步" }]);
    expect(heuristicPlan({ text: "来点关于露营装备的内容", focusedCard: null, topics }).actions).toEqual([{ type: "search", query: "露营装备" }]);
  });
  it("feed scope: everything else is remembered as a rule", () => {
    expect(heuristicPlan({ text: "摘要都用要点", focusedCard: null, topics }).actions).toEqual([{ type: "add_rule", rule: "摘要都用要点" }]);
    expect(heuristicPlan({ text: "不想看营销号", focusedCard: null, topics }).actions).toEqual([{ type: "add_rule", rule: "不想看营销号" }]);
  });
});

describe("ruleRewrite", () => {
  it("shortens to the first sentence and bullets to at most three", () => {
    expect(ruleRewrite("短一点", card.summary)).toBe("先工作能看清行业。");
    expect(ruleRewrite("分点列出", "只有一句话。")).toBe("· 只有一句话。");
    expect(ruleRewrite("翻成英文", card.summary)).toBeNull();
  });
});

describe("normalizePlan", () => {
  it("drops rewrite without a summary and answer without a card", () => {
    expect(normalizePlan({ reply: "ok", actions: [{ type: "rewrite" }, { type: "answer" }] }, { hasCard: true, topics }).actions).toEqual([{ type: "answer" }]);
    expect(normalizePlan({ reply: "ok", summary: "新摘要", actions: [{ type: "rewrite" }] }, { hasCard: false, topics }).actions).toEqual([]);
    const kept = normalizePlan({ reply: "ok", summary: "新摘要", actions: [{ type: "rewrite" }] }, { hasCard: true, topics });
    expect(kept.summary).toBe("新摘要");
  });
  it("treats a card-scoped summary as a rewrite even when the model omits the action", () => {
    const plan = normalizePlan({ reply: "改好了", summary: "· 一\n· 二", actions: [] }, { hasCard: true, topics });
    expect(plan.actions).toEqual([{ type: "rewrite" }]);
    expect(plan.summary).toBe("· 一\n· 二");
    expect(normalizePlan({ reply: "x", summary: "· 一", actions: [] }, { hasCard: false, topics }).actions).toEqual([]);
  });
  it("canonicalizes topics and degrades unresolved ones", () => {
    const plan = normalizePlan({ reply: "", actions: [
      { type: "adjust_topic", topic: "远程办公", direction: "less" },
      { type: "adjust_topic", topic: "量子计算", direction: "more" },
      { type: "adjust_topic", topic: "娱乐八卦", direction: "mute" },
    ] }, { hasCard: false, topics });
    expect(plan.actions).toEqual([
      { type: "adjust_topic", topic: "远程办公效率", direction: "less" },
      { type: "search", query: "量子计算" },
      { type: "add_rule", rule: "不推：娱乐八卦" },
    ]);
    expect(plan.reply).toBe("已处理。");
  });
  it("dedupes and caps at three actions", () => {
    const plan = normalizePlan({ reply: "ok", actions: [
      { type: "search", query: "a1" }, { type: "search", query: "a1" }, { type: "search", query: "a2" }, { type: "search", query: "a3" }, { type: "search", query: "a4" },
    ] }, { hasCard: false, topics });
    expect(plan.actions.map((action) => (action as { query: string }).query)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("applyDirectives", () => {
  const input = topics.map((name, index) => ({ name, weight: 1 - index * 0.2 }));
  it("mutes, boosts and damps without mutating the input", () => {
    const out = applyDirectives(input, [
      { kind: "topic", topic: "考研 vs 就业", direction: "mute" },
      { kind: "topic", topic: "远程办公效率", direction: "more" },
      { kind: "topic", topic: "公路车入门", direction: "less" },
      { kind: "rule", topic: null, direction: null },
    ]);
    expect(out.map((topic) => topic.name)).toEqual(["远程办公效率", "公路车入门"]);
    expect(out[0].weight).toBeCloseTo(0.8 * DIRECTIVE_FACTOR.more);
    expect(out[1].weight).toBeCloseTo(0.6 * DIRECTIVE_FACTOR.less);
    expect(input[0].weight).toBe(1);
  });
  it("is a no-op copy without topic directives", () => {
    const out = applyDirectives(input, [{ kind: "rule", topic: null, direction: null }]);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});
