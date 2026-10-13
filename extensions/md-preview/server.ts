/**
 * Local HTTP server backing the markdown preview.
 *
 * Lifecycle rules (requirement: the tool must not outlive the session):
 *  - The server is created lazily when a document is previewed.
 *  - It shuts itself down once a browser tab was open and then closed
 *    (the page sends a `close` beacon on unload; SSE connections drop too).
 *  - It also shuts down if no tab ever opens within a few minutes,
 *    and whenever the hosting session announces shutdown.
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { renderMarkdown, escapeHtml, type RenderedDoc, type TocItem } from "./render";
import { renderPage } from "./page";
import { loadPrefs, savePrefsDebounced, normalizeTheme, clampScale, type ThemePref } from "./prefs";

const IDLE_MS = 8_000; // shutdown this long after the last tab goes away
const NEVER_OPENED_MS = 5 * 60_000; // shutdown if nobody ever opened a tab
const SWEEP_MS = 3_000;
const HEARTBEAT_MS = 25_000;

export interface PreviewHandle {
	/** Full URL of the rendered page. */
	url: string;
	docId: string;
	title: string;
	/** True when this file was already being previewed (no new tab needed). */
	reused: boolean;
	/** Tabs currently connected to this document. */
	liveViewers: number;
	port: number;
}

interface DocState {
	id: string;
	filePath: string;
	rootDir: string;
	label: string;
	explicitTitle?: string;
	rendered: RenderedDoc;
	/** Bumped on every re-render; lets stale SSE clients detect they missed an update. */
	version: number;
	sourceMissing: boolean;
	mtimeMs: number;
	size: number;
	watcher: fs.FSWatcher | null;
	reloadTimer: ReturnType<typeof setTimeout> | null;
	/** connection id -> client id (one browser tab) */
	viewers: Map<string, string>;
}

/** 预览页「选中提问」的一条问答记录 */
export interface QaEntry {
	id: string;
	docId: string;
	/** 用户在预览页选中的原文 */
	quote: string;
	/** 用户的提问 */
	question: string;
	/** Agent 回复（服务端渲染后的 HTML；原始 HTML 已按转义文本渲染） */
	answerHtml?: string;
	askedAt: number;
	answeredAt?: number;
}

/** 下发到页面的问答数据形态（answerHtml 为 null 表示待回复） */
export interface QaPayload {
	id: string;
	quote: string;
	question: string;
	answerHtml: string | null;
	askedAt: number;
	answeredAt: number | null;
}

const MAX_QA_PER_DOC = 50;

// ----------------------------------------------------------- 版本号（页脚）

