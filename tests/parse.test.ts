import { describe, expect, it } from "vitest";
import { conversationsToText, parseConversations } from "@/lib/ingest/parse";

describe("parseConversations", () => {
  it("解析带角色前缀的纯文本", () => {
    const text = "用户：我想学手冲咖啡\n助手：可以先买 V60。\nUser: 预算 500 够吗？";
    const result = parseConversations(text);
    expect(result).toHaveLength(1);
    expect(result[0].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(result[0].messages[2].content).toBe("预算 500 够吗？");
  });

  it("无前缀文本按段落视为用户消息", () => {
    const result = parseConversations("第一段想法\n\n第二段想法");
    expect(result[0].messages).toHaveLength(2);
    expect(result[0].messages.every((message) => message.role === "user")).toBe(true);
  });

  it("解析 persona / 通用 JSON 格式", () => {
    const json = JSON.stringify({
      conversations: [{ title: "A", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }],
    });
    const result = parseConversations(json);
    expect(result[0].title).toBe("A");
    expect(result[0].messages).toHaveLength(2);
  });

  it("解析 ChatGPT 导出的 mapping 树", () => {
    const exported = [
      {
        title: "考研",
        create_time: 1_700_000_000,
        mapping: {
          a: { message: { author: { role: "user" }, content: { parts: ["要不要考研"] }, create_time: 1 } },
          b: { message: { author: { role: "assistant" }, content: { parts: ["看目标"] }, create_time: 2 } },
          c: { message: null },
        },
      },
    ];
    const result = parseConversations(exported);
    expect(result).toHaveLength(1);
    expect(result[0].messages.map((message) => message.content)).toEqual(["要不要考研", "看目标"]);
  });

  it("conversationsToText 只完整保留用户消息", () => {
    const text = conversationsToText([
      { title: "T", messages: [{ role: "user", content: "问题一" }, { role: "assistant", content: "很长的回答。第二句。" }] },
    ]);
    expect(text).toContain("用户：问题一");
    expect(text).toContain("助手：很长的回答…");
    expect(text).not.toContain("第二句");
  });
});
