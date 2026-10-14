# web-export 功能实施报告：md-preview 预览页「导出 HTML」

> 需求：预览页新增导出功能，将当前 md 文档的最终渲染效果 + 当前已完成的 Agent 回复，一起导出为独立 HTML 文件，离线打开后显示效果与当前 preview 一致。
>
> 执行方式：pi 子 Agent 多角色工作流（PM 拆解 → 架构师出方案 → 工程师实施 → 验收评审 → PM 汇总）。

---

## 1. 需求拆分

需求归为单一模块 **`web-export`**（变更集中在一个页面模板文件，无并行拆分空间）：

| 模块 | 范围 | 需求 |
| --- | --- | --- |
| web-export | `extensions/md-preview/page.ts`（按钮 + 导出逻辑）、`scripts/demo.mjs`（断言） | 工具栏新增导出按钮，一键导出「文档渲染效果 + 已完成 Agent 回复卡片」为离线可用的单文件 HTML |

## 2. 各角色任务及完成情况

| 角色 | 模型 | 会话 slug | 产出 | 状态 |
| --- | --- | --- | --- | --- |
| PM（主 Agent） | kimi-for-coding | —（主会话） | 模块拆分、派单、抽查、汇总 | ✅ |
| 架构师 | xiaomi/mimo-v2.6-pro | `web-export-arch` | `docs/web-export-plan.md` 实施方案 | ✅ |
| 工程师 | deepseek/deepseek-flash（thinking max） | `web-export-impl` | 代码实施 + 自测 | ✅ |
| 验收 | kimi-coding/kimi-for-coding | `web-export-review` | 评审结果：A1–A7 全部符合，**合格** | ✅ |

**回炉轮数：0**（一次通过）。

## 3. 方案要点（架构师）

**路线结论：客户端 DOM 序列化导出**（克隆 → 净化 → 冻结状态 → Blob 下载），不走服务端 `/export` 端点。理由：mermaid SVG、代码高亮 span、QA 卡片绝对定位、当前主题/字号都只存在于客户端 DOM 运行时状态，服务端无法忠实复现；且导入口径本来就在页面上。`server.ts` / `index.ts` / `render.ts` / `prefs.ts` **零改动**。

关键设计：

- **冻结外观**：导出时把当前主题（system 解析为具体亮/暗）、背景、字号、行距固化为 `<html>` data 属性与 CSS 变量，剥离 THEME_BOOT 防止 localStorage 重算漂移。
- **净化**：删除全部 `<script>`、导出/下载按钮、提问面板、进度条；live-pill 换成「离线导出 · 时间」静态徽标；mermaid 已渲染 SVG 直接序列化。
- **QA 卡片**：已完成回复原样保留；等待中的提问保留卡片并静态标注「⏳ 导出时该提问尚未回复」（保真且不丢提问痕迹）；无卡片时移除 qa-rail。
- **离线运行时 `EXPORT_JS`（~100 行）**：导出件内复制按钮、回到顶部、主题/背景/字号/行距切换仍可用；**不写 localStorage、不发任何请求**（不污染在线偏好）。
- **离线资源**：同源 `/asset/` 图片内联为 data URL；mermaid 渲染竞态等待 ~3s 兜底。
- **隐私**：导出时 `.doc-sub` 的本地绝对路径替换为仅文件名。
- **转义**：`EXPORT_JS` 经 `JSON.stringify` + `\u003c` 注入，规避模板字符串手写转义。

## 4. 变更清单（工程师）

- **`extensions/md-preview/page.ts`（+352 行）**：`icon()` 新增 `export` 图标；工具栏下载按钮旁新增 `#exportBtn`；CSS 放宽 `.seg .dl-btn` 并补 `button.dl-btn` / `.dl-btn.busy`；新增顶层 `EXPORT_JS` 常量；PAGE_JS 新增导出小节（`buildExportDocument` + 点击绑定 + busy 防双击 + 三态 toast）。
- **`scripts/demo.mjs`（+4 行）**：`--smoke` 追加 2 条断言（`id="exportBtn"`、「离线导出」运行时标记），旧断言零改动。

## 5. 测试用例与结果

| 用例 | 执行方 | 结果 |
| --- | --- | --- |
| `npm run check`（tsc strict） | 工程师 + PM 复跑 + 验收复跑 | ✅ 三方均通过 |
| `npm run demo -- --smoke`（含 SSE/prefs/问答推送 + 2 条新断言） | 工程师 + PM 复跑 + 验收复跑 | ✅ 通过，旧断言零回归 |
| 负向对照（改坏断言能检出失败） | 工程师 | ✅ 2 次均能检出 |
| 注入转义专项（43 项：无未转义 `<`、无反引号/`${}`、合法 JS、无 localStorage/网络请求） | 工程师 | ✅ 全通过 |
| curl 取证（exportBtn/「离线导出」命中、页内 0 外链资源、`\u003c` 转义正确） | 验收 | ✅ |
| 浏览器端到端（断网 + 关服务器后 `file://` 打开导出件逐项核对） | — | ⚠️ **未执行**（子 Agent 环境限制），建议合并前手动/用 tabbit 补验 |

## 6. 验收结论（验收子 Agent）

**合格（代码级）**，A1–A7 逐条符合，依据含文件行号与命令输出。非阻塞观察项 1 条：

- mermaid 渲染超时导出的件中 loading 脉冲动画会离线继续闪（可后续在超时分支清 `data-status`，一行修复）。

## 7. 遗留风险与后续建议

1. **端到端未验证**（最重要）：当前会话的 live 预览扩展加载自 git 源，不含本工作区未提交改动。验证步骤：提交后更新扩展（或 `pi install` 指向本检出）→ 打开预览页 → 制造复杂状态（深色 + 背景 + 字号 + 1 答 1 待 QA + mermaid + 代码块）→ 点导出 → 断网/关服务器后打开导出件逐项核对（方案 §3 第 3 条清单）。
2. 导出件内切主题后 mermaid SVG 配色不重渲染（无 mermaid.mjs，已知取舍）。
3. 导出件中外链图片与 `/doc/`、`/asset/` 文内链接离线不可用（文档化的已知限制）。
4. QA 卡片绝对定位基于导出时视口宽度，离线打开窗口宽度差异大时可能错位（窄屏 <1080px 由 media query 隐藏，反而安全）。

## 8. 追溯

- 方案文档：`docs/web-export-plan.md`
- 子 Agent 会话：`pi --session web-export-arch` / `web-export-impl` / `web-export-review`（存档于 `~/.pi/agent/sessions/`）
- 改动未提交，可用 `git diff` 查看；如需提交可按仓库惯例（Conventional Commits + AI 署名 trailer）。
