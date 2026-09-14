// 把私有仓库的 HEAD 导出为公开仓库（默认 ../openzhiprism）：
//   git archive HEAD → 剔除 denylist → 叠加 release/public-overlay/ → 密钥扫描 → typecheck + test → commit。
// 私有仓库是唯一事实来源，公开仓库只接收导出提交，历史里永远没有 JustOne 适配器与素材。
// 用法：pnpm export:public [--no-verify] [--allow-dirty]
//   环境变量：PUBLIC_DIR 覆盖目标目录；EXPORT_REF 覆盖导出的提交（默认 HEAD）。
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const PUBLIC_DIR = path.resolve(ROOT, process.env.PUBLIC_DIR ?? "../openzhiprism");
const OVERLAY = path.join(ROOT, "release/public-overlay");
const REF = process.env.EXPORT_REF ?? "HEAD";

/** 以这些前缀开头（目录）或完全相等（文件）的路径不进公开仓库 */
const DENY = ["release/", ".claude/", "data/skills/", "docs/PRODUCT.v1.md"];
/** 目标目录清空时保留的条目 */
const KEEP = new Set([".git", "node_modules"]);
/** 密钥扫描：只看这些名字模式的环境变量值 */
const SECRET_KEY = /SECRET|TOKEN|KEY|PASSWORD|AUTH|_ID$/i;

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function git(argv, cwd = ROOT, options = {}) {
  return execFileSync("git", argv, { cwd, encoding: "utf8", ...options });
}

function run(cmd, argv, cwd) {
  console.log(`\n$ ${cmd} ${argv.join(" ")}   (${path.relative(ROOT, cwd) || "."})`);
  const result = spawnSync(cmd, argv, { cwd, stdio: "inherit" });
  if (result.status !== 0) fail(`${cmd} ${argv.join(" ")} 失败（exit ${result.status}）`);
}

function isDenied(relPath) {
  return DENY.some((rule) => (rule.endsWith("/") ? relPath.startsWith(rule) : relPath === rule));
}

// ── 1. 私有仓库状态 ──────────────────────────────────────
const head = git(["rev-parse", REF]).trim();
const dirty = git(["status", "--porcelain"]).trim();
if (dirty) {
  if (!args.has("--allow-dirty")) {
    fail(`工作区有未提交改动，导出只取 ${REF}（${head.slice(0, 7)}）。先提交，或加 --allow-dirty 明确只导出 HEAD。`);
  }
  console.warn(`! 工作区有未提交改动，只导出 ${REF} ${head.slice(0, 7)}`);
}

// ── 2. 清空目标目录并解包 HEAD ───────────────────────────
mkdirSync(PUBLIC_DIR, { recursive: true });
for (const entry of readdirSync(PUBLIC_DIR)) {
  if (!KEEP.has(entry)) rmSync(path.join(PUBLIC_DIR, entry), { recursive: true, force: true });
}
const archive = git(["archive", "--format=tar", head], ROOT, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
const untar = spawnSync("tar", ["-x", "-C", PUBLIC_DIR], { input: archive });
if (untar.status !== 0) fail(`tar 解包失败：${untar.stderr}`);

// ── 3. 剔除 denylist ─────────────────────────────────────
const tracked = git(["ls-tree", "-r", "--name-only", head]).split("\n").filter(Boolean);
const removed = tracked.filter(isDenied);
for (const rel of removed) rmSync(path.join(PUBLIC_DIR, rel), { recursive: true, force: true });
for (const rule of DENY) {
  if (rule.endsWith("/")) rmSync(path.join(PUBLIC_DIR, rule), { recursive: true, force: true });
}
console.log(`剔除 ${removed.length} 个路径：\n  ${removed.join("\n  ")}`);

// ── 4. 叠加公开版本替换文件 ──────────────────────────────
if (!existsSync(OVERLAY)) fail(`缺少 overlay 目录 ${OVERLAY}`);
cpSync(OVERLAY, PUBLIC_DIR, { recursive: true });
const overlayFiles = [];
(function walk(dir, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    else overlayFiles.push(rel);
  }
})(OVERLAY);
console.log(`叠加 ${overlayFiles.length} 个 overlay 文件：\n  ${overlayFiles.join("\n  ")}`);

// ── 5. 初始化 / 暂存公开仓库 ─────────────────────────────
if (!existsSync(path.join(PUBLIC_DIR, ".git"))) {
  git(["init", "-b", "main"], PUBLIC_DIR);
  console.log(`已在 ${PUBLIC_DIR} 初始化公开仓库`);
}
git(["add", "-A"], PUBLIC_DIR);

// ── 6. 密钥扫描（针对暂存区）────────────────────────────
const secrets = [];
for (const file of [".env.local", ".env.production.local"]) {
  const envPath = path.join(ROOT, file);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (SECRET_KEY.test(key) && value.length >= 8) secrets.push({ key, value, file });
  }
}
for (const { key, value, file } of secrets) {
  const hit = spawnSync("git", ["grep", "--cached", "-qF", "--", value], { cwd: PUBLIC_DIR });
  if (hit.status === 0) {
    git(["reset", "-q"], PUBLIC_DIR);
    fail(`公开仓库里出现了 ${file} 中 ${key} 的值，已撤销暂存。请先从源码里移除。`);
  }
}
const patterns = ["sk-[A-Za-z0-9]{20,}", "AKIA[0-9A-Z]{16}", "ghp_[A-Za-z0-9]{30,}", "xox[bp]-[A-Za-z0-9-]{20,}"];
for (const pattern of patterns) {
  const hit = spawnSync("git", ["grep", "--cached", "-nE", "--", pattern, ":!pnpm-lock.yaml"], { cwd: PUBLIC_DIR, encoding: "utf8" });
  if (hit.status === 0) {
    git(["reset", "-q"], PUBLIC_DIR);
    fail(`疑似密钥（/${pattern}/）：\n${hit.stdout}`);
  }
}
console.log(`密钥扫描通过（${secrets.length} 个环境变量值 + ${patterns.length} 个通用模式）`);

const leftovers = removed.filter((rel) => existsSync(path.join(PUBLIC_DIR, rel)));
if (leftovers.length > 0) fail(`denylist 路径仍在目标目录：${leftovers.join(", ")}`);

// ── 7. 验证 ──────────────────────────────────────────────
if (!args.has("--no-verify")) {
  run("pnpm", ["install", "--frozen-lockfile"], PUBLIC_DIR);
  run("pnpm", ["typecheck"], PUBLIC_DIR);
  run("pnpm", ["test"], PUBLIC_DIR);
}

// ── 8. 提交 ──────────────────────────────────────────────
const staged = git(["status", "--porcelain"], PUBLIC_DIR).trim();
if (!staged) {
  console.log(`\n公开仓库与 ${REF} 一致，无需提交。`);
} else {
  const date = new Date().toISOString().slice(0, 10);
  git(["commit", "-q", "-m", `export: ${head.slice(0, 7)} (${date})`], PUBLIC_DIR);
  console.log(`\n✓ 已提交 export: ${head.slice(0, 7)} → ${PUBLIC_DIR}`);
}
console.log(`\n下一步（手动）：\n  cd ${PUBLIC_DIR}\n  git remote add origin <公开仓库地址>   # 首次\n  git push -u origin main`);
