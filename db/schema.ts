import { sql } from "drizzle-orm";
import type { DetectionResult } from "@/lib/ai-detection/types";
import type { DailyBrief } from "@/lib/feed/types";
import type { SourceSnapshot, EvidenceRef, TopicDossier, InquiryView, ReflectionVersion } from "@/lib/cognition/types";
import type { CapturePayload, CaptureResult } from "@/lib/extension/contract";
import type { ExtractionOutcome } from "@/lib/ingest/extract";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/** Public source material and immutable, versioned evidence analysis. */
export const sourceSnapshots = sqliteTable("source_snapshots", {
  id: text("id").primaryKey(), contentId: text("content_id").notNull(), hash: text("hash").notNull(),
  payload: text("payload", { mode: "json" }).$type<SourceSnapshot>().notNull(),
}, (t) => [uniqueIndex("source_snapshot_version_idx").on(t.contentId, t.hash)]);
export const dossierArtifacts = sqliteTable("dossier_artifacts", {
  id: text("id").primaryKey(), cacheKey: text("cache_key").notNull().unique(),
  payload: text("payload", { mode: "json" }).$type<TopicDossier>().notNull(), createdAt: integer("created_at").notNull(),
});
export const dossierJobs = sqliteTable("dossier_jobs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topicKey: text("topic_key").notNull(), topic: text("topic").notNull(), status: text("status").notNull(),
  stage: text("stage").notNull(), lease: text("lease").notNull(), error: text("error"),
  sourceIds: text("source_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  evidence: text("evidence", { mode: "json" }).$type<EvidenceRef[]>().notNull().default([]),
  artifactId: text("artifact_id").references(() => dossierArtifacts.id),
  updatedAt: integer("updated_at").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("dossier_job_user_topic_idx").on(t.userId, t.topicKey)]);
export const dossierAccess = sqliteTable("dossier_access", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull().references(() => dossierJobs.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull().references(() => dossierArtifacts.id),
}, (t) => [primaryKey({ columns: [t.userId, t.jobId, t.artifactId] })]);
export const inquiries = sqliteTable("inquiries", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(), revision: integer("revision").notNull(),
  payload: text("payload", { mode: "json" }).$type<InquiryView>().notNull(), updatedAt: integer("updated_at").notNull(),
});
export const inquiryOperations = sqliteTable("inquiry_operations", {
  id: text("id").primaryKey(), inquiryId: text("inquiry_id").notNull().references(() => inquiries.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(), result: text("result", { mode: "json" }).$type<InquiryView>().notNull(),
});
export const reflections = sqliteTable("reflections", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull().references(() => dossierJobs.id), topic: text("topic").notNull(),
  following: integer("following", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [index("reflection_user_idx").on(t.userId, t.updatedAt)]);
export const reflectionVersions = sqliteTable("reflection_versions", {
  reflectionId: text("reflection_id").notNull().references(() => reflections.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), requestId: text("request_id").notNull(), inputHash: text("input_hash").notNull(),
  payload: text("payload", { mode: "json" }).$type<ReflectionVersion>().notNull(),
}, (t) => [primaryKey({ columns: [t.reflectionId, t.version] }), uniqueIndex("reflection_request_idx").on(t.reflectionId, t.requestId)]);
export const contentFeedback = sqliteTable("content_feedback", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contentId: text("content_id").notNull(), kind: text("kind").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.contentId] })]);

/** 登录用户。demo 中一个浏览器 cookie 对应一个用户。 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  headline: text("headline"),
  /** 知乎 url_token，模拟 OAuth 或输入得到 */
  zhihuUrlToken: text("zhihu_url_token"),
  /** 已验证的登录邮箱（小写），邮箱验证码或 Google 登录写入 */
  email: text("email"),
  /** demo | zhihu_self | zhihu_token | zhihu_oauth | mcp | email | google */
  loginSource: text("login_source").notNull().default("demo"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

/** 采集到的对话记录（已做隐私过滤后的文本） */
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** paste | mcp | persona | zhihu_follow */
    source: text("source").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    redactedCount: integer("redacted_count").notNull().default(0),
    /** 规范化正文的 sha256，同一用户同一段对话只采集一次 */
    contentHash: text("content_hash"),
    platform: text("platform"),
    externalId: text("external_id"),
    sourceUrl: text("source_url"),
    capturedAt: integer("captured_at"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    processedAt: integer("processed_at", { mode: "timestamp" }),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.createdAt), index("conversations_hash_idx").on(t.userId, t.contentHash),
    uniqueIndex("conversations_external_idx").on(t.userId, t.platform, t.externalId)],
);

