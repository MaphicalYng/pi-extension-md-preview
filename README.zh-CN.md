# pi-extension-md-preview

[English](README.md) | 简体中文

一个 [Pi](https://github.com/earendil-works/pi-coding-agent) 扩展：把 Agent 编写的 Markdown 文件渲染成专业、简洁、现代的 Web 页面，并在浏览器中呈现给用户阅读。

面向「结构化内容呈现」场景——**只要 Agent 要输出的内容是结构化内容（报告、文档、多段落/多小节、表格、列表、代码示例等），且字符数大于 150，就必须调用本扩展**：写好 `.md` 文件后调用一次工具，浏览器自动打开排版好的页面；之后 Agent 无需保持工作，用户关闭标签页，预览服务自动退出。

## 功能特性

| 需求 | 实现 |
| --- | --- |
| Web 页面渲染 Markdown | 自研零依赖 Markdown 渲染器（GFM 风格）：标题、表格、围栏代码（25+ 语言高亮）、引用块（含 `[!NOTE]` 提示框）、任务列表、脚注、图片、自动链接 |
| Mermaid 图表 | `mermaid` 语言围栏代码块渲染为图表：前端动态加载预览服务同源提供的 mermaid 运行时，自动绘制流程图、时序图等 |
| Agent 主动呈现 + 自动开浏览器 | `md_preview` 工具：本地起服务 → 自动用系统默认浏览器打开标签页（macOS `open` / Linux `xdg-open` / Windows `start`），跨标签页去重（已打开则复用） |
| Agent 无需保持工作 | 工具立即返回；预览服务独立运行。用户关闭全部标签页 8 秒后（或浏览器标签从未打开 5 分钟后）服务自动退出；Pi 会话结束时兜底退出 |
| 双语界面（中 / 英） | Agent 启动预览时通过必填的 `ui_lang` 工具参数显式选择页面 UI 语言（根据用户语言选定）；页面右上角提供 中/EN 切换控件，读者可随时覆盖（`localStorage` 记忆） |
| 界面专业简洁现代 | 极简阅读版式、纸面纹理背景、页面进度条、目录导航（滚动高亮）、代码块「语言标签 + 一键复制」 |
| 必要动效 | 主题切换平滑过渡、TOC 指示器滑动、按钮悬停微交互、内容刷新淡入、滚动显示的「回到顶部」 |
| 明亮 / 黑暗模式 | 三档：跟随系统 / 强制明亮 / 强制黑暗（导航栏一键切换） |
| 字体大小调节 | A- / A+ 步进调节（每档 ±10%，范围 0.7× – 1.6×） |
| 行间距调节 | 范围 1.4 – 2.2（默认 1.75），顶栏步进调节 |
| 用户级全局记忆 | 主题、阅读背景、字号与行距持久化到用户配置文件（`$XDG_CONFIG_HOME/md-preview/settings.json`），跨会话、跨随机端口生效；浏览器 `localStorage` 作为同端口内的加速缓存 |
| 选中文字向 Agent 提问 | 页面内选中正文 → 浮动「提问」按钮 → 提问注入 pi 会话唤醒 Agent → 回复经 `md_preview_reply` 工具实时推回页面：文档左侧出现回复卡片（原文 / 回复内容 / 回复时间），原文橙色高亮 |
| 导出 HTML 快照 | 一键导出自包含离线 HTML：图片内联、当前主题/背景/字号/语言冻结、纯交互控件剥离——离线打开与在线预览观感一致 |
| 附赠 | **实时同步**：源文件被修改后页面自动刷新（SSE），无需重新调用工具 |

## 快速开始

### 以本地包安装（推荐）

```bash
pi install /Users/maphicalyng/code/mk_projects/pi-extension-md-preview
```

安装后重启 pi 会话即可。开发调试时可临时加载而不安装：

```bash
pi --extension /Users/maphicalyng/code/mk_projects/pi-extension-md-preview/extensions/md-preview/index.ts
```

### 在会话中使用

**Agent 主动调用**（推荐路径）：触发规则——输出内容为结构化内容（报告、调研结果、设计文档、多段落/多小节、表格、列表、代码示例等）且字符数大于 150 时**必须**调用，不得只在终端输出。调用前先 `write` 出 `.md` 文件：

```jsonc
// 工具调用
{
  "file": "/path/to/report.md",   // 必填：Markdown 文件（绝对路径或相对 cwd）
  "title": "2025 Q3 基础设施迁移报告",  // 可选：页面标题，默认取文档首个一级标题
  "ui_lang": "zh",                // 必填："en" | "zh"——必须根据用户语言选定
  "open_browser": true            // 可选：默认 true，自动打开浏览器
}
```

工具会返回页面地址；Agent 把地址发给用户即可继续其他工作，无需等待或轮询。对已预览的文档再次调用并传不同的 `ui_lang`，可热切换页面语言（经 SSE 实时同步到所有打开的标签页）。

**用户命令**：在会话里输入（支持 Tab 补全 Markdown 文件名）：

```
/md-preview reports/summary.md
/md-preview              # 列出当前预览中的文档
```

### 独立 Demo（无需 Pi 会话）

```bash
npm install
npm run demo               # 渲染示例报告并打开浏览器
npm run demo -- --smoke    # 无头冒烟测试：编译、起服务、断言渲染结果后退出
```

## 工作机制

```
Agent 写 .md ──► md_preview 工具 ──► 本地预览服务（127.0.0.1:随机端口）
                                        │
                 浏览器标签页 ◄── 自动打开 ┘
                        │  SSE：源文件变更 → 页面自动刷新
                        │  sendBeacon：标签页关闭 → viewer 计数 -1
                        ▼
   全部标签页关闭 8s 后服务自动退出（未打开过则 5 分钟后退出）
   Pi 会话 session_shutdown → 服务兜底退出
```

- **进程生命周期**：服务按需惰性启动（首次调用工具 / 命令时），不阻塞工具返回；退出判定在每 3 秒的轻量巡检中完成，无外部依赖。
- **选中提问链路**：页面提交 `POST /doc/{id}/ask` → 服务端落库并 SSE 广播 `ask` → 扩展经 `pi.sendUserMessage`（`deliverAs: "followUp"`）把提问注入会话；Agent 阅读相关文件后调用 `md_preview_reply` 工具 → 服务端渲染 Markdown 并 SSE 广播 `answer` → 所有打开该文档的标签页左侧出现回复卡片，原文橙色高亮。
- **跨标签页去重**：同一文件多标签页共享一个文档渲染；源文件修改后所有标签页一起刷新。
- **UI 语言**：`md_preview` 工具要求显式传 `ui_lang`（`"en"` 或 `"zh"`），由 Agent 根据用户语言选定；`/md-preview` 命令则按 `MD_PREVIEW_LANG` 环境变量 > `"en"` 解析（文档首次打开时确定）。页面内的 中/EN 切换控件优先级高于服务端下发值，并按浏览器源记忆在 `localStorage`（`mdp.lang`）。语言刻意**不**写入用户级偏好文件。
- **下载原文**：顶部工具栏一键下载当前文档的 Markdown 源文件（`GET /doc/{id}/download`，`Content-Disposition: attachment`，始终读磁盘最新内容）。
- **导出 HTML**：一键生成独立快照——克隆在线 DOM、净化、冻结（当前主题/背景/字号/行距/语言）、图片内联为 data URL，并剥离纯交互控件（导出/下载按钮、提问面板、语言切换）。Mermaid 图表配色保持导出瞬间的主题（已知限制）。
- **Markdown 链接路由**：相对链接指向 Markdown 文件时在同页打开新文档（并纳入实时同步），指向图片 / 附件时按静态资源提供；链接解析被限制在（会话工作目录 ∪ 预览文档目录）之内，其他路径的链接在浏览器中标记为不可用。

## 页面功能速览

- 左侧目录（≥2 个标题时显示）：随滚动高亮当前章节，点击平滑滚动，移动端抽屉式展开。
- 顶部工具栏：主题三档切换（系统 / 明亮 / 黑暗）、阅读背景四色切换（纯白 / 暗白 / 木色 / 青色，浅色为纸面配色、深色为对应暗色变体）、字体调节（A- / A+）、行距步进调节（1.4 – 2.2）、语言切换（中 / EN）、下载当前文档、导出 HTML、页面进度条。
- 代码块：语言标签、一键复制（复制成功有反馈动画）、按语言高亮；不支持的语言降级为纯文本。
- 选中提问：选中正文后点浮动「提问」按钮输入问题；Agent 回复后卡片出现在文档左侧，含原文、回复内容与回复时间，被引用原文橙色高亮。
- 页脚显示当前版本：提交日期 + 短 commit id（源自 git，工作区有未提交改动时追加 `-dirty`；无 git 环境不显示）。
- 阅读体验：`scroll-margin-top` 保证锚点跳转不被顶栏遮挡，窄屏自适应（TOC 折叠、表格横向滚动）。

## 项目结构

```
extensions/md-preview/
├── index.ts       # 扩展入口：md_preview / md_preview_reply 工具 + /md-preview 命令 + 会话退出兜底
├── render.ts      # 零依赖 Markdown → HTML 渲染器（GFM 子集 + 代码高亮）
├── page.ts        # 页面模板：CSS 主题系统 + 交互脚本（TOC/主题/字号/实时刷新/选中提问/导出）
├── page-i18n.ts   # 双语 UI 文案表（en/zh）+ 语言归一化
├── server.ts      # 本地 HTTP 服务：路由、SSE 实时同步、viewer 计数、自动退出、/prefs、/doc/{id}/ask、/doc/{id}/download
├── prefs.ts       # 用户级偏好（主题/背景/字号/行距）：读取、校验、原子落盘、防抖写入
└── browser.ts     # 跨平台默认浏览器打开
scripts/
├── check.mjs             # npm run check：链接宿主类型定义并做严格 TypeScript 检查
├── i18n-check.mjs        # 语言优先级 / openDocument 契约 / SSE lang 断言
├── page-i18n-check.mjs   # 文案表对齐、文案安全、双语渲染断言
└── demo.mjs              # npm run demo：独立渲染演示 / --smoke 冒烟测试
```

Pi 通过 jiti 直接加载 TypeScript 源码，无需构建步骤；`tsconfig.json` 仅用于类型检查（`npm run check`），`tsconfig.demo.json` 仅用于把无宿主依赖的模块编译成 demo 可用的 CommonJS。

## 配置

| 环境变量 | 作用 |
| --- | --- |
| `MD_PREVIEW_HOST` | 绑定地址，默认 `127.0.0.1`（安全默认，不对外网开放） |
| `MD_PREVIEW_THEME` | 初始主题提示 `system` / `light` / `dark`（仅在用户未手动选择主题前生效） |
| `MD_PREVIEW_LANG` | 兜底 UI 语言 `en` / `zh`（供 `/md-preview` 命令使用；`md_preview` 工具始终显式传 `ui_lang`） |

### 用户级偏好持久化

主题、阅读背景、字号与行距的持久化分两层：

1. **用户级（全局）**：`$XDG_CONFIG_HOME/md-preview/settings.json`（未设置 `XDG_CONFIG_HOME` 时为 `~/.config/md-preview/settings.json`）。页面上的切换会防抖上报到 `POST /prefs`，原子落盘；下次任意会话、任意随机端口的预览页都会带上这份偏好。
2. **浏览器 `localStorage`**（`mdp.theme` / `mdp.bg` / `mdp.scale` / `mdp.lineHeight` / `mdp.lang`）：同源加速缓存，同一会话内立即生效；跨端口失效时由用户级偏好兜底。

加载优先级：`localStorage`（同端口内最近一次操作）> 用户偏好文件 > `MD_PREVIEW_THEME` 环境变量 > 内置默认（跟随系统、纯白背景、字号 100%、行距 1.75）。背景与行距不参与环境变量提示，未设置时直接回退内置默认。UI 语言走独立链路：页面内 `localStorage` 选择 > 服务端下发语言（工具参数 / 环境变量 / 默认）。

偏好文件示例：

```json
{
  "theme": "dark",
  "bg": "wood",
  "scale": 1.15,
  "lineHeight": 1.75
}
```

向 `POST /prefs` 发送显式 `null`（如 `{"theme": null}`）可将对应键重置回默认。

### 选中文字向 Agent 提问

阅读时选中任意正文，点浮动「✦ 提问」按钮输入问题（Enter 发送）。服务端创建问答记录并广播 SSE `ask` 事件，扩展随即把提问以用户消息形式注入 pi 会话（`deliverAs: "followUp"`：空闲立即唤起，忙碌排队到当前回合结束）。Agent 结合仓库里的相关文件作答后，调用 `md_preview_reply` 工具：

```jsonc
// 工具调用（question_id 省略时回复最早未回复的提问）
{ "question_id": "q1", "text": "这段延迟下降主要来自缓存命中率提升…（支持 Markdown）" }
```

回复以卡片形式实时出现在**文档左侧**（所有打开该文档的标签页同步），卡片包含原文、回复内容与回复时间；被引用的原文在正文中以橙色高亮。问答随服务端存活，刷新 / 重开页面后卡片与高亮自动恢复（高亮按原文文本回定位，跨元素选择的原文在恢复时可能无法重新高亮，卡片不受影响）。Agent 未回复时卡片显示「等待 Agent 回复…」。窄屏（<1080px）下左栏隐藏，仅保留橙色高亮。

## 安全考量

- 服务只绑定回环地址，页面自身不发起任何外部网络请求（无 CDN、无外链资源）。
- Mermaid 图表运行时由预览服务同源提供（`/mermaid.mjs`），图表渲染不产生任何外部请求。
- 静态资源与链接解析均校验路径必须落在（会话工作目录 ∪ 预览文档目录）之内；未知文件类型返回 404，`text/html` 等危险类型强制以 `text/plain` 提供。
- 扩展执行不调用 shell：打开浏览器走 `spawn`（`open` / `xdg-open` / `cmd start`）并立即 `unref`，失败时仅降级为「请手动访问地址」；页脚版本号仅在首次渲染时向扩展根目录 `spawn` 一次 `git`（不经 shell，每进程缓存），失败时静默降级为不显示。
- 端口随机（`listen(0)`），关闭事件经 `sendBeacon` + SSE 断连双重判定，服务退出幂等。

## 已知限制

- Markdown 支持 GFM 常用子集；`<details>` 等内嵌 HTML 按转义文本处理（保证渲染安全）。
- 代码高亮为内置词法规则（25+ 常见语言），不支持的语言渲染为纯文本代码块；`mermaid` 语言围栏块不走高亮，渲染为 Mermaid 图表。
- 「关闭标签页 8 秒后退出」是设计选择而非缺陷：短暂的刷新 / 网络抖动不会误杀预览；重新调用工具即可随时恢复。
- 导出的 HTML 快照中，Mermaid 图表配色保持导出瞬间的主题，快照内切换主题不会改变图表配色。

## 开发

```bash
npm install                 # 安装类型检查依赖
npm run check               # 严格 TypeScript 检查（推荐每次改动后运行）
npm run check:i18n          # 双语文案表 + 语言通道断言
npm run demo -- --smoke     # 端到端冒烟：渲染 + 服务 + SSE
```
