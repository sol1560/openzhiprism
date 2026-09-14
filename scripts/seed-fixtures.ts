/**
 * 拉取真实知乎数据快照到 fixtures/zhihu/，让 demo 在无网络 / 无额度时也能完整运行。
 *
 * 用法：
 *   node --env-file=.env.local --import tsx scripts/seed-fixtures.ts            # 只补缺失的快照
 *   node --env-file=.env.local --import tsx scripts/seed-fixtures.ts --force    # 全部重拉
 *   node --env-file=.env.local --import tsx scripts/seed-fixtures.ts --source official
 *
 * 默认用 JustOne（按量计费、返回完整正文）；官方接口每日额度很小，只在显式指定时使用。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { justoneSearch, justoneUserFollowQuestions, justoneUserFollowTopics, justoneUserFollowees, justoneUserInfo, isJustoneConfigured } from "@/lib/zhihu/justone";
import { officialFollowees, officialHotList, officialSearch, isOfficialConfigured, remainingQuota } from "@/lib/zhihu/official";
import { normalizeQuery } from "@/lib/zhihu/text";
import type { HotItem, ZhihuFollowGraph, ZhihuItem } from "@/lib/zhihu/types";

const ROOT = path.resolve(process.cwd(), "fixtures", "zhihu");
const SEARCH_DIR = path.join(ROOT, "search");
const FOLLOW_DIR = path.join(ROOT, "follow-graph");

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const sourceArg = process.argv[process.argv.indexOf("--source") + 1];
const source: "justone" | "official" = sourceArg === "official" ? "official" : "justone";

interface PersonaFile {
  id: string;
  expectedTopics: string[];
}

/** 每个 persona 话题的中性检索词 + 正反方检索词（供「换个角度看」使用） */
const SEED_QUERIES: string[] = [
  // 林同学
  "考研还是直接工作",
  "为什么建议先工作再考研",
  "为什么建议考研而不是先工作",
  "考研人数下降 性价比",
  "Python 数据分析 学习路线",
  "pandas 入门 实战项目",
  "数据分析实习 简历",
  "SQL 窗口函数 面试",
  "第一次租房 合同 注意事项",
  "减脂 力量训练 新手",
  "健身房新手 三分化",
  "手冲咖啡 入门 器具",
  "V60 滤杯 新手",
  // 周产品
  "AI Agent 产品设计",
  "Agent 工具调用 用户确认 交互",
  "Agent 评测 指标",
  "RAG 效果优化 chunk",
  "RAG rerank 召回率",
  "AI 会取代程序员吗",
  "AI 不会取代程序员 理由",
  "AI 取代初级程序员 案例",
  "产品经理 会被 AI 取代吗",
  "大厂还是创业公司",
  "去创业公司 后悔",
  "大厂 稳定 值得去",
  "创业公司 期权 估值",
  "公路车入门 预算 8000",
  "105 套件 Tiagra 区别",
  "多智能体 过度设计",
  // 陈自由
  "远程办公 效率 专注",
  "深度工作 时间管理",
  "自由职业 收入不稳定",
  "自由职业者 社保 个体户",
  "回老家还是留在大城市",
  "留在大城市 机会 值得",
  "回老家 生活 幸福 远程工作",
  "小城市回不去 幸存者偏差",
  "三线城市 房价 还会跌吗",
  "独立开发者 变现 订阅 买断",
  "独立开发 出海 英文市场",
  "极简主义 断舍离 方法",
  "极简主义 消费主义",
  "半马 12 周 训练计划",
  "跑步 膝盖外侧疼 髂胫束",
];

function slugify(query: string): string {
  return normalizeQuery(query).replace(/\s+/g, "-");
}