/** Only redacted snapshots are persisted, including pending/failed captures. */
export const captureJobs = sqliteTable("capture_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantId: text("grant_id").notNull().references(() => connectorGrants.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  payload: text("payload", { mode: "json" }).$type<CapturePayload>().notNull(),
  redactedCount: integer("redacted_count").notNull().default(0),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("等待分析"),
  result: text("result", { mode: "json" }).$type<CaptureResult>(),
  checkpoint: text("checkpoint", { mode: "json" }).$type<{ signature: string; cursor: number; outcomes: ExtractionOutcome[] }>(),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("capture_jobs_snapshot_idx").on(t.userId, t.platform, t.externalId, t.snapshotHash),
  index("capture_jobs_user_idx").on(t.userId, t.status)]);

export const captureMessages = sqliteTable("capture_messages", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  contentHash: text("content_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.messageId, t.contentHash] })]);

/** A short per-user lease serializes delta extraction across tabs/processes. */
export const captureWorkers = sqliteTable("capture_workers", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** Durable refresh request: an in-progress Feed must not swallow a new profile. */
export const captureFeedRefreshes = sqliteTable("capture_feed_refreshes", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("pending"),
  token: text("token"),
  leaseExpiresAt: integer("lease_expires_at"),
});

/** 兴趣画像中的话题 */
export const interestTopics = sqliteTable(
  "interest_topics",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 0-1 归一化权重 */
    weight: real("weight").notNull().default(0),
    /** 原始累计分（频次 × 深度），衰减后归一化为 weight */
    rawScore: real("raw_score").notNull().default(0),
    hits: integer("hits").notNull().default(1),
    /** JSON string[] */
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** JSON string[] 用户提出过的问题 */
    questions: text("questions", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** JSON string[] 证据句（脱敏后），用于推荐理由 */
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** JSON string[] 适合知乎搜索的检索词 */
    searchQueries: text("search_queries", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** 公共讨论中是否存在对立观点 */
    controversial: integer("controversial", { mode: "boolean" }).notNull().default(false),
    /** 用户在该话题上表现出的立场倾向：pro | con | neutral | null */
    stance: text("stance"),
    /** 立场的自然语言描述，例如「倾向于认为考研比就业更稳妥」 */
    stanceLabel: text("stance_label"),
    /** conversation | zhihu_follow | mixed */
    source: text("source").notNull().default("conversation"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().default(now),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("interest_topics_user_name_idx").on(t.userId, t.name),
    index("interest_topics_user_weight_idx").on(t.userId, t.weight),
  ],
);

/** 知乎内容缓存：搜索结果 + 摘要，跨用户共享 */
export const contentCache = sqliteTable(
  "content_cache",
  {
    contentId: text("content_id").primaryKey(),
    /** official | justone | fixture */
    provider: text("provider").notNull(),
    /** answer | article | question | hot */
    type: text("type").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    sourceText: text("source_text"),
    sourceHash: text("source_hash"),
    sourceProvider: text("source_provider"),
    sourceFetchedAt: integer("source_fetched_at", { mode: "timestamp" }),
    sourceTruncated: integer("source_truncated", { mode: "boolean" }),
    url: text("url").notNull(),
    authorName: text("author_name"),
    authorAvatar: text("author_avatar"),
    voteUp: integer("vote_up").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    thumbnailUrl: text("thumbnail_url"),
    /** 命中的检索词 */
    query: text("query"),
    summary: text("summary"),
    summaryModel: text("summary_model"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("content_cache_query_idx").on(t.query)],
);

/** 每日 feed 条目 */
export const feedItems = sqliteTable(
  "feed_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    position: integer("position").notNull(),
    /** main | light | perspective */
    kind: text("kind").notNull(),
    contentId: text("content_id").references(() => contentCache.contentId),
    topicId: text("topic_id").references(() => interestTopics.id, { onDelete: "set null" }),
    topicName: text("topic_name"),
    reason: text("reason").notNull().default(""),
    /** perspective 卡片的完整载荷 */
    payload: text("payload", { mode: "json" }),
    /** 用户用自然语言要求改写后的摘要（按用户覆盖，不动共享的 content_cache.summary） */
    summaryOverride: text("summary_override"),
    /** 改写依据：用户原话或触发的长期规则，卡片上展示 */
    overrideNote: text("override_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("feed_items_user_date_idx").on(t.userId, t.date, t.position)],
);

/** 用户对 Feed 的自然语言要求：话题增减 / 屏蔽与长期规则。构建时读取，画像重算不会覆盖。 */
export const feedDirectives = sqliteTable(
  "feed_directives",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** topic | rule */
    kind: text("kind").notNull(),
    /** kind=topic 时为画像中的规范话题名 */
    topic: text("topic"),
    /** more | less | mute */
    direction: text("direction"),
    /** 展示给用户与模型的一句话 */
    text: text("text").notNull(),
    /** 用户原话 */
    sourceText: text("source_text").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("feed_directives_user_idx").on(t.userId, t.createdAt)],
);

/** 已看过的内容，避免重复推送 */
export const seenItems = sqliteTable(
  "seen_items",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: text("content_id").notNull(),
    seenAt: integer("seen_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentId] })],
);

/** 多元视角分析缓存：按话题共享，不对每个用户重复调用直答 */
export const perspectiveCache = sqliteTable("perspective_cache", {
  /** 归一化话题名 */
  topicKey: text("topic_key").primaryKey(),
  topicName: text("topic_name").notNull(),
  /** 争议焦点问题 */
  question: text("question").notNull(),
  isControversial: integer("is_controversial", { mode: "boolean" }).notNull().default(false),
  /** JSON PerspectiveStance[] */
  stances: text("stances", { mode: "json" }).notNull().default([]),
  /** 中立分析（直答或 LLM 生成） */
  analysis: text("analysis"),
  model: text("model"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

/** 每次 feed 生成的运行记录，用于 UI 展示数据源与用量 */
export const feedRuns = sqliteTable("feed_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  /** official | justone | fixture | mixed */
  sourceUsed: text("source_used").notNull(),
  llmUsed: text("llm_used").notNull(),
  stats: text("stats", { mode: "json" }).notNull().default({}),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

/** 每日 feed 后台构建的状态行：一个用户一天一行，供前端轮询真实进度 */
export const feedBuilds = sqliteTable(
  "feed_builds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    /** queued | running | ready | error */
    status: text("status").notNull(),
    /** allocate | search | enrich | persist | done */
    stage: text("stage"),
    stageIndex: integer("stage_index").notNull().default(0),
    stageTotal: integer("stage_total").notNull().default(0),
    /** 当前阶段的补充说明，例如正在检索的话题名 */
    detail: text("detail"),
    error: text("error"),
    force: integer("force", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [uniqueIndex("feed_builds_user_date_idx").on(t.userId, t.date)],
);

/** 每日简报：页面头部与语音向导共用，一人一天一行；Feed 强制重建时删除 */
export const dailyBriefs = sqliteTable(
  "daily_briefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    payload: text("payload", { mode: "json" }).$type<DailyBrief>().notNull(),
    /** 生成简报的模型；规则回退为 rules */
    model: text("model").notNull().default("rules"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/** 本地 API 调用计数（官方额度仍以 /api/v1/quota 为准） */
export const apiUsage = sqliteTable(
  "api_usage",
  {
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    date: text("date").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.endpoint, t.date] })],
);

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type InterestTopic = typeof interestTopics.$inferSelect;
export type ContentCacheRow = typeof contentCache.$inferSelect;
export type FeedItem = typeof feedItems.$inferSelect;
export type FeedDirectiveRow = typeof feedDirectives.$inferSelect;
export type PerspectiveCacheRow = typeof perspectiveCache.$inferSelect;
export type FeedRun = typeof feedRuns.$inferSelect;
export type FeedBuild = typeof feedBuilds.$inferSelect;
export type DailyBriefRow = typeof dailyBriefs.$inferSelect;

/** 正文快照与检测结果不可变；同一版本的内容只提交一次。时间戳均为毫秒。 */
export const detectionJobs = sqliteTable("detection_jobs", {
  id: text("id").primaryKey(),
  contentId: text("content_id").notNull().references(() => contentCache.contentId),
  textHash: text("text_hash").notNull(),
  model: text("model").notNull(),
  processingVersion: text("processing_version").notNull(),
  status: text("status").notNull(),
  taskId: text("task_id"),
  sourceText: text("source_text").notNull(),
  sourceProvider: text("source_provider").notNull(),
  sourceFetchedAt: integer("source_fetched_at"),
  sourceTruncated: integer("source_truncated", { mode: "boolean" }),
  result: text("result", { mode: "json" }).$type<DetectionResult>(),
  errorCode: text("error_code"),
  createdAt: integer("created_at").notNull(),
  checkedAt: integer("checked_at"),
  nextPollAt: integer("next_poll_at").notNull().default(0),
  pollLease: text("poll_lease"),
}, (t) => [uniqueIndex("detection_content_version_idx").on(t.contentId, t.textHash, t.model, t.processingVersion).where(sql`${t.status} <> 'rejected'`)]);

/** 保守预留账本，不冒充供应商账单；结果不明或已提交的费用不会释放。 */
export const detectionReservations = sqliteTable("detection_reservations", {
  jobId: text("job_id").primaryKey().references(() => detectionJobs.id),
  userId: text("user_id").notNull().references(() => users.id),
  cents: integer("cents").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("detection_reservation_time_idx").on(t.createdAt), index("detection_reservation_user_idx").on(t.userId, t.createdAt)]);

/** 所有进程共用的请求节流门。 */
export const requestGates = sqliteTable("request_gates", {
  key: text("key").primaryKey(),
  nextAt: integer("next_at").notNull(),
});

export const authCredentials = sqliteTable("auth_credentials", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  label: text("label").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [index("auth_credentials_user_idx").on(t.userId, t.kind)]);

export const oauthTransactions = sqliteTable("oauth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  returnTo: text("return_to"),
});

/** 外部身份绑定：(provider, subject) 唯一对应一个用户。公开模式只接受有身份绑定的会话。 */
export const oauthIdentities = sqliteTable("oauth_identities", {
  /** zhihu | google | email */
  provider: text("provider").notNull().default("zhihu"),
  subject: text("subject").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** 身份提供方报告的已验证邮箱（仅作参考） */
  email: text("email"),
  createdAt: integer("created_at").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.provider, t.subject] }), index("oauth_identities_user_idx").on(t.userId)]);

/** 邮箱一次性登录码；只存哈希，绑定发起浏览器。 */
export const loginCodes = sqliteTable("login_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  browserHash: text("browser_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
}, (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)]);

/** Connector OAuth uses separate grants and credentials from browser sessions and manual keys. */
export const connectorClients = sqliteTable("connector_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  authMethod: text("auth_method").notNull(),
  grantTypes: text("grant_types", { mode: "json" }).$type<string[]>().notNull(),
  secretHash: text("secret_hash"),
  createdAt: integer("created_at").notNull(),
  /** CIMD 客户端（id 为 https URL）的元数据缓存到期时间；动态注册的客户端为 null */
  metadataExpiresAt: integer("metadata_expires_at"),
});

export const connectorRequests = sqliteTable("connector_requests", {
  requestHash: text("request_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  clientId: text("client_id").notNull().references(() => connectorClients.id),
  redirectUri: text("redirect_uri").notNull(),
  state: text("state"),
  challenge: text("challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
});

export const connectorGrants = sqliteTable("connector_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => connectorClients.id),
  scope: text("scope").notNull(),
  resource: text("resource").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  /** 用户在同意页或连接管理里为该客户端开启的自动采集；默认关闭 */
  autoIngest: integer("auto_ingest", { mode: "boolean" }).notNull().default(false),
}, (t) => [index("connector_grants_user_idx").on(t.userId)]);

export const connectorCredentials = sqliteTable("connector_credentials", {
  tokenHash: text("token_hash").primaryKey(),
  grantId: text("grant_id").notNull().references(() => connectorGrants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  redirectUri: text("redirect_uri"),
  challenge: text("challenge"),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
}, (t) => [index("connector_credentials_grant_idx").on(t.grantId)]);
