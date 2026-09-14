import type { DemoRecommendation, DemoScenario, DemoState, DemoTab } from "./types";

export function createDemoState(scenario: DemoScenario): DemoState {
  return {
    scenarioId: scenario.id,
    weights: Object.fromEntries(scenario.interests.map((topic) => [topic.id, topic.weight])),
    tab: "feed", filter: "all", seen: [], highlightedTopic: null, previewId: null, side: 0,
  };
}

export type DemoAction =
  | { type: "reset"; scenario: DemoScenario }
  | { type: "weight"; topicId: string; weight: number }
  | { type: "tab"; tab: DemoTab }
  | { type: "filter"; filter: string }
  | { type: "reason"; topicId: string | null }
  | { type: "preview"; articleId: string | null }
  | { type: "side"; side: number };

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset": return createDemoState(action.scenario);
    case "weight": {
      if (!(action.topicId in state.weights) || !Number.isFinite(action.weight)) return state;
      const weight = Math.max(0, Math.min(100, Math.round(action.weight)));
      return { ...state, weights: { ...state.weights, [action.topicId]: weight },
        filter: weight === 0 && state.filter === action.topicId ? "all" : state.filter };
    }
    case "tab": return { ...state, tab: action.tab };
    case "filter": return { ...state, filter: action.filter };
    case "reason": return { ...state, highlightedTopic: action.topicId };
    case "preview": return { ...state, previewId: action.articleId,
      seen: action.articleId ? [...new Set([...state.seen, action.articleId])] : state.seen };
    case "side": return { ...state, side: action.side };
  }
}

/** Deterministic local demo: rotate through active interests, highest weight first. */
export function selectDemoFeed(scenario: DemoScenario, state: DemoState): DemoRecommendation[] {
  const active = scenario.interests.filter((t) => state.weights[t.id] > 0)
    .sort((a, b) => state.weights[b.id] - state.weights[a.id]);
  if (!active.length) return [];
  const picked: DemoRecommendation[] = [];
  const used = new Set<string>();
  const pool = state.filter === "all" ? active : active.filter((t) => t.id === state.filter);
  const rounds = Math.max(0, ...pool.map((t) => t.articles.length));
  for (let round = 0; round < rounds && picked.length < 4; round++) {
    for (const interest of pool) {
      const article = interest.articles[round];
      if (!article || used.has(article.id) || picked.length === 4) continue;
      used.add(article.id);
      picked.push({ article, interest, kind: "main" });
    }
  }
  if (state.filter === "all" && !used.has(scenario.light.id)) {
    picked.push({ article: scenario.light, interest: null, kind: "light" });
  }
  return picked;
}
