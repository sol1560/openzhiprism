# AI 写作检测：实现与验收

2026-09-09。实现与本地验收已完成；公开上线仍有明确阻塞项。

## 当前验收

| 检查 | 状态 | 证据与边界 |
| --- | --- | --- |
| 自动化回归 | PASS | 10 个测试文件、59 个用例；含原有 27 个用例 |
| 原文与供应商协议 | PASS | 中英文分词、emoji 截断、原文与摘要隔离、未知分类、异常响应；供应商通过 mock 验证 |
| 并发和费用 | PASS | 并发只提交一次、最后一笔预算竞争、独立数据库连接去重、查询租约、滚动预算、提交不明保留预留 |
| 持久化与迁移 | PASS | 旧数据库原有用户／Feed／摘要保留；精确 ID 回填快照；新数据库连接恢复查询 |
| 身份与访问 | PASS | 随机会话、退出撤销、过期、MCP 独立令牌、旧凭证拒绝、账户隔离、OAuth state 绑定与防重放 |
| HTTP 接口 | PASS | 开发服务及最终生产构建 13 项检查：未登录、旧 Cookie、跨站写入、任意正文、外部内容 ID、缓存读取、MCP 工具调用与撤销等 |
| 生产模式关闭策略 | PASS | 本机生产服务 4 项检查：关闭 OAuth 入口、禁止开发者身份登录、禁止未完成授权、即使检测开关开启也不发出付费请求 |
| 浏览器 UI | PASS | 桌面与 390px 窄屏；分类、三类份额、分段、实际原文可展开；无横向溢出，无浏览器 error 日志 |
| Lint／类型检查／生产构建 | PASS | `pnpm lint`、非增量 TypeScript、`pnpm build`；构建用 mock LLM、fixture 内容源及临时数据库 |
| 真实 Pangram API 与账单 | BLOCKED | 本地没有 `PANGRAM_API_KEY`；读取 Pangram 私有账户以取得现有凭证的浏览器操作被自动审批拒绝，等待明确账户读取授权 |
| 真实知乎 OAuth 双账户联调 | BLOCKED | 缺少 app_id、已确认的用户信息接口／稳定身份字段，以及 state 回传验证 |
| 公开 HTTPS 全流程 | BLOCKED | 上述供应商／OAuth 联调未完成，且本次未部署公开站点 |

UI 和 HTTP 检查使用独立的临时数据库。界面样例显著标明“模拟检测结果（未调用 Pangram）”；没有生成伪装成真实检测结果的运行时 fallback，没有消耗 Pangram 检测额度。真实模型准确率和供应商计费粒度均尚未验证。

## 配置与启动

配置项见 `.env.example`，现有 `.env.local` 未修改。

