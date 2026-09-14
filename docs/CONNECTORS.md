# 连接 AI

`/connect` 是公开的客户端接入指南，默认 Claude Connector；六个入口分别覆盖 Claude、ChatGPT、Claude Code、Codex、Cursor 和 Agent 框架。`?client=claude|chatgpt|claude-code|codex|cursor|sdk` 可直接选择入口。登录后可查看和撤销自己的授权。

## 用户流程

Claude 使用自定义 Connector：复制地址，打开 Claude 添加连接，按提示登录知棱并允许授权。无需生成或粘贴个人密钥。ChatGPT 使用自定义应用和 OAuth；具体设置入口、开发者权限以当前账户和官方文档为准。

Claude Code 通过 `/mcp` 完成授权；Codex 明确执行 `codex mcp login zhiprism`。Cursor 提供仅携带服务地址的一键安装链接。Agent 框架保留手动 Bearer 令牌，90 天到期，最多五个，明文只在创建时显示一次。

先调用 `get_connection_status` 验证连接：它返回账户、授权客户端名称、授权到期时间、画像话题数和今日 Feed 是否已生成，空画像也是成功。连接不会读取历史聊天记录。默认只有用户要求时才进入 `ingest_conversation`（助手直接整理当前对话，不需要用户复制粘贴）；用户在同意页或连接管理中为某个客户端开启「自动采集」后，自检会返回 `autoIngest: true`，instructions 据此引导助手在用户聊到新兴趣时主动提交一次。

Claude 入口有第四步「让 Claude 默认加载知棱」（新对话 ＋ → 连接器 → 工具访问 → 已加载工具，Claude 没有该设置的直达链接）和「在 Claude 中试试」按钮（`https://claude.ai/new?q=` 预填自检提示，不会自动发送）。

## 授权接口

| 接口 | 用途 |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | OAuth 发现，声明 DCR、CIMD（`client_id_metadata_document_supported`）、S256、授权码和刷新支持 |
| `GET /.well-known/oauth-protected-resource` | 服务地址、授权服务器和 zhiprism 权限；同时支持 `/api/mcp` 后缀 |
| `POST /api/oauth/register` | JSON 动态注册；public client 或 client_secret_basic/client_secret_post |
| CIMD（`client_id` 为 https URL） | `lib/connectors/cimd.ts`：按 MCP 2026-07-28 profile 拉取客户端元数据文档（仅 HTTPS、DNS 全部公网、优先钉 IPv4、拒绝重定向、5 秒 / 8KB 上限），要求 `client_id` 一致、`client_name`、`redirect_uris`、`token_endpoint_auth_method: none`；缓存为 `connector_clients` 行，`metadata_expires_at` 按 Cache-Control 夹在 5 分钟到 24 小时。claude.ai 的文档是 `https://claude.ai/oauth/mcp-oauth-client-metadata` |
| `GET /llms.txt`、`GET /.well-known/mcp/server-card.json`、`/robots.txt`、`/sitemap.xml` | Agent 与目录发现文件，与 MCP instructions 同源 |
| `GET /api/oauth/authorize` | 验证客户端、回调、PKCE、权限与目标资源，建立 10 分钟的浏览器绑定事务 |
| `GET /connect/authorize?request=…` | 登录续接、权限说明、允许或拒绝 |
| `POST /api/oauth/authorize` | 同源浏览器决定，事务单次消费，发放 5 分钟授权码或返回 access_denied |
| `POST /api/oauth/token` | form-urlencoded 授权码兑换及刷新 |
| `POST /api/oauth/revoke` | form-urlencoded 撤销客户端自己的授权凭证 |
| `GET /api/connections` | 当前用户的授权、状态和成功调用时间 |
| `DELETE /api/connections` | `{ id }` 撤销当前用户自己的授权 |

