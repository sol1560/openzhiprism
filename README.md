# 知棱 ZhiPrism

> 知乎黑客松 2026 校园新锐季 · 知识炼金场赛道 · 作者 Sol

知棱是一个从你与 AI 的日常对话中自动发现兴趣、生成个性化知乎内容 Feed、并主动打破信息茧房的知识发现工具。它不是新的内容平台，而是知乎内容生态的外挂式发现层：

- 知乎提供内容供给（搜索 API、直答、热榜、关注数据）
- AI 对话平台提供最真实的意图信号（通过 MCP 接入）
- 知棱在中间把对话里的兴趣翻译成知乎内容推荐，并在单一视角的话题上刻意补充另一方的高赞回答

用户在知棱里只看到摘要，想读原文就跳转知乎。产品说明计划书见 [docs/PRODUCT.md](docs/PRODUCT.md)。

## Demo 流程

1. `/login`：邮箱验证码（6 位，登录即注册；本地开发模式下验证码会直接显示在登录页并自动填入，不依赖邮件送达）或 Google 登录。已有画像的用户直接进 `/feed`，新用户进 `/onboarding`
2. 接入对话：粘贴一段对话 / 上传 ChatGPT、Claude 导出的 JSON。可先「预览脱敏结果」，看到手机号、身份证、金额等在进入模型前被隐去
3. 分析后得到兴趣画像（话题、权重、关键词、证据句、立场倾向）；今日 Feed 同时在后台开始生成，进入 `/feed` 就能看到真实进度和骨架卡，无需手动点生成
4. `/feed`：每条内容含两三句摘要、来源、赞同数、推荐理由「因为你最近在聊 XX」，点击跳转知乎原文；约 20% 是热榜轻松内容；在你只听一种声音的争议话题上出现带棱镜边框的「换个角度看」卡片
5. `/profile` 查看画像、立场偏向、已采集对话；`/connect` 选择 AI 客户端，登录授权后主动提交选定的对话

## 运行

```bash
pnpm install
cp .env.example .env.local   # 填入 key，见下文
pnpm dev                     # http://localhost:3000
```

无任何 key 也能跑：`LLM_PROVIDER=mock` 时用词典规则提取兴趣，内容源自动降级到 `fixtures/zhihu/` 里的真实知乎快照（60 个检索词、30 条热榜、3 份关注图谱，由 `pnpm seed` 抓取）。

| 变量 | 作用 |
|---|---|
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 Access Secret（developer.zhihu.com/personal），驱动搜索 / 热榜 / 直答 / 用户关注 |
| `JUSTONEAPI_TOKEN` | JustOne API，官方额度不足时的补充内容源（知乎搜索、用户关注话题） |
| `ZENMUX_API_KEY` | OpenAI 兼容网关，做兴趣提取、摘要、立场分类 |
| `LLM_PROVIDER` | `zenmux` / `zhida`（知乎直答）/ `mock` |
| `LLM_MODEL` | 默认 `deepseek/deepseek-v4-flash`（约 20s 完成一次提取） |
| `ZHIHU_SOURCE` | `auto`（官方有额度则用官方，否则 JustOne，再否则快照）/ `official` / `justone` / `fixture` |
| `RESEND_API_KEY` / `EMAIL_FROM` | 邮箱验证码发信（Resend）。本地不填时验证码打印到终端；公开模式必须配置，发件人需用已验证域名 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 客户端；回调地址填 `${NEXT_PUBLIC_APP_URL}/api/auth/google/callback` |
| `ZHIHU_OAUTH_APP_ID` / `ZHIHU_OAUTH_APP_KEY` | 知乎 OAuth 应用凭证（预留，未接入登录页），详见下文 |
| `PANGRAM_API_KEY` / `AI_DETECTION_ENABLED` | 服务端检测密钥与总开关；默认为关闭 |

```bash
pnpm test        # vitest：脱敏、解析、规则提取、画像合并、Feed 混排、视角判定
pnpm typecheck
pnpm lint
pnpm seed        # 用 JustOne / 官方接口补齐离线快照（幂等，--force 重拉；需私有适配器，公开版本不可用）
pnpm mcp:stdio   # 本地 stdio MCP server
```

## 架构

