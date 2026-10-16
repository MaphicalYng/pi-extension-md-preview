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
import { loadPrefs, savePrefsDebounced, normalizeTheme, normalizeBg, clampScale, clampLineHeight, resolveUiLang, type ThemePref, type BgPref, type UiLang } from "./prefs";

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
	/** UI language this document is rendered with. */
	uiLang: UiLang;
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
	/** UI language of this document: drives page rendering, SSE payloads and error notices. */
	uiLang: UiLang;
}

/** One question-and-answer record created from a selected-text question or a chat message on the preview page. */
export interface QaEntry {
	id: string;
	docId: string;
	/** Original passage the user selected in the preview page; empty for chat entries. */
	quote: string;
	/** The user's question, or the message body for chat entries. */
	question: string;
	/** True for chat messages typed in the box at the bottom of the page (quote is then empty). */
	chat?: boolean;
	/** Agent reply as server-rendered HTML (raw HTML in the reply is rendered as escaped text). */
	answerHtml?: string;
	/** Raw Markdown of the agent reply: only used to summarize chat context, never sent to the page. */
	answerText?: string;
	askedAt: number;
	answeredAt?: number;
}

/** Q&A payload shape sent to the page (answerHtml null = still awaiting a reply). */
export interface QaPayload {
	id: string;
	quote: string;
	question: string;
	chat: boolean;
	answerHtml: string | null;
	askedAt: number;
	answeredAt: number | null;
}

/** onAsk callback payload; chat notices additionally carry the document's earlier chat entries. */
export type AskNotice = QaEntry & {
	title: string;
	/** Earlier chat entries of the same document, oldest first; chat notices only. */
	history?: QaEntry[];
};

const MAX_QA_PER_DOC = 50;
const MAX_CHAT_PER_DOC = 100; // per-doc chat cap; only chat entries are trimmed

// ----------------------------------------------------------- version (footer)

/** Walk up from the current file location to the extension root (the directory whose package.json names this extension). */
function findExtensionRoot(startDir: string): string | null {
	let dir = startDir;
	for (let i = 0; i < 6; i++) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string };
			if (pkg.name === "pi-md-preview") return dir;
		} catch {
			/* keep walking up */
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let cachedVersion: string | null | undefined;

/**
 * Footer version: commit date + short commit id (e.g. 2026-10-13 · 9311172).
 * On the first render a single git process is spawned (without a shell) in the
 * extension root; a dirty worktree appends -dirty. Returns null when git or the
 * repository is unavailable, in which case the page shows no footer.
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
			/* ignore dirty-check failure */
		}
		cachedVersion = `${date} · ${hash}${dirty}`;
	} catch {
		/* no git, or not inside a repository: no version shown */
	}
	return cachedVersion;
}

let cachedMermaidPath: string | null | undefined;

