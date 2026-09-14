export type LlmProvider = "zenmux" | "zhida" | "mock";
export type SourceStrategy = "auto" | "official" | "justone" | "fixture";

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = read(name);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const env = {
  get zhihuAccessSecret() {
    return read("ZHIHU_ACCESS_SECRET");
  },
  get zhihuOAuthAppKey() {
    return read("ZHIHU_OAUTH_APP_KEY");
  },
  get zhihuOAuthAppId() { return read("ZHIHU_OAUTH_APP_ID"); },
  get publicMode() { return process.env.NODE_ENV === "production" || read("APP_PUBLIC_MODE") === "true"; },
  get oauthContractVerified() { return read("ZHIHU_OAUTH_CONTRACT_VERIFIED") === "true"; },
  get oauthUserInfoUrl() { return read("ZHIHU_OAUTH_USERINFO_URL"); },
  get oauthSubjectPath() { return read("ZHIHU_OAUTH_SUBJECT_PATH"); },
  get oauthNamePath() { return read("ZHIHU_OAUTH_NAME_PATH"); },
  get pangramApiKey() { return read("PANGRAM_API_KEY"); },
  get detectionEnabled() { return read("AI_DETECTION_ENABLED") === "true"; },
  get detectionLimits() {
    const limit = (key: string, fallback: number) => {
      const raw = read(key);
      if (raw === undefined) return fallback;
      const value = Number(raw);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    return {
      perDay: limit("AI_DETECTION_USER_DAILY", 5),
      perMinute: limit("AI_DETECTION_USER_MINUTE", 2),
      dailyCents: limit("AI_DETECTION_DAILY_CENTS", 500),
      rollingCents: limit("AI_DETECTION_ROLLING_CENTS", 15000),
    };
  },
  get justoneToken() {
    return read("JUSTONEAPI_TOKEN");
  },
  get zenmuxApiKey() {
    return read("ZENMUX_API_KEY");
  },
  get llmProvider(): LlmProvider {
    return readEnum("LLM_PROVIDER", ["zenmux", "zhida", "mock"] as const, "mock");
  },
  get llmModel() {
    return read("LLM_MODEL") ?? "deepseek/deepseek-v4-flash";
  },
  get sourceStrategy(): SourceStrategy {
    return readEnum("ZHIHU_SOURCE", ["auto", "official", "justone", "fixture"] as const, "auto");
  },
  get databaseUrl() {
    return read("DATABASE_URL") ?? read("TURSO_DATABASE_URL") ?? "file:./data/zhiprism.db";
  },
  get appUrl() {
    return read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
  /** Session cookies are `secure` only when the app itself is served over https; `next start` on localhost keeps working. */
  get secureCookies() {
    try { return this.publicMode && new URL(this.appUrl).protocol === "https:"; } catch { return this.publicMode; }
  },
  get googleClientId() { return read("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return read("GOOGLE_CLIENT_SECRET"); },
  get resendApiKey() { return read("RESEND_API_KEY"); },
  get emailFrom() { return read("EMAIL_FROM") ?? "知棱 ZhiPrism <onboarding@resend.dev>"; },
  // 语音向导（ElevenLabs Agents）：API key 只在服务端换取 signed URL，agent 由 pnpm voice:sync 创建
  get elevenLabsApiKey() { return read("ELEVENLABS_API_KEY"); },
  get elevenLabsAgentId() { return read("ELEVENLABS_AGENT_ID"); },
  get elevenLabsVoiceId() { return read("ELEVENLABS_VOICE_ID"); },
  /** key 与 agent id 齐备即开启；VOICE_GUIDE_ENABLED=false 可临时隐藏面板 */
  get voiceGuideEnabled() { return read("VOICE_GUIDE_ENABLED") !== "false" && Boolean(this.elevenLabsApiKey && this.elevenLabsAgentId); },
};

export const ZHIHU_OFFICIAL_BASE_URL = "https://developer.zhihu.com";
export const ZHIHU_OAUTH_BASE_URL = "https://openapi.zhihu.com";
export const JUSTONE_BASE_URL = "https://api.justoneapi.com";
export const ZENMUX_BASE_URL = "https://zenmux.ai/api/v1";
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
