import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import type { FeedBuild } from "@/db/schema";
import { writeTransaction } from "@/lib/security/transaction";
import { todayKey } from "@/lib/zhihu/text";
import { buildDailyFeed, getFeed } from "./build";
import type { BuildFeedOptions, BuildProgress, FeedBuildView, FeedView } from "./types";

/**
 * 每日 Feed 的后台构建：一个用户一天一行 feed_builds，前端轮询这一行拿真实进度。
 * 同一进程内用 globalThis 上的 Map 共享正在跑的 Promise（HMR 安全），跨进程以数据库行为准。
 */

/** 状态行超过这个时间没有更新就视为中断（进程被杀等），允许重新发起 */
export const BUILD_STALE_MS = 120_000;
/** 前端轮询间隔 */
export const BUILD_POLL_MS = 1500;
const STALE_MESSAGE = "生成中断了，请重试。";

export type FeedBuilder = (userId: string, options: BuildFeedOptions) => Promise<FeedView>;

export interface StartBuildOptions {
  date?: string;
  force?: boolean;
  mainCount?: number;
}

export interface StartBuildDeps {
  builder?: FeedBuilder;
  database?: Db;
  now?: () => number;
}

export interface StartBuildResult {
  build: FeedBuildView;
  /** 构建完成后解析为最新 feed；失败时 reject */
  promise: Promise<FeedView>;
  /** 本次调用是否真的发起了新构建（false = 复用了正在跑的那次） */
  started: boolean;
}

const globalForBuilds = globalThis as unknown as { __zhiprismBuilds?: Map<string, Promise<FeedView>> };
function inflight(): Map<string, Promise<FeedView>> {
  return (globalForBuilds.__zhiprismBuilds ??= new Map());
}
const keyOf = (userId: string, date: string) => `${userId}:${date}`;

function isActive(row: FeedBuild, now: number): boolean {
  return (row.status === "queued" || row.status === "running") && now - row.updatedAt <= BUILD_STALE_MS;
}

export function buildView(row: FeedBuild, now = Date.now()): FeedBuildView {
  const stale = (row.status === "queued" || row.status === "running") && !isActive(row, now);
  return {
    status: stale ? "error" : (row.status as FeedBuildView["status"]),
    stage: (row.stage as FeedBuildView["stage"]) ?? null,
    stageIndex: row.stageIndex,
    stageTotal: row.stageTotal,
    detail: row.detail,
    error: stale ? STALE_MESSAGE : row.error,
    updatedAt: new Date(row.updatedAt).toISOString(),
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  };
}

async function readRow(database: Db, userId: string, date: string): Promise<FeedBuild | undefined> {
  const [row] = await database
    .select()
    .from(schema.feedBuilds)
    .where(and(eq(schema.feedBuilds.userId, userId), eq(schema.feedBuilds.date, date)))
    .limit(1);
  return row;
}

export async function getBuildStatus(userId: string, date = todayKey(), database?: Db, now = Date.now()): Promise<FeedBuildView | null> {
  const row = await readRow(database ?? (await db()), userId, date);
  return row ? buildView(row, now) : null;
}

/** 等待数据库里的构建行离开 active 状态（用于别的进程正在构建的情况） */
async function waitForRow(database: Db, userId: string, date: string, now: () => number): Promise<FeedView> {
  const deadline = now() + BUILD_STALE_MS;
  while (now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
    const row = await readRow(database, userId, date);
    if (!row || !isActive(row, now())) {
      if (row?.status === "error") throw new Error(row.error ?? "生成失败");
      if (row && row.status !== "ready") throw new Error(STALE_MESSAGE);
      return getFeed(userId, date);
    }
  }
  throw new Error(STALE_MESSAGE);
}

/**
 * 发起（或复用）当日 feed 构建。立即返回状态行 + 完成 Promise；调用方决定是否 await。
 * 在 Route Handler 里请用 `after(() => promise.catch(() => undefined))` 保证请求返回后构建继续跑。
 */
export async function startFeedBuild(userId: string, options: StartBuildOptions = {}, deps: StartBuildDeps = {}): Promise<StartBuildResult> {
  const database = deps.database ?? (await db());
  const builder = deps.builder ?? buildDailyFeed;
  const now = deps.now ?? Date.now;
  const date = options.date ?? todayKey();
  const key = keyOf(userId, date);

  const claimed = await writeTransaction(database, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.feedBuilds)
      .where(and(eq(schema.feedBuilds.userId, userId), eq(schema.feedBuilds.date, date)))
      .limit(1);
    const at = now();
    if (existing && isActive(existing, at)) return { row: existing, started: false as const };
    const row: FeedBuild = {
      id: existing?.id ?? randomUUID(),
      userId,
      date,
      status: "queued",
      stage: null,
      stageIndex: 0,
      stageTotal: 0,
      detail: null,
      error: null,
      force: options.force ?? false,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    };
    await tx
      .insert(schema.feedBuilds)
      .values(row)
      .onConflictDoUpdate({ target: [schema.feedBuilds.userId, schema.feedBuilds.date], set: { ...row, id: row.id } });
    return { row, started: true as const };
  });

  if (!claimed.started) {
    const promise = inflight().get(key) ?? waitForRow(database, userId, date, now);
    return { build: buildView(claimed.row, now()), promise, started: false };
  }

  const patch = async (values: Partial<typeof schema.feedBuilds.$inferInsert>) => {
    await writeTransaction(database, async (tx) => {
      await tx.update(schema.feedBuilds).set({ ...values, updatedAt: now() }).where(eq(schema.feedBuilds.id, claimed.row.id));
    });
  };
  const onProgress = async (event: BuildProgress) => {
    await patch({ status: "running", stage: event.stage, stageIndex: event.index, stageTotal: event.total, detail: event.detail ?? null });
  };

  const run = async (): Promise<FeedView> => {
    try {
      await patch({ status: "running" });
      const feed = await builder(userId, { date, force: options.force, mainCount: options.mainCount, onProgress });
      await patch({ status: "ready", stage: "done", error: null, finishedAt: now() });
      return feed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await patch({ status: "error", error: message, finishedAt: now() }).catch(() => undefined);
      throw error;
    }
  };
  const promise = run();
  inflight().set(key, promise);
  // 没人 await 时也不要变成 unhandled rejection；调用方仍可自行 await 拿到错误
  promise
    .finally(() => { if (inflight().get(key) === promise) inflight().delete(key); })
    .catch(() => undefined);

  return { build: buildView(claimed.row, now()), promise, started: true };
}