权限为 `zhiprism`，另加 `offline_access` 请求续期。Access token 最长 1 小时，refresh token 在原授权的 90 天期限内轮换，授权码、访问凭证、续期凭证和客户端密钥均只存哈希。重放有效兑换过的授权码或刷新令牌会撤销整个授权。原授权期限不会因刷新延长。

`/api/mcp` 校验 OAuth 访问凭证或既有 `zp_m_` 手动令牌，不接受会话 Cookie、用户 ID、refresh token 或 URL 中的凭证。所有路径沿用既有用户身份校验；公开模式要求绑定已验证的登录身份。

工具返回 text + `structuredContent`；`get_daily_feed`、`get_interest_profile`、`get_perspectives`、`mark_seen` 声明 `outputSchema`（`lib/mcp/views.ts`）。四个 `ui://zhiprism/*.html` 资源（MCP Apps，mime `text/html;profile=mcp-app`）由 `widgets/dist` 提供，CSP 只放 `https://assets.claude.ai` 字体源；`mark_seen` 对卡片可见以便「标记已读」回调。

只有成功调用工具才更新对应授权的 `lastUsedAt`。发现接口、工具列表、复制操作、登录授权和失败调用均不会显示「已验证」。状态读取每 15 秒刷新，也支持返回窗口时或手动刷新。撤销立即影响 access 和 refresh token。

## 运行和迁移

`NEXT_PUBLIC_APP_URL` 必须是无路径、无查询参数的规范站点 origin；公开环境必须 HTTPS。无需新增外部 OAuth 服务或迁移到 Better Auth。邮箱、Google 登录沿用当前配置，Google 的回调地址仍是该 origin 下的 `/api/auth/google/callback`。授权续接在服务端保存，只允许返回连接指南或指定的授权事务。

增量迁移 `0004_connector_oauth.sql` 增加四张 Connector 表及现有 OAuth 登录事务的 `return_to` 列，`0006_cimd_clients.sql` 给 `connector_clients` 加可空列 `metadata_expires_at`；都不重建或清空用户、身份、会话或手动凭证。部署前备份数据库；多实例共用持久化 libSQL 数据库。本地文件库仍在首个请求时自动迁移；远程库（`libsql://`）默认关闭请求期迁移，部署后执行 `pnpm db:migrate`（`DATABASE_MIGRATE_ON_START=true` 可临时恢复旧行为）。完整部署步骤见 [DEPLOY.md](DEPLOY.md)。

公开注册和令牌接口使用数据库节流门；浏览器授权和撤销额外验证 Origin、会话以及发起浏览器的事务 Cookie。发现元数据允许无凭证的 CORS 读取，令牌响应禁用缓存。

## 验证

运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。Connector 测试覆盖真实路由/SDK调用、独立 SQLite、账号隔离、PKCE、浏览器绑定、登录续接、授权码重放、刷新轮换/并发、撤销、旧令牌兼容、数据库升级、CIMD（真实 claude.ai 文档、缓存/节流、各类拒绝原因、SSRF 守卫）、发现文件与 MCP Apps 卡片（源码/产物一致、每个工具的 `_meta.ui`、structuredContent 满足 outputSchema）。

部署后运行 `pnpm smoke:connector https://<域名> --oauth`：发现文件、401 挑战、DCR、完整授权码 + 刷新轮换、`tools/list`、`resources/list`、`get_connection_status`。

本地测试不能证明 Claude 或 ChatGPT 云端能连接。真实验收须在可达的 HTTPS 环境完成：新增 Connector → 登录授权 → tools/list → get_interest_profile → 刷新续期 → 撤销后拒绝访问。目录上架、生产部署和真实第三方账户联调不属于本次本地实现。

### 2026-09-11 本地验收记录

