# web-export 实施方案：md-preview 预览页「导出 HTML」

> 目标：预览页点击按钮，把当前 md 文档的最终渲染效果 + 已完成的 Agent 回复（问答卡片）导出为**一个独立 HTML 文件**，离线打开后显示效果与当前 preview 页面一致。
>
> 范围：主要 `extensions/md-preview/page.ts`（模板 + 内联 JS + CSS）；`server.ts` 结论上不需要改（见 §2.1）。

---

## 0. 路线评估：客户端 DOM 序列化 vs 服务端 /export 端点

| 维度 | 客户端 DOM 序列化（克隆→净化→Blob 下载） | 服务端 /export 端点（重新 renderPage） |
| --- | --- | --- |
| Mermaid 图表 | ✅ 已渲染 SVG 就在 DOM 里，序列化即得 | ❌ 服务端无 DOM；Node 里跑 vendored 浏览器版 mermaid.esm.min.mjs 需要模拟 DOM（违反「不引入新依赖」）；把 mermaid.mjs 内嵌进导出文件 ≈+2.5MB 且 file:// 下 `import()` 被 CORS 拦截，还要另做 `<script>` 内嵌方案 |
| 代码高亮 span | ✅ `enhanceCode` 运行后 DOM 状态直接保留 | ⚠️ 服务端可重跑高亮（同一段逻辑），但要复制/抽取客户端 tokenizer，重复实现 |
| QA 卡片定位（`layoutQaCards` 绝对定位 inline style） | ✅ `cloneNode` 连 inline `style="top/left/width"` 一起复制 | ❌ 服务端无法知道布局测量结果，需重新测量或改为静态流式布局（视觉不一致） |
| 当前主题/背景/字号/行距 | ✅ 已应用在 `<html>` 的 data 属性与 CSS 变量上，克隆即冻结 | ⚠️ 需把客户端当前值 POST 给服务端（多一个接口 + 状态同步问题） |
| SSE 期间的 DOM 增量（提问高亮、卡片） | ✅ DOM 是唯一真相 | ❌ 服务端 qa 内存表有，但高亮位置（跨元素 Range）只在客户端 |
| 实现复杂度 | 单文件 page.ts 内闭环，无新路由 | 新路由 + 状态回传 + 渲染兜底，复杂度高、保真度低 |
| 体积 | 一份 HTML（含内联图片 data URL） | 若内嵌 mermaid.mjs 则 +2.5MB |

**结论：采用「客户端 DOM 序列化导出」路线。** 服务端路线在保真度（mermaid SVG、QA 定位、高亮）上天然缺失，补齐的代价（重跑 mermaid、回传状态）远高于收益；且导出入口本身就在页面上，不存在「页面不可用还要导出」的场景。`server.ts` **不新增 /export 端点、不改动**。

---

## 1. 变更点清单

| 文件 | 改动 |
| --- | --- |
| `extensions/md-preview/page.ts` | ① `icon()` 增加 `export` 图标；② 工具栏下载按钮所在 `.seg` 组内并列新增导出按钮（`id="exportBtn"`）；③ `PAGE_CSS`：`.seg a.dl-btn` 选择器放宽为 `.seg .dl-btn`（同时覆盖 `<a>`/`<button>`），补 `button.dl-btn` 的 font/cursor 与 `.dl-btn.busy` 态；④ 新增顶层常量 `EXPORT_JS`（离线运行时，见 §2.4）；⑤ `PAGE_JS` 新增「导出 HTML」小节（克隆/净化/冻结/内联图片/Blob 下载，见 §2.2–2.3） |
| `scripts/demo.mjs` | `--smoke` 分支追加 2–3 条断言：页面含 `id="exportBtn"`、含导出运行时标记字符串（如 `离线导出`）；不改动现有断言 |
| `extensions/md-preview/server.ts` | **不改**（见 §0 结论） |
| `index.ts / render.ts / prefs.ts` | **不改**。导出不涉及工具注册、markdown 渲染、偏好持久化；且导出文件**不得**写 localStorage/偏好（见风险 R8） |

