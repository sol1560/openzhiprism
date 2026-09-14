# 部署：Vercel + Turso + zhi.openmo.org

连接器地址 `https://zhi.openmo.org/api/mcp`。一个 Next.js 应用装全部（站点、OAuth 授权服务器、MCP 端点），数据库用 Turso（libSQL），代码已支持远程库与 `TURSO_*` 环境变量。

## 环境变量（Production 与 Preview）

| 变量 | 值 |
| --- | --- |
| `HEROUI_AUTH_TOKEN` | HeroUI Pro 的 CI/CD token（https://heroui.pro/dashboard 生成）。`@heroui-pro/react` 在 npm 上只是 4 个文件的壳，真正的组件由 postinstall 凭此 token 下载；没有它 Vercel 构建会报 `Can't resolve '@heroui-pro/react'`（2026-09-12 首次预览部署即因此失败）。`pnpm-workspace.yaml` 已允许该包的 build 脚本 |
| `NEXT_PUBLIC_APP_URL` | `https://zhi.openmo.org`，无路径无查询；首次生产部署前就设成最终域名，OAuth issuer 必须与之一致；浏览器写请求按同源校验，公开模式下要求 https |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Vercel Marketplace 的 Turso 集成自动注入（等价于 `DATABASE_URL` / `DATABASE_AUTH_TOKEN`） |
| `DATABASE_MIGRATE_ON_START` | 不设或 `false`：远程库不在请求期迁移 |
| `RESEND_API_KEY` / `EMAIL_FROM` | 已验证域名的发件人，见 [RESEND.md](RESEND.md)；缺少 key 时生产无法发验证码 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console 的回调填 `https://zhi.openmo.org/api/auth/google/callback` |
| `LLM_PROVIDER` / `LLM_MODEL` / `ZENMUX_API_KEY` | `zenmux` 与模型名，从 `.env.local` 复制 |
| `ZHIHU_ACCESS_SECRET` / `JUSTONEAPI_TOKEN` / `ZHIHU_SOURCE` | 内容源，`ZHIHU_SOURCE=auto` |
| `PANGRAM_API_KEY` / `AI_DETECTION_*` | 可选 |
| 不设 | `APP_PUBLIC_MODE`（production 自动进入公开模式）、`ZHIHU_OAUTH_*` |

## 步骤

1. `pnpm dlx vercel link`：选择 ailoras team，新建项目 `zhiprism`。`vercel.json` 已指定 Next.js、`pnpm install --frozen-lockfile`、`pnpm build`、区域 `iad1`（与 Turso 库同区）。
2. Vercel 控制台 → 项目 → Storage → Turso（Marketplace）→ 新建数据库（选离 hkg1 最近的区域）→ 连接到 `zhiprism`，两个 `TURSO_*` 变量随之注入。
3. `vercel env add <变量> production` 逐个写入上表其余变量（Preview 同样一份）。`HEROUI_AUTH_TOKEN` 必须在第一次成功构建前就位。
4. `vercel env pull .env.production.local && pnpm db:migrate`：对 Turso 应用全部迁移（含 `0006_cimd_clients`）。以后每次新增迁移都重复这一步。
5. `vercel deploy --prod`。
6. `vercel domains add zhi.openmo.org`；在 Cloudflare 给 `openmo.org` 加 `CNAME zhi → cname.vercel-dns.com`，**灰云（仅 DNS，不代理）**：避免双层 TLS、Cloudflare 100 秒代理超时和对 `/api/mcp` 流式响应的缓冲。把 `*.vercel.app` 别名设为重定向到正式域名，避免对错误 issuer 授权。
7. Google Cloud Console 加回调地址与 JS origin，发布同意屏。
8. `pnpm smoke:connector https://zhi.openmo.org`，再加 `--oauth` 在浏览器走一遍完整授权。
9. claude.ai 人工验收（下节）。

## 运维要点

- `app/api/mcp/route.ts` 与 `app/api/feed/route.ts` 的 `maxDuration = 300`：Feed 首次生成 20-40 秒，`after()` 里的后台构建只在该时限内运行。
- `next.config.ts` 的 `outputFileTracingIncludes` 把 `widgets/dist`（MCP Apps 卡片）、`drizzle`（应急迁移）、`fixtures/zhihu`（离线内容源）带进 serverless 产物。
- 若 Vercel 上 Turbopack 构建复现本地那次 CSS worker 端口被拒的失败，把 `vercel.json` 的 `buildCommand` 改成 `pnpm build --webpack`。
- **CLI 部署会被 git 作者邮箱拦截**：项目已关联 GitHub `sol1560/zhiprism`，`vercel deploy` 会附带本地 HEAD 的提交信息；当前提交作者邮箱是 `sol@zhiprism.local`，触发 Vercel「提交作者须为团队成员」保护，部署状态显示 Blocked 而 CLI 只报 `Not authorized`。解决：把 `git config user.email` 改成 GitHub 账号已验证邮箱后再提交并 push（走 Git 自动部署），或者从不含 `.git` 的工作树副本 `vercel deploy --prod --archive=tgz`（2026-09-13 首次上线即用此法）。
- Turso 库由 Marketplace 建在 `aws-us-east-1`，所以 `vercel.json` 区域用 `iad1` 让计算贴着数据库；上游知乎 / ZenMux 在亚洲，跨洋延迟落在上游调用上而不是每个请求的多次 DB 往返上。
- 回滚：Vercel 控制台 Promote 上一个部署；迁移全部是加列/建表，旧代码可直接跑在新库上。

## claude.ai 验收清单

1. 设置 → 连接器 → 添加自定义连接器：名称「知棱」，URL `https://zhi.openmo.org/api/mcp`，不填 client id / secret → 连接 → 落到 `/connect/authorize` → 邮箱验证码或 Google 登录 → 同意页标题「允许 Claude 连接知棱？」→ 回到 claude.ai 显示已连接。
2. Vercel 日志里 `GET /api/oauth/authorize` 的 `client_id` 应为 `https://claude.ai/oauth/mcp-oauth-client-metadata`（CIMD）；若为 `zp_client_…` 说明 Claude 回退到了 DCR，两条路都必须通，且不应出现 `invalid_client`。
3. 新对话 ＋ → 连接器 → 启用知棱 → 工具访问 → 已加载工具 → 发送「在 Claude 中试试」预填的自检提示 → 结果 `client: "Claude"`、`auth: "oauth"`；`/connect` 的「我的连接」显示已验证。
4. 「今天有什么值得看的」→ Feed 卡片渲染：亮/暗主题、中文字体、链接经宿主打开、「标记已读」翻转并在下次 `get_daily_feed` 中 `seen: true`；函数耗时在 Vercel 日志中 < 300 秒。
5. 读取兴趣画像、「在某个话题上换个角度」→ 画像与多元视角两张卡片；`get_status` 走通用结果视图。
6. 粘贴一段对话要求提交 → `ingest_conversation` 只在明确要求时执行，画像增长。
7. 一小时后 Claude 静默刷新（offline_access）；在 `/connect` 撤销后下一次调用失败并可重连，重连成功。
8. 可选：ChatGPT 开发者模式添加连接器，走 DCR 完成同一流程。