/** 从当前文件位置向上找扩展根目录（含本扩展 package.json 的目录）。 */
function findExtensionRoot(startDir: string): string | null {
	let dir = startDir;
	for (let i = 0; i < 6; i++) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string };
			if (pkg.name === "pi-extension-md-preview") return dir;
		} catch {
			/* 继续向上 */
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let cachedVersion: string | null | undefined;

/**
 * 页脚版本号：提交日期 + 短 commit id（如 2026-10-13 · 9311172）。
 * 首次渲染时向扩展根目录 spawn 一次 git（不经 shell）；工作区有改动追加 -dirty；
 * 找不到 git / 仓库时返回 null，页面不显示页脚。
 */
function resolveVersion(): string | null {
	if (cachedVersion !== undefined) return cachedVersion;
	cachedVersion = null;
	try {
		const here = typeof __dirname === "string" ? __dirname : process.cwd();
		const rootDir = findExtensionRoot(here);
		if (!rootDir) return cachedVersion;
		const log = execFileSync("git", ["log", "-1", "--format=%h %cs"], {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const m = log.match(/^(\S+)\s+(\S+)$/);
		const hash = m?.[1] ?? "";
		const date = m?.[2] ?? "";
		if (!hash || !date) return cachedVersion;
		let dirty = "";
		try {
			const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
				cwd: rootDir,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (status) dirty = "-dirty";
		} catch {
			/* 忽略脏检查失败 */
		}
		cachedVersion = `${date} · ${hash}${dirty}`;
	} catch {
		/* 无 git 或不在仓库中：不显示版本 */
	}
	return cachedVersion;
}

const CONTENT_TYPES: Record<string, string> = {
	txt: "text/plain; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	pdf: "application/pdf",
	json: "application/json",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
};

export class PreviewServer {
	private server: http.Server;
	private docs = new Map<string, DocState>();
	private byPath = new Map<string, DocState>();
	private roots = new Set<string>();
	private sseConns = new Map<string, http.ServerResponse>();
	private connDoc = new Map<string, string>();
	private docSeq = 0;
	private connSeq = 0;
	private startedAt = Date.now();
	private lastPing = 0;
	private hadViewer = false;
	private noViewerSince: number | null = null;
	private shuttingDown = false;
	private onShutdown?: (reason: string) => void;
	/** 预览页收到提问时回调（扩展用它把提问注入 pi 会话以唤醒 Agent） */
	onAsk: ((qa: QaEntry & { title: string }) => void) | null = null;
	private qa = new Map<string, QaEntry>();
	private qaSeq = 0;
	port = 0;

	constructor(onShutdown?: (reason: string) => void) {
		this.onShutdown = onShutdown;
		this.server = http.createServer((req, res) => {
			this.handle(req, res).catch((err) => {
				try {
					res.statusCode = 500;
					res.setHeader("Content-Type", "text/plain; charset=utf-8");
					res.end(`Internal error: ${String(err)}`);
				} catch {
					/* response already gone */
				}
			});
		});
	}

	async start(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(0, "127.0.0.1", () => {
				this.server.removeListener("error", reject);
				const addr = this.server.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				resolve();
			});
		});
		setInterval(() => this.sweep(), SWEEP_MS).unref();
	}

	// ---------------------------------------------------------------- docs

	/** Register (or reuse) a document and return its preview handle. */
	async openDocument(filePath: string, opts: { cwd?: string; title?: string } = {}): Promise<PreviewHandle> {
		const abs = path.resolve(filePath);
		// A freshly requested document gives a browser tab a new chance to
		// connect: restart the no-viewer grace windows so the sweep cannot shut
		// the server down in the middle of this call.
		this.startedAt = Date.now();
		this.noViewerSince = null;
		if (opts.cwd) this.roots.add(path.resolve(opts.cwd));
		const existing = this.byPath.get(abs);
		if (existing) {
			if (opts.title && opts.title !== existing.explicitTitle) {
				existing.explicitTitle = opts.title;
				await this.refresh(existing);
				this.broadcastUpdate(existing);
			}
			await this.refreshIfStale(existing);
			return this.handleFor(existing, true);
		}
		const doc: DocState = {
			id: `d${++this.docSeq}`,
			filePath: abs,
			rootDir: path.dirname(abs),
			label: path.basename(abs),
			explicitTitle: opts.title,
			rendered: { html: "", toc: [], title: null },
			version: 0,
			sourceMissing: false,
			mtimeMs: 0,
			size: 0,
			watcher: null,
			reloadTimer: null,
			viewers: new Map(),
		};
		this.docs.set(doc.id, doc);
		this.byPath.set(abs, doc);
		this.roots.add(doc.rootDir);
		await this.refresh(doc);
		this.watch(doc);
		return this.handleFor(doc, false);
	}

	listDocuments(): { id: string; filePath: string; title: string; viewers: number }[] {
		return [...this.docs.values()].map((d) => ({
			id: d.id,
			filePath: d.filePath,
			title: this.titleFor(d),
			viewers: d.viewers.size,
		}));
	}

	get isOpen(): boolean {
		return !this.shuttingDown;
	}

	private handleFor(doc: DocState, reused: boolean): PreviewHandle {
		this.byPath.set(doc.filePath, doc);
		return {
			url: `http://127.0.0.1:${this.port}/doc/${doc.id}`,
			docId: doc.id,
			title: this.titleFor(doc),
			reused,
			liveViewers: doc.viewers.size,
			port: this.port,
		};
	}

	private titleFor(doc: DocState): string {
		return doc.explicitTitle || doc.rendered.title || doc.label;
	}

	// ------------------------------------------------------- render + watch

	private linkResolver(doc: DocState): (kind: "link" | "asset", target: string) => string | null {
		return (kind, target) => {
			const noHash = target.split("#")[0] ?? "";
			const clean0 = noHash.split("?")[0] ?? "";
			let clean = clean0;
			try {
				clean = decodeURIComponent(clean0);
			} catch {
				return null;
			}
			if (!clean) return null;
			const abs = path.resolve(doc.rootDir, clean);
			if (!this.withinRoots(abs)) return null;
			if (kind === "link" && clean.toLowerCase().endsWith(".md")) {
				return `/doc/${encodePathToken(abs)}`;
			}
			if (kind === "link" && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
				const readme = path.join(abs, "README.md");
				if (fs.existsSync(readme)) return `/doc/${encodePathToken(readme)}`;
			}
			return `/asset/${encodePathToken(abs)}`;
		};
	}

	private withinRoots(abs: string): boolean {
		for (const root of this.roots) {
			if (abs === root || abs.startsWith(root + path.sep)) return true;
		}
		return false;
	}

	private async refresh(doc: DocState): Promise<void> {
		try {
			const st = await fs.promises.stat(doc.filePath);
			const source = await fs.promises.readFile(doc.filePath, "utf8");
			doc.sourceMissing = false;
			doc.mtimeMs = st.mtimeMs;
			doc.size = st.size;
			doc.rendered = renderMarkdown(source, { resolveLink: this.linkResolver(doc) });
		} catch (err) {
			doc.sourceMissing = true;
			doc.rendered = {
				html: `<div class="notice">文件无法读取：${escapeHtml(doc.filePath)}<br>${escapeHtml(String(err))}</div>`,
				toc: [],
				title: doc.label,
			};
		}
		doc.version++;
	}

	private async refreshIfStale(doc: DocState): Promise<void> {
		try {
			const st = await fs.promises.stat(doc.filePath);
			if (doc.sourceMissing || st.mtimeMs !== doc.mtimeMs || st.size !== doc.size) {
				await this.refresh(doc);
			}
		} catch {
			await this.refresh(doc);
		}
	}

	private watch(doc: DocState): void {
		const scheduleReload = () => {
			if (doc.reloadTimer) clearTimeout(doc.reloadTimer);
			doc.reloadTimer = setTimeout(() => {
				doc.reloadTimer = null;
				if (this.shuttingDown) return;
				void this.refresh(doc).then(() => this.broadcastUpdate(doc));
			}, 180);
		};
		try {
			doc.watcher = fs.watch(doc.filePath, { persistent: false }, scheduleReload);
			doc.watcher.on("error", () => {
				/* watch failure is non-fatal; stale check runs on each page load */
			});
		} catch {
			doc.watcher = null;
		}
	}

	private broadcastEvent(docId: string, event: string, payload: string): void {
		for (const [connId, connDocId] of this.connDoc) {
			if (connDocId !== docId) continue;
			const res = this.sseConns.get(connId);
			if (res) this.writeSse(res, event, payload);
		}
	}

	private broadcastUpdate(doc: DocState): void {
		const payload = JSON.stringify({
			html: doc.rendered.html,
			toc: doc.rendered.toc as TocItem[],
			title: this.titleFor(doc),
		});
		this.broadcastEvent(doc.id, "update", payload);
	}

	// ------------------------------------------------------- 选中提问（Q&A）

	private qaPayload(e: QaEntry): QaPayload {
		return {
			id: e.id,
			quote: e.quote,
			question: e.question,
			answerHtml: e.answerHtml ?? null,
			askedAt: e.askedAt,
			answeredAt: e.answeredAt ?? null,
		};
	}

	qaList(docId: string): QaPayload[] {
		return [...this.qa.values()].filter((e) => e.docId === docId).map((e) => this.qaPayload(e));
	}

	/** 预览页提交提问：落库、广播 SSE ask、回调扩展注入 pi 会话。 */
	ask(doc: DocState, quote: string, question: string): QaEntry {
		const entry: QaEntry = { id: `q${++this.qaSeq}`, docId: doc.id, quote, question, askedAt: Date.now() };
		this.qa.set(entry.id, entry);
		const list = this.qaList(doc.id);
		if (list.length > MAX_QA_PER_DOC) {
			for (const old of list.slice(0, list.length - MAX_QA_PER_DOC)) this.qa.delete(old.id);
		}
		this.broadcastEvent(doc.id, "ask", JSON.stringify(this.qaPayload(entry)));
		try {
			this.onAsk?.({ ...entry, title: this.titleFor(doc) });
		} catch {
			/* 注入 pi 会话失败不阻塞提问本身 */
		}
		return entry;
	}

	/**
	 * md_preview_reply 工具入口：记录 Agent 回复并广播 SSE answer 事件。
	 * questionId 省略时回复最早未回复的提问。
	 */
	answerQuestion(questionId: string | undefined, text: string): { ok: boolean; message: string } {
		const answer = (text ?? "").trim();
		if (!answer) return { ok: false, message: "回复内容为空。" };
		let entry: QaEntry | undefined;
		if (questionId) entry = this.qa.get(questionId);
		else for (const e of this.qa.values()) if (!e.answerHtml) { entry = e; break; }
		if (!entry || entry.answerHtml) {
			const pending = [...this.qa.values()].filter((e) => !e.answerHtml).map((e) => e.id).join(", ") || "无";
			return { ok: false, message: `未找到可回复的提问（question_id=${questionId ?? "最早未回复"}）。当前未回复的提问：${pending}` };
		}
		entry.answerHtml = renderMarkdown(answer).html;
		entry.answeredAt = Date.now();
		this.broadcastEvent(entry.docId, "answer", JSON.stringify({ id: entry.id, answerHtml: entry.answerHtml, answeredAt: entry.answeredAt }));
		return { ok: true, message: `已回复预览页提问 ${entry.id}，回复卡片已推送到浏览器。` };
	}

	// --------------------------------------------------------------- routes

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const p = url.pathname;
		if (p === "/" || p === "/index.html") return this.serveIndex(res);
		if (p === "/prefs") {
			if (req.method === "GET") return this.servePrefs(res);
			if (req.method === "POST") return this.serveSavePrefs(req, res);
			res.statusCode = 405;
			res.setHeader("Allow", "GET, POST");
			res.end("method not allowed");
			return;
		}
		if (p === "/favicon.ico") {
			res.statusCode = 204;
			res.end();
			return;
		}
		if (p.startsWith("/asset/")) return this.serveAsset(res, p.slice("/asset/".length));
		const m = p.match(/^\/doc\/([^/]+)(\/events|\/close|\/ask)?$/);
		if (m) {
			const token = m[1] ?? "";
			const sub = m[2] ?? "";
			const doc = this.resolveDocToken(token);
			if (!doc) return notFound(res, "document not found");
			if (sub === "/events") return this.serveEvents(req, res, doc, url);
			if (sub === "/close") return this.serveClose(req, res, doc, url);
			if (sub === "/ask") return this.serveAsk(req, res, doc);
			return this.serveDoc(res, doc);
		}
		return notFound(res, "not found");
	}

	private resolveDocToken(token: string): DocState | null {
		const direct = this.docs.get(token);
		if (direct) return direct;
		const filePath = decodePathToken(token);
		if (!filePath) return null;
		const known = this.byPath.get(filePath);
		if (known) return known;
		if (!this.withinRoots(filePath)) return null;
		if (!fs.existsSync(filePath)) return null;
		// A doc reached through a markdown link: register it so it gets watched too.
		const doc: DocState = {
			id: `d${++this.docSeq}`,
			filePath,
			rootDir: path.dirname(filePath),
			label: path.basename(filePath),
			rendered: { html: "", toc: [], title: null },
			version: 0,
			sourceMissing: false,
			mtimeMs: 0,
			size: 0,
			watcher: null,
			reloadTimer: null,
			viewers: new Map(),
		};
		this.docs.set(doc.id, doc);
		this.byPath.set(filePath, doc);
		this.roots.add(doc.rootDir);
		void this.refresh(doc).then(() => this.watch(doc));
		return doc;
	}

	private async serveDoc(res: http.ServerResponse, doc: DocState): Promise<void> {
		await this.refreshIfStale(doc);
		const cid = `c${++this.connSeq}`;
		// 用户级持久化偏好优先于 MD_PREVIEW_THEME 环境变量提示；
		// 两者都不存在时页面回退到跟随系统。
		const prefs = loadPrefs();
		const env = process.env.MD_PREVIEW_THEME;
		const themeHint = prefs.theme ?? (env === "light" || env === "dark" || env === "system" ? env : undefined);
		const html = renderPage({
			docId: doc.id,
			title: this.titleFor(doc),
			subtitle: doc.filePath,
			bodyHtml: doc.rendered.html,
			toc: doc.rendered.toc,
			updateUrl: `/doc/${doc.id}/events?c=${cid}&v=${doc.version}`,
			closeUrl: `/doc/${doc.id}/close?c=${cid}`,
			askUrl: `/doc/${doc.id}/ask`,
			qa: this.qaList(doc.id),
			version: resolveVersion(),
			themeHint,
			prefScale: prefs.scale,
			prefsUrl: "/prefs",
		});
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(html);
	}

	private async serveAsk(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState): Promise<void> {
		const body = await readBody(req);
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* 空或非 JSON 主体按无效请求处理 */
		}
		const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		const quote = typeof obj.quote === "string" ? obj.quote.trim().slice(0, 2000) : "";
		const question = typeof obj.question === "string" ? obj.question.trim().slice(0, 2000) : "";
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		if (!quote || !question) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "quote 与 question 必须是非空字符串" }));
			return;
		}
		const entry = this.ask(doc, quote, question);
		res.statusCode = 200;
		res.end(JSON.stringify({ id: entry.id, askedAt: entry.askedAt }));
	}

	private serveEvents(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState, url: URL): void {
		const clientId = url.searchParams.get("c") || `c${++this.connSeq}`;
		const connId = `k${++this.connSeq}`;
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders?.();
		res.write("retry: 2000\n\n");
		// A tab that loaded the page before the latest render syncs immediately.
		if (url.searchParams.get("v") !== String(doc.version)) {
			this.writeSse(res, "init", JSON.stringify({ html: doc.rendered.html, toc: doc.rendered.toc, title: this.titleFor(doc), qa: this.qaList(doc.id) }));
		}
		this.sseConns.set(connId, res);
		this.connDoc.set(connId, doc.id);
		doc.viewers.set(connId, clientId);
		this.hadViewer = true;
		this.noViewerSince = null;
		req.on("close", () => {
			this.sseConns.delete(connId);
			this.connDoc.delete(connId);
			doc.viewers.delete(connId);
		});
	}

	/** The page fires this beacon on unload; it carries the per-load client id. */
	private async serveClose(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState, url: URL): Promise<void> {
		const body = await readBody(req);
		let clientId = url.searchParams.get("c") || "";
		if (!clientId && body.includes("=")) clientId = new URLSearchParams(body).get("clientId") || "";
		const kill = (connId: string) => {
			const sse = this.sseConns.get(connId);
			this.sseConns.delete(connId);
			this.connDoc.delete(connId);
			doc.viewers.delete(connId);
			try {
				sse?.end();
			} catch {
				/* already gone */
			}
		};
		if (clientId) {
			for (const [connId, cid] of doc.viewers) if (cid === clientId) kill(connId);
		} else {
			// No id: tear down every connection for this document. The page
			// reconnects automatically if another tab is still open.
			for (const [connId, connDocId] of this.connDoc) if (connDocId === doc.id) kill(connId);
		}
		res.statusCode = 204;
		res.end();
	}

	private async serveAsset(res: http.ServerResponse, token: string): Promise<void> {
		const filePath = decodePathToken(token);
		if (!filePath || !this.withinRoots(filePath)) {
			notFound(res, "forbidden");
			return;
		}
		const ext = path.extname(filePath).slice(1).toLowerCase();
		const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
		try {
			const data = await fs.promises.readFile(filePath);
			res.statusCode = 200;
			res.setHeader("Content-Type", type);
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("X-Content-Type-Options", "nosniff");
			res.end(data);
		} catch {
			notFound(res, "file not found");
		}
	}

	private serveIndex(res: http.ServerResponse): void {
		const items = [...this.docs.values()]
			.map((d) => `<li><a href="/doc/${d.id}">${escapeHtml(this.titleFor(d))}</a> <code>${escapeHtml(d.filePath)}</code></li>`)
			.join("\n");
		const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Markdown Preview</title><style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
body{max-width:720px;margin:64px auto;padding:0 24px;line-height:1.7}
h1{font-size:1.4rem} li{margin:.4rem 0} code{opacity:.6;font-size:.85em} a{color:#2563eb}
</style></head><body><h1>Markdown Preview</h1><p>当前会话打开的文档：</p><ul>${items || "<li>（无）</li>"}</ul></body></html>`;
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(html);
	}

	// ------------------------------------------------------------- prefs

	/** 当前用户级偏好（调试 / 页面自检用）。 */
	private servePrefs(res: http.ServerResponse): void {
		const prefs = loadPrefs();
		res.statusCode = 200;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(JSON.stringify(prefs));
	}

	/**
	 * 页面在主题 / 字号变化时上报，合并进用户级偏好文件。
	 * 非法字段被忽略而不是报错——前端钳制值域，这里只做兜底校验。
	 */
	private async serveSavePrefs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readBody(req);
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* 空或非 JSON 主体按“无补丁”处理 */
		}
		const patch: { theme?: ThemePref | null; scale?: number | null } = {};
		if (parsed && typeof parsed === "object") {
			const obj = parsed as Record<string, unknown>;
			// 非法值忽略；显式 null 表示重置回默认。
			if (obj.theme !== undefined) {
				const theme = normalizeTheme(obj.theme);
				if (theme !== null || obj.theme === null) patch.theme = theme;
			}
			if (obj.scale !== undefined) {
				const scale = clampScale(obj.scale);
				if (scale !== null || obj.scale === null) patch.scale = scale;
			}
		}
		const prefs = savePrefsDebounced(patch);
		res.statusCode = 200;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(JSON.stringify(prefs));
	}

	// ------------------------------------------------------------- lifecycle

	private writeSse(res: http.ServerResponse, event: string, data: string): void {
		try {
			res.write(`event: ${event}\ndata: ${data}\n\n`);
		} catch {
			/* connection gone; the close handler cleans up */
		}
	}

	private sweep(): void {
		if (this.shuttingDown) return;
		const viewers = this.sseConns.size;
		if (viewers > 0) {
			this.hadViewer = true;
			this.noViewerSince = null;
			const now = Date.now();
			if (now - this.lastPing >= HEARTBEAT_MS) {
				this.lastPing = now;
				for (const res of this.sseConns.values()) {
					try {
						res.write(": ping\n\n");
					} catch {
						/* cleaned up via close handler */
					}
				}
			}
			return;
		}
		const now = Date.now();
		if (this.hadViewer) {
			if (this.noViewerSince === null) this.noViewerSince = now;
			else if (now - this.noViewerSince >= IDLE_MS) void this.shutdown("所有预览标签页已关闭");
			return;
		}
		if (now - this.startedAt >= NEVER_OPENED_MS) void this.shutdown("浏览器未打开预览页面");
	}

	async shutdown(reason: string): Promise<void> {
		if (this.shuttingDown) return;
		this.shuttingDown = true;
		for (const res of this.sseConns.values()) this.writeSse(res, "closing", JSON.stringify({ reason }));
		for (const doc of this.docs.values()) {
			if (doc.reloadTimer) clearTimeout(doc.reloadTimer);
			try {
				doc.watcher?.close();
			} catch {
				/* ignore */
			}
		}
		this.sseConns.clear();
		this.connDoc.clear();
		this.docs.clear();
		this.byPath.clear();
		try {
			this.server.closeAllConnections?.();
		} catch {
			/* older node */
		}
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
		try {
			this.onShutdown?.(reason);
		} catch {
			/* notify failure must not break shutdown */
		}
	}
}

// ------------------------------------------------------------------ helpers

function notFound(res: http.ServerResponse, msg: string): void {
	res.statusCode = 404;
	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	res.end(msg);
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => (data += String(c)));
		req.on("end", () => resolve(data));
		req.on("error", () => resolve(data));
	});
}

export function encodePathToken(absPath: string): string {
	return Buffer.from(absPath, "utf8").toString("base64url");
}

export function decodePathToken(token: string): string | null {
	try {
		const s = Buffer.from(token, "base64url").toString("utf8");
		if (!path.isAbsolute(s)) return null;
		if (encodePathToken(s) !== token) return null;
		return s;
	} catch {
		return null;
	}
}

// ------------------------------------------------------------- singleton

let instance: PreviewServer | null = null;
let starting: Promise<PreviewServer> | null = null;

export function ensureServer(opts?: {
	onShutdown?: (reason: string) => void;
	onAsk?: (qa: QaEntry & { title: string }) => void;
}): Promise<PreviewServer> {
	if (instance && instance.isOpen) return Promise.resolve(instance);
	if (!starting) {
		const server = new PreviewServer(opts?.onShutdown);
		if (opts?.onAsk) server.onAsk = opts.onAsk;
		const boot = server.start().then(() => {
			instance = server;
			return server;
		});
		starting = boot;
		// Release the boot guard once it settles. Clearing it only on failure
		// (the old behavior) kept a resolved promise around forever, so every
		// call after the server auto-exited got the dead instance back and the
		// browser hit ERR_CONNECTION_REFUSED on the closed port.
		const settle = () => {
			if (starting === boot) starting = null;
		};
		boot.then(settle, settle);
	}
	return starting;
}

export function currentServer(): PreviewServer | null {
	return instance;
}
