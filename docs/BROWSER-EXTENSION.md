# 知棱浏览器插件

## 0.1.1 修复

服务端兼容修复：早期开发库已经执行过不含 checkpoint 字段的 0009 草稿，而最终迁移文件包含该字段，导致新建测试库正常、旧开发库提交时返回 503。db/compatibility.ts 在事务中检查并只补齐缺失的 nullable 字段，保留任务和迁移记录；本地启动及出站迁移都执行此检查。开发模式按迁移清单刷新启动缓存，HMR 不再沿用已经过期的“迁移完成”状态，远程库自动迁移仍需显式开启。此修复不要求更新插件。

已在实际 localhost:3000 通过临时独立测试账户验证 POST 返回 202，后续 GET 返回 ready，消息入库成功；测试账户、授权和记录已清理，未改动用户原有画像。

修复 Claude 对话树起点识别：真实接口的 parent_message_uuid 使用 00000000-0000-4000-8000-000000000000 作为虚拟起点。0.1.0 只处理全零值，会将正常完整对话误判为缺少父消息。0.1.1 对 Claude 识别这两种起点及 null，仍拒绝任意缺失父节点和循环，不导入其它分支。相关抓取、后台及回归测试 12 项通过。

升级时须重新加载扩展，单独刷新 Claude 页面不会替换已加载的后台代码。直接加载仓库 dist/chrome-dev 的用户重新加载即可；从 ZIP 解压安装的用户需要先下载新包、解压覆盖原扩展目录，再重新加载。Chrome 扩展管理中应显示版本 0.1.1。

## 安装与使用

支持 Chrome、Edge、Brave 120+，使用 Manifest V3。插件只在用户点击图标时捕捉当前已保存的 ChatGPT / Claude 聊天。

1. 在仓库运行 pnpm build:extension:dev，或打开本地网站 /extension 下载开发 ZIP。
2. 打开浏览器扩展管理，开启「开发者模式」，选择「加载已解压的扩展程序」，选 extensions/browser/dist/chrome-dev 目录。
3. 在插件设置页点击「连接知棱」，完成邮箱 / Google 登录及授权。在扩展菜单中固定知棱。
4. 打开一段 ChatGPT / Claude 聊天，等回复生成完成，点击知棱图标。页面右下角显示进度、结果和「查看知棱」链接。
5. 插件选项页提供最近任务、失败重试、账户切换和断开连接；网站 /connect 同样可以撤销授权。

开发包默认连接 http://localhost:3000。正式包运行 pnpm build:extension，使用配置的 HTTPS NEXT_PUBLIC_APP_URL（未配置 HTTPS 时使用产品默认域名 https://zhi.openmo.org）。EXTENSION_APP_URL 可显式指定目标；仅开发包允许 localhost / 127.0.0.1 的 HTTP 地址。构建不会打包服务端密钥。

输出：

- extensions/browser/dist/chrome-dev：可加载的本地开发目录。
- extensions/browser/dist/chrome：可加载的正式目录。
- extensions/browser/dist/zhiprism-chrome-dev.zip 和 zhiprism-chrome.zip：对应 ZIP。
- public/downloads：网站下载文件，构建时生成，不提交二进制。

pnpm dev 的 predev 生成开发包，pnpm build 的 prebuild 生成正式包。改变插件代码后重新构建，并在扩展管理页重新加载；网站 API 变更也需要相应服务器运行新版本。正式域名部署新 API 和迁移之前，正式包不能完成导入。本次没有部署生产或提交商店审核。

## 抓取与数据范围

当前页面世界负责同站请求；ChatGPT 会话令牌仅用于该页读取当前会话，不返回到扩展或知棱。Claude 查找当前会话所属组织，不枚举其他聊天。适配器沿当前节点 / 叶节点回溯父消息，校验页面显示的分支，拒绝缺失节点和循环。

只提交标准化文字、代码、链接、附件名称、平台、标题、消息 ID、来源 URL。跳过隐藏消息、系统工具消息、推理块、图片和附件正文。不支持临时聊天和分享链接；正在生成、页面切换、接口出错、缺少完整分支或超过 2 MiB 时明确提示，不截取部分记录冒充全量。

这是对站点内部接口的适配，不是平台保证稳定的官方导出 API。源码来源及许可证保存在 extensions/browser/THIRD_PARTY_NOTICES.md；维护时需对真实站点重新验证。

