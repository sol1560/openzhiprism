import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { createDemoState, demoReducer, selectDemoFeed } from "@/lib/demo/state";

describe("landing sandbox", () => {
  for (const scenario of DEMO_SCENARIOS) {
    it(`${scenario.name}: shows four unique recommendations and a light item with source provenance`, () => {
      const feed = selectDemoFeed(scenario, createDemoState(scenario));
      expect(feed.map((item) => item.kind)).toEqual(["main", "main", "main", "main", "light"]);
      expect(new Set(feed.map((item) => item.article.id)).size).toBe(5);
      for (const { article } of feed) {
        expect(new URL(article.url).hostname).toMatch(/(^|\.)zhihu\.com$/);
        expect(article.fixture).toMatch(/^fixtures\/zhihu\/search\//);
        expect(article.fetchedAt).toBeTruthy();
      }
    });
  }

  const scenario = DEMO_SCENARIOS[0];
  it("raising another interest moves its first recommendation to the front", () => {
    const initial = createDemoState(scenario);
    const changed = demoReducer(initial, { type: "weight", topicId: "intern", weight: 100 });
    const before = selectDemoFeed(scenario, initial);
    const after = selectDemoFeed(scenario, changed);
    expect(before[0].interest?.id).toBe("study");
    expect(after[0].interest?.id).toBe("intern");
    expect(initial.weights.intern).toBe(45);
    expect(scenario.interests[2].weight).toBe(45);
  });

  it("filters the complete active topic pool, even when its second item was outside the default four", () => {
    const state = demoReducer(createDemoState(scenario), { type: "filter", filter: "intern" });
    expect(selectDemoFeed(scenario, state).map((item) => item.article.id)).toEqual(scenario.interests[2].articles.map((item) => item.id));
  });

  it("disabling a filtered topic returns to all and removes its recommendations", () => {
    const initial = { ...createDemoState(scenario), filter: "study" };
    const state = demoReducer(initial, { type: "weight", topicId: "study", weight: 0 });
    expect(state.filter).toBe("all");
    expect(selectDemoFeed(scenario, state).every((item) => item.interest?.id !== "study")).toBe(true);
  });

  it("all interests disabled produces the recovery state, including no unrelated light item", () => {
    const state = scenario.interests.reduce((current, topic) => demoReducer(current, { type: "weight", topicId: topic.id, weight: 0 }), createDemoState(scenario));
    expect(selectDemoFeed(scenario, state)).toEqual([]);
  });

  it("resetting or switching scenes clears read state, preview, filters, highlighted evidence and adjustments", () => {
    let state = demoReducer(createDemoState(scenario), { type: "preview", articleId: scenario.light.id });
    state = demoReducer(state, { type: "preview", articleId: scenario.light.id });
    expect(state.seen).toEqual([scenario.light.id]);
    state = { ...state, filter: "intern", tab: "perspective", side: 2, highlightedTopic: "intern", weights: { ...state.weights, study: 0 } };
    expect(demoReducer(state, { type: "reset", scenario })).toEqual(createDemoState(scenario));
    expect(demoReducer(state, { type: "reset", scenario: DEMO_SCENARIOS[1] })).toEqual(createDemoState(DEMO_SCENARIOS[1]));
  });

  it("rejects unknown or nonfinite weights and clamps valid values", () => {
    const initial = createDemoState(scenario);
    expect(demoReducer(initial, { type: "weight", topicId: "unknown", weight: 50 })).toBe(initial);
    expect(demoReducer(initial, { type: "weight", topicId: "study", weight: NaN })).toBe(initial);
    expect(demoReducer(initial, { type: "weight", topicId: "study", weight: 150 }).weights.study).toBe(100);
  });
});
