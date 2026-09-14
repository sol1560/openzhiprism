import type { McpServer } from "@modelcontextprotocol/server";
import { after } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { uiMeta } from "@/lib/mcp/widgets";
import { startDossier, getDossier } from "./dossiers";
import { discussSchema, discussTopic, getInquiry } from "./inquiries";
import { getReflections, manageReflection, manageReflectionSchema, reflectionExport } from "./reflections";
import { setContentFeedback } from "./feedback";
import { cognitionGate } from "./http";
import { CognitionError, cognitionEnabled, feedbackSchema, reflectionDraftSchema } from "./types";

const outputSchema = z.object({ kind: z.string(), data: z.record(z.string(), z.unknown()), links: z.record(z.string(), z.string()) });
export function registerCognitionTools(server: McpServer, requireUser: (ctx: unknown) => Promise<string>, respond: (ctx: unknown, value: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> }>) {
  const enabled = () => { if (!cognitionEnabled()) throw new CognitionError("证据与判断功能暂未开放", 503); };
  const links = (jobId?: string, inquiryId?: string) => ({ reflections: `${env.appUrl}/reflections`, ...(jobId ? { topic: `${env.appUrl}/topics/${jobId}${inquiryId ? `?inquiry=${inquiryId}` : ""}` } : {}) });
  server.registerTool("get_topic_dossier", {
    title: "查看话题证据与分歧", description: "查看可核对的话题材料。提供 topic 发起或复用分析；返回 pending 时使用 jobId 读取进度。version 可读取已授权历史版本。每个引文有不可变来源；没有分析时只能转述材料。evidenceId 可只展开某条依据。不要根据材料数量给用户贴立场标签。",
    inputSchema: z.object({ topic: z.string().min(2).max(300).optional(), jobId: z.string().optional(), version: z.string().optional(), evidenceId: z.string().optional(), refresh: z.boolean().default(false) }),
    outputSchema, _meta: uiMeta("cognition"), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async (input, ctx) => {
    enabled(); const user = await requireUser(ctx); let id = input.jobId;
    if (!id || input.refresh) {
      const topic = input.topic ?? (id ? (await getDossier(user, id)).topic : undefined);
      if (!topic) throw new CognitionError("请提供 topic 或 jobId");
      await cognitionGate(user, "dossier");
      const result = await startDossier(user, { topic, refresh: input.refresh });
      try { after(() => result.promise); } catch { /* stdio has a persistent process instead of a Next request. */ void result.promise; }
      id = result.jobId;
    }
    const view = await getDossier(user, id, input.version);
    if (input.evidenceId) {
      const evidence = view.dossier?.evidence.find((e) => e.id === input.evidenceId);
      if (!evidence) throw new CognitionError("该版本没有这条证据", 404);
      return respond(ctx, { kind: "evidence", data: { evidence, source: view.dossier!.sources.find((s) => s.id === evidence.snapshotId) }, links: links(id) });
    }
    return respond(ctx, { kind: "dossier", data: { ...view }, links: links(id) });
  });
  server.registerTool("discuss_topic", {
    title: "一起想清楚", description: "仅在用户主动要求思辨时开始。action=start 使用 jobId；reply/draft 使用 inquiryId、revision 和 requestId。最多三轮，每轮一个问题；草稿不是已保存判断。action=get 跨端继续已有会话。相同请求重试必须复用 requestId。",
    inputSchema: z.object({ action: z.enum(["get", "start", "reply", "draft"]), jobId: z.string().optional(), version: z.string().optional(), inquiryId: z.string().optional(), revision: z.number().int().optional(), requestId: z.string().optional(), text: z.string().max(1200).optional() }),
    outputSchema, _meta: uiMeta("cognition"), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input, ctx) => {
    enabled(); const user = await requireUser(ctx);
    if (input.action !== "get") await cognitionGate(user, "inquiry");
    const data = input.action === "get" && input.inquiryId ? await getInquiry(user, input.inquiryId) : await discussTopic(user, discussSchema.parse(input));
    return respond(ctx, { kind: "inquiry", data: { ...data }, links: links(data.jobId, data.id) });
  });
  server.registerTool("manage_reflection", {
    title: "保存或管理我的判断", description: "仅在用户明确说保存、修改、关注或删除时调用；普通阅读、自动推荐不能调用。save 必须先向用户呈现 draft 并获得确认，confirmed=true；修改追加版本，expectedVersion 用当前版本。跟踪未解问题用 follow。重复保存复用 requestId。不能将模型草稿当成用户已认可的观点。",
    inputSchema: z.object({ action: z.enum(["save", "follow", "delete"]), jobId: z.string().optional(), dossierId: z.string().optional(), inquiryId: z.string().optional(), reflectionId: z.string().optional(), expectedVersion: z.number().int().default(0), requestId: z.string().optional(), confirmed: z.boolean().optional(), following: z.boolean().default(false), draft: reflectionDraftSchema.optional() }),
    outputSchema, _meta: uiMeta("cognition"), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async (input, ctx) => { enabled(); const user = await requireUser(ctx); await cognitionGate(user, "reflection"); return respond(ctx, { kind: "reflection_saved", data: await manageReflection(user, manageReflectionSchema.parse(input)), links: links(input.jobId) }); });
  server.registerTool("get_reflections", {
    title: "回看我的判断", description: "读取已确认的判断、历史版本和新材料提示。不会读取其他用户或未确认草稿。按 id 或 topic 筛选；id 加 exportFormat 可获取仅包含确认判断和公共依据的导出预览。",
    inputSchema: z.object({ id: z.string().optional(), topic: z.string().optional(), exportFormat: z.enum(["md", "html"]).optional() }),
    outputSchema, _meta: uiMeta("cognition"), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, ctx) => { enabled(); const user = await requireUser(ctx); const items = await getReflections(user, input); const exported = input.id && input.exportFormat ? await reflectionExport(user, input.id, input.exportFormat) : undefined; return respond(ctx, { kind: "reflections", data: { items, ...(exported ? { exportPreview: exported } : {}) }, links: links() }); });
  server.registerTool("set_content_feedback", {
    title: "反馈阅读内容", description: "仅记录用户明确给出的阅读反馈：useful 有帮助、known 已知道、irrelevant 不相关、misleading 归纳有误，null 撤销。不代表赞同作者，也不会改变用户立场。contentId 必须来自该用户 Feed 或证据材料。",
    inputSchema: z.object({ contentId: z.string(), kind: feedbackSchema.nullable() }), outputSchema, _meta: uiMeta("cognition"), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (input, ctx) => { enabled(); const user = await requireUser(ctx); await cognitionGate(user, "feedback"); return respond(ctx, { kind: "feedback", data: await setContentFeedback(user, input.contentId, input.kind), links: links() }); });
}