## 授权与接口

复用现有 /api/oauth/register、authorize、token、revoke，使用 Authorization Code + S256 PKCE，回调由 chrome.identity.getRedirectURL("zhiprism") 提供。插件资源为 /api/extension，权限为 conversations:write offline_access。原 MCP 默认权限仍是 zhiprism offline_access；资源严格隔离，插件令牌不能调用 MCP，MCP 令牌和网页 Cookie 不能调用插件接口。

插件凭证只放在受信任扩展上下文可访问的 chrome.storage.local。刷新串行并轮换 refresh token；撤销或过期会要求重新连接。授权页明确显示插件能力，不提供自动采集。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | /api/extension/account | 当前连接账户的 ID 和显示名 |
| POST | /api/extension/captures | 接收 version:1 标准会话；202 返回 id、capture，已完成的相同快照返回 200 和 alreadyImported |
| GET | /api/extension/captures/:id | 返回 queued / running / ready / error、真实阶段、结果及 Feed 状态；推进已排队分块和待刷新 Feed |
| POST | /api/extension/captures/:id/retry | 重试失败 / 租约超时任务或失败 Feed |

请求结构定义在 lib/extension/contract.ts，严格校验实现位于 validation.ts。请求体按流检查字节数，不能伪造 Content-Length 绕过限制。错误码包含 400、401、404、413、415、503，返回通用错误，不返回供应商原始报错或聊天正文。

## 任务、增量与恢复

0009_browser_capture.sql 增加任务、已处理消息版本、工作租约和 Feed 刷新记录，并为原 conversations 增加平台、外部 ID、来源 URL 和最后捕捉时间。现有导入、MCP、授权及业务数据保留。

入队前对正文、标题及附件名称脱敏。相同用户 / 平台 / 外部会话 / 快照只创建一个任务；同一会话的不同快照保留已处理消息版本。每次最多分析四组文本，单条长消息会拆分，分块结果保存后再继续；未完成前不合并半份画像。

旧用户消息只作为标记过的上下文，不参与规则提取和本次提及计数。新增或编辑的消息版本参与分析，旧分支再次捕捉不重复计分。画像保留产品既有累计语义；删除 / 修改原聊天不追溯撤回过去已经形成的兴趣。存档保存最近捕捉的分支，不重复堆叠完整聊天。

数据库中的用户级租约协调并发；只有持有有效租约、有效授权的工作者能在同一事务中合并画像、写存档、标记消息并完成任务。崩溃后超时显示可重试；重试使用已完成分块。扩展提交成功后仅保留任务引用和结果，不保存聊天原文。关闭提示、切换标签或后台重启后，轮询 / alarms 继续；浏览器完全退出时剩余分块会在下次启动后恢复。

有兴趣变更才请求 Feed 刷新。刷新记录带 revision；已有 Feed 正在生成时，等待它结束再启动包含新画像的一次生成。期间又有画像更新，保留 pending，下一次轮询继续。清空画像同时清理捕捉任务、消息版本和租约。

## 验证状态

自动测试覆盖适配器分支 / 长对话 / 组织选择、页面切换与生成状态、真实路由的 OAuth / 202 导入 / 跨账户隔离、增量 / 并发 / 超时恢复 / 分块检查点 / 撤销、Feed 更新竞争和迁移兼容。

2026-09-14：全套 33 个测试文件 / 190 项通过，包含 Chrome API 模拟环境下的单次点击提交、无原文持久化与后台重启后恢复查询。类型检查、lint 和 ZIP 完整性检查通过；当前代码快照的 pnpm build --webpack 已成功生成全部路由（包括 /extension 和插件 API）。安装页与开发 ZIP 下载在 localhost:3000 返回 HTTP 200。生产构建额外修正了已有 Skeleton 组件的服务端 / 客户端导入边界，并将有独立 package.json 和 tsconfig 的 video 工程排除在网站 TypeScript 构建之外。

本地安装页已在实际 Chrome 打开并检查。浏览器自动化的安全策略禁止访问扩展管理页，安装步骤已交给用户；在手动加载后完成真正的图标点击、浏览器 OAuth、ChatGPT 和 Claude 抓取、画像及 Feed 更新之前，不能将模拟站点 / 单元测试结果写作平台端到端通过。生产部署及商店上架未执行。