```
app/                      Next.js 16 App Router + HeroUI v3 / HeroUI Pro
  login · onboarding · feed · profile · connect · api/{auth/{email,google},ingest,feed,profile,status,mcp}
lib/
  zhihu/                  内容源：official（配额守卫）→ justone → fixture，统一 ZhihuItem 模型，24h 内容缓存
  llm/                    AI SDK 客户端（ZenMux / 直答 / mock）+ 全部 prompt 与 zod schema
  ingest/                 隐私正则脱敏 → 对话解析（文本 / JSON / ChatGPT 导出）→ LLM 或词典规则提取兴趣
  profile/                画像合并（频次 × 深度累积、14 天半衰期、归一化权重）、知乎关注冷启动
  feed/                   选题分配、检索去重、批量摘要（按内容缓存）、80/20 混排
  perspective/            争议检测 → 正 / 反 / 中立检索 → 立场分类 → 偏向判定 → 换个角度看卡片（按话题缓存 7 天）
  mcp/                    MCP 工具集（HTTP 与 stdio 共用）
db/                       Drizzle + libsql（本地 SQLite）
fixtures/                 真实知乎快照 + 3 个 persona 对话集
scripts/                  seed-fixtures.ts · mcp-stdio.ts
```

数据流：对话 → 正则脱敏 → LLM 提取 `{topics[{name, keywords, questions, evidence, depth, mentions, stance, controversial, searchQueries}]}` → 合并画像 → 按权重分配名额检索知乎 → 去重（已读 / 已推送）→ 批量摘要 → 热榜挑选 → 视角卡 → 混排落库。

### 知乎 API 与配额策略

黑客松承诺的额度（搜索 5000 / 直答 100 / 热榜 100 每天）尚未开通，当前 Access Secret 的实际额度是搜索 10、热榜 2、直答 2、用户数据 1000。为此：

- 每次官方调用前读 `GET /api/v1/quota`（不消耗额度），余量低于保留值自动降级到 JustOne，再降级到离线快照；Feed 页角标显示本次实际数据源
- 搜索结果按检索词缓存 24h，摘要按内容 id 缓存并跨用户复用
- 直答只用于「换个角度看」的中立分析，结果按话题缓存 7 天；额度为 0 时自动改用默认 LLM
- `GET /api/v1/user/followees` 无需 OAuth 即可读取 Secret 持有者的关注，冷启动代码保留在后端但未接入登录页；公开环境不会退回开发者身份

## 连接 AI

`/connect` 提供 Claude、ChatGPT、Claude Code、Codex、Cursor 和 Agent 框架六种接入引导。Claude 通过自定义 Connector 登录授权，无需手动生成令牌；Cursor 支持一键安装，Codex 通过 `codex mcp login zhiprism` 完成 OAuth。接入说明无需登录，连接管理需登录。

- 远程端点：`/api/mcp`，支持 OAuth Authorization Code + S256 PKCE、动态客户端注册、客户端元数据文档（CIMD，claude.ai 新版连接器的默认方式）、刷新与撤销。
- 首次验证：调用 `get_connection_status`，返回账户、授权客户端、授权到期、画像话题数与今日 Feed 状态；空画像也代表成功。只有成功工具调用才显示「已验证」。
- 简报与历史：`get_daily_brief` 返回可朗读的 `spokenScript` 与亮点，`get_reading_history` 返回各话题推送 / 打开数与连续性话题。
- MCP Apps 卡片：`get_daily_feed`、`get_interest_profile`、`get_perspectives` 在支持 MCP Apps 的宿主（claude.ai 等）中渲染为交互卡片，其余工具走通用结果视图；不支持的宿主照常收到 JSON 文本。卡片源码在 `widgets/src`，改完运行 `pnpm build:widgets` 并提交 `widgets/dist`。
- 发现文件：`/llms.txt`、`/.well-known/mcp/server-card.json`、`/robots.txt`、`/sitemap.xml` 与 MCP instructions 同源（`lib/mcp/instructions.ts`）。
- Agent 框架可继续使用独立 `zp_m_` 令牌；浏览器会话、用户 ID 和 URL 里的凭证都不能代替它。
- 本地 stdio：`ZHIPRISM_USER_ID=<userId> pnpm mcp:stdio`，受本机进程与数据库权限保护。
- 连接不会读取历史聊天记录。默认只在用户要求时采集：用户说「把这段对话交给知棱」，助手把当前对话整理后交给 `ingest_conversation`，不需要复制粘贴。用户可在同意页或 `/connect` 的连接管理里为单个客户端开启「自动采集」（`connector_grants.auto_ingest`，默认关闭），开启后助手会在用户聊到新兴趣时主动提交那段对话；同一段对话按正文哈希去重。
- 翻近期对话：接入页「让 Claude 翻近期对话找兴趣」会在 claude.ai 预填一段提示，让 Claude 用自带的 `recent_chats` / `conversation_search`（界面上的 Relevant chats）多轮翻最近 7 天的对话，整理成话题后分批交给 `ingest_conversation`（`source: recent_chats`，画像页显示「Claude 近期对话」）。提取按 4000 字分块并行；模型超时时回滚存档并返回 `retryable: true`，助手拆短后重提。

