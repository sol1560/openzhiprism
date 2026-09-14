import { z } from "zod";
import { sourceIdentity, type CapturePayload } from "./contract";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const captureSchema = z.object({
  version: z.literal(1),
  platform: z.enum(["chatgpt", "claude"]),
  externalId: identifier,
  sourceUrl: z.string().max(2048),
  title: z.string().trim().min(1).max(500),
  messages: z.array(z.object({
    id: identifier,
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    attachments: z.array(z.string().max(500)).max(100).optional(),
  }).strict()).min(1).max(20_000),
}).strict().superRefine((value, ctx) => {
  const source = sourceIdentity(value.sourceUrl);
  if (!source || source.externalId !== value.externalId || source.platform !== value.platform) {
    ctx.addIssue({ code: "custom", message: "来源与会话不匹配" });
  }
  if (new Set(value.messages.map((m) => m.id)).size !== value.messages.length) ctx.addIssue({ code: "custom", message: "消息 ID 重复" });
  if (!value.messages.some((m) => m.role === "user" && m.content.trim())) ctx.addIssue({ code: "custom", message: "没有可分析的用户消息" });
});
export function validateCapture(raw: unknown): CapturePayload {
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) throw new Error("捕捉数据不完整或格式不受支持，请刷新聊天页后重试。");
  return { ...parsed.data, sourceUrl: sourceIdentity(parsed.data.sourceUrl)!.sourceUrl };
}