async function saveJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function seedSearch(query: string): Promise<"skipped" | "saved" | "empty" | "failed"> {
  const file = path.join(SEARCH_DIR, `${slugify(query)}.json`);
  if (!force && existsSync(file)) return "skipped";
  try {
    let items: ZhihuItem[] = [];
    if (source === "official") {
      const remaining = await remainingQuota("zhihu_search");
      if (remaining !== null && remaining <= 1) {
        console.warn(`  官方搜索额度不足（剩 ${remaining}），跳过 ${query}`);
        return "failed";
      }
      items = await officialSearch(query);
    } else {
      items = await justoneSearch(query, { count: 20 });
    }
    if (items.length === 0) return "empty";
    await saveJson(file, { query, fetchedAt: new Date().toISOString(), source, items });
    return "saved";
  } catch (error) {
    console.warn(`  ${query} 失败：${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

async function seedHot() {
  const file = path.join(ROOT, "hot.json");
  if (!force && existsSync(file)) return console.log("热榜快照已存在，跳过");
  let items: HotItem[] = [];
  if (isOfficialConfigured()) {
    const remaining = await remainingQuota("hot_list");
    if (remaining !== null && remaining > 0) {
      try {
        items = await officialHotList(30);
        console.log(`热榜：官方接口取得 ${items.length} 条`);
      } catch (error) {
        console.warn(`热榜官方接口失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.warn(`热榜官方额度不足（剩 ${remaining}）`);
    }
  }
  if (items.length === 0 && isJustoneConfigured()) {
    const results = await justoneSearch("今日热议 知乎热榜", { count: 20 });
    items = results.map((item) => ({
      id: item.id.replace(/^[a-z]+:/, "hot:"),
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      thumbnailUrl: item.thumbnailUrl,
      provider: "justone" as const,
    }));
    console.log(`热榜：JustOne 搜索替代取得 ${items.length} 条`);
  }
  if (items.length > 0) await saveJson(file, items);
}

async function seedFollowGraph() {
  // 1) Access Secret 持有者本人的关注（官方接口，无需 OAuth）
  if (isOfficialConfigured()) {
    const file = path.join(FOLLOW_DIR, "self.json");
    if (force || !existsSync(file)) {
      try {
        const followees = await officialFollowees(50);
        const graph: ZhihuFollowGraph = { followees, topics: [], questions: [], provider: "official" };
        await saveJson(file, graph);
        console.log(`关注图谱：官方账号关注 ${followees.length} 人`);
      } catch (error) {
        console.warn(`官方关注列表失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // 2) 示例 url_token 的关注话题 / 问题（JustOne），用于「输入任意知乎账号」的冷启动演示
  if (isJustoneConfigured()) {
    for (const token of ["jzwa", "sylearn"]) {
      const file = path.join(FOLLOW_DIR, `${token}.json`);
      if (!force && existsSync(file)) continue;
      try {
        const [self, followees, topics, questions] = await Promise.allSettled([
          justoneUserInfo(token),
          justoneUserFollowees(token),
          justoneUserFollowTopics(token),
          justoneUserFollowQuestions(token),
        ]);
        const graph: ZhihuFollowGraph = {
          self: self.status === "fulfilled" ? self.value ?? undefined : undefined,
          followees: followees.status === "fulfilled" ? followees.value : [],
          topics: topics.status === "fulfilled" ? topics.value : [],
          // 该端点在部分账号上返回 API INVALID，失败时留空
          questions: questions.status === "fulfilled" ? questions.value : [],
          provider: "justone",
        };
        await saveJson(file, graph);
        console.log(
          `关注图谱：${token} 关注 ${graph.followees.length} 人、${graph.topics.length} 话题、${graph.questions.length} 问题`,
        );
      } catch (error) {
        console.warn(`JustOne 关注图谱 ${token} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function main() {
  console.log(`数据源：${source}${force ? "（强制重拉）" : ""}`);
  if (source === "justone" && !isJustoneConfigured()) throw new Error("JUSTONEAPI_TOKEN 未配置");
  if (source === "official" && !isOfficialConfigured()) throw new Error("ZHIHU_ACCESS_SECRET 未配置");

  const personaDir = path.resolve(process.cwd(), "fixtures", "personas");
  const personaTopics = new Set<string>();
  for (const name of ["lin-student", "zhou-pm", "chen-freelancer"]) {
    try {
      const persona = JSON.parse(await readFile(path.join(personaDir, `${name}.json`), "utf8")) as PersonaFile;
      persona.expectedTopics.forEach((topic) => personaTopics.add(topic));
    } catch {
      // persona 文件缺失不影响 seed
    }
  }
  const queries = [...new Set([...SEED_QUERIES, ...personaTopics])];

  const stats = { skipped: 0, saved: 0, empty: 0, failed: 0 };
  for (const [index, query] of queries.entries()) {
    const result = await seedSearch(query);
    stats[result] += 1;
    console.log(`[${index + 1}/${queries.length}] ${result.padEnd(7)} ${query}`);
  }
  console.log("搜索快照：", stats);

  await seedHot();
  await seedFollowGraph();
  console.log("完成。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