/** Path of the vendored single-file mermaid ESM bundle (extensions/md-preview/vendor/mermaid.esm.min.mjs). */
function resolveMermaidVendor(): string | null {
	if (cachedMermaidPath !== undefined) return cachedMermaidPath;
	const here = typeof __dirname === "string" ? __dirname : process.cwd();
	const rootDir = findExtensionRoot(here);
	cachedMermaidPath = rootDir ? path.join(rootDir, "extensions", "md-preview", "vendor", "mermaid.esm.min.mjs") : null;
	return cachedMermaidPath;
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

// page.ts (module B) adds `lang` to PageOptions later; declaring the extra field
// here keeps both modules type-checking independently. Intersections are
// idempotent, so this stays valid after module B lands.
type RenderPageArgs = Parameters<typeof renderPage>[0] & { lang?: UiLang; chatUrl?: string };

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
	/** Callback fired when the preview page receives a question or chat message (the extension uses it to inject the message into the pi session and wake the agent). */
	onAsk: ((qa: AskNotice) => void) | null = null;
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
	async openDocument(filePath: string, opts: { cwd?: string; title?: string; uiLang?: UiLang } = {}): Promise<PreviewHandle> {
		const abs = path.resolve(filePath);
		// A freshly requested document gives a browser tab a new chance to
		// connect: restart the no-viewer grace windows so the sweep cannot shut
		// the server down in the middle of this call.
		this.startedAt = Date.now();
		this.noViewerSince = null;
		if (opts.cwd) this.roots.add(path.resolve(opts.cwd));
		const uiLang = resolveUiLang(opts.uiLang);
		const existing = this.byPath.get(abs);
		if (existing) {
			if (opts.title && opts.title !== existing.explicitTitle) {
				existing.explicitTitle = opts.title;
				await this.refresh(existing);
				this.broadcastUpdate(existing);
			}
			// Language update policy (PM revision): only an explicitly supplied uiLang may
			// change the language of an already-open document, so a repeated call that
			// omits ui_lang keeps the current language instead of resetting it.
			if (opts.uiLang !== undefined && uiLang !== existing.uiLang) {
				existing.uiLang = uiLang;
				// Re-render so a localized error notice (if any) matches the new language,
				// then push it over SSE — open tabs pick it up on their auto-refresh.
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
			uiLang,
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
			uiLang: doc.uiLang,
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
			// The notice is data, localized at render time by the document's language.
			const detail = `${escapeHtml(doc.filePath)}<br>${escapeHtml(String(err))}`;
			doc.rendered = {
				html: `<div class="notice">${doc.uiLang === "zh" ? `文件无法读取：${detail}` : `Cannot read file: ${detail}`}</div>`,
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
			lang: doc.uiLang,
		});
		this.broadcastEvent(doc.id, "update", payload);
	}

	// ---------------------------------------------------------- Q&A + chat

	private qaPayload(e: QaEntry): QaPayload {
		return {
			id: e.id,
			quote: e.quote,
			question: e.question,
			chat: e.chat === true,
			answerHtml: e.answerHtml ?? null,
			askedAt: e.askedAt,
			answeredAt: e.answeredAt ?? null,
		};
	}

	qaList(docId: string): QaPayload[] {
		return [...this.qa.values()].filter((e) => e.docId === docId).map((e) => this.qaPayload(e));
	}

	/** The preview page submitted a question: persist it, broadcast the SSE ask event, and let the extension inject it into the pi session. */
	ask(doc: DocState, quote: string, question: string): QaEntry {
		const entry: QaEntry = { id: `q${++this.qaSeq}`, docId: doc.id, quote, question, askedAt: Date.now() };
		this.qa.set(entry.id, entry);
		// Only selected-text questions count against this cap: chat entries have their own.
		const selected = [...this.qa.values()].filter((e) => e.docId === doc.id && !e.chat);
		if (selected.length > MAX_QA_PER_DOC) {
			for (const old of selected.slice(0, selected.length - MAX_QA_PER_DOC)) this.qa.delete(old.id);
		}
		// Advance the document version without broadcasting an update: it invalidates the `v` of every open
		// EventSource, so a tab whose link dropped re-fetches the full init frame on its automatic reconnect
		// (bringing along any question that arrived while the link was down). Online tabs are unaffected:
		// they still receive the ask/answer events below.
		doc.version++;
		this.broadcastEvent(doc.id, "ask", JSON.stringify(this.qaPayload(entry)));
		try {
			this.onAsk?.({ ...entry, title: this.titleFor(doc) });
		} catch {
			/* failing to inject into the pi session must not block the question itself */
		}
		return entry;
	}

	/** The preview page chat box submitted a message: persist it, broadcast the SSE ask event (chat: true), and let the extension inject it into the pi session. */
	chat(doc: DocState, message: string): QaEntry {
		const entry: QaEntry = { id: `q${++this.qaSeq}`, docId: doc.id, quote: "", question: message, chat: true, askedAt: Date.now() };
		this.qa.set(entry.id, entry);
		this.trimChat(doc.id);
		// Same reason as ask(): make the `v` of already-open EventSource links stale, so a reconnect after a
		// dropped link receives the full init frame (chat entries plus their answers included).
		doc.version++;
		this.broadcastEvent(doc.id, "ask", JSON.stringify(this.qaPayload(entry)));
		try {
			this.onAsk?.({ ...entry, title: this.titleFor(doc), history: this.chatHistory(doc.id, entry.id) });
		} catch {
			/* failing to inject into the pi session must not block the message itself */
		}
		return entry;
	}

	/** Keep only the newest MAX_CHAT_PER_DOC chat entries of a document (selected-text questions are capped separately). */
	private trimChat(docId: string): void {
		const chat = [...this.qa.values()].filter((e) => e.docId === docId && e.chat === true);
		if (chat.length > MAX_CHAT_PER_DOC) {
			for (const old of chat.slice(0, chat.length - MAX_CHAT_PER_DOC)) this.qa.delete(old.id);
		}
	}

	/** Earlier chat entries of a document, oldest first (Map insertion order); the entry being injected is excluded. */
	private chatHistory(docId: string, excludeId?: string): QaEntry[] {
		return [...this.qa.values()].filter((e) => e.docId === docId && e.chat === true && e.id !== excludeId);
	}

	/**
	 * md_preview_reply tool entry point: stores the agent reply and broadcasts the
	 * SSE answer event. When questionId is omitted the earliest unanswered
	 * question is answered.
	 */
	answerQuestion(questionId: string | undefined, text: string): { ok: boolean; message: string } {
		const answer = (text ?? "").trim();
		if (!answer) return { ok: false, message: "Reply text is empty." };
		let entry: QaEntry | undefined;
		if (questionId) entry = this.qa.get(questionId);
		else for (const e of this.qa.values()) if (!e.answerHtml) { entry = e; break; }
		if (!entry || entry.answerHtml) {
			const pending = [...this.qa.values()].filter((e) => !e.answerHtml).map((e) => e.id).join(", ") || "none";
			return { ok: false, message: `No pending question found (question_id=${questionId ?? "earliest unanswered"}). Pending questions: ${pending}` };
		}
		entry.answerHtml = renderMarkdown(answer).html;
		entry.answerText = answer;
		entry.answeredAt = Date.now();
		this.broadcastEvent(entry.docId, "answer", JSON.stringify({ id: entry.id, answerHtml: entry.answerHtml, answeredAt: entry.answeredAt }));
		return { ok: true, message: `Answered preview question ${entry.id}; the reply card has been pushed to the browser.` };
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
		if (p === "/mermaid.mjs") return this.serveMermaid(res);
		if (p.startsWith("/asset/")) return this.serveAsset(res, p.slice("/asset/".length));
		const m = p.match(/^\/doc\/([^/]+)(\/events|\/close|\/ask|\/chat|\/download)?$/);
		if (m) {
			const token = m[1] ?? "";
			const sub = m[2] ?? "";
			const doc = this.resolveDocToken(token);
			if (!doc) return notFound(res, "document not found");
			if (sub === "/events") return this.serveEvents(req, res, doc, url);
			if (sub === "/close") return this.serveClose(req, res, doc, url);
			if (sub === "/ask") return this.serveAsk(req, res, doc);
			if (sub === "/chat") return this.serveChat(req, res, doc);
			if (sub === "/download") return this.serveDownload(res, doc);
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
			uiLang: resolveUiLang(),
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
		// User-level persisted prefs win over the MD_PREVIEW_THEME env hint;
		// with neither set the page falls back to following the OS theme.
		const prefs = loadPrefs();
		const env = process.env.MD_PREVIEW_THEME;
		const themeHint = prefs.theme ?? (env === "light" || env === "dark" || env === "system" ? env : undefined);
		const args: RenderPageArgs = {
			docId: doc.id,
			title: this.titleFor(doc),
			subtitle: doc.filePath,
			bodyHtml: doc.rendered.html,
			toc: doc.rendered.toc,
			updateUrl: `/doc/${doc.id}/events?c=${cid}&v=${doc.version}`,
			closeUrl: `/doc/${doc.id}/close?c=${cid}`,
			askUrl: `/doc/${doc.id}/ask`,
			chatUrl: `/doc/${doc.id}/chat`,
			qa: this.qaList(doc.id),
			version: resolveVersion(),
			themeHint,
			prefScale: prefs.scale,
			prefLineHeight: prefs.lineHeight,
			prefBg: prefs.bg,
			prefsUrl: "/prefs",
			downloadUrl: `/doc/${doc.id}/download`,
			lang: doc.uiLang,
		};
		const html = renderPage(args);
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(html);
	}

	/** Download the raw Markdown source of the current document (always reads the latest bytes from disk). */
	private serveDownload(res: http.ServerResponse, doc: DocState): void {
		let raw: Buffer;
		try {
			raw = fs.readFileSync(doc.filePath);
		} catch {
			return notFound(res, "source file not found");
		}
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/markdown; charset=utf-8");
		res.setHeader("Content-Disposition", contentDisposition(path.basename(doc.filePath)));
		res.setHeader("Cache-Control", "no-store");
		res.end(raw);
	}

	private async serveAsk(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState): Promise<void> {
		const body = await readBody(req);
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* an empty or non-JSON body counts as an invalid request */
		}
		const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		const quote = typeof obj.quote === "string" ? obj.quote.trim().slice(0, 2000) : "";
		const question = typeof obj.question === "string" ? obj.question.trim().slice(0, 2000) : "";
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		if (!quote || !question) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "quote and question must be non-empty strings" }));
			return;
		}
		const entry = this.ask(doc, quote, question);
		res.statusCode = 200;
		res.end(JSON.stringify({ id: entry.id, askedAt: entry.askedAt }));
	}

	/**
	 * Chat box entry point: validates `{ message: string }` (trimmed, 2000 chars max,
	 * the same policy as /ask) and stores the message as a chat entry.
	 */
	private async serveChat(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState): Promise<void> {
		if (req.method !== "POST") {
			res.statusCode = 405;
			res.setHeader("Allow", "POST");
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.end("method not allowed");
			return;
		}
		const body = await readBody(req);
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* an empty or non-JSON body counts as an invalid request */
		}
		const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		const message = typeof obj.message === "string" ? obj.message.trim().slice(0, 2000) : "";
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		if (!message) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: "message must be a non-empty string" }));
			return;
		}
		const entry = this.chat(doc, message);
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
			this.writeSse(res, "init", JSON.stringify({ html: doc.rendered.html, toc: doc.rendered.toc, title: this.titleFor(doc), qa: this.qaList(doc.id), lang: doc.uiLang }));
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

	/** Serve the vendored single-file mermaid ESM bundle from the same origin (pages with diagrams dynamically import('/mermaid.mjs') instead of using a CDN). */
	private async serveMermaid(res: http.ServerResponse): Promise<void> {
		const filePath = resolveMermaidVendor();
		if (!filePath) {
			notFound(res, "mermaid not found");
			return;
		}
		try {
			const data = await fs.promises.readFile(filePath);
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/javascript; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("X-Content-Type-Options", "nosniff");
			res.end(data);
		} catch {
			notFound(res, "mermaid not found");
		}
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
		// The index page has no document context, so it follows resolveUiLang()
		// (MD_PREVIEW_LANG env hint, then the default).
		const lang = resolveUiLang();
		const items = [...this.docs.values()]
			.map((d) => `<li><a href="/doc/${d.id}">${escapeHtml(this.titleFor(d))}</a> <code>${escapeHtml(d.filePath)}</code></li>`)
			.join("\n");
		const heading = lang === "zh" ? "Markdown 预览" : "Markdown Preview";
		const intro = lang === "zh" ? "当前会话打开的文档：" : "Documents open in this session:";
		const empty = lang === "zh" ? "（无）" : "(none)";
		const html = `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Markdown Preview</title><style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
body{max-width:720px;margin:64px auto;padding:0 24px;line-height:1.7}
h1{font-size:1.4rem} li{margin:.4rem 0} code{opacity:.6;font-size:.85em} a{color:#2563eb}
</style></head><body><h1>${heading}</h1><p>${intro}</p><ul>${items || `<li>${empty}</li>`}</ul></body></html>`;
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(html);
	}

	// ------------------------------------------------------------- prefs

	/** Current user-level preferences (for debugging / page self-checks). */
	private servePrefs(res: http.ServerResponse): void {
		const prefs = loadPrefs();
		res.statusCode = 200;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(JSON.stringify(prefs));
	}

	/**
	 * Reported by the page whenever theme / font size / line height change; merged
	 * into the user-level prefs file. Invalid fields are ignored instead of
	 * erroring out — the client clamps values, this is only a safety net.
	 */
	private async serveSavePrefs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readBody(req);
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			/* an empty or non-JSON body counts as "no patch" */
		}
		const patch: { theme?: ThemePref | null; bg?: BgPref | null; scale?: number | null; lineHeight?: number | null } = {};
		if (parsed && typeof parsed === "object") {
			const obj = parsed as Record<string, unknown>;
			// Invalid values are ignored; an explicit null resets to the default.
			if (obj.theme !== undefined) {
				const theme = normalizeTheme(obj.theme);
				if (theme !== null || obj.theme === null) patch.theme = theme;
			}
			if (obj.bg !== undefined) {
				const bg = normalizeBg(obj.bg);
				if (bg !== null || obj.bg === null) patch.bg = bg;
			}
			if (obj.scale !== undefined) {
				const scale = clampScale(obj.scale);
				if (scale !== null || obj.scale === null) patch.scale = scale;
			}
			if (obj.lineHeight !== undefined) {
				const lineHeight = clampLineHeight(obj.lineHeight);
				if (lineHeight !== null || obj.lineHeight === null) patch.lineHeight = lineHeight;
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
			else if (now - this.noViewerSince >= IDLE_MS) void this.shutdown("All preview tabs were closed");
			return;
		}
		if (now - this.startedAt >= NEVER_OPENED_MS) void this.shutdown("The preview page was never opened");
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

/** RFC 5987: ASCII fallback filename plus the real UTF-8 encoded filename. */
function contentDisposition(filename: string): string {
	const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
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
	onAsk?: (qa: AskNotice) => void;
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
