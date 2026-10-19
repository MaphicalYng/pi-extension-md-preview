<p align="center"><img src="assets/logo/logo-512.png" width="104" alt=""></p>

# pi-md-preview

[English](README.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/pi-md-preview)](https://www.npmjs.com/package/pi-md-preview)
[![npm downloads](https://img.shields.io/npm/dm/pi-md-preview)](https://www.npmjs.com/package/pi-md-preview)
[![pi.dev 包页面](https://img.shields.io/badge/pi.dev-package_page-8B5CF6)](https://pi.dev/packages/pi-md-preview)
[![license](https://img.shields.io/npm/l/pi-md-preview)](LICENSE)

一个 [Pi](https://github.com/earendil-works/pi-coding-agent) 扩展：把 Agent 编写的 Markdown 文件渲染成专业、简洁、现代的 Web 页面，并在浏览器中呈现给用户阅读。

面向「结构化内容呈现」场景——**只要 Agent 要输出的内容是结构化内容（报告、文档、多段落/多小节、表格、列表、代码示例等），且字符数大于 150，就必须调用本扩展**：写好 `.md` 文件后调用一次工具，浏览器自动打开排版好的页面；之后 Agent 无需保持工作，用户关闭标签页，预览服务自动退出。

## 功能特性

| 需求 | 实现 |
| --- | --- |
| Agent 主动呈现 + 自动开浏览器 | `md_preview` 工具：本地起服务 → 自动用系统默认浏览器打开标签页（macOS `open` / Linux `xdg-open` / Windows `start`），跨标签页去重（已打开则复用）；`/md-preview <file> --host <ip>` 可指定标签页打开的 IP，`/md-preview-host <ip>` 可把该 host 持久化到用户级配置，所有 pi 实例自动使用 |
| Agent 无需保持工作 | 工具立即返回；预览服务独立运行。用户关闭全部标签页 8 秒后（或浏览器标签从未打开 5 分钟后）服务自动退出；Pi 会话结束时兜底退出 |
| 选中文字向 Agent 提问 | 页面内选中正文 → 浮动「提问」按钮 → 提问注入 pi 会话唤醒 Agent → 回复经 `md_preview_reply` 工具实时推回页面：文档左侧出现回复卡片（原文 / 回复内容 / 回复时间），原文橙色高亮 |
| 批量暂存提问 | 选中文字 → 「✦ 提问」→ 输入问题后点「暂存」把问题放进队列并关闭面板（顶栏「问答」按钮显示待发送条数）；之后点一次即经 `POST /doc/<id>/ask-batch` 把整批提交（URL 带 token），Agent 逐条调用 `md_preview_reply`，回复分别落在各自的问答卡片中 |
| 页面底部与 Agent 对话 | 页面底部提供「与 Agent 对话」聊天区：无需选中文字，可就整篇文档提问；消息连同最近几轮对话摘要注入 pi 会话，Agent 经 `md_preview_reply` 回复后以「Agent」消息出现在聊天区（最新在上），刷新 / 重开页面后自动恢复 |
| 批量暂存修订 | 选中文字 → 「✎ 修订」→ 写下修订意见后「暂存」（顶栏「修订」按钮显示条数）；点一次经 `POST /doc/<id>/revise` 整批提交，Agent 直接更新 Markdown 文件、**不逐条回复消息**，完成后调用 `md_preview_revision_done`（`doc?`、`highlights?`），页面把改过的段落以色块短暂标记后淡出（约 3 秒） |
| Web 页面渲染 Markdown | 基于 `marked` 的 GFM 渲染器：标题、表格、围栏代码（25+ 语言高亮）、引用块（含 `[!NOTE]` … `[!CAUTION]` 提示框）、任务列表、脚注、图片、自动链接 |
| Mermaid 图表 | `mermaid` 语言围栏代码块渲染为图表：前端动态加载预览服务同源提供的 mermaid 运行时，自动绘制流程图、时序图等 |
| 双语界面（中 / 英） | Agent 启动预览时通过必填的 `ui_lang` 工具参数显式选择页面 UI 语言（根据用户语言选定）；页面右上角提供 中/EN 切换控件，读者可随时覆盖（`localStorage` 记忆） |
| 界面专业简洁现代 | 极简阅读版式、纸面纹理背景、页面进度条、目录导航（滚动高亮）、代码块「语言标签 + 一键复制」 |
| 必要动效 | 主题切换平滑过渡、TOC 指示器滑动、按钮悬停微交互、内容刷新淡入、滚动显示的「回到顶部」 |
| 明亮 / 黑暗模式 | 三档：跟随系统 / 强制明亮 / 强制黑暗（导航栏一键切换） |
| 字体大小调节 | A- / A+ 步进调节（每档 ±10%，范围 0.7× – 1.6×） |
| 行间距调节 | 范围 1.4 – 2.2（默认 1.75），顶栏步进调节 |
| 用户级全局记忆 | 主题、阅读背景、字号与行距持久化到用户配置文件（`$XDG_CONFIG_HOME/md-preview/settings.json`），跨会话、跨随机端口生效；浏览器 `localStorage` 作为同端口内的加速缓存 |
| 导出 HTML 快照 | 一键导出自包含离线 HTML：图片内联、当前主题/背景/字号/语言冻结、纯交互控件剥离——离线打开与在线预览观感一致 |
| 附赠 | **实时同步**：源文件被修改后页面自动刷新（SSE），无需重新调用工具 |

## 快速开始

### 从 npm 安装

包发布在 npm：[`pi-md-preview`](https://www.npmjs.com/package/pi-md-preview)；Pi 官网上也有对应的包页面（含 manifest 与 README）：[`pi.dev/packages/pi-md-preview`](https://pi.dev/packages/pi-md-preview)。

```bash
pi install npm:pi-md-preview@0.4.0
```

安装后重启 pi 会话即可。只想临时试用一次、不写入 settings：

```bash
pi -e npm:pi-md-preview
```

### 以本地包安装（开发调试）

clone 本仓库后：

```bash
pi install ./pi-extension-md-preview
```

或临时加载而不安装：

```bash
pi --extension ./extensions/md-preview/index.ts
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
/md-preview reports/summary.md --host 192.0.2.10     # 以该 IP 打开标签页（服务需监听 0.0.0.0）
/md-preview-host 192.0.2.20                          # 持久化浏览器 host，所有预览都用它
/md-preview-host --clear                             # 清除该设置，回落到服务绑定地址
/md-preview              # 列出当前预览中的文档
```

`--host` 只替换打开/分享 URL 的 host，端口与 `?token=` 访问令牌原样保留，详见下文「监听地址与访问 Token」。

浏览器 host 在每次预览调用时解析，优先级为 **显式 `--host` > 持久化的 `browserHost` > 服务绑定地址**（通配符绑定时为 `127.0.0.1`）。持久化值在调用时读取，所以**已经在运行的 pi 实例在下一次预览就会生效**——不需要 `/reload`，也不需要重启。

### 独立 Demo（无需 Pi 会话）

```bash
npm install
npm run demo               # 渲染示例报告并打开浏览器
npm run demo -- --smoke    # 无头冒烟测试：编译、起服务、断言渲染结果后退出
```

## 工作机制

```
Agent 写 .md ──► md_preview 工具 ──► 本地预览服务（127.0.0.1:随机端口，URL 带 token 鉴权）
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
- **批量链路**：暂存队列以一次请求送出——`POST /doc/{id}/ask-batch` 或 `POST /doc/{id}/revise`（与其他路由一样需 token 鉴权）——扩展按批只唤醒 Agent 一次（`onAsk` / `onRevise`），不再逐条唤醒。提问批拆成每条一条问答记录，各自用自己的 `question_id` 调 `md_preview_reply`，卡片逐张填充；修订批不产生任何问答记录——文件就是交付物，`md_preview_revision_done` 是收尾步骤，负责推送新 HTML 并广播会淡出的高亮标记。每篇文档只保留最新一批（更早且未完成的批次会被取代）。
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
- 暂存队列：顶栏「问答」/「修订」按钮带暂存条数徽标（为 0 时隐藏，发送中禁用），点一次即把该队列整批发出；发送失败时条目与徽标原样保留。
- 修订高亮：批次被标记完成后，命中段落出现色块，保持约 2 秒、约 3 秒内淡出消失；在此期间刷新页面会按原时间表重放。
- 页脚显示当前版本：提交日期 + 短 commit id（源自 git，工作区有未提交改动时追加 `-dirty`；无 git 环境不显示）。
- 阅读体验：`scroll-margin-top` 保证锚点跳转不被顶栏遮挡，窄屏自适应（TOC 折叠、表格横向滚动）。

## 项目结构

```
extensions/md-preview/
├── index.ts       # 扩展入口：md_preview / md_preview_reply / md_preview_revision_done 工具 + /md-preview 与 /md-preview-host 命令 + 会话退出兜底
├── render.ts      # Markdown → HTML 渲染器（marked/GFM）：目录、锚点、提示框、脚注、代码块骨架
├── page.ts        # 页面模板：CSS 主题系统 + 交互脚本（目录/主题/字号/行距/代码高亮/实时刷新/提问/对话/暂存队列/修订高亮/导出）
├── page-i18n.ts   # 双语 UI 文案表（en/zh）+ 语言归一化
├── server.ts      # 本地 HTTP 服务：路由、SSE 实时同步、viewer 计数、自动退出、/prefs、/doc/{id}/ask、/doc/{id}/ask-batch、/doc/{id}/revise、/doc/{id}/download
├── prefs.ts       # 用户级偏好（主题/背景/字号/行距 + 持久化浏览器 host）：读取、校验、原子落盘、防抖写入
├── vendor/        # 内置的自包含 Mermaid ESM 构建（MIT），由预览服务按需同源提供
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
| `MD_PREVIEW_BIND` | 绑定地址，默认 `127.0.0.1`。设为 `0.0.0.0`（或具体网卡 IP）可供其他机器访问。**在预览服务启动时（会话首次预览）读取**；会话中途改动需重启 pi 会话才生效。它只决定**绑定**地址；浏览器打开的 host 由持久化设置（`/md-preview-host`）与 `--host` 决定。旧名 `MD_PREVIEW_HOST` 仍作为已弃用别名兼容，两者同时设置时以 `MD_PREVIEW_BIND` 为准 |
| `MD_PREVIEW_TOKEN` | 固定访问令牌，覆盖启动时生成的随机 URL-safe token（便于远程使用固定链接）；所有页面 URL 均携带 `?token=` |
| `MD_PREVIEW_THEME` | 初始主题提示 `system` / `light` / `dark`（仅在用户未手动选择主题前生效） |
| `MD_PREVIEW_LANG` | 兜底 UI 语言 `en` / `zh`（供 `/md-preview` 命令使用；`md_preview` 工具始终显式传 `ui_lang`） |

### 监听地址与访问 Token

预览 HTTP 服务默认私有：只绑定 `127.0.0.1`，且**所有**路由——文档页面、`/prefs`、SSE 流、`/asset/*` 以及全部 `/doc/*` 子路由（events / close / ask / chat / download）——都必须携带本次会话的访问令牌（query 参数 `?token=`）。**本地请求同样校验**：缺令牌或令牌错误一律返回 `401`。令牌在服务启动时随机生成（URL-safe），也可用 `MD_PREVIEW_TOKEN` 固定。

扩展打印的所有 URL（工具返回、命令输出）都已带令牌，复制分享时请完整保留——**删掉 `?token=...` 会直接 401**。

要让其他机器访问，先显式绑定可达地址，再用命令指定浏览器打开的 IP：

```bash
MD_PREVIEW_BIND=0.0.0.0 pi

# 会话内
/md-preview reports/summary.md                     # -> http://127.0.0.1:<端口>/doc/<id>?token=…
/md-preview reports/summary.md --host 192.0.2.10 # -> http://192.0.2.10:<端口>/doc/<id>?token=…
```

- `--host <ip>` 只决定浏览器与该分享 URL 使用哪个 host；端口与 `?token=` 始终与服务端一致。支持 `--host <ip>`、`--host=<ip>`、`--host "<ip>"` 三种写法，放在文件名前后均可。
- `/md-preview-host <ip|hostname>` 把浏览器 host 持久化到用户级配置：凡未指定 `--host` 的预览都使用它，本实例和其他 pi 实例一律生效（调用时读取）。`/md-preview-host` 无参时显示持久化值、下次预览实际生效值与来源、配置文件路径；`/md-preview-host --clear` 清除。持久化 host 超出监听范围时仍可使用，会给出下方同样的警告。
- 绑定 `0.0.0.0`（或 `::`）且既未指定 `--host` 也未持久化 host 时，浏览器以 `127.0.0.1` 打开（本地阅读视角）；远程读者需 `--host <对端可达的 IP>`（或自行替换 IP），并保留 `?token=`。
- `--host` 指定的地址不在监听范围内（例如监听 `127.0.0.1` 却要求局域网 IP）时仍会预览，但命令输出与通知会给出警告，提示用 `MD_PREVIEW_BIND=0.0.0.0` 重启 pi：预览服务是**会话级单例**，中途改环境变量不会让已在运行的服务重新绑定。
- `--host` 写法错误（缺值、重复，或写成 `http://host` 这类 URL）会直接报错，**不会打开浏览器**。

> 完整远程案例（pi 在远程服务器、浏览器在本地、含 Agent 对话链路与 SSH 隧道方案）：见 [远程访问指南](docs/remote-access.zh-CN.md)。

### 用户级偏好持久化

主题、阅读背景、字号与行距的持久化分两层：

1. **用户级（全局）**：`$XDG_CONFIG_HOME/md-preview/settings.json`（未设置 `XDG_CONFIG_HOME` 时为 `~/.config/md-preview/settings.json`）。页面上的切换会防抖上报到 `POST /prefs`，原子落盘；下次任意会话、任意随机端口的预览页都会带上这份偏好。
2. **浏览器 `localStorage`**（`mdp.theme` / `mdp.bg` / `mdp.scale` / `mdp.lineHeight` / `mdp.lang`）：同源加速缓存，同一会话内立即生效；跨端口失效时由用户级偏好兜底。

加载优先级：`localStorage`（同端口内最近一次操作）> 用户偏好文件 > `MD_PREVIEW_THEME` 环境变量 > 内置默认（跟随系统、纯白背景、字号 100%、行距 1.75）。背景与行距不参与环境变量提示，未设置时直接回退内置默认。UI 语言走独立链路：页面内 `localStorage` 选择 > 服务端下发语言（工具参数 / 环境变量 / 默认）。

`browserHost` 是唯一的例外：它**只有用户级一层**。页面端写不了它——`POST /prefs` 只接受页面可控的四个键（`theme` / `bg` / `scale` / `lineHeight`），服务端也按这四个键白名单过滤，所以页面请求永远改不到持久化的 host。它由 `/md-preview-host` 命令写入，每次预览按 `--host` > 持久化的 `browserHost` > `localBrowserHost(server.host)`（通配符绑定时为 `127.0.0.1`）解析。

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

需要一次问多处时，见下文「批量暂存提问与修订」。

### 批量暂存提问与修订

两个浮动按钮都可以先把工作暂存起来，不立即发送。

**提问**：选中文字 → 「✦ 提问」→ 写问题 → 点「暂存」而不是「发送」。面板关闭，草稿进入队列，顶栏「问答」按钮上出现条数徽标。可以继续为其他段落暂存，之后点一次「问答」：页面 POST `/doc/<id>/ask-batch`，扩展只唤醒 Agent 一次，把整批条目（各自带 `question_id`）一起交给它。面板里的「发送」行为相同——先把当前草稿暂存，再发送整个队列，所以写到一半的问题不会丢。Agent 逐条回复：

```jsonc
// 每条暂存提问对应一次 md_preview_reply
{ "question_id": "q4", "text": "…（支持 Markdown）" }
```

每条回复落在各自条目的问答卡片里，与单条提问完全一致：卡片先显示「等待回复…」，答案到达后逐张填充。发送失败时队列原样保留（toast 会说明），不会丢条目。

**修订**：选中文字 → 「✎ 修订」→ 描述想要的改动 → 「暂存」或「发送」；顶栏「修订」按钮显示队列条数，点击后经 `POST /doc/<id>/revise` 整批提交。注入给 Agent 的是一条明确的**文档修改请求**：Agent 直接就地修改 Markdown 文件，**不**通过 `md_preview_reply` 回复，也不发聊天消息——改好的文档是唯一交付物，因此不会出现回复卡片。

文件保存后，Agent 用一次调用收尾：

```jsonc
// 工具调用——每批一次，确认改动已落盘后
{
  "doc": "d1",                       // 可选：文档 id 或其 Markdown 路径；省略则针对最近预览的文档
  "highlights": ["缓存命中率", "p95 降到 180 ms"]  // 可选：每个被修改段落一句原文短语
}
```

该工具会重新渲染文档，先把新 HTML 推给所有打开的标签页，再广播 `revision-done`。页面弹出「修订完成，文档已更新」toast，并把命中的段落以色块标记：色块保持约 2 秒，约 3 秒内淡出消失。`highlights` 是纯文本定位短语，从改后的正文里原样复制（渲染后的正文不含 `**`、反引号等 Markdown 标记，请传纯文本），每批最多 20 条、每条最长 300 字符。该调用**幂等**：对同一批次重复调用不会刷新时间戳，因此不会延长高亮窗口——重复调用只会更新标记哪些段落（省略 `highlights` 时沿用上一次的列表）。在窗口内刷新页面，标记会按原时间表重放。

**上限与旧服务端**：单批最多暂存 20 条，第 21 条会在暂存时被拒绝并弹出提示，因此队列总能整批发送。页面没有逐个删除暂存条目的控件，也没有整体清空入口——只能整批发送。两个端点都以带会话 token 的 URL 注入页面。若服务端未提供 `askBatchUrl` / `reviseUrl`（旧版扩展），页面会隐藏对应的队列按钮、隐藏该面板里的「暂存」按钮，并整体隐藏「✎ 修订」入口；提问面板的「发送」回落到传统的单条 `POST /doc/{id}/ask`，因此原有的单条问答链路照常可用，只是没有队列。

## 安全考量

- 服务默认只绑定回环地址。**所有路由（包括本机发起的请求）都必须携带 `?token=` 访问令牌**，缺失或错误一律 401。对外开放是显式 opt-in（`MD_PREVIEW_BIND`），且即使开放仍需令牌；页面自身不发起任何外部网络请求（无 CDN、无外链资源）。
- 令牌随 URL 进入浏览器历史与终端记录——这是「链接即凭证」设计固有的取舍；需要固定已知链接时用 `MD_PREVIEW_TOKEN` 固定。`--host` 只改变打开/分享 URL 的 host，**不放宽任何鉴权**。
- Mermaid 图表运行时由预览服务同源提供（`/mermaid.mjs`），图表渲染不产生任何外部请求。
- 静态资源与链接解析均校验路径必须落在（会话工作目录 ∪ 预览文档目录）之内；未知文件类型返回 404，`text/html` 等危险类型强制以 `text/plain` 提供。
- 扩展执行不调用 shell：打开浏览器走 `spawn`（`open` / `xdg-open` / `cmd start`）并立即 `unref`，失败时仅降级为「请手动访问地址」；页脚版本号仅在首次渲染时向扩展根目录 `spawn` 一次 `git`（不经 shell，每进程缓存），失败时静默降级为不显示。
- 端口随机（`listen(0)`），关闭事件经 `sendBeacon` + SSE 断连双重判定，服务退出幂等。

## 已知限制

- Markdown 支持 GFM 常用子集；`<details>` 等内嵌 HTML 按转义文本处理（保证渲染安全）。
- 代码高亮由页面端内置词法规则实现（25+ 常见语言），不支持的语言渲染为纯文本代码块；`mermaid` 语言围栏块不走高亮，渲染为 Mermaid 图表。
- 「关闭标签页 8 秒后退出」是设计选择而非缺陷：短暂的刷新 / 网络抖动不会误杀预览；重新调用工具即可随时恢复。
- 导出的 HTML 快照中，Mermaid 图表配色保持导出瞬间的主题，快照内切换主题不会改变图表配色。
- 单批最多 20 条，第 21 条在暂存时即被拒绝，队列因此总能整批发送；页面没有逐个删除或清空队列的控件。
- 修订高亮的定位依赖纯文本短语：跨行内元素的短语（或与改后正文已不一致的短语）不会产生标记，工具的返回里会列出未命中的条目。

## 开发

```bash
npm install                 # 安装类型检查依赖
npm run check               # 严格 TypeScript 检查（推荐每次改动后运行）
npm run check:i18n          # 双语文案表 + 语言通道断言
npm run demo -- --smoke     # 端到端冒烟：渲染 + 服务 + SSE
```

## 许可证

MIT。本包内含一份自包含的 [Mermaid](https://github.com/mermaid-js/mermaid) 构建产物（`extensions/md-preview/vendor/mermaid.esm.min.mjs`，MIT 许可），由预览服务器同源懒加载——详见 `NOTICE`。
