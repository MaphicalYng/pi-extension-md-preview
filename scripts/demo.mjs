#!/usr/bin/env node
/**
 * Standalone demo / smoke test for the preview stack (render + page + server),
 * runnable without a Pi session:
 *
 *   npm run demo            # render a sample report and open it in the browser
 *   npm run demo -- --smoke # headless smoke test: compile, serve, verify, exit
 *
 * The demo compiles the extension's host-independent modules to CommonJS under
 * .demo/build (the real extension is loaded directly from TypeScript by Pi).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.includes("--smoke") || process.env.MD_PREVIEW_SMOKE === "1";
// 冒烟测试必须隔离用户真实偏好文件，指向一次性临时 XDG_CONFIG_HOME。
const tmpConfig = smoke ? mkdtempSync(join(tmpdir(), "mdp-smoke-")) : null;
if (tmpConfig) process.env.XDG_CONFIG_HOME = tmpConfig;

const SAMPLE_REPORT = `# md-preview 示例报告

> 本文件由 \`scripts/demo.mjs\` 生成，用于演示预览页面的排版效果。

## 执行摘要

本季度基础设施迁移完成度达到 **87%**，核心链路平均延迟下降 *31%*。剩余工作集中在
离线任务与数据回填，详见 [附录](./sample-appendix.md)。

### 关键指标

| 指标 | 迁移前 | 迁移后 | 变化 |
| --- | ---: | ---: | ---: |
| P99 延迟 | 840 ms | 580 ms | -31% |
| 错误率 | 0.42% | 0.11% | -74% |
| 单位成本 | ¥1.80 | ¥1.20 | -33% |

### 主要动作

1. 将会话存储切换到分区表，热点查询走覆盖索引。
2. 引入两级缓存，命中率稳定在 92% 左右。
3. 重构重试策略，采用带抖动的指数退避。

- [x] 存储层迁移
- [x] 缓存引入
- [ ] 离线任务切换（预计下季度）

## 技术细节

热点路径的重试逻辑如下：

\`\`\`typescript
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let error: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      await sleep(Math.min(1000 * 2 ** i, 8000) * (0.5 + Math.random()));
    }
  }
  throw error;
}
\`\`\`

> [!NOTE]
> 上限 8 秒的退避窗口是基于现网重放数据确定的。

脚注示例：抖动系数来自压测结论。[^jitter]

[^jitter]: 抖动系数取 0.5–1.5 的随机区间，避免重试风暴。

## 架构示意

\`\`\`mermaid
flowchart TD
    浏览器 --> 预览服务
    预览服务 --> 文件监听
    文件监听 -->|SSE 变更推送| 浏览器
\`\`\`

## 下一步计划

- 优先级 P0：完成离线任务切换（预计 3 人周）。
- 优先级 P1：为缓存增加一致性校验作业。
- 参考外部资料：[TypeBox](https://github.com/sinclairzx81/typebox)。
`;

const SAMPLE_APPENDIX = `# 附录：数据来源

所有指标来自生产环境监控（7 日滑动窗口），原始数据见离线数仓 \`dwd_infra_latency\`。

返回 [示例报告](./sample-report.md)。
`;

/* 1. Compile the host-independent modules. */
execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.demo.json"], {
	cwd: root,
	stdio: "inherit",
});

/* 2. Mark the compiled output as CommonJS (root package.json is type: module). */
const buildDir = join(root, ".demo", "build");
writeFileSync(join(buildDir, "package.json"), '{"type":"commonjs"}\n', "utf8");

/* 3. Write demo content. */
const demoDir = join(root, ".demo");
mkdirSync(demoDir, { recursive: true });
const report = join(demoDir, "sample-report.md");
const appendix = join(demoDir, "sample-appendix.md");
// 冒烟测试固定重写为模板内容，保证断言可复现（.demo 下可能残留旧样例）。
if (!existsSync(report) || smoke) writeFileSync(report, SAMPLE_REPORT, "utf8");
if (!existsSync(appendix)) writeFileSync(appendix, SAMPLE_APPENDIX, "utf8");

/* 4. Start the preview server against the sample report. */
const require = createRequire(import.meta.url);
const { createPreviewServerManager, envBindHost } = require(join(root, ".demo", "build", "server.js"));
const { openBrowser } = require(join(root, ".demo", "build", "browser.js"));
const { renderMarkdown } = require(join(root, ".demo", "build", "render.js"));

const servers = createPreviewServerManager();
const server = await servers.ensure();
const handle = await server.openDocument(report, { cwd: demoDir, title: "md-preview 示例报告" });
console.log(`预览页面：${handle.url}`);

