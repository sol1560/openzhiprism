import { describe, expect, it } from "vitest";
import { snapshotItem, validateAnalysis, validateEvidence, materialsOnly } from "@/lib/cognition/evidence";
import { cognitionSources } from "./helpers/cognition";
import { nextInquiryQuestion } from "@/lib/cognition/inquiries";
describe("immutable source evidence", () => {
  it("keeps each follow-up to one question and advances evidence then boundary checks", () => {
    expect(nextInquiryQuestion("你具体指什么？请再定义一次？", 1)).toContain("原文");
    const next = nextInquiryQuestion("哪条证据支持你？可以举例吗？", 1);
    expect(next).toBe("哪条证据支持你？");
    expect(nextInquiryQuestion("请继续解释你的意思？", 2)).toContain("条件");
  });
  it("binds exact quotes, offsets and context to a version, rejects forged or unknown references", () => {
    const s = snapshotItem(cognitionSources[0])!;
    const quote = "继续读研可能有帮助";
    const result = validateEvidence({ items: [
      { snapshotId: s.id, quote, claim: "作者谈到继续读研", condition: null },
      { snapshotId: s.id, quote: "读研一定比工作更好", claim: "伪造", condition: null },
      { snapshotId: "unknown", quote, claim: "无来源", condition: null },
    ] }, [s]);
    expect(result.rejected).toBe(2); expect(result.evidence).toHaveLength(1);
    const e = result.evidence[0]; expect(s.text.slice(e.start, e.end)).toBe(e.quote);
    expect(e.before + e.quote + e.after).toBe(s.text);
    expect(snapshotItem({ ...cognitionSources[0], content: s.text + "后来更新了。" })!.id).not.toBe(s.id);
  });
  it("uses public answer identity across providers while preserving distinct authors' answers", () => {
    const a = snapshotItem(cognitionSources[0])!;
    const b = snapshotItem({ ...cognitionSources[0], id: "answer:provider-alias", provider: "official", url: cognitionSources[0].url + "?utm_source=api" })!;
    expect(a.id).toBe(b.id); expect(a.identity).toBe("answer:11");
    expect(snapshotItem(cognitionSources[1])!.id).not.toBe(a.id);
  });
  it("labels search-only and truncated sources honestly, refuses non-Zhihu or missing material", () => {
    expect(snapshotItem({ ...cognitionSources[0], content: undefined })?.scope).toBe("search_excerpt");
    expect(snapshotItem({ ...cognitionSources[0], content: "中".repeat(5000) })?.text).toHaveLength(4000);
    expect(snapshotItem({ ...cognitionSources[0], url: "https://evil.test/x" })).toBeNull();
    expect(snapshotItem({ ...cognitionSources[0], content: "", excerpt: "" })).toBeNull();
  });
  it("does not retain synthesized claims with missing or unknown evidence", () => {
    const s = snapshotItem(cognitionSources[0])!;
    const { evidence } = validateEvidence({ items: [{ snapshotId: s.id, quote: s.text, claim: "原文主张", condition: null }] }, [s]);
    const result = validateAnalysis({ ...materialsOnly(), dimensions: [{ title: "伪分歧", positions: [{ label: "无出处", claims: [{ text: "凭空结论", evidenceIds: ["ghost"] }] }] }] }, evidence);
    expect(result.dimensions).toEqual([]); expect(result.summary.evidenceIds).toEqual([]);
    const singleSourceConsensus = validateAnalysis({ ...materialsOnly(), consensus: [{ text: "单个来源不能代表材料共识", evidenceIds: [evidence[0].id] }] }, evidence);
    expect(singleSourceConsensus.consensus).toEqual([]);
  });
});