新增文件：无（`.demo/` 下可选加 `export-visual.mjs` 作视觉验证辅助，仿 `.demo/qa-visual.mjs`，非必需）。

---

## 2. 关键设计

### 2.1 总体流程

```
点击 #exportBtn
  → busy 禁用 + toast「正在生成导出文件…」
  → buildExportDocument()（async）
       1. document.documentElement.cloneNode(true)
       2. 冻结外观状态（主题/背景/字号/行距 → 具体值）
       3. 净化：去 <script>、去在线交互控件、live-pill → 静态徽标
       4. QA 卡片处理（已完成保留；等待中 → 静态标注）
       5. 等待仍在渲染的 mermaid（超时兜底）
       6. 图片 src 内联为 data URL（同源 /asset/）
       7. 注入 EXPORT_JS（极简离线运行时）
  → "<!doctype html>\n" + clone.outerHTML
  → Blob("text/html;charset=utf-8") → <a download> 触发下载 → revokeObjectURL
  → toast「已导出 HTML」/ 失败「导出失败」
```

### 2.2 DOM 克隆与净化细节

**冻结外观状态**（`<html>` 上已有 data 属性与 inline CSS 变量，但要显式定值，防止导出文件再「跟随系统」漂移）：

- `data-theme` 写入**已解析**的 `dark`/`light`（`root.dataset.theme` 本身就是解析后的值；`data-theme-pref="system"` 同步改为具体值，导出文件只看 `data-theme`）。
- `style` 内显式写 `--font-scale` / `--line-height`（取 PAGE_JS 里的 `scale` / `lineHeight` 闭包变量，即用户当前值）。
- 删除 `data-theme-hint`、`data-pref-scale`、`data-pref-line-height`、`data-pref-bg`（服务端下发的偏好残留，导出后无意义）。

**剥离（在线预览专属 / 离线会报错或误导的）：**

| 对象 | 处理 | 理由 |
| --- | --- | --- |
| 全部 `<script>`（THEME_BOOT、`__MDP__`、PAGE_JS） | 删除 | SSE/`import("/mermaid.mjs")`/prefs fetch 离线必失败；THEME_BOOT 会从 localStorage 重算主题，破坏冻结值 |
| `#exportBtn`、下载按钮 `<a id="downloadBtn">` | 删除 | 导出按钮不该出现在导出件里；下载链接指向已死的 `/doc/x/download` |
| `#qaSelBtn`、`#askPanel` | 删除 | 选中提问交互依赖 `/ask` 接口 |
| `.progress`（顶部进度条） | 删除 | 无 JS 常驻 width:0，纯噪音 |
| `#livePill` | 内容替换为静态徽标 `离线导出 · <导出时间>`（保留 `.live-pill`/`.live-dot` 样式） | 「实时同步/连接断开」在离线件里语义错误 |
| `#toTop`、`#toast`、`.copy-btn`、主题/背景/字号/行距控件 | **保留**，由 EXPORT_JS 接管（见 §2.4） | 保持「显示效果与当前 preview 页面相同」且控件可用 |
| `pre.mermaid` 的 `data-mmd`/`data-status`/隐藏 `style` | 原样保留 | 已渲染的 `div.mermaid-rendered > svg` 是纯 DOM，序列化即离线可用；隐藏的 `pre` 留作源码备份，无害 |

克隆里没有 inline `on*` 事件属性（现有代码全部 `addEventListener`），无需额外剥离事件属性；`querySelectorAll("script")` 全删也顺带覆盖 SVG 内理论上的 `<script>`（mermaid securityLevel:strict 不会生成）。

**QA 卡片（等待中的提问处理——建议：保留并静态标注）：**

- **建议方案（默认）：保留等待中的卡片，把等待态换成静态标注**：`.qa-wait` 内容替换为「⏳ 导出时该提问尚未回复」（去掉 `.qa-pulse` 脉冲点），`.qa-card.pending` 的虚线边框**保留**（视觉上继续表达「未完成」）。理由：
  1. 「显示效果与当前 preview 页面相同」——卡片与橙色 `mark.mdp-qa-hl` 原文高亮都留在原位，布局无空洞；
  2. 用户的提问意图（就这段原文问了什么）是内容的一部分，剔除会静默丢失；
  3. 脉冲动画 +「等待 Agent 回复…」离线是永久误导，必须换成一次性静态文案——这正是「标注」而非「剔除」能解决的问题。
