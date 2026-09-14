# 依据、思辨与我的判断

知棱现在从 Feed 卡片进入独立话题页，用可核对的来源材料支持短程思辨，再由读者确认保存判断。原有 Feed、自然语言要求、历史、Connector、浏览器采集和小棱入口继续保留。

## 使用路径

1. 今日导读最多选三条，每条说明相关原因和这次能弄清什么。完整 Feed 仍可阅读；页面估时仅针对导读。
2. 点卡片上的「看分歧与依据」，进入可恢复的话题地址。检索材料到达后即可先看，分析完成后展示问题、最多四个维度、条件、反例与未决问题。
3. 点一次「查看依据」即可核对作者、短引文、相邻上下文、采集范围和知乎原文。引文匹配证明出处，不证明作者主张正确。
4. 主动选择「帮我想清楚」，最多三轮：当前看法与处境、具体依据、条件或反例。可随时跳过或结束。
5. 编辑草稿后点击确认，才进入「我的判断」。修改保留旧版；跨端修改必须匹配版本号。
6. 将未解问题设为继续关注后，后续 Feed 出现相关新来源或来源版本变化时会提示具体标题。不会自动修改判断或发送外部通知。
7. 从判断历史预览 Markdown 或可打印 HTML，再下载。默认仅有已确认判断字段和公开引用，不导出原始对话、思辨回答或未确认草稿。用户主动写入判断的个人内容仍需在预览时自行检查。

「有帮助／已知道／不相关／归纳有误」是阅读反馈，打开过和反馈都不等于赞同、理解或改变立场。

## 公共依据与私人状态

| 数据 | 用途 | 访问与版本 |
|---|---|---|
| SourceSnapshot | 已取得的知乎正文片段或搜索摘录 | 不可变；正文规范化后哈希，记录范围、截断和采集时间 |
| EvidenceRef | 作者主张、连续短引文及上下文 | 服务端对照特定快照逐字验证；未知 ID、伪造、拼接引文不进入结果 |
| TopicDossier | 有出处的概览、维度、条件、反例 | 只使用校验通过的证据；公共材料分析可复用 |
| dossier_jobs / dossier_access | 分阶段任务、租约、历史访问 | 按账户拥有；授权映射允许回看当时的分析版本 |
| Inquiry / inquiry_operations | 最多三轮回答、模型反馈、可编辑草稿 | 按账户隔离；revision 防止并发覆盖，requestId 用于重试 |
| Reflection / ReflectionVersion | 用户明确确认的判断与历史 | 追加版本，不直接覆盖旧文本；导出、删除均校验所有权 |
| content_feedback | 明确的阅读反馈 | 复用 Feed 选材机制，清理对应每日导读缓存 |

公共分析的问题来自预置公共话题名或来源标题，不把用户原始问题、个人处境、回答或判断放进共享缓存。个人输入发给模型前继续使用现有明显个人信息脱敏机制；这不是完整匿名化保证。

来源身份按知乎回答／文章原文 URL 识别，同一回答在不同内容源的内部 ID 可以不同。来源去重不以标题为键；不同作者对同一问题的回答保留。原始 provider contentId 仍供现有 Feed 反馈和兼容接口使用。

两阶段模型处理：先抽取短引文，再只使用有效 EvidenceRef 归纳。单一来源不会被列为材料共识。没有反例时留空，缺失前提进入待核查问题；不会根据检索词补正反立场。材料不足或模型失败时保留来源并说明限制。

## 三端契约

HTTP、MCP 和语音调用 `lib/cognition/` 的同一组服务。

| 能力 | HTTP | MCP／小棱工具 |
|---|---|---|
| 发起／读取话题 | POST／GET `/api/dossiers` | `get_topic_dossier` |
| 开始／继续／整理思辨 | POST／GET `/api/inquiries` | `discuss_topic` |
| 保存、追加版本、关注、删除 | POST `/api/reflections` | `manage_reflection` |
| 历史与导出预览 | GET `/api/reflections` | `get_reflections` |
| 阅读反馈 | POST／GET `/api/content-feedback` | `set_content_feedback` |

话题 URL 为 `/topics/{jobId}?version={dossierId}&inquiry={inquiryId}`。三端传递同一组标识；指定历史 version 时保持引用材料不变。现有 `get_perspectives` 和 Feed 字段仍兼容旧客户端，旧版摘要标注为未绑定证据，展开后才创建新版分析。

`discuss_topic` 的 start 需要 jobId 和 requestId；reply／draft 需要 inquiryId、revision 和 requestId。草稿不等于正式记录。`manage_reflection(save)` 要求 confirmed=true、完整 draft、dossierId、expectedVersion（新建为 0）、requestId；追加时带 reflectionId。错误返回 400／404／409／429／503，不将失败伪装为成功。

Connector 有独立证据卡片和展开、继续入口。Claude 对旧连接器可能缓存工具目录：设置 → 连接器 → 知棱 → 更多 → **Refresh tools list**，无需重建授权。当前工具目录为 14 项，其中新增五项依据与判断工具。

小棱的客户端参数遵循 ElevenLabs 要求，每个字段都有描述，不使用服务不支持的 nullable type 数组。撤销反馈在语音工具层用 `clear`，适配器转换为共享服务的 null；HTTP/MCP 契约保持原样。语音工具由 `pnpm voice:sync` 同步。

## 恢复、配额与发布

- 新增迁移为 `0011_evidence_dossiers.sql`。若生产仍在 0006，需顺序应用既有 0007–0010 后再执行 0011；它们只新增表、列和索引，不替换旧记录。
- 相同账户、相同规范化问题只持有一个活动任务。数据库租约是任务权威，进程内 Promise 只用于同进程复用。
- search、extract、synthesize 的完成结果逐阶段保存。`after()` 受路由 300 秒限制；租约过期后显示可重试，重试沿用已完成阶段。
- 每个模型调用的结构化请求和文本格式回退共用时间预算，避免回退把超时翻倍。检索沿用现有来源、缓存和配额；生产默认最多选八个不同内容身份的材料。
- 缓存键包含来源快照版本和 `COGNITION_VERSION`（当前 evidence-2）。改处理规则时更新此版本；历史判断继续指向旧 artifact。
- `COGNITION_ENABLED=false` 可关闭新增页面、入口与服务，保留已有 Feed 和 Connector 基础能力；新工具将明确返回暂未开放。关闭功能不删除数据。
- 回滚可在 Vercel Promote 旧部署；新增表可保留。生产请求不自动执行远程迁移。

## 验证入口

- `pnpm test`：引文、权限、并发、恢复、版本、跨适配器和既有业务回归。
- `pnpm typecheck`、`pnpm lint`、`pnpm build --webpack`：类型、静态检查和生产构建。
- `pnpm smoke:connector https://zhi.openmo.org`：公开协议与未授权边界；不代替宿主工具实测。
- `scripts/qa-cognition.ts --all`：五组真实模型验收，强制独立临时数据库。包含离线来源时必须如实标注。

当前运行证据、宿主验收边界和五题结果记录在 [验收记录](../outputs/evidence-upgrade/acceptance.md)。竞品优劣需要同条件任务对照和真实用户试用；功能已实现不等于学习效果已被证明。
