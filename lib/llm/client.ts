import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { env, ZENMUX_BASE_URL, ZHIHU_OFFICIAL_BASE_URL, type LlmProvider } from "@/lib/env";

/**
 * LLM 客户端：zenmux（主力）/ zhida（知乎直答，配额极少）/ mock（无 key 时的规则回退）。
 * 所有调用都要求提供 fallback，保证 demo 在无网络、无 key、模型出错时仍能产出结果。
 */

export interface ObjectCall<T> {
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  fallback: () => T;
  /** 覆盖默认 provider，例如「换个角度看」强制用直答 */
  provider?: LlmProvider;
  temperature?: number;
  /** 覆盖默认 25s 上限；长输入的兴趣提取需要更久 */
  timeoutMs?: number;
}

export interface TextCall {
  system?: string;
  prompt: string;
  fallback: () => string;
  provider?: LlmProvider;
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmCallResult<T> {
  value: T;
  provider: LlmProvider;
  model: string;
  /** true 表示实际走了模型；false 表示用了 fallback */
  live: boolean;
  error?: string;
}

export type ZhidaModelId = "zhida-fast-1p5" | "zhida-thinking-1p5" | "zhida-agent";

function resolveProvider(requested?: LlmProvider): LlmProvider {
  const provider = requested ?? env.llmProvider;
  if (provider === "zenmux" && !env.zenmuxApiKey) return "mock";
  if (provider === "zhida" && !env.zhihuAccessSecret) return "mock";
  return provider;
}

function buildModel(provider: LlmProvider, zhidaModel: ZhidaModelId = "zhida-fast-1p5"): { model: LanguageModel; id: string } | null {
  switch (provider) {
    case "zenmux": {
      const zenmux = createOpenAICompatible({
        name: "zenmux",
        baseURL: ZENMUX_BASE_URL,
        apiKey: env.zenmuxApiKey,
        supportsStructuredOutputs: true,
      });
      return { model: zenmux.chatModel(env.llmModel), id: env.llmModel };
    }
    case "zhida": {
      const zhida = createOpenAICompatible({
        name: "zhida",
        baseURL: `${ZHIHU_OFFICIAL_BASE_URL}/v1`,
        apiKey: env.zhihuAccessSecret,
        headers: { "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)) },
      });
      return { model: zhida.chatModel(zhidaModel), id: zhidaModel };
    }
    case "mock":
      return null;
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

export function isLlmLive(): boolean {
  return resolveProvider() !== "mock";
}

export function describeLlm(): { provider: LlmProvider; model: string } {
  const provider = resolveProvider();
  switch (provider) {
    case "zenmux":
      return { provider, model: env.llmModel };
    case "zhida":
      return { provider, model: "zhida-fast-1p5" };
    case "mock":
      return { provider, model: "rules" };
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

/** 从模型文本中尽力抠出 JSON（兼容 ```json 代码块与前后废话） */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no json found");
  const trimmed = candidate.slice(start);
  const closer = trimmed[0] === "[" ? "]" : "}";
  const end = trimmed.lastIndexOf(closer);
  return JSON.parse(end === -1 ? trimmed : trimmed.slice(0, end + 1));
}

/** 单次模型调用默认上限：网关挂起时退到规则回退，而不是让整个 feed 构建卡死 */
export const LLM_TIMEOUT_MS = 25_000;

/** AbortSignal.timeout 触发的是 TimeoutError；超时后再用文本模式重跑只会让等待翻倍 */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timed? ?out|aborted/i.test(error.message));
}

export async function llmObject<T>(call: ObjectCall<T>): Promise<LlmCallResult<T>> {
  const provider = resolveProvider(call.provider);
  const built = buildModel(provider);
  if (!built) {
    return { value: call.fallback(), provider: "mock", model: "rules", live: false };
  }
  const timeoutMs = call.timeoutMs ?? LLM_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  try {
    const result = await generateObject({
      model: built.model,
      schema: call.schema,
      system: call.system,
      prompt: call.prompt,
      temperature: call.temperature ?? 0.2,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return { value: result.object, provider, model: built.id, live: true };
  } catch (objectError) {
    if (isTimeoutError(objectError)) {
      return { value: call.fallback(), provider, model: built.id, live: false, error: `timeout after ${timeoutMs}ms` };
    }
    // 两种请求方式共享本次调用的时间预算，不能让格式回退把等待翻倍。
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { value: call.fallback(), provider, model: built.id, live: false, error: `timeout after ${timeoutMs}ms` };
    // 有些 OpenAI 兼容网关不支持 json schema 模式，退化为文本 + 手动解析
    try {
      const jsonSchema = JSON.stringify(z.toJSONSchema(call.schema));
      const result = await generateText({
        model: built.model,
        system: `${call.system ?? ""}\n\n只输出一个符合以下 JSON Schema 的 JSON 对象，不要输出任何解释或代码块：\n${jsonSchema}`.trim(),
        prompt: call.prompt,
        temperature: call.temperature ?? 0.2,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(remainingMs),
      });
      const parsed = call.schema.parse(extractJson(result.text));
      return { value: parsed, provider, model: built.id, live: true };
    } catch (textError) {
      const message = [objectError, textError]
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join(" | ");
      return { value: call.fallback(), provider, model: built.id, live: false, error: message };
    }
  }
}

export async function llmText(call: TextCall): Promise<LlmCallResult<string>> {
  const provider = resolveProvider(call.provider);
  const built = buildModel(provider);
  if (!built) {
    return { value: call.fallback(), provider: "mock", model: "rules", live: false };
  }
  try {
    const result = await generateText({
      model: built.model,
      system: call.system,
      prompt: call.prompt,
      temperature: call.temperature ?? 0.4,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(call.timeoutMs ?? LLM_TIMEOUT_MS),
    });
    const text = result.text.trim();
    if (!text) throw new Error("empty response");
    return { value: text, provider, model: built.id, live: true };
  } catch (error) {
    return {
      value: call.fallback(),
      provider,
      model: built.id,
      live: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