/*
 * Token-gated URLs: every route now requires `?token=`, and handle.url already carries the
 * token in its query, so `${handle.url}/events` style appends are broken. Rebuild sub-routes
 * from port + doc id + token instead, and add the token to bare URLs too.
 */
const token = handle.token ?? server.token ?? "";
/** Absolute preview-server URL for a path, with the access token attached when there is one. */
const serverUrl = (pathname, params) => {
	const u = new URL(pathname, `http://127.0.0.1:${server.port}/`);
	if (token) u.searchParams.set("token", token);
	for (const [key, value] of Object.entries(params ?? {})) u.searchParams.set(key, value);
	return u.toString();
};
/** URL of a sub-route of the previewed document ("" = the page itself). */
const docUrl = (sub = "", params) => serverUrl(`/doc/${handle.docId}${sub}`, params);

if (smoke) {
	const failures = [];

	// Env naming contract: MD_PREVIEW_BIND is canonical; MD_PREVIEW_HOST is a deprecated alias.
	process.env.MD_PREVIEW_BIND = "0.0.0.0";
	process.env.MD_PREVIEW_HOST = "192.0.2.10";
	if (envBindHost() !== "0.0.0.0") failures.push("MD_PREVIEW_BIND 未优先于 MD_PREVIEW_HOST");
	delete process.env.MD_PREVIEW_BIND;
	if (envBindHost() !== "192.0.2.10") failures.push("MD_PREVIEW_HOST 兼容别名未生效");
	delete process.env.MD_PREVIEW_HOST;
	if (envBindHost() !== undefined) failures.push("未设置绑定环境变量时不应返回地址");

	/** 读取 SSE 流直到谓词命中（或超时），累积文本到 acc。 */
	const readEventsUntil = async (reader, acc, pred, label) => {
		const decoder = new TextDecoder();
		try {
			for (let i = 0; i < 64; i++) {
				const chunk = await Promise.race([
					reader.read(),
					new Promise((_, reject) => setTimeout(() => reject(new Error(label + " 超时")), 5000)),
				]);
				if (chunk.done) break;
				acc.text += decoder.decode(chunk.value);
				if (pred(acc.text)) return true;
			}
		} catch (e) {
			failures.push(`SSE 读取异常（${label}）：${e.message}`);
		}
		return false;
	};
	const page = await fetch(docUrl());
	const html = await page.text();
	if (!page.ok) failures.push(`GET /doc -> ${page.status}`);
	if (!html.includes("md-preview 示例报告")) failures.push("页面缺少标题");
	if (!html.includes("执行摘要")) failures.push("页面缺少正文渲染结果");
	if (!html.includes("toc")) failures.push("页面缺少目录结构");
	if (!html.includes('class="admonition admonition-note"')) failures.push("页面缺少 NOTE 提示框");
	if (!html.includes('class="footnote-ref"') || !html.includes('class="footnotes"')) failures.push("页面缺少脚注结构");

	// 卡片布局契约：正文与目录各是一张 8px 圆角卡片、列间距 32px，导出快照与印刷各自扁平化。
	const cssText = (html.match(/<style>([\s\S]*?)<\/style>/) || [null, ""])[1];
	/*
	 * 选择器列表按逗号拆成独立项精确比对（`.content, .toc { }` 里的声明对两者都生效），
	 * 同名规则的花括号内容合并后返回。注释先剔除，否则会被并进后一条规则的选择器里。
	 * 扫描完整样式表，不能假设基础规则都排在第一个 @media 之前。
	 */
	const cssRule = (sel) => {
		const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
		const bodies = [];
		for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const list = m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim());
			if (list.includes(sel)) bodies.push(m[2]);
		}
		return bodies.join("\n");
	};
	const baseLayout = cssRule(".layout");
	if (!/gap:\s*32px/.test(baseLayout)) failures.push("卡片列间距不是 32px（.layout gap）");
	if (!/grid-template-columns:\s*minmax\(0, 780px\) 236px/.test(baseLayout)) failures.push(".layout 首列未锁定 780px（会产生超大空隙）");
	if (!/max-width:\s*1096px/.test(baseLayout)) failures.push(".layout 宽度不是 1096px（24+780+32+236+24）");
	for (const sel of [".content", ".toc"]) {
		const rule = cssRule(sel);
		for (const decl of [
			"background: var(--card-bg)",
			"border: var(--card-border)",
			"border-radius: var(--card-radius)",
			"box-shadow: var(--card-shadow)",
		]) {
			if (!rule.includes(decl)) failures.push(`${sel} 缺少卡片声明：${decl}`);
		}
		if (!/padding:\s*var\(--(card|toc)-pad\)/.test(rule)) failures.push(`${sel} 缺少卡片内边距（var(--card-pad)/var(--toc-pad)）`);
	}
	for (const [decl, msg] of [
		["--card-radius: 8px", "卡片圆角不是 8px"],
		["--card-bg: var(--bg-elev)", "卡片底色未使用 --bg-elev"],
		["--card-shadow: var(--shadow-1)", "卡片阴影未使用 --shadow-1"],
	]) {
		if (!cssText.includes(decl)) failures.push(msg);
	}
	const flatAt = cssText.indexOf("html[data-export] .content");
	if (flatAt < 0) failures.push("导出快照缺少卡片扁平化规则（html[data-export]）");
	else {
		const flat = cssText.slice(flatAt, flatAt + 400);
		for (const decl of ["--card-bg: transparent", "--card-border: 0", "--card-shadow: none", "--card-pad: 0"]) {
			if (!flat.includes(decl)) failures.push("导出扁平化缺少：" + decl);
		}
	}
	const printCss = cssText.slice(cssText.indexOf("@media print"));
	if (!printCss.includes("--card-shadow: none")) failures.push("印刷样式未扁平化卡片（@media print）");

	// 设置面板：display:grid 会压过 UA 的 [hidden] 规则，因此必须自己声明隐藏契约，
	// 否则关闭后的面板会继续盖在正文上（这份样式契约不允许被后续改动默默删掉）。
	const settingsPanelRule = cssRule(".settings-panel");
	if (!settingsPanelRule) failures.push("缺少 .settings-panel 规则（设置面板）");
	else {
		if (!/position:\s*absolute/.test(settingsPanelRule)) failures.push("设置面板未使用 absolute 定位（应挂在齿轮下方）");
		if (!/display:\s*grid/.test(settingsPanelRule)) failures.push("设置面板未使用 grid 布局（行对齐会错位）");
	}
	if (!cssText.includes(".settings-panel[hidden] { display: none; }")) {
		failures.push("设置面板缺少 [hidden] 隐藏契约（display:grid 会压过 UA 的 [hidden]）");
	}
	// Q&A rail 与正文卡片的间距：32px 且不再残留 16px 字面量
	if (!html.includes("QA_RAIL_GAP = 32")) failures.push("QA rail 间距常量不是 32px");
	if (!html.includes("contentRect.left - QA_RAIL_GAP")) failures.push("QA rail 仍在使用硬编码间距");
	if (html.includes("contentRect.left - 16")) failures.push("QA rail 残留旧的 16px 间距");
	// Agent 卡片与正文卡片分离：.chat 也是独立卡片，间距与卡片间距一致，圆角统一到 8px
	const chatCss = cssRule(".chat");
	if (!/margin-top:\s*32px/.test(chatCss)) failures.push(".chat 与正文卡片的间距不是 32px");
	if (!/border-radius:\s*8px/.test(chatCss)) failures.push(".chat 圆角未对齐 8px");
	// 问答正文借用 .content 排版，但不得继承文章卡片的壳（边框/底色/阴影/圆角/内边距）
	const chatBodyCss = cssRule(".chat-body.content");
	if (!/background:\s*transparent/.test(chatBodyCss)) failures.push("chat 正文仍继承 .content 卡片底色");
	if (!/box-shadow:\s*none/.test(chatBodyCss)) failures.push("chat 正文仍继承 .content 卡片阴影");
	if (!/border:\s*0/.test(chatBodyCss)) failures.push("chat 正文仍继承 .content 卡片边框");
	const qaCardCss = cssRule(".qa-card");
	if (!/border-radius:\s*8px/.test(qaCardCss)) failures.push(".qa-card 圆角未对齐 8px");
	// 白色纸面下 --bg 与 --bg-elev 同色，卡片靠加强阴影维持层次
	if (!cssText.includes(':root[data-theme="light"][data-bg="white"] .content')) failures.push("缺少 white 预设下的卡片阴影加强规则");
	else if (!cssText.includes("0 4px 14px rgba(16, 24, 40, 0.08)")) failures.push("white 预设的卡片阴影值不符合预期");

	// 端点注入：批量问答/批量修订 URL 必须非 null（页面据 docState.askBatchUrl / reviseUrl 决定是否显示
	// 问答/修订队列按钮与选中浮层的「修订」入口；为 null 时整套功能在真实页面上不可达）。
	if (!html.includes("/ask-batch")) failures.push("页面未注入批量提问端点（/ask-batch）");
	if (!html.includes("/revise")) failures.push("页面未注入批量修订端点（/revise）");
	if (!/"askBatchUrl":"\/doc\/[^"]*\/ask-batch/.test(html)) failures.push("docState.askBatchUrl 为空（页面会隐藏问答队列按钮）");
	if (!/"reviseUrl":"\/doc\/[^"]*\/revise/.test(html)) failures.push("docState.reviseUrl 为空（页面会隐藏修订入口）");

	// raw HTML 必须按转义文本显示（README 契约）：回归 XSS 弹窗问题。
	const probe = renderMarkdown('裸文本 <script>alert("xss")</script> 与 <img src=x onerror=alert(1)>');
	if (probe.html.includes("<script") || probe.html.includes("<img")) failures.push("raw HTML 未被转义（存在可执行标签）");
	if (!probe.html.includes("&lt;script&gt;")) failures.push("raw HTML 未按转义文本显示");

	// mermaid 围栏块应渲染为裸 pre 占位（page.ts 负责绘图），不得包裹代码块增强结构。
	if (!html.includes('<pre class="mermaid">')) failures.push("页面缺少 mermaid 占位结构");
	const mermaidProbe = renderMarkdown("```mermaid\ngraph TD; A-->B\n```");
	if (!mermaidProbe.html.includes('<pre class="mermaid">')) failures.push("mermaid 代码块未渲染为裸 pre 占位");
	if (mermaidProbe.html.includes("code-block")) failures.push("mermaid 代码块不应包含 code-block 结构");

	// GitHub 风格提示框与脚注（marked 扩展）。
	const admonitionProbe = renderMarkdown("> [!NOTE]\n> Body\n");
	if (!admonitionProbe.html.includes('class="admonition admonition-note"')) failures.push("NOTE 提示框未渲染为 callout");
	if (admonitionProbe.html.includes("[!NOTE]")) failures.push("NOTE 提示框标记未被移除");
	const plainQuoteProbe = renderMarkdown("> plain quote\n");
	if (plainQuoteProbe.html.includes("admonition")) failures.push("普通引用块被误判为提示框");
	const footnoteProbe = renderMarkdown("Text[^note].\n\n[^note]: Body.\n");
	if (!footnoteProbe.html.includes('class="footnote-ref"')) failures.push("脚注引用未渲染");
	if (!footnoteProbe.html.includes('class="footnotes"') || !footnoteProbe.html.includes('id="fn-1"')) failures.push("脚注列表未渲染");
	if (footnoteProbe.html.includes("[^note]")) failures.push("脚注标记残留");
	const fencedFootnoteProbe = renderMarkdown("```md\n[^note]: code\n```\n");
	if (fencedFootnoteProbe.html.includes("footnotes")) failures.push("代码块内的脚注定义被误解析");

	// 导出 HTML：工具栏按钮 + 离线运行时（EXPORT_JS）已注入页面脚本。
	if (!html.includes('id="exportBtn"')) failures.push("页面缺少导出按钮");
	if (!html.includes("离线导出")) failures.push("页面未注入导出运行时标记（离线导出）");

	const index = await fetch(serverUrl("/"));
	if (!index.ok) failures.push(`GET / -> ${index.status}`);

	const events = await fetch(docUrl("/events", { c: "smoke" }));
	let stream = "";
	if (events.ok && events.body) {
		const reader = events.body.getReader();
		const decoder = new TextDecoder();
		for (let i = 0; i < 3 && !stream.includes("event: init"); i++) {
			const chunk = await reader.read();
			if (chunk.done) break;
			stream += decoder.decode(chunk.value);
		}
		await reader.cancel();
	}
	if (!events.ok || !stream.includes("retry:") || !stream.includes("event: init")) failures.push("SSE 端点异常");

	// ---------- 用户级偏好（主题/字号/行距全局持久化） ----------
	const prefsEndpoint = serverUrl("/prefs");
	const postPrefs = async (data) => {
		const res = await fetch(prefsEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});
		return { status: res.status, body: res.ok ? await res.json() : null };
	};

	// 初始应为空偏好，且不得触碰真实用户配置目录。
	const prefs0 = await fetch(prefsEndpoint);
	if (!prefs0.ok) failures.push(`GET /prefs -> ${prefs0.status}`);
	else {
		const body = await prefs0.json();
		if (body.theme !== null || body.bg !== null || body.scale !== null || body.lineHeight !== null) failures.push("初始 /prefs 应为空偏好");
	}

	// 合法值：合并保存。
	const post1 = await postPrefs({ theme: "dark", scale: 1.25 });
	if (post1.status !== 200 || post1.body?.theme !== "dark" || post1.body?.scale !== 1.25) {
		failures.push(`POST /prefs 合法值异常：${post1.status} ${JSON.stringify(post1.body)}`);
	}

	// 合法背景：只更新 bg，其他键不受影响。
	const post1c = await postPrefs({ bg: "wood" });
	if (post1c.status !== 200 || post1c.body?.bg !== "wood" || post1c.body?.theme !== "dark" || post1c.body?.scale !== 1.25) {
		failures.push(`POST /prefs 背景合法值异常：${post1c.status} ${JSON.stringify(post1c.body)}`);
	}

	// 合法行距：只更新 lineHeight，其他键不受影响。
	const post1b = await postPrefs({ lineHeight: 1.9 });
	if (post1b.status !== 200 || post1b.body?.lineHeight !== 1.9 || post1b.body?.theme !== "dark" || post1b.body?.scale !== 1.25) {
		failures.push(`POST /prefs 行距合法值异常：${post1b.status} ${JSON.stringify(post1b.body)}`);
	}

	// 落盘防抖 200ms：等一拍再取页面，serveDoc 读取的是磁盘上的已落盘偏好。
	await new Promise((r) => setTimeout(r, 300));
	const prefsFile = join(tmpConfig, "md-preview", "settings.json");
	if (!existsSync(prefsFile)) failures.push("偏好文件未写入 XDG_CONFIG_HOME");

	// 页面注入：重新渲染的文档应携带用户级主题、字号与行距。
	const page2 = await fetch(docUrl());
	const html2 = page2.ok ? await page2.text() : "";
	if (!page2.ok) failures.push(`GET /doc（二次）-> ${page2.status}`);
	if (!html2.includes('data-theme-hint="dark"')) failures.push("页面未注入用户级主题");
	if (!html2.includes('data-pref-scale="1.25"')) failures.push("页面未注入用户级字号");
	if (!html2.includes('data-pref-line-height="1.9"')) failures.push("页面未注入用户级行距");
	if (!html2.includes('data-pref-bg="wood"')) failures.push("页面未注入用户级背景");
	// prefsUrl 现在由服务端注入（带 token），不能再断言裸字面量 '"/prefs"'。
	const prefsUrlInPage = html2.match(/"prefsUrl":"([^"]*)"/)?.[1] ?? "";
	if (!/^\/prefs(\?|$)/.test(prefsUrlInPage)) failures.push("页面缺少 prefsUrl 端点");
	else if (token && !prefsUrlInPage.includes("token" + "=")) failures.push("页面 prefsUrl 未携带访问令牌");
	if (!html2.includes('/download')) failures.push("页面缺少下载入口");

	// 部分更新保留其他键；越界字号/行距被钳制；非法值被忽略；显式 null 重置。
	const post2 = await postPrefs({ theme: "light" });
	if (post2.body?.theme !== "light" || post2.body?.scale !== 1.25 || post2.body?.lineHeight !== 1.9) failures.push("部分更新未保留 scale/lineHeight");
	const post3 = await postPrefs({ scale: 99 });
	if (post3.body?.scale !== 1.6) failures.push(`scale 未钳制到 1.6：${post3.body?.scale}`);
	const post3b = await postPrefs({ lineHeight: 9.99 });
	if (post3b.body?.lineHeight !== 2.2) failures.push(`lineHeight 未钳制到 2.2：${post3b.body?.lineHeight}`);
	const post4 = await postPrefs({ theme: "neon", bg: "neon", scale: "huge" });
	if (post4.body?.theme !== "light" || post4.body?.bg !== "wood" || post4.body?.scale !== 1.6 || post4.body?.lineHeight !== 2.2) failures.push("非法值未被忽略");
	const post4b = await postPrefs({ lineHeight: "wide" });
	if (post4b.body?.lineHeight !== 2.2) failures.push("非法行距未被忽略");
	const post5 = await postPrefs({ theme: null });
	if (post5.body?.theme !== null || post5.body?.scale !== 1.6) failures.push("显式 null 未重置 theme");
	const post5b = await postPrefs({ lineHeight: null });
	if (post5b.body?.lineHeight !== null) failures.push("显式 null 未重置 lineHeight");

	// GET 校验最终落盘内容（等防抖落盘）。
	await new Promise((r) => setTimeout(r, 300));
	const prefsFinal = await (await fetch(prefsEndpoint)).json();
	if (prefsFinal.theme !== null || prefsFinal.bg !== "wood" || prefsFinal.scale !== 1.6 || prefsFinal.lineHeight !== null) failures.push(`落盘偏好异常：${JSON.stringify(prefsFinal)}`);

	// ---------- 下载当前文档 ----------
	const dl = await fetch(docUrl("/download"));
	if (dl.status !== 200) failures.push(`GET /download -> ${dl.status}`);
	const cd = dl.headers.get("content-disposition") || "";
	if (!cd.includes("attachment")) failures.push("下载缺少 attachment 头");
	if (!cd.includes("sample-report.md")) failures.push(`下载文件名异常：${cd}`);
	const dlText = await dl.text();
	if (dlText !== SAMPLE_REPORT) failures.push("下载内容与源文件不一致");

	// 不存在的文档下载应 404。
	const dl404 = await fetch(serverUrl("/doc/nope/download"));
	if (dl404.status !== 404) failures.push(`未知文档下载 -> ${dl404.status}`);

	// ---------- 选中提问（ask → SSE → answer） ----------
	const askBody = { quote: "核心链路平均延迟下降", question: "下降的主要原因是什么？" };
	const askRes = await fetch(docUrl("/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(askBody) });
	if (askRes.status !== 200) failures.push(`POST /ask -> ${askRes.status}`);
	const askData = askRes.ok ? await askRes.json() : {};
	if (!askData.id) failures.push("ask 未返回问题 id");

	const badAsk = await fetch(docUrl("/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote: "", question: "" }) });
	if (badAsk.status !== 400) failures.push(`POST /ask 空内容 -> ${badAsk.status}（应为 400）`);

	// SSE：init 携带 qa；ask / answer 事件实时推送。
	const acc = { text: "" };
	const esRes = await fetch(docUrl("/events", { c: "smoke-qa" }));
	const esReader = esRes.ok && esRes.body ? esRes.body.getReader() : null;
	if (!esReader) failures.push("无法建立问答 SSE 连接");
	if (esReader) {
		await readEventsUntil(esReader, acc, (t) => t.includes("event: init"), "qa init");
		if (!acc.text.includes(askData.id)) failures.push("SSE init 未携带 qa 数据");

		const reply = server.answerQuestion(askData.id, "缓存命中率提升与**索引优化**，详见压测数据。");
		if (!reply.ok) failures.push(`answerQuestion 失败：${reply.message}`);
		await readEventsUntil(esReader, acc, (t) => t.includes("event: answer"), "qa answer");
		if (!acc.text.includes("event: answer") || !acc.text.includes("缓存命中率提升")) failures.push("SSE answer 事件缺失或内容不对");

		const orphan = server.answerQuestion("q999", "孤儿回复");
		if (orphan.ok) failures.push("answerQuestion 未知 id 应失败");

		const askRes2 = await fetch(docUrl("/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote: "P99 延迟", question: "还会再降吗？" }) });
		const askData2 = askRes2.ok ? await askRes2.json() : {};
		await readEventsUntil(esReader, acc, (t) => t.includes("event: ask"), "qa ask");
		if (!acc.text.includes("event: ask") || !acc.text.includes(askData2.id)) failures.push("SSE ask 事件缺失或 id 不对");
		await esReader.cancel();
	}

	// 重新渲染的页面应内嵌问答数据与提问端点。
	const page3 = await fetch(docUrl());
	const html3 = page3.ok ? await page3.text() : "";
	if (!page3.ok) failures.push(`GET /doc（三次）-> ${page3.status}`);
	if (!html3.includes("/ask")) failures.push("页面未注入提问端点");
	if (!html3.includes("下降的主要原因是什么？")) failures.push("页面未内嵌提问内容");
	if (!html3.includes("缓存命中率提升")) failures.push("页面未内嵌回复内容");
	if (!html3.includes("mdp-qa-hl")) failures.push("页面缺少橙色高亮样式");

	// 页脚应显示当前版本：提交日期 + 短 commit id。
	const shortHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	if (!html3.includes("doc-foot")) failures.push("页面缺少页脚");
	if (!html3.includes(shortHash)) failures.push(`页脚未显示当前 commit id（${shortHash}）`);

	// ---------- 批量提问（ask-batch） ----------
	// demo 的 manager.ensure() 未传 onAsk，直接赋值计数即可（无其他订阅者）。
	const notices = [];
	server.onAsk = (n) => notices.push(n);

	const postJson = (path, data) =>
		fetch(docUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof data === "string" ? data : JSON.stringify(data) });
	const expectStatus = async (label, res, want) => {
		if (res.status !== want) failures.push(`${label} -> ${res.status}（应为 ${want}）`);
	};

	const batchItems = [
		{ quote: "核心链路平均延迟下降", question: "这个降幅的统计口径是什么？" },
		{ quote: "错误率", question: "错误率是怎么采样得到的？" },
	];
	const batchRes = await postJson("/ask-batch", { items: batchItems });
	await expectStatus("POST /ask-batch", batchRes, 200);
	const batchData = batchRes.ok ? await batchRes.json() : {};
	if (batchData.ok !== true) failures.push(`ask-batch 未返回 ok:true（${JSON.stringify(batchData.ok)}）`);
	if (batchData.count !== 2) failures.push(`ask-batch count=${batchData.count}（应为 2）`);
	if (!Array.isArray(batchData.items) || batchData.items.length !== 2) failures.push("ask-batch 未返回 2 条 QaPayload");
	const batchIds = (batchData.items ?? []).map((i) => i.id);
	if (batchIds.length !== 2 || new Set(batchIds).size !== 2) failures.push(`ask-batch id 异常：${batchIds.join()}`);
	if (!batchIds.every((id) => /^q\d+$/.test(id))) failures.push(`ask-batch id 格式异常：${batchIds.join()}`);

	// onAsk 必须恰好触发一次，并携带整批 items（顺序与请求一致）。
	if (notices.length !== 1) failures.push(`ask-batch 触发 onAsk ${notices.length} 次（应恰好 1 次）`);
	const notice = notices[0] ?? {};
	if (notice.batch !== true) failures.push("ask-batch 的 onAsk 未标记 batch=true");
	if ((notice.items ?? []).length !== 2) failures.push(`ask-batch onAsk items=${(notice.items ?? []).length}（应为 2）`);
	if ((notice.items ?? []).map((i) => i.id).join() !== batchIds.join()) failures.push("ask-batch onAsk 的 id 顺序与请求不一致");
	if (notice.docId !== handle.docId) failures.push(`ask-batch onAsk docId=${notice.docId}（应为 ${handle.docId}）`);

	// SSE：2 帧 ask（各含对应 id），逐条 answer 落到各自卡片。
	const acc2 = { text: "" };
	const es2 = await fetch(docUrl("/events", { c: "smoke-batch" }));
	const r2 = es2.ok && es2.body ? es2.body.getReader() : null;
	if (!r2) failures.push("无法建立批量问答 SSE 连接");
	if (r2) {
		await readEventsUntil(r2, acc2, (t) => batchIds.every((id) => t.includes(`"id":"${id}"`)), "ask-batch SSE");
		for (const id of batchIds) if (!acc2.text.includes(`"id":"${id}"`)) failures.push(`SSE 未推送批量问题 ${id}`);
		const answers = ["按 7 日滑动窗口统计。", "按分钟级采样聚合。"];
		for (let i = 0; i < batchIds.length; i++) {
			const r = server.answerQuestion(batchIds[i], answers[i]);
			if (!r.ok) failures.push(`批量 answerQuestion(${batchIds[i]}) 失败：${r.message}`);
			await readEventsUntil(r2, acc2, (t) => t.includes(answers[i]), `answer ${batchIds[i]}`);
			if (!acc2.text.includes(answers[i])) failures.push(`SSE answer 缺少 ${batchIds[i]} 的回复内容`);
		}
	}

	// 校验矩阵。
	await expectStatus("ask-batch 空 items", await postJson("/ask-batch", { items: [] }), 400);
	await expectStatus("ask-batch 21 条", await postJson("/ask-batch", { items: Array.from({ length: 21 }, () => ({ quote: "q", question: "?" })) }), 400);
	await expectStatus("ask-batch 空 quote", await postJson("/ask-batch", { items: [{ quote: "   ", question: "?" }] }), 400);
	await expectStatus("ask-batch 空 question", await postJson("/ask-batch", { items: [{ quote: "q", question: "  " }] }), 400);
	await expectStatus("ask-batch quote 超长", await postJson("/ask-batch", { items: [{ quote: "x".repeat(2001), question: "?" }] }), 400);
	await expectStatus("ask-batch question 超长", await postJson("/ask-batch", { items: [{ quote: "q", question: "x".repeat(2001) }] }), 400);
	await expectStatus("ask-batch items 非数组", await postJson("/ask-batch", { items: "nope" }), 400);
	await expectStatus("ask-batch 空 body", await postJson("/ask-batch", ""), 400);
	await expectStatus("ask-batch GET", await fetch(docUrl("/ask-batch")), 405);
	// 超过 256KB 的 body 直接 413（先读完后丢弃，不在内存里放大）。
	await expectStatus("ask-batch 超大 body", await postJson("/ask-batch", { items: [{ quote: "x".repeat(300 * 1024), question: "?" }] }), 413);

	// 20 条上限本身必须成功，且仍只触发一次 onAsk。
	notices.length = 0;
	const capRes = await postJson("/ask-batch", { items: Array.from({ length: 20 }, (_, i) => ({ quote: `上限批量段落 ${i}`, question: `第 ${i} 个问题？` })) });
	await expectStatus("ask-batch 20 条", capRes, 200);
	if (notices.length !== 1 || (notices[0]?.items ?? []).length !== 20) failures.push("ask-batch 20 条未合并为一次 onAsk");

	// ---------- 批量修订（revise / revision-done） ----------
	const revItems = [
		{ quote: "P99 延迟", comment: "补一句口径说明：P99 为 7 日滑动窗口。" },
		{ quote: "单位成本", comment: "货币单位统一写成「元」。" },
	];
	const revRes = await postJson("/revise", { items: revItems });
	await expectStatus("POST /revise", revRes, 200);
	const revData = revRes.ok ? await revRes.json() : {};
	if (revData.ok !== true) failures.push("revise 未返回 ok:true");
	if (!Number.isInteger(revData.batchId) || revData.batchId < 1) failures.push(`revise batchId 异常：${revData.batchId}`);
	if (revData.count !== 2) failures.push(`revise count=${revData.count}（应为 2）`);

	await expectStatus("revise 空 items", await postJson("/revise", { items: [] }), 400);
	await expectStatus("revise 21 条", await postJson("/revise", { items: Array.from({ length: 21 }, () => ({ quote: "q", comment: "c" })) }), 400);
	await expectStatus("revise 空 comment", await postJson("/revise", { items: [{ quote: "q", comment: "  " }] }), 400);
	await expectStatus("revise 空 quote", await postJson("/revise", { items: [{ quote: "", comment: "c" }] }), 400);
	await expectStatus("revise comment 超长", await postJson("/revise", { items: [{ quote: "q", comment: "x".repeat(2001) }] }), 400);
	await expectStatus("revise GET", await fetch(docUrl("/revise")), 405);
	await expectStatus(
		"revise 未知文档",
		await fetch(serverUrl("/doc/nope/revise"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: revItems }) }),
		404,
	);

	// revisionDone：返回 batchId、推送 revision-done 帧（页面注入由模块 B 覆盖，此处不断言 HTML）。
	const revId = revData.batchId;
	const done = await server.revisionDone(undefined, ["P99 延迟", "单位成本"]);
	if (!done.ok) failures.push(`revisionDone 失败：${done.message}`);
	if (done.batchId !== revId) failures.push(`revisionDone batchId=${done.batchId}（应为 ${revId}）`);
	if (done.docId !== handle.docId) failures.push(`revisionDone docId=${done.docId}（应为 ${handle.docId}）`);

	if (r2) {
		await readEventsUntil(r2, acc2, (t) => t.includes("event: revision-done"), "revision-done");
		const tail = acc2.text.slice(acc2.text.lastIndexOf("event: revision-done"));
		for (const needle of [`"batchId":${revId}`, '"docId":"', '"highlights":["P99 延迟","单位成本"]', '"at":']) {
			if (!tail.includes(needle)) failures.push(`revision-done 帧缺少 ${needle}`);
		}
	}

	// 幂等：重复调用成功、换 highlights、同 batchId。
	const done2 = await server.revisionDone(undefined, ["错误率"]);
	if (!done2.ok || done2.batchId !== revId) failures.push(`revisionDone 重复调用应幂等成功（${done2.message}）`);

	// 未知文档 / 过期窗口。
	const done3 = await server.revisionDone("d999", []);
	if (done3.ok) failures.push("revisionDone 未知文档应失败");
	process.env.MD_PREVIEW_REVISION_TTL_MS = "50";
	await new Promise((r) => setTimeout(r, 80));
	const done4 = await server.revisionDone(undefined, []);
	if (done4.ok) failures.push("revisionDone 过期批次应失败");
	delete process.env.MD_PREVIEW_REVISION_TTL_MS;
	if (r2) await r2.cancel();

	await server.shutdown("smoke 完成");
	rmSync(tmpConfig, { recursive: true, force: true });
	if (failures.length) {
		console.error("smoke 失败：");
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	console.log("smoke 通过：页面渲染、SSE、偏好持久化（/prefs）、选中提问（ask/answer/SSE 推送）、批量提问（ask-batch 合并注入/逐条回复）、批量修订（revise/revision-done）均正常。");
	process.exit(0);
}

if (process.env.MD_PREVIEW_NO_BROWSER === "1") {
	console.log("(MD_PREVIEW_NO_BROWSER=1，未打开浏览器)");
} else {
	openBrowser(handle.url);
}
console.log("关闭浏览器标签页后预览服务会自动退出；按 Ctrl+C 可提前手动停止。");
