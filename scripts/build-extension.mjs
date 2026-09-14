import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const nextRequire = createRequire(import.meta.resolve("next/package.json"));
const { loadEnvConfig } = nextRequire("@next/env");

const root = process.cwd(), dev = process.argv.includes("--dev");
loadEnvConfig(root, dev);
const configured = process.env.NEXT_PUBLIC_APP_URL;
const appUrl = new URL(process.env.EXTENSION_APP_URL ?? (dev ? (configured?.match(/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/) ? configured : "http://localhost:3000") : configured?.startsWith("https://") ? configured : "https://zhi.openmo.org"));
if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash ||
  (appUrl.protocol !== "https:" && !(dev && appUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(appUrl.hostname)))) throw new Error("Invalid extension application origin");
const source = path.join(root, "extensions/browser");
const output = path.join(source, "dist", dev ? "chrome-dev" : "chrome");
await mkdir(output, { recursive: true });
const manifest = {
  manifest_version: 3, name: dev ? "知棱 · 聊天捕捉（开发）" : "知棱 · 聊天捕捉", version: "0.1.1",
  minimum_chrome_version: "120",
  description: "点一下，捕捉当前 ChatGPT 或 Claude 聊天，导入知棱并更新兴趣画像。",
  permissions: ["activeTab", "scripting", "storage", "identity", "alarms"],
  host_permissions: [appUrl.origin + "/*"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_title: "导入当前聊天到知棱", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  options_ui: { page: "options.html", open_in_tab: true },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await build({ entryPoints: [path.join(source, "src/background.ts"), path.join(source, "src/options.ts")], outdir: output,
  bundle: true, format: "esm", platform: "browser", target: "chrome120", define: { __APP_URL__: JSON.stringify(appUrl.origin) }, legalComments: "eof" });
for (const name of ["options.html", "options.css", "THIRD_PARTY_NOTICES.md"]) await copyFile(path.join(source, name), path.join(output, name));
const sharp = nextRequire("sharp");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#fffdf8"/><path d="M16 3 29 27H3L16 3Z" fill="none" stroke="#accdec" stroke-width="2" stroke-linejoin="round"/><path d="M16 3 3 27h13" fill="none" stroke="#2878d0" stroke-width="2" stroke-linejoin="round"/><path d="M3 27 16 15l13 12" fill="none" stroke="#f4d47a" stroke-width="1.8" stroke-linejoin="round"/></svg>';
await mkdir(path.join(output, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(output, "icons", size + ".png"));
const archive = path.join(source, "dist", dev ? "zhiprism-chrome-dev.zip" : "zhiprism-chrome.zip");
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "."], { cwd: output });
await mkdir(path.join(root, "public/downloads"), { recursive: true });
await copyFile(archive, path.join(root, "public/downloads", dev ? "zhiprism-chrome-dev.zip" : "zhiprism-chrome.zip"));
if (!dev) {
  await writeFile(path.join(root, "public/downloads/extension-version.json"), JSON.stringify({ version: manifest.version, appUrl: appUrl.origin }) + "\n");
}
const built = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
if (built.action.default_popup || built.permissions.includes("cookies")) throw new Error("Unexpected capture permissions or popup");
console.log("Extension built: " + output + "\nArchive: " + archive + "\nTarget: " + appUrl.origin);
