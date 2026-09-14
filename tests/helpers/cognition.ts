import type { ZhihuItem } from "@/lib/zhihu/types";
import type { DossierDeps } from "@/lib/cognition/dossiers";
import type { DossierAnalysis } from "@/lib/cognition/types";
export const cognitionSources: ZhihuItem[] = [
  { id: "answer:e1", type: "answer", title: "考研还是先就业？", url: "https://www.zhihu.com/question/1/answer/11", author: { name: "测试作者甲" }, content: "如果目标岗位要求研究训练，继续读研可能有帮助。先确认目标岗位，而不是只比较学历。", excerpt: "研究训练与岗位要求。", contentTruncated: false, sourceFetchedAt: 1789380000000, voteUp: 12, commentCount: 0, provider: "fixture" },
  { id: "answer:e2", type: "answer", title: "考研还是先就业？", url: "https://www.zhihu.com/question/1/answer/12", author: { name: "测试作者乙" }, content: "如果目标岗位更重视项目经历，可以先通过实习验证兴趣。具体选择取决于目标和现实条件。", excerpt: "实习验证与现实条件。", contentTruncated: false, sourceFetchedAt: 1789380000000, voteUp: 9, commentCount: 0, provider: "fixture" },
];
export const cognitionModels: Pick<DossierDeps, "extract" | "synthesize" | "relevant"> = {
  relevant: async (_topic, sources) => sources,
  extract: async (sources) => ({ live: true, model: "test-stub", value: { items: sources.map((source) => ({ snapshotId: source.id, quote: source.text.split("。")[0] + "。", claim: source.text.split("。")[0], condition: null })) } }),
  synthesize: async (_question, evidence) => {
    const value: DossierAnalysis = { summary: { text: "需要区分岗位目标及适用条件。", evidenceIds: evidence.map((e) => e.id) },
      dimensions: [{ title: "目标岗位要求什么？", positions: evidence.map((e, i) => ({ label: `材料 ${i + 1}`, claims: [{ text: e.claim, evidenceIds: [e.id] }] })) }],
      consensus: [], conditions: [], counterexamples: [], openQuestions: ["目标岗位具体要求哪些能力？"] };
    return { live: true, model: "test-stub", value };
  },
};