- **备选（评审若偏好干净归档可改）**：剔除 `.qa-card.pending` 及其对应 `mark[data-qa]` 高亮（`mark` 用 `while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m)` 解包）。剔除不会破坏其他卡片定位（top 是 inline 绝对定位，互不影响），仅原位置留白。
- 已完成卡片：**原样保留**（quote/问/答/时间/高亮），不动。
- 若最终没有任何卡片（或走剔除方案后为空）：移除 `#qaRail` 并去掉 `#layout` 的 `with-qa` class。

**Mermaid 渲染竞态**：若导出时存在 `pre.mermaid[data-status="loading"]`（动态 import + render 还没完成），先等最多 ~3s（轮询该选择器归零），仍 loading 则继续导出并 toast 提示「部分图表仍在渲染中，已导出源码」。

**图片离线化**：遍历克隆内 `img[src]`，跳过 `data:` 与 `https?:` 开头的外链；其余（同源 `/asset/<token>`）`fetch` → `blob` → `FileReader.readAsDataURL` 写回 `src`。失败保留原 src（不阻塞导出）。外链图片保持 URL，离线不显示（文档化为已知限制，见 R5）。

### 2.3 导出主流程代码骨架（写入 PAGE_JS，tab 缩进）

```js
	/* ---------- 导出 HTML（离线快照） ---------- */

	var EXPORT_RUNTIME = ${JSON.stringify(EXPORT_JS).replace(/</g, "\\u003c")};

	function exportHtml() {
		var btn = document.getElementById("exportBtn");
		if (btn) { btn.disabled = true; btn.classList.add("busy"); }
		toast("正在生成导出文件…");
		buildExportDocument().then(function (html) {
			var blob = new Blob([html], { type: "text/html;charset=utf-8" });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = exportFileName();
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
			toast("已导出 HTML");
		}).catch(function (e) {
			console.warn("[md-preview] 导出失败：", e);
			toast("导出失败，请重试");
		}).then(function () {
			if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
		});
	}
	document.getElementById("exportBtn").addEventListener("click", exportHtml);
```

> 转义要点：`EXPORT_JS` 作为**独立顶层 TS 模板字符串常量**（与 `PAGE_CSS`/`PAGE_JS` 平级）定义，在 PAGE_JS 里用 `${JSON.stringify(EXPORT_JS)...}` 注入——`JSON.stringify` 自动完成全部引号/反斜杠转义，规避手写转义的坑。`EXPORT_JS` 自身不出现反引号与 `${`；`\\u003c` 的替换防 `</script>` 截断（沿用 `docState` 的既有做法）。

`buildExportDocument()` 骨架：

```js
	function buildExportDocument() {
		var rootEl = document.documentElement;
		var clone = rootEl.cloneNode(true);

		// 1) 冻结外观状态为具体值
		var theme = rootEl.dataset.theme === "dark" ? "dark" : "light";
		clone.setAttribute("data-theme", theme);
		clone.setAttribute("data-theme-pref", theme);
		clone.removeAttribute("data-theme-hint");
		clone.removeAttribute("data-pref-scale");
		clone.removeAttribute("data-pref-line-height");
		clone.removeAttribute("data-pref-bg");
		clone.style.setProperty("--font-scale", String(scale));
		clone.style.setProperty("--line-height", String(lineHeight));

		// 2) 剥离脚本与在线交互
		var scripts = clone.querySelectorAll("script");
		for (var i = 0; i < scripts.length; i++) scripts[i].parentNode.removeChild(scripts[i]);
		removeInClone(clone, ["exportBtn", "downloadBtn", "qaSelBtn", "askPanel"]);
		var prog = clone.querySelector(".progress");
		if (prog && prog.parentNode) prog.parentNode.removeChild(prog);
		var pill = clone.querySelector("#livePill");
		if (pill) pill.innerHTML = '<span class="live-dot"></span><span class="live-text">离线导出 · ' + esc(fmtTime(Date.now())) + "</span>";

		// 3) QA：已完成原样保留；等待中 → 静态标注（默认方案）
		var pending = clone.querySelectorAll(".qa-card.pending .qa-wait");
		for (var j = 0; j < pending.length; j++) {
			pending[j].innerHTML = "⏳ 导出时该提问尚未回复";
		}
		// （备选剔除方案见 §2.2）

		// 4) 注入离线运行时
		var s = document.createElement("script");
		s.textContent = EXPORT_RUNTIME;
		clone.querySelector("body").appendChild(s);

		// 5) 图片内联 + mermaid 竞态等待，然后序列化
		return waitForMermaid().then(inlineImages.bind(null, clone)).then(function () {
			return "<!doctype html>\n" + clone.outerHTML;
		});
	}
```

