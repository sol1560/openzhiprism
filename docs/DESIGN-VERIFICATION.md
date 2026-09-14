# 全站视觉与首页沙盒验收

日期：2026-09-10

## 实现

- 首页采用蓝黄光影、轻字重标题与可操作的双栏产品窗口。
- 林同学、周产品、陈自由三个场景；支持兴趣权重与开关、话题筛选、推荐理由和对话联动、内容预览、阅读状态、不同观点及重置。
- 示例数据来自仓库的虚构人物与知乎离线快照。`lib/demo/samples.json` 保留来源文件、原文链接和采集日期。
- 演示状态仅保存在组件内存中；不创建会话、不存储偏好、不请求业务接口、不调用检测服务。
- 抽离无请求副作用的 ContentCardView，正式 Feed 与沙盒共用展示层。
- Feed、画像、引导、接入、导航、主题和复制反馈均使用统一视觉。公开 API 与数据库无本次改动。

## 验证结果

- 改版验证时 `pnpm test`：11 个测试文件、68 个测试通过，包含 9 个新增沙盒测试；并行登录改动接入后复跑为 12 个测试文件、77 个测试通过。
- `pnpm lint`、TypeScript 检查、`git diff --check` 通过。
- `pnpm build --webpack` 完成生产构建。生产服务器的首页与引导页均返回 HTTP 200，验证当时的知乎授权正确显示尚未开放。
- 浏览器检查首页、Feed、画像、接入与引导在 390、768、1440px 下的浅色和深色布局。
- 修正真实 Feed 长内容造成的手机和平板横向溢出；复查分别为 390/390px 和 768/768px，无超出视口的内容。
- 三个人物场景与各自的三个观点均可切换；权重调整改变推荐顺序；关闭全部兴趣出现恢复入口；重置与切换场景清除筛选、阅读和编辑状态。
- 浏览器监测沙盒操作期间 fetch 记录为空；源码亦不包含请求或浏览器存储调用。
- 390px 真实触摸打开预览，弹窗宽 352px；Tab/Shift+Tab 在弹窗内循环，Escape 关闭并把焦点还给打开按钮。
- 手机菜单、示例对话折叠正常。系统深色且无保存偏好时默认浅色；用户选择深色后刷新仍保留。
- 减少动态效果模式下环境动画为 none；离开视口后动画暂停。

## 正式页面流程

通过 `/tmp/zhiprism-design-qa` 中的隔离副本和独立数据库验证，环境为 `LLM_PROVIDER=mock`、`ZHIHU_SOURCE=fixture`，不调用付费服务。

- 新建体验账号 → 脱敏预览 → 分析 7 段对话、35 条消息 → 6 个兴趣 → 12 条主内容、3 条轻松内容及 1 张不同观点卡。
- Feed 重新生成成功；打开原文会标记已读。
- AI 检测保持原有门槛，正确显示“新检测暂未开放，已有结果仍可查看”。
- 接入页复制显示“已复制”；临时 MCP 令牌可以创建、撤销，撤销后一次性配置消失。
- 在一次性测试账号上模拟清空确认的取消/确认分支：取消保留 6 个话题，确认后话题和对话为空。

## 本机运行说明

本机 Turbopack 的编译 worker 受到端口绑定权限限制，使用 Webpack 完成构建与预览：

```sh
pnpm dev --webpack --port 3000
pnpm build --webpack
```

预览地址：http://localhost:3000

验收收尾时，工作区的并行登录任务新增了邮箱/Google 登录，并将登录移到 `/login`。本次保留其账户逻辑与首页入口，重新为登录后的两步引导接入统一样式；复查首页、登录页返回 200，未登录访问 `/onboarding` 正确进入 `/login`。上述体验账号完整流程记录对应隔离验证副本；新增邮箱和 Google 登录的真实服务验收由登录任务负责。

首页复查截图位于本机 `.tmp/design-review/home-light.png` 和 `.tmp/design-review/home-dark.png`（不纳入版本控制）。浏览器扩展添加 body 属性造成的 hydration 警告已定位到扩展；正式 OAuth 和真实 Pangram 的上线验证不属于本次视觉改版验收。

## 2026-09-14 补充：首页功能说明

### 实现
- 首页新增第四段「04 / 从阅读到判断」（`COGNITION_ENABLED=false` 时不渲染）、「功能一览」卡片区（基础 7 张，语音向导「小棱」卡仅在 `env.voiceGuideEnabled` 为真时显示）、接入区改为五个平台名加「连接 AI」「安装浏览器插件」双入口。
- 只使用 `globals.css` 的语义类：新增 `.mini-judgment` / `.mini-evidence` / `.feature-section` / `.feature-heading` / `.feature-grid` / `.feature-card` / `.feature-icon` / `.connection-cta`；卡片沿用 `.reading-card` 的表面、边框、16px 圆角与阴影，标题沿用 `.story-copy h2` 的字号字重。未引入 HeroUI 组件、Tailwind 圆角/字重类、CSS Module 或内联样式。
- 段落镜像规则由 `nth-child(2)` 改为 `nth-child(even)`；功能卡最后一张落单时横跨整行（3 列下 `3n+1`，2 列下 `odd`）。

