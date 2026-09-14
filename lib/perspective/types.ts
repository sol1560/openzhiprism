export type PerspectiveSide = "pro" | "con" | "neutral";

export interface PerspectiveItem {
  id: string;
  title: string;
  url: string;
  oneLine: string;
  excerpt: string;
  authorName?: string;
  voteUp: number;
  provider: string;
}

export interface PerspectiveStance {
  side: PerspectiveSide;
  label: string;
  items: PerspectiveItem[];
}

/** 「换个角度看」卡片载荷 */
export interface PerspectiveCard {
  evidenceVersion?: string;
  topicKey: string;
  topicName: string;
  question: string;
  /** 用户画像 + 已推送内容体现出的倾向 */
  userSide: PerspectiveSide | null;
  userSideLabel: string | null;
  /** 0-1，用户已接触内容中同向占比 */
  exposureRatio: number;
  /** 被刻意推荐的对立面 */
  counterSide: PerspectiveSide;
  stances: PerspectiveStance[];
  analysis: string | null;
  analysisModel: string | null;
  /** 为什么插入这张卡 */
  reason: string;
}