文件名：`exportFileName()` 返回 `"md-preview-" + 标题净化 + "-" + yyyymmdd-hhmm + ".html"`，标题取 `#docTitle` 的 `textContent`，净化非法文件名字符（正则写在 TS 模板里注意反斜杠双写，或改用逐字符过滤避免正则）。

### 2.4 EXPORT_JS：极简离线运行时（独立常量，~100 行）

只做纯 DOM/CSS 变量操作，**不碰 localStorage、不发任何请求**：

- 主题切换：`[data-theme-set]` 点击 → 设 `root.dataset.theme`（system 按 `matchMedia` 解析一次）+ 按钮 `active` 态。CSS 变量体系原样生效。
- 阅读背景切换：`[data-bg-set]` → `root.dataset.bg` + `active` 态。
- 字号/行距：`#fontMinus/#fontPlus/#fontValue`、`#lineHeightMinus/#lineHeightPlus/#lineHeightValue` → 改 `--font-scale`/`--line-height` 与数值显示（沿用 0.7–1.6 / 1.4–2.2 钳制语义）。
- 复制按钮：`.copy-btn` 点击 → `navigator.clipboard.writeText`，失败回退 `execCommand("copy")`，成功改「已复制」+ `#toast` 提示。
- 回到顶部：`#toTop` 点击 → `window.scrollTo`（`html{scroll-behavior:smooth}` 已内联，平滑滚动免费）。
- TOC 锚点跳转：**不需要 JS**（`href="#id"` + CSS smooth）；scroll-spy 高亮不做（静态快照语义）。

不放进 EXPORT_JS 的：SSE、prefs 持久化、选中提问、mermaid 渲染、进度条/scroll-spy。

> 明确设计约束：导出文件**不得**写 `localStorage` 或 POST `/prefs`——否则离线打开会污染/覆盖在线预览的用户偏好。EXPORT_JS 是纯内存操作，天然满足。

### 2.5 按钮位置与交互

- 位置：与现有下载按钮（69da47c）同一个 `.seg` 组内、下载按钮右侧并列：

```html
			<div class="seg">
				<a class="dl-btn" id="downloadBtn" href="${escapeHtml(downloadUrl ?? "#")}" download title="下载当前文档（Markdown 原文）" aria-label="下载当前文档">${icon("download")}</a>
				<button type="button" class="dl-btn" id="exportBtn" title="导出 HTML（含 Agent 回复，可离线打开）" aria-label="导出 HTML">${icon("export")}</button>
			</div>
```

- `icon("export")`：与现有图标同风格（`viewBox="0 0 24 24"`、`stroke="currentColor"`、1.8 描边），造型为「文档 + 向上导出箭头」。
- CSS：把 `.seg a.dl-btn` 一族选择器改为 `.seg .dl-btn`，补 `button.dl-btn { font: inherit; cursor: pointer; }` 与 `.dl-btn.busy { opacity: 0.5; pointer-events: none; }`。
- 交互：点击 → busy 禁用（防双击重复下载）→ toast 进行中 → 成功/失败 toast → 恢复按钮。生成是异步的（图片内联），全程 try/catch 兜底。