### 验证结果
- `pnpm typecheck` 通过；`pnpm lint` 0 错误（83 条既有 warning，均不在首页文件）；`pnpm test` 40 个文件 236 个用例通过（首轮 `tests/mcp-widgets.test.ts` 在 widgets/dist 重建时偶发失败，重跑通过）。
- 浏览器检查 1440 / 768 / 390，浅色与深色：功能卡 3 / 2 / 1 列；第四段在 1440 镜像（示意在左），在 390 先文字后示意；接入区平台名在 390 换成两行，双按钮同行；`document.documentElement.scrollWidth <= window.innerWidth` 在三种宽度均成立；控制台无错误。
- 在 DOM 中临时移除语音卡后，最后一张卡在 1440 与 768 下均横跨整行（`grid-column: 1 / -1`）。
- 未重启服务验证 `COGNITION_ENABLED=false` 的实际渲染（3000 端口的开发服务器属于另一会话）；该分支只是 JSX 条件渲染，DOM 只剩 3 段时 `nth-child(even)` 仍只镜像第 02 段。

## 2026-09-14 · 新功能收口到同一套设计语言

日期：2026-09-14（晚）

### 问题

9/12–9/14 新加的功能（看分歧与依据、我的判断、Today 头部与简报、语音向导、对 Feed 说话、浏览器插件页、登录页、AI 写作检测）各自带了一套样式：`components/cognition/cognition.module.css` 是第二套私有设计系统，其余混用 HeroUI `Button/Chip/Alert/EmptyState` 与零散 Tailwind。同屏出现十种圆角、三套按钮；`/topics` `/reflections` 比其他页窄 44px；每张 Feed 卡片底部堆六条操作；文案是"系统在做什么"而不是"你能得到什么"；等待只有一行文字。

### 约定（新页面一律遵守）

- 页面壳：`.product-page` → `.product-heading`（eyebrow / h1 / p + `.product-heading-actions`）→ `.product-stack`。两栏用 `.feed-layout`（275px 侧栏）或 `.topic-layout`（340px 对话栏）。
- 面：`.product-surface`（区块）、`.reading-card`（内容）、卡内 `.surface-stack`（gap 16），列表 `.reading-list`（gap 16），区块之间 `.product-stack`（gap 24）。组件里不写 `mt-*` 或 inline margin。
- 控件：主按钮 `.pill-button pill-primary`，次按钮 `pill-secondary`，小尺寸加 `pill-small`；安静操作 `.text-control`（`-sm` / `-danger`）；图标 `.icon-control`；标签 `.tag`（`-accent` / `-warm`）；提示条 `.inline-note`（`-accent` / `-warm` / `-danger`，`.inline-note-actions` 放按钮）；表单 `.form-stack / .form-field / .form-check / .form-error / .search-field / .choice-row`；空态 `.empty-state`；弹窗 `.content-preview`；等待 `components/progress-panel.tsx`（阶段列表 + 预期时长，`slim` 版一行）。
- HeroUI 只保留没有全局等价物的功能件：Spinner、Skeleton、ProgressBar、Tabs、Stepper、TextField/Input/InputOTP/Label、Tooltip、Switch、BarChart、TextShimmer。文字箭头一律换 lucide 图标。
- 文案：第二人称、说结果不说机制；「小棱」「换个角度看」「帮我想清楚」和四个反馈标签保持不变（语音人设与 MCP 工具文档依赖）。
- 等待：每个会等的地方都有骨架或进度面板；`/feed` `/topics/[id]` `/reflections` `/profile` `/connect` `/extension` `/onboarding` 都有 `loading.tsx`，导航栏用 `AppNav pending` 画同高度的壳，不再闪一个只有 Logo 的假导航。

### 本次改动

- Feed 卡片：署名行只留一行操作（有帮助 / 不相关 / 看分歧与依据 / 更多），提要求、推荐理由、完整反馈和 AI 检测收进「更多」抽屉。视角卡回到 `.reading-card` 几何，反方回答常开，375px 不再裁切。
- Today 头部：h1 固定不随简报替换；语音入口是标题区一颗按钮，连接后才展开整宽面板；简报改为逐行列表。
- `/topics/[id]`、`/reflections`、首页沙盒示例：删除 `cognition.module.css`，全部改用上面的类；生成中显示三阶段进度面板 + 骨架。
- 登录、连接管理、授权同意、MCP 令牌、画像操作、错误页：HeroUI 按钮与提示条换成全局等价物。
- 可用性：写请求的跨源校验改为与本次请求同源（本地任意端口都能用，`launch.json` 不再 autoPort）；AI 写作检测对空白/版本/分段差异容错，已有任务读取失败可重读、提交失败可重发。

### 验证

- `pnpm typecheck`、`pnpm lint`（0 错误）、`pnpm test`（40 个文件 242 个用例）通过。
- 浏览器（Sol 的 :3000）检查 `/feed`、`/topics/[id]`（生成中 → 就绪）、`/reflections`、`/profile`、`/connect`、`/extension`、首页沙盒，1280 与 375 宽、浅色与深色；375 宽无横向溢出。