- `pnpm test`：14 个测试文件、97 项测试通过。`pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。
- 真实浏览器使用隔离数据库和 `zhiprism-qa.localhost` 测试域，走通邮箱验证码 → 授权页 → 允许 → 回调 → HTTP 令牌兑换 → `get_interest_profile` 返回空画像 → 页面显示已验证。Google 续接使用模拟身份服务的路由集成测试验证，未发送真实 Google 请求。
- 页面撤销后真实 MCP 请求返回 401；取消授权返回 `access_denied` 并保留 state。六个入口、选择续接、复制成功／失败提示／手动全选／重试，以及 390px 和 320px 无横向溢出均已检查。
- `pnpm build --webpack` 生产构建通过。默认 `pnpm build` 的 Turbopack 在当前运行环境中因 CSS 编译进程绑定本地端口被拒绝而失败，提升执行权限后仍复现；未修改项目默认构建器。
- 测试浏览器扩展注入了 `mpa-version`、`data-sharkid` 属性，触发 Next 开发模式 hydration 提示；提示差异来自扩展属性。未修改产品代码来隐藏该提示。
- Claude／ChatGPT 真实云端 Connector、正式 Google 登录、HTTPS 部署和目录上架仍未联调。

### 2026-09-13 生产验收记录（zhi.openmo.org）

- 部署：Vercel ailoras/zhiprism（iad1）+ Marketplace Turso（aws-us-east-1），`pnpm db:migrate` 出站迁移到 0006。首次 CLI 部署被「提交作者邮箱须为团队成员」拦截，改从不含 `.git` 的工作树副本部署，见 [DEPLOY.md](DEPLOY.md)。
- `pnpm smoke:connector https://zhi.openmo.org`：授权服务器元数据（含 CIMD 标志）、两个受保护资源文档、server-card、llms.txt、robots、sitemap、401 挑战、DCR 全部通过。
- claude.ai 真实连接：通过 `/connect` 的深链打开「添加自定义连接器」，Claude 自动识别「Sign in now」与「Use Claude's published identity (CIMD) — Detected」；授权跳到知棱邮箱验证码登录 → 同意页标题「允许 Claude 连接知棱？」→ 回到 claude.ai 显示 Connected，7 个工具列为 Interactive tools。数据库中该授权的 client_id 为 `https://claude.ai/oauth/mcp-oauth-client-metadata`，即 CIMD 路径；`grant.last_used_at` 在首次成功调用后写入，`/connect` 状态为已验证。
- 对话内：`get_connection_status` 返回 `auth: oauth, client: Claude`，由通用结果卡片渲染；`ingest_conversation` 用线上 ZenMux 提取出两个话题；`get_daily_feed` 约 40 秒生成 16 条并以 Feed 卡片渲染（内容卡 + 「换个角度看」立场对比），来源 official、摘要 deepseek-v4-flash。
- 已知问题：Vercel 时钟为 UTC，`todayKey()` 在北京时间 9 月 13 日凌晨仍生成 9 月 12 日的 Feed（待修，见 follow-up）；claude.ai 对 URL 预填的提示会显示「Use caution」提示条，属平台行为。
- 未验证成功：Feed 卡片内的「标记已读」按钮在 claude.ai 里用浏览器自动化点击没有触发 `mark_seen`（`seen_items` 仍为 0；本地模拟宿主里同一按钮可正常回调）。需要人工在 claude.ai 上点一次确认宿主是否允许 app 发起的 tools/call。
- 未在本次验证：1 小时后的静默刷新、撤销后重连、ChatGPT 开发者模式。

参考：

- [Claude Connector authentication](https://claude.com/docs/connectors/building/authentication)
- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Cursor install links](https://prod.cursor.com/docs/mcp/install-links)

## 浏览器插件接入

`/extension` 提供一键捕捉插件，与已有 AI Connector 并列。插件复用 OAuth 登录、PKCE、刷新及撤销，使用独立资源 `/api/extension` 和 `conversations:write offline_access`；MCP 默认权限和资源不变，令牌不可跨资源使用。连接列表按资源显示插件身份，插件没有自动采集开关。首次成功导入后标为已验证。实现、安装与验证限制见 [浏览器插件文档](BROWSER-EXTENSION.md)。