---

## 3. 单测要求

浏览器端 DOM 序列化逻辑无法在 Node 里单测（无 jsdom，且不引入新依赖），采用「类型检查 + HTTP 冒烟断言 + 浏览器手动清单（可用 tabbit 自动化）」三层：

1. **`npm run check`**（tsc --noEmit，strict）：必须通过——覆盖 page.ts/server.ts/demo.mjs 之外的 TS 改动本身（PAGE_JS/EXPORT_JS 是字符串，逃逸类型检查，靠 2/3 层兜住）。
2. **`npm run demo -- --smoke`**：在现有断言后追加：
   - `html.includes('id="exportBtn"')`（导出按钮已渲染进工具栏）；
   - `html.includes("离线导出")`（EXPORT_JS 已注入页面脚本——用运行时内的固定文案作存在性探针）；
   - 现有全部断言不回归（SSE/prefs/mermaid 占位/raw HTML 转义等）。
3. **浏览器手动验证清单**（`npm run demo` 打开页面；可用 tabbit 截图辅助）：
   1. 工具栏出现导出按钮，与下载按钮同组同风格，hover/按下反馈正常。
   2. 制造复杂状态：切深色 + 木色背景 + 字号 130% + 行距 2.00；选中文字提问 2 条（1 条 `answerQuestion` 回复、1 条留等待）；文档含 mermaid 图、带语言代码块、表格、本地图片。
   3. 点导出：toast「正在生成导出文件…」→「已导出 HTML」，只下载一个 `.html`；连续双击不产生两个文件。
   4. **关闭预览服务 / 断网**，双击打开导出文件：
      - 外观与导出瞬间一致（深色、木色、130%、2.00 行距全部生效）；
      - mermaid 显示为 SVG（不是源码、无加载脉冲、无 error 边框）；
      - 代码高亮 span、语言标签保留；点「复制」拿到纯文本并有 toast；
      - 已回答 QA 卡片内容完整（原文/问/答/时间）且橙色高亮仍在正文原位；
      - 等待中的卡片显示「⏳ 导出时该提问尚未回复」静态文案、无脉冲动画；
      - DevTools Console 无报错；Network 面板无任何请求（无 `/mermaid.mjs`、无 SSE、无 `/prefs`）；
      - TOC 锚点跳转正常、回到顶部可用、主题/背景/字号/行距切换可用且不影响 mermaid 之外的元素配色。
   5. 含本地图片的文档导出后离线图片仍显示（src 已是 data URL）；外链 https 图片按已知限制处理。
   6. 边界：无 QA、无 mermaid、无 TOC（单标题）、纯文本、图片内联失败（可临时改 fetch 地址模拟）均导出成功且不弹「导出失败」。
4. **（可选）`.demo/export-visual.mjs`**：仿 `.demo/qa-visual.mjs` 注入一答一待 QA 后常驻服务器，供 tabbit 截图对比「预览页 vs 导出件」。

---

## 4. 验收标准（可判定）

- **A1** 预览页工具栏含导出按钮（`id="exportBtn"`），与下载按钮同组、样式一致；点击有进行中/成功/失败三态反馈，双击不重复导出。
- **A2** 导出物是**单个** `.html` 文件（`<!doctype html>` 开头、UTF-8），不含任何外链 CSS/JS/字体；预览服务关闭 + 断网后 `file://` 打开：Console 零报错、Network 零请求。
- **A3** 显示保真：导出文件打开后的主题、阅读背景、字号、行距与导出瞬间的预览页一致；mermaid 为 SVG 成品；代码高亮、表格、引用、图片样式一致。
- **A4** QA 保真：所有已完成 Agent 回复卡片的 quote/问/答/时间完整保留，正文橙色高亮位置不变；等待中卡片按「⏳ 导出时该提问尚未回复」静态标注呈现（默认方案）；无 QA 文档导出后不残留 qa-rail/`with-qa`。
- **A5** 导出件内可用：复制按钮、回到顶部、TOC 锚点、主题/背景/字号/行距切换均工作；且导出件**不写 localStorage、不发 /prefs**（切主题后再打开在线预览，偏好不被导出件改动）。
- **A6** `npm run check` 通过；`npm run demo -- --smoke` 通过（含新增断言，旧断言零回归）。
- **A7** 不引入新 npm 依赖；`index.ts` / `render.ts` / `prefs.ts` / `server.ts` 零改动；代码 tab 缩进、与现有风格一致。

