export interface DemoArticle {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  url: string;
  authorName: string;
  voteUp: number;
  fetchedAt: string;
  fixture: string;
}

export interface DemoInterest {
  id: string;
  name: string;
  weight: number;
  message: string;
  reply: string;
  articles: DemoArticle[];
}

export interface DemoScenario {
  id: string;
  name: string;
  role: string;
  description: string;
  interests: DemoInterest[];
  light: DemoArticle;
  perspective: {
    topicId: string;
    question: string;
    context: string;
    sides: { label: string; description: string; article?: DemoArticle }[];
  };
}

export type DemoTab = "feed" | "interests" | "perspective";
export interface DemoState {
  scenarioId: string;
  weights: Record<string, number>;
  tab: DemoTab;
  filter: string;
  seen: string[];
  highlightedTopic: string | null;
  previewId: string | null;
  side: number;
}

export interface DemoRecommendation {
  article: DemoArticle;
  interest: DemoInterest | null;
  kind: "main" | "light";
}
