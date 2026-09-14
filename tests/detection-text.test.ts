import { describe, expect, it, vi } from "vitest";
import { countWords, estimateCents, prepareSource } from "@/lib/ai-detection/text";
import { createPangramClient, PangramError, parseResult } from "@/lib/ai-detection/pangram";
import { sourceValues } from "@/lib/ai-detection/source";
import { prose } from "./helpers/database";
export function rawResult(text = prose) {
  return { text, version: "4.0", prediction_short: "Mixed", fraction_ai: 0.3, fraction_ai_assisted: 0.2, fraction_human: 0.5,
    windows: [{ text, label: "AI-Assisted", confidence: "High", start_index: 0, end_index: Array.from(text).length }] };
}
describe("source and provider contract", () => {
  it("counts natural Chinese and English words, not emoji or whitespace", () => {
    expect(countWords("这是一个关于城市交通的完整讨论。".repeat(30))).toBeGreaterThan(50);
    expect(countWords(prose)).toBe(80);
    expect(countWords("😀 \n".repeat(200))).toBe(0);
  });
  it("caps at Unicode characters without splitting emoji or rewriting punctuation", () => {
    const input = "甲".repeat(3999) + "😀乙";
    const source = prepareSource(input);
    expect(Array.from(source.text)).toHaveLength(4000);
    expect(source.text.endsWith("😀")).toBe(true);
    expect(source.truncated).toBe(true);
    expect(prepareSource("“原句”\n保留，标点！").text).toBe("“原句”\n保留，标点！");
    expect(prepareSource(input + "丙").hash).toBe(source.hash);
    expect(estimateCents("😀".repeat(101))).toBe(10);
  });
  it("preserves unknown classification rather than calling it human", () => {
    const result = parseResult({ ...rawResult(), prediction_short: "New label", windows: [{ ...rawResult().windows[0], label: "Future label", confidence: "Something" }] }, prose);
    expect(result.label).toBe("unknown"); expect(result.segments[0].label).toBe("unknown"); expect(result.segments[0].confidence).toBe("Unknown");
    expect(() => parseResult({ ...rawResult(), fraction_ai: 8 }, prose)).toThrow("invalid_result");
    expect(() => parseResult({ text: prose }, prose)).toThrow("invalid_result");
  });
  it("tolerates whitespace, version and window drift instead of discarding a paid result", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spaced = parseResult({ ...rawResult(), text: `\n${prose.replace(/ /g, "  ")}  ` }, prose);
    expect(spaced.notes).toBeUndefined(); expect(spaced.segments).toHaveLength(1);
    const mismatch = parseResult(rawResult("different"), prose);
    expect(mismatch.notes).toEqual(["text_mismatch", "dropped_windows"]); expect(mismatch.segments).toHaveLength(0);
    expect(parseResult({ ...rawResult(), version: "3.3" }, prose).notes).toEqual(["unexpected_version"]);
    const noWindows = parseResult({ ...rawResult(), windows: undefined, prediction_short: undefined }, prose);
    expect(noWindows.segments).toHaveLength(0); expect(noWindows.label).toBe("unknown");
    expect(String(vi.mocked(console.warn).mock.calls.flat())).not.toContain(prose.slice(0, 12));
    vi.mocked(console.warn).mockRestore();
  });
  it("submits only supplied original text to v4 with private reports", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ task_id: "task-1" }));
    const client = createPangramClient("test-only-key", fetcher);
    await expect(client.submit(prose)).resolves.toBe("task-1");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://text.external-api.pangram.com/task");
    expect(JSON.parse(String(init?.body))).toEqual({ text: prose, model: "pangram-4", public_dashboard_link: false });
    expect(init?.redirect).toBe("error");
  });
  it("treats lost submission responses as uncertain and explicit refusals separately", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network contains secret"));
    await expect(createPangramClient("test-only", fetcher).submit(prose)).rejects.toMatchObject({ uncertain: true, code: "network" });
    fetcher.mockResolvedValue(Response.json({}, { status: 402 }));
    await expect(createPangramClient("test-only", fetcher).submit(prose)).rejects.toMatchObject({ uncertain: false, code: "provider_credits" });
    fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(createPangramClient("test-only", fetcher).submit(prose)).rejects.toBeInstanceOf(PangramError);
  });
  it("records missing-body refreshes separately from legacy rows", () => {
    expect(sourceValues({ id: "a", provider: "justone", type: "answer", title: "a", excerpt: "excerpt", url: "https://www.zhihu.com", voteUp: 0, commentCount: 0 })).toMatchObject({ sourceText: null, sourceHash: null, sourceProvider: "justone" });
  });
});
