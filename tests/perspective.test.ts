import { describe, expect, it } from "vitest";
import { assembleCard, computeExposure } from "@/lib/perspective";

const items = [
  { id: "p1", title: "支持 1", url: "", oneLine: "", excerpt: "", voteUp: 100, provider: "fixture", side: "pro" as const },
  { id: "p2", title: "支持 2", url: "", oneLine: "", excerpt: "", voteUp: 50, provider: "fixture", side: "pro" as const },
  { id: "c1", title: "反对 1", url: "", oneLine: "", excerpt: "", voteUp: 300, provider: "fixture", side: "con" as const },
  { id: "c2", title: "反对 2", url: "", oneLine: "", excerpt: "", voteUp: 20, provider: "fixture", side: "con" as const },
  { id: "n1", title: "中立", url: "", oneLine: "", excerpt: "", voteUp: 10, provider: "fixture", side: "neutral" as const },
];

const analysis = {
  topicKey: "考研",
  topicName: "考研 vs 就业",
  isControversial: true,
  question: "先考研还是先工作？",
  proLabel: "先考研",
  conLabel: "先工作",
  items,
  analysis: "两边各有道理",
  analysisModel: "rules",
};

describe("computeExposure", () => {
  it("用户明确立场按 3 票计，一条反向曝光不足以抵消", () => {
    const result = computeExposure("pro", items, new Set(["c1"]));
    expect(result.userSide).toBe("pro");
    expect(result.ratio).toBeCloseTo(0.75);
  });

  it("没有立场也没有曝光时返回 null", () => {
    expect(computeExposure(null, items, new Set()).userSide).toBeNull();
  });

  it("只有曝光时按曝光方向判定", () => {
    const result = computeExposure(null, items, new Set(["c1", "c2"]));
    expect(result.userSide).toBe("con");
    expect(result.ratio).toBe(1);
  });
});

describe("assembleCard", () => {
  it("用户偏向 pro 时推对立面 con，并按赞同排序", () => {
    const card = assembleCard(analysis, "pro", "倾向先考研", new Set())!;
    expect(card).not.toBeNull();
    expect(card.counterSide).toBe("con");
    expect(card.stances[0].side).toBe("con");
    expect(card.stances[0].items.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(card.stances.map((stance) => stance.side)).toEqual(["con", "neutral", "pro"]);
    expect(card.reason).toContain("先工作");
  });

  it("接触过两条以上对立观点后不再插卡", () => {
    expect(assembleCard(analysis, "pro", null, new Set(["c1", "c2"]))).toBeNull();
  });

  it("非争议话题不出卡", () => {
    expect(assembleCard({ ...analysis, isControversial: false }, "pro", null, new Set())).toBeNull();
  });
});