---

## 5. 风险与注意事项

- **R1 模板字符串转义**（高优先）：PAGE_JS/EXPORT_JS 都嵌在 TS 模板字符串里。规则：EXPORT_JS 用 `JSON.stringify` 注入（§2.3）；EXPORT_JS 内部不写反引号、不写 `${`；确需正则时反斜杠双写（`\\d`）或干脆用字符串函数规避；`</script>` 序列统一走 `\\u003c` 替换。
- **R2 system 主题冻结语义**：导出件把「跟随系统」固化为导出时刻解析出的具体亮/暗值。离线打开后系统主题变化不再跟随——这是「显示效果一致」的必要取舍，属预期行为；`data-theme-pref` 同步写具体值避免歧义。
- **R3 mermaid 与导出件内主题切换**：导出件没有 mermaid.mjs，切主题后 SVG 配色不重渲染（保持导出时主题）。已知限制：在 EXPORT_JS 切主题分支里可加一行 toast「图表配色保持导出时的主题」提示；不做 CSS filter 模拟（色相失真）。同一限制也适用于「等待 mermaid 渲染超时」导出的源码块（R9）。
- **R4 QA 卡片绝对定位与视口**：`layoutQaCards` 的 inline `top/left/width` 基于导出时视口测量。离线打开窗口宽度差异大时卡片可能与锚点错开或覆盖正文左缘。缓解：现有 `@media (max-width: 1080px)` 会隐藏 `.qa-rail`（窄屏反而安全）；宽屏偏差可接受，列为已知限制，不在本期做响应式重排。
- **R5 图片**：同源 `/asset/` 图片内联为 data URL 后体积膨胀（每张 base64 ≈ 原文件 1.33×），超大图片文档注意 Blob 内存；内联失败保留原 URL（离线不显示，不阻塞导出）。外链 `https://` 图片保持 URL，离线不可见——文档化。
- **R6 文内链接离线失效**：`render.ts` 的 `resolveLink` 把 md 链接改写为 `/doc/<token>`、资源为 `/asset/<token>`，导出件里这些 href 离线必然 404/连接失败。本期保持原样（点击失效可接受），如需改造为相对路径属于后续工作，不在本期范围。
- **R7 隐私**：顶栏 `doc-sub` 是源文件**绝对路径**，页脚含 git 版本号——导出件分享出去会泄露本机路径。建议（低成本、本期顺手做）：导出时把克隆里 `#docTitle` 旁的 `.doc-sub` 文本替换为**仅文件名**；若评审认为路径有用可保留，但需在按钮 tooltip/文档中提示。
- **R8 导出件不得污染在线偏好**：EXPORT_JS 禁止 `localStorage.setItem` 与 POST `/prefs`（在线 PAGE_JS 的 applyTheme/setScale 会写偏好，导出件绝不能复用那段逻辑）。验证见 A5。
- **R9 mermaid 渲染竞态**：导出点击时图表可能仍在 `loading`（动态 import + render 异步）。按 §2.2 等待最多 ~3s，超时导出源码并 toast 提示，绝不静默丢图。
- **R10 `file://` 下的浏览器 API**：`navigator.clipboard` 在部分浏览器 file:// 上下文受限——复制回退 `execCommand` 路径必须保留（与在线版一致）；`URL.createObjectURL`/`Blob` 各主流浏览器 file:// 均可用，无需降级。
- **R11 一次性 DOM 查询假设**：克隆前若用户正打开「选中提问」面板或有选区浮动按钮，净化步骤已覆盖（`#qaSelBtn`/`#askPanel` 删除）；注意 `#qaSelBtn` 的 `hidden` 属性状态无关紧要（元素整体移除）。