生产地址由 `NEXT_PUBLIC_APP_URL` 配置，必须为 HTTPS origin。授权协议、增量迁移和验证步骤见 [连接说明](docs/CONNECTORS.md)，Vercel + Turso 部署步骤见 [部署说明](docs/DEPLOY.md)。

## Today Feed：兴趣 × 历史

`/feed` 的选题不只看画像权重，也看你实际点开了什么：

- **历史加权**：最近 14 天里点开率高的话题权重最高 ×1.4，推了 5 条一条没点的降到 ×0.6，从未推送过的话题给 ×1.1 的探索空间（`lib/feed/select.ts` `applyHistoryBoost`，样本少时向 1 收缩）。昨天在读的话题今天保证至少 1 条（`pinTopics`）。
- **历史理由**：卡片理由会写「昨天你点开了「X」的内容，今天接着看」「「X」推了 5 条你都没点，今天少放一点」。
- **每日简报**：页面头部一句话标题、总结、3-5 条亮点（点击滚到卡片）和与昨天的连续性；同一份简报的 `spokenScript` 供语音向导开场朗读。懒生成、一人一天一行（`daily_briefs`），Feed 重建即作废；LLM 不可用时规则拼装。
- **往日回看**：侧栏「往日」进入 `/feed?date=YYYY-MM-DD` 只读视图，「最近打开」列出最近点开的内容。
- API：`GET /api/feed/brief?date=`（`POST {force:true}` 重生成）、`GET /api/feed/history?days=`、`GET /api/perspectives?topic=`、`GET /api/search?q=`。MCP 新增 `get_daily_brief`、`get_reading_history`。

## 语音向导「小棱」

