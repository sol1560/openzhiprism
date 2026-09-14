import { describe, expect, it } from "vitest";
import { normalizeCapture } from "@/extensions/browser/src/normalize";
import { validateCapture } from "@/lib/extension/validation";
import { sourceIdentity } from "@/lib/extension/contract";
import type { PageCapture } from "@/extensions/browser/src/page-reader";
const id = "00000000-1111-2222-3333-444444444444";
const gpt = (): PageCapture => ({ url: "https://chatgpt.com/c/" + id, visibleIds: ["u"], visibleUserTexts: [],
  raw: { conversation_id: id, title: "代码讨论", current_node: "answer", mapping: {
    root: { parent: null, message: null },
    u: { parent: "root", message: { author: { role: "user" }, content: { parts: ["Explain the code\n\nhttps://example.com"] } } },
    discarded: { parent: "u", message: { author: { role: "assistant" }, content: { parts: ["wrong branch"] } } },
    reasoning: { parent: "u", message: { author: { role: "assistant" }, channel: "analysis", content: { parts: ["hidden reasoning"] } } },
    answer: { parent: "reasoning", message: { author: { role: "assistant" }, channel: "final", content: { content_type: "code", language: "python", text: "print(1)" } } },
  } } });
describe("current conversation adapters", () => {
  it("walks only the active GPT branch, preserves code and links, excludes reasoning", () => {
    const result = normalizeCapture(gpt());
    expect(result.messages.map((m) => m.id)).toEqual(["u", "answer"]);
    const fence = String.fromCharCode(96).repeat(3);
    expect(result.messages[1].content).toBe(fence + "python\nprint(1)\n" + fence);
    expect(result.messages[0].content).toContain("https://example.com");
    expect(validateCapture(result)).toEqual(result);
  });
  it("walks Claude parents rather than array order and only retains attachment names", () => {
    const result = normalizeCapture({ url: "https://claude.ai/chat/" + id, visibleIds: [], visibleUserTexts: [], raw: {
      uuid: id, name: "Claude", current_leaf_message_uuid: "a", chat_messages: [
        { uuid: "a", parent_message_uuid: "u", sender: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "answer" }] },
        { uuid: "other", parent_message_uuid: "u", sender: "assistant", text: "other branch" },
        { uuid: "u", parent_message_uuid: "00000000-0000-4000-8000-000000000000", sender: "human", text: "my question", attachments: [{ file_name: "note.pdf", extracted_content: "not imported" }] },
      ],
    } });
    expect(result.messages.map((m) => m.id)).toEqual(["u", "a"]);
    expect(result.messages[0].attachments).toEqual(["note.pdf"]);
    expect(JSON.stringify(result)).not.toContain("not imported");
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("fails closed on missing parents, missing leaf, visible branch mismatch, or streaming", () => {
    const page = gpt(); (page.raw.mapping as Record<string, unknown>).root = { parent: "missing" };
    expect(() => normalizeCapture(page)).toThrow("完整分支");
    const noLeaf = gpt(); delete noLeaf.raw.current_node; expect(() => normalizeCapture(noLeaf)).toThrow();
    const branch = gpt(); branch.visibleIds = ["discarded"]; expect(() => normalizeCapture(branch)).toThrow();
    const stream = gpt(); ((stream.raw.mapping as Record<string, { message: Record<string, unknown> }>).answer.message).status = "in_progress";
    expect(() => normalizeCapture(stream)).toThrow("正在生成");
  });
  it.each(["00000000-0000-4000-8000-000000000000", "00000000-0000-0000-0000-000000000000", null])("recognizes Claude's root marker %s without requiring a synthetic root message", (parent) => {
    const page: PageCapture = { url: "https://claude.ai/chat/" + id, visibleIds: ["question", "answer"], visibleUserTexts: [],
      raw: { uuid: id, name: "经济学课程", current_leaf_message_uuid: "answer", chat_messages: [
        { uuid: "answer", parent_message_uuid: "question", sender: "assistant", content: [{ type: "text", text: "回答正文。" }] },
        { uuid: "question", parent_message_uuid: parent, sender: "human", content: [{ type: "text", text: "为什么经济学会放在政治课程里？" }] },
      ] } };
    expect(normalizeCapture(page).messages.map((message) => message.id)).toEqual(["question", "answer"]);
    (page.raw.chat_messages as Array<{ parent_message_uuid: string | null }>)[1].parent_message_uuid = "11111111-1111-4111-8111-111111111111";
    expect(() => normalizeCapture(page)).toThrow("完整分支");
  });
  it("does not truncate a long conversation to visible DOM messages", () => {
    const page = gpt(), mapping = page.raw.mapping as Record<string, unknown>;
    for (let i = 0; i < 600; i++) mapping["m" + i] = { parent: i ? "m" + (i - 1) : "answer", message: { author: { role: i % 2 ? "assistant" : "user" }, content: { parts: ["text " + i] } } };
    page.raw.current_node = "m599";
    expect(normalizeCapture(page).messages).toHaveLength(602);
  });
  it("rejects unsupported pages, mismatched identities and duplicate message IDs", () => {
    for (const url of ["https://chatgpt.com/", "https://chatgpt.com/share/" + id, "https://claude.ai.evil.test/chat/" + id, "http://claude.ai/chat/" + id]) expect(sourceIdentity(url)).toBeNull();
    const parsed = normalizeCapture(gpt());
    expect(() => validateCapture({ ...parsed, externalId: "other" })).toThrow();
    expect(() => validateCapture({ ...parsed, messages: [parsed.messages[0], parsed.messages[0]] })).toThrow();
  });
});
