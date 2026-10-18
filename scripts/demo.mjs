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
const { ensureServer } = require(join(root, ".demo", "build", "server.js"));
const { openBrowser } = require(join(root, ".demo", "build", "browser.js"));
const { renderMarkdown } = require(join(root, ".demo", "build", "render.js"));

const server = await ensureServer();
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
	else if (token && !prefsUrlInPage.includes("token=")) failures.push("页面 prefsUrl 未携带访问令牌");
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

	await server.shutdown("smoke 完成");
	rmSync(tmpConfig, { recursive: true, force: true });
	if (failures.length) {
		console.error("smoke 失败：");
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	console.log("smoke 通过：页面渲染、SSE、偏好持久化（/prefs）、选中提问（ask/answer/SSE 推送）均正常。");
	process.exit(0);
}

if (process.env.MD_PREVIEW_NO_BROWSER === "1") {
	console.log("(MD_PREVIEW_NO_BROWSER=1，未打开浏览器)");
} else {
	openBrowser(handle.url);
}
console.log("关闭浏览器标签页后预览服务会自动退出；按 Ctrl+C 可提前手动停止。");