- `PANGRAM_API_KEY`：只在服务端使用。`AI_DETECTION_ENABLED=false` 是默认值，关闭新提交但保留已有结果读取。
- `ZHIHU_OAUTH_APP_ID`、`ZHIHU_OAUTH_APP_KEY`：正式 OAuth 凭证，不能用数据 API 的 Access Secret 代替。
- `ZHIHU_OAUTH_USERINFO_URL`、`ZHIHU_OAUTH_SUBJECT_PATH`：须使用知乎获批材料中的实际接口和稳定身份字段路径；没有默认猜测。可选 `ZHIHU_OAUTH_NAME_PATH` 只影响显示名称。
- 当前身份适配器使用 HTTPS GET、Bearer 用户访问令牌和 JSON 响应，限定 `openapi.zhihu.com`，拒绝重定向。必须在实际获批协议中确认这些约定，并在联调通过后设置 `ZHIHU_OAUTH_CONTRACT_VERIFIED=true`。
- `NEXT_PUBLIC_APP_URL` 必须匹配浏览器访问 Origin；公开环境必须 HTTPS。`NODE_ENV=production` 强制公开模式，开发环境可用 `APP_PUBLIC_MODE=true` 验证关闭策略。
- 本地 SQLite 启用 WAL。多实例需连接同一个持久化数据库；不要使用各实例的临时文件或把 SQLite 文件放在不支持 WAL 的共享文件系统上。远程 libSQL 可配置 `DATABASE_URL` 和 `DATABASE_AUTH_TOKEN`。

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit --incremental false
LLM_PROVIDER=mock ZHIHU_SOURCE=fixture DATABASE_URL=file:/private/tmp/zhiprism-build.db pnpm build
```

首次访问数据库自动应用 Drizzle 迁移。备份生产数据库后部署；迁移不删除原有数据。旧 `zp_uid` Cookie 及用户 ID Bearer 不再有效，不能靠提交旧 ID 认领历史账户。

构建额外修复了两个已存在的问题：Geist 字体改为自托管并附 OFL 许可，避免构建时请求 Google Fonts；服务端页面通过明确的客户端组件边界使用 HeroUI。受限环境下 Turbopack 需要允许本机进程通信。失败的生成缓存可能保留权限错误，验证时已隔离该缓存再重新构建。

## 数据与接口

- 原文保存在 `content_cache` 的 source 字段，包含原始来源、时间、截断信息与哈希；旧快照未记录的时间显示未知。
- `detection_jobs` 固定保存实际送检片段、模型、处理版本、任务 ID 与结果。同一内容 ID／正文哈希／模型／处理版本有唯一约束。
- `detection_reservations` 是保守费用预留与尝试次数账本，不是供应商账单；`request_gates` 对提交和查询统一节流。
- 本进程内的事务在各数据库句柄之间顺序执行，避免当前 libSQL native binding 在并行 BEGIN 时遗留 busy statement；跨进程的最终保护仍是数据库事务和唯一约束。
- `auth_credentials` 只保存会话和 MCP 凭证哈希；`oauth_transactions` 保存一次性浏览器绑定；`oauth_identities` 将经官方验证的稳定标识映射到用户。

`POST /api/ai-detection` 仅接受 `{ "contentId": "answer:…" }`。`GET /api/ai-detection?contentId=…` 只读取或续查已有任务。两个入口均验证会话与 Feed 归属；创建新任务额外要求已验证身份（邮箱 / Google）且至少配置了一种登录方式。提交字段不能指定文本、模型、目标 URL 或供应商任务 ID。

返回状态：`not_requested`、`pending`、`ready`、`unavailable`、`error`、`submission_unknown`。详情按需包含实际原文和结构化结果。前端每次展开最多自动查询 60 秒，随后允许手动续查；不因页面刷新重新创建任务。

## 费用与故障处理

- 默认每账户 UTC 日 5 次、每分钟 2 次；缓存命中不计次。全站每 UTC 日 500 美分、滚动 31 天 15000 美分。
- 预留金额按非空白 Unicode 字符数，每开始的 100 字符预留 5 美分，单次最多 4000 字符。这是保守上限估算；实际中文计费应在真实小样本中核对。
- 数字限额可设为 0 以停止相应新请求；非法或负值按 0 处理，避免误配置扩大额度。
- 明确拒绝提交的输入／鉴权／余额／限流错误释放金额，但保留尝试计数，并将拒绝记录移出活动缓存。用户重新查询后可手动重试；系统不会自动重发。已提交、服务器异常或响应不明的任务保留预留金额。
- 超时、未知提交结果和无任务 ID 的中断记录不自动重新提交。已知任务 ID 的查询失败可恢复，不需要重新付费。
- 若存在 `submission_unknown`，管理员应按提交时间和原文核对供应商记录；在确认前不要删除记录、释放预算或再次提交。可以通过关闭总开关停止新检测。
- 日志不得包含 OAuth 令牌、Pangram 密钥或原文。用户只看到经过分类的错误信息。

## 公开启用前仍需完成

1. 获准读取现有 Pangram API 凭证并配置后，用有限的小样本核对实际提交、响应文本、分段与费用；不将“模型每次都判断正确”作为程序验收标准。
2. 核对知乎获批 OAuth 材料，确认用户身份接口、令牌用法、稳定标识和 state 回传。完成两个真实账户的登录、恢复、退出和隔离测试，再打开契约验证开关。
3. 使用持久化数据库部署到真实 HTTPS 域名，核对回调白名单、Cookie、Origin 与费用限制；完成“登录 → Feed → 检测 → 刷新复用”后才能标记上线完成。

官方依据：[Pangram 4 接口迁移](https://www.pangram.com/blog/pangram-4-migration-guide)、[输入要求](https://www.pangram.com/knowledge-hub/minimum-and-maximum-input-sizes)、[知乎 OAuth](https://developer.zhihu.com/docs?key=zhihu_oauth_integrated)。

## 2026-09-14 · 结果解析容错与重读

- `parseResult` 不再因为空白/Unicode 形式差异、版本号不以 `4.` 开头、或个别分段对不上原文而整篇作废：文本按 NFC + 空白折叠后比较，对不上的分段逐个略去，差异记入 `result.notes` 并在卡片里用一句话说明；只有响应结构不符或三类占比加起来偏离 1 超过 0.05 才判 `invalid_result`。诊断日志只含字段名、版本号、字数与分段数，不含正文。
- 已有 `task_id` 但读取结果失败（`invalid_result` / `task_missing`）的任务，下次查询会重读同一个任务，不重新提交、不再扣费；提交阶段就失败且没有 `task_id` 的任务，允许用户重新发起（新预留、计入限额）。