一个会主动汇报的阅读向导：进入 `/feed` 点「听今日播报」，小棱先把今天的简报读给你听，再带你逐条读，讲完一张卡会主动问要不要听「换个角度看」的另一方；你也可以直接问它「今天发生了什么」「我最近在看什么」。底层是 [ElevenLabs Agents](https://elevenlabs.io/docs/agents-platform)，人设、首句、工具定义都在代码里（`lib/voice/agent-config.ts`、`lib/voice/tools.ts`）。

- **工具**：12 个 client tools 在浏览器里执行、用当前登录态调本站 API（今日 Feed / 简报 / 卡片详情 / 画像 / 阅读历史 / 多元视角 / 知乎搜索 / 数据源状态），并能操控页面（滚到某张卡、打开原文、标记已读、重新生成）。实现与传输层无关，日后换 Webhook 只改接线。
- **同步 agent**：

  ```bash
  pnpm voice:sync --dry-run   # 看将要提交的 JSON
  pnpm voice:sync             # 用 ELEVENLABS_API_KEY 创建 / 更新工具与 agent
  ```

  首次会打印 `ELEVENLABS_AGENT_ID=...`，贴进 `.env.local` 后再跑一次即走 PATCH。
- **环境变量**：`ELEVENLABS_API_KEY`（只在服务端换取 signed URL）、`ELEVENLABS_AGENT_ID`、`ELEVENLABS_VOICE_ID`（可选，Voice Library 里选支持中文的声音）、`VOICE_GUIDE_ENABLED=false` 可临时隐藏面板。未配置时页面上没有语音入口。
- **注意**：麦克风只在 https 或 localhost 可用，没有麦克风时用「文字模式」；单次会话上限 15 分钟，agent 会在用户长时间沉默后道别；`search_zhihu` 会消耗知乎搜索额度，prompt 要求优先用 Feed 里已有的内容。

## 隐私

- 进入模型前用正则隐去手机号、身份证、邮箱、银行卡、地址、收入金额、姓名提示，并在 UI 中展示脱敏统计
- 提取 prompt 要求模型只输出话题层面的信息，并登记主动跳过的敏感类别
- 画像里只有话题、关键词和脱敏后的证据句；对话原文只保存在本地 SQLite，不回传任何第三方

## AI 写作检测

推荐卡片中的回答／文章支持手动检测，先说明发送范围，再点击「检测这段原文」。发送的是来源正文片段（最多 4,000 个 Unicode 字符），不是知棱生成的摘要、推荐理由或视角分析。短于 50 个本地分词单元的文本跳过；供应商仍可能拒绝有效文本不足的输入。

Pangram 4 的分类、文本份额、分段结果、模型版本和时间在卡片内展示。所有结果标明「仅检测已获取的原文片段」，不能据此断言作者身份或内容真伪。没有密钥时不会生成模拟检测结果。

- `POST /api/ai-detection`：`{ "contentId": "answer:…" }`，验证会话、Feed 归属及已验证身份（邮箱 / Google）后创建任务；缓存命中不计次。
- `GET /api/ai-detection?contentId=answer%3A…`：读取状态、原文和结果，续查已有任务，不创建任务。
- 状态包含 `not_requested`、`pending`、`ready`、`unavailable`、`error`、`submission_unknown`。来源变化后旧结果不再绑定新正文。
- 原文与任务 ID 持久化；相同内容 ID／正文哈希／模型／处理版本只提交一次。提交结果不明时保留预留费用，不自动再次提交。
- 每个真实账户默认每天 5 次、每分钟 2 次；全站默认 UTC 日 $5、滚动 31 天 $150。按非空白 Unicode 字符数保守预留，单位为每开始的 100 字符 5 美分；这是上限估算，不是供应商账单或实际余额。已知拒绝提交释放预留金额，但仍计入尝试次数；仅这种确认未受理的请求允许用户手动重试。
- 所有提交和状态查询共用数据库中的每 500ms 一次限速门；同一任务的查询使用可过期租约合并。部署多个实例必须使用同一个持久化数据库，不能使用各自的临时 SQLite。

完整运行、验收与公开上线依赖见 [docs/AI-DETECTION.md](docs/AI-DETECTION.md)。

构建使用项目内自托管 Geist 字体，不依赖 Google Fonts 网络访问。

## 公开登录与旧凭证迁移

登录只有两种方式：邮箱验证码和 Google。验证码只存哈希，10 分钟过期、错 5 次锁定、同邮箱 60 秒一次且每小时最多 5 次，并绑定发起请求的浏览器 Cookie；Google 走 PKCE + state 双提交，只信任 Google 标记为已验证的邮箱。同一个已验证邮箱用两种方式登录会合并成一个账户（`oauth_identities` 按 `(provider, subject)` 绑定用户）。

生产构建运行时自动开启公开模式（开发环境可设置 `APP_PUBLIC_MODE=true`）。公开模式只接受带身份绑定的会话；旧的体验账号、开发者本人和任意 url_token 登录接口仍在后端但公开模式下拒绝。旧 `zp_uid` Cookie 会失效，本地体验用户需重新登录，原有数据仍保留但不按旧 ID 恢复身份。

浏览器使用随机的 `zp_session`，30 天到期，退出时服务端撤销；生产 Cookie 启用 HttpOnly、Secure、SameSite=Lax。写接口需要与 `NEXT_PUBLIC_APP_URL` 匹配的 Origin；公开地址必须是 HTTPS。MCP 使用独立凭证，不接受浏览器 Cookie。

知乎 OAuth 作为第三种登录方式预留，代码在 `lib/auth/oauth.ts` 与 `/api/auth/zhihu/*`，未接入登录页。知乎官方采用 `app_id`＋`app_key`，回调为 `authorization_code`。当前公开文档没有给出用户信息接口定义，也未明确 state 回传。`ZHIHU_OAUTH_USERINFO_URL`（仅允许 `https://openapi.zhihu.com`）、稳定身份字段路径及可选名称路径须来自实际获批协议；现有适配器按 Bearer 用户令牌读取 JSON，正式联调时必须核对该约定。`ZHIHU_OAUTH_CONTRACT_VERIFIED` 默认 false，在官方协议确认与真实联调完成之前不得开启。没有有效稳定标识时绝不创建 OAuth 用户。

### 浏览器插件

Chrome / Edge / Brave 可以点击工具栏图标，把当前 ChatGPT 或 Claude 聊天导入知棱。网页入口为 `/extension`，支持专用 OAuth、增量去重、分块恢复及 Feed 更新。

- `pnpm build:extension:dev`：生成连接 localhost 的可加载目录和 ZIP。
- `pnpm build:extension`：生成正式域名版本，网站构建时也会自动执行。
- 安装、数据范围、接口和实际验收状态见 [浏览器插件文档](docs/BROWSER-EXTENSION.md)。

## 许可证

本项目以 [GNU AGPL-3.0-only](LICENSE) 发布。「知棱 / ZhiPrism」名称与 logo 不在授权范围内；闭源使用需商业授权。详见 [NOTICE.md](NOTICE.md)。
