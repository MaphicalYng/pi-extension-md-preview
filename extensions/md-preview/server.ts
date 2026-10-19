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
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { renderMarkdown, escapeHtml, type RenderedDoc, type TocItem } from "./render";
import { renderPage } from "./page";
import { loadPrefs, savePrefsDebounced, normalizeTheme, normalizeBg, clampScale, clampLineHeight, resolveUiLang, type ThemePref, type BgPref, type UiLang } from "./prefs";

const IDLE_MS = 8_000; // shutdown this long after the last tab goes away
const NEVER_OPENED_MS = 5 * 60_000; // shutdown if nobody ever opened a tab
const SWEEP_MS = 3_000;
const HEARTBEAT_MS = 25_000;

export interface PreviewHandle {
	/** Full URL of the rendered page (always carries `?token=...`). */
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
	/**
	 * Host embedded in `url`: the bound address, or 127.0.0.1 when the server binds a
	 * wildcard (0.0.0.0 / ::). Replace it to build a LAN URL.
	 */
	host: string;
	/** Access token every route requires (`?token=...`). */
	token: string;
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
	/**
	 * The user's chat message rendered as HTML on the server (same pipeline as answerHtml: raw HTML
	 * in it is escaped). Only chat entries get one. `question` keeps the original Markdown verbatim
	 * and stays the source of truth for the pi session context.
	 */
	questionHtml?: string;
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
	/** Server-rendered HTML of the user's message (chat entries only); null for selected-text questions. */
	questionHtml: string | null;
	answerHtml: string | null;
	askedAt: number;
	answeredAt: number | null;
}

/**
 * onAsk payload for one selected-text question or one chat message; chat notices additionally carry
 * the document's earlier chat entries. `batch` stays undefined so the AskEvent union narrows.
 */
export type AskNotice = QaEntry & {
	title: string;
	/** Earlier chat entries of the same document, oldest first; chat notices only. */
	history?: QaEntry[];
	/** Discriminant: a single-question notice never carries a batch. */
	batch?: undefined;
};

/** One batch of selected-text questions; onAsk fires exactly once per batch, never once per item. */
export interface AskBatchNotice {
	batch: true;
	docId: string;
	title: string;
	/** Entries created by this batch, in request order; every id needs its own md_preview_reply. */
	items: QaEntry[];
	/** Other selected-text entries of the same document that still await an answer (excludes this batch). */
	history: QaEntry[];
	askedAt: number;
}

/** onAsk payload union: one single question/chat message, or one whole batch of questions. */
export type AskEvent = AskNotice | AskBatchNotice;

/** One staged revision comment (a passage the user marked plus the edit they asked for). */
export interface RevisionItem {
	quote: string;
	comment: string;
}

/** Revision batch pushed to the agent through onRevise; one notice per batch, never per item. */
export interface RevisionNotice {
	batchId: number;
	docId: string;
	title: string;
	/** Absolute path of the Markdown file the agent must edit. */
	filePath: string;
	items: RevisionItem[];
	requestedAt: number;
}

/** Persisted revision batch; at most one per document (the newest wins). */
export interface RevisionRecord {
	batchId: number;
	docId: string;
	title: string;
	filePath: string;
	items: RevisionItem[];
	createdAt: number;
	/** Render version the batch was requested against (diagnostics only). */
	baseVersion: number;
	doneAt?: number;
	highlights: string[];
	/** Batch id that replaced this one before it was marked done (observability only). */
	supersededBy?: number;
}

/** Page-facing view of a completed batch: embedded in the page and in the SSE init frame. */
export interface RevisionState {
	batchId: number;
	highlights: string[];
	at: number;
}

const MAX_QA_PER_DOC = 50;
const MAX_CHAT_PER_DOC = 100; // per-doc chat cap; only chat entries are trimmed
/** Cap on one batch request (questions or revision comments). */
export const MAX_BATCH_ITEMS = 20;
/** Hard cap on a batch request body; larger bodies are rejected with 413 before parsing. */
const MAX_BATCH_BODY_BYTES = 256 * 1024;
/** Cap on highlight fragments per batch. */
export const MAX_HIGHLIGHTS = MAX_BATCH_ITEMS;
/** Cap on one highlight fragment. */
export const MAX_HIGHLIGHT_LEN = 300;

/**
 * Recovery window of one revision record, measured from doneAt (while pending: from createdAt).
 * Exposed as a function so the smoke test can shrink it (MD_PREVIEW_REVISION_TTL_MS is a test
 * hook, not a user-facing setting).
 */
function revisionTtlMs(): number {
	const raw = Number(process.env.MD_PREVIEW_REVISION_TTL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
}

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

// page.ts (module B) adds `lang` and `mermaidUrl` to PageOptions later; declaring the extra
// fields here keeps both modules type-checking independently. Intersections are
// idempotent, so this stays valid after module B lands.
type RenderPageArgs = Parameters<typeof renderPage>[0] & {
	lang?: UiLang;
	chatUrl?: string;
	mermaidUrl?: string;
	/** Completed revision batch the page replays its highlights from; null/undefined = nothing to mark. */
	revision?: RevisionState | null;
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
	/**
	 * Callback fired when the preview page receives a question, a chat message, or a whole batch of questions
	 * (the extension injects the message into the pi session and wakes the agent).
	 */
	onAsk: ((event: AskEvent) => void) | null = null;
	/** Callback fired when the preview page submits a batch of revision comments (wakes the agent to edit the file). */
	onRevise: ((notice: RevisionNotice) => void) | null = null;
	private qa = new Map<string, QaEntry>();
	private qaSeq = 0;
	/** Newest revision batch per document id. */
	private revisions = new Map<string, RevisionRecord>();
	private revisionSeq = 0;
	/** Most recently opened or navigated document; fallback when a tool call omits `doc`. */
	private lastActiveDocId: string | null = null;
	port = 0;
	/** Address actually bound by `listen()`: may be a wildcard such as 0.0.0.0, unlike `PreviewHandle.host`. */
	readonly host: string;
	/** Per-server access token every route requires (`?token=...`). */
	readonly token: string;

	constructor(onShutdown?: (reason: string) => void, host = "127.0.0.1") {
		this.onShutdown = onShutdown;
		this.host = host;
		this.token = resolveToken();
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
			this.server.listen(0, this.host, () => {
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
		this.lastActiveDocId = doc.id;
		return {
			url: this.withToken(`http://${urlHostFor(this.host)}:${this.port}/doc/${doc.id}`),
			docId: doc.id,
			title: this.titleFor(doc),
			reused,
			liveViewers: doc.viewers.size,
			port: this.port,
			uiLang: doc.uiLang,
			host: urlHostFor(this.host),
			token: this.token,
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
				return this.withToken(`/doc/${encodePathToken(abs)}`);
			}
			if (kind === "link" && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
				const readme = path.join(abs, "README.md");
				if (fs.existsSync(readme)) return this.withToken(`/doc/${encodePathToken(readme)}`);
			}
			return this.withToken(`/asset/${encodePathToken(abs)}`);
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
			questionHtml: e.questionHtml ?? null,
			answerHtml: e.answerHtml ?? null,
			askedAt: e.askedAt,
			answeredAt: e.answeredAt ?? null,
		};
	}

	qaList(docId: string): QaPayload[] {
		return [...this.qa.values()].filter((e) => e.docId === docId).map((e) => this.qaPayload(e));
	}

	/**
	 * Persist one selected-text question and push it to every open tab.
	 * Does not wake the agent and does not bump the document version.
	 */
	private persistAsk(doc: DocState, quote: string, question: string): QaEntry {
		const entry: QaEntry = { id: `q${++this.qaSeq}`, docId: doc.id, quote, question, askedAt: Date.now() };
		this.qa.set(entry.id, entry);
		// Only selected-text questions count against this cap: chat entries have their own.
		const selected = [...this.qa.values()].filter((e) => e.docId === doc.id && !e.chat);
		if (selected.length > MAX_QA_PER_DOC) {
			for (const old of selected.slice(0, selected.length - MAX_QA_PER_DOC)) this.qa.delete(old.id);
		}
		this.broadcastEvent(doc.id, "ask", JSON.stringify(this.qaPayload(entry)));
		return entry;
	}

	/** The preview page submitted a question: persist it, broadcast the SSE ask event, and let the extension inject it into the pi session. */
	ask(doc: DocState, quote: string, question: string): QaEntry {
		const entry = this.persistAsk(doc, quote, question);
		// Advance the document version without broadcasting an update: it invalidates the `v` of every open
		// EventSource, so a tab whose link dropped re-fetches the full init frame on its automatic reconnect
		// (bringing along any question that arrived while the link was down). Online tabs are unaffected:
		// they still receive the ask event below.
		doc.version++;
		try {
			this.onAsk?.({ ...entry, title: this.titleFor(doc) });
		} catch {
			/* failing to inject into the pi session must not block the question itself */
		}
		return entry;
	}

	/**
	 * The preview page submitted a batch of selected-text questions: persist every item (each still
	 * broadcasts its own ask frame) but bump the version and wake the agent exactly once for the batch.
	 */
	askBatch(docId: string, items: { quote: string; question: string }[]): QaEntry[] {
		const doc = this.docs.get(docId);
		if (!doc || items.length === 0) return []; // defensive: the route already rejects empty batches with 400
		const created: QaEntry[] = [];
		try {
			for (const item of items) created.push(this.persistAsk(doc, item.quote, item.question));
		} finally {
			// Partial success still wakes the agent for whatever was persisted.
			if (created.length > 0) {
				doc.version++; // exactly one bump for the whole batch
				const ids = new Set(created.map((e) => e.id));
				try {
					this.onAsk?.({
						batch: true,
						docId: doc.id,
						title: this.titleFor(doc),
						items: created,
						history: this.pendingSelected(doc.id, ids),
						askedAt: created[created.length - 1]?.askedAt ?? Date.now(),
					});
				} catch {
					/* injection failure must not drop the questions */
				}
			}
		}
		return created;
	}

	/** Selected-text entries of a document that still await an answer, optionally excluding ids. */
	private pendingSelected(docId: string, exclude?: Set<string>): QaEntry[] {
		return [...this.qa.values()].filter(
			(e) => e.docId === docId && !e.chat && !e.answerHtml && !(exclude?.has(e.id) ?? false),
		);
	}

	/** The preview page chat box submitted a message: persist it, broadcast the SSE ask event (chat: true), and let the extension inject it into the pi session. */
	chat(doc: DocState, message: string): QaEntry {
		const entry: QaEntry = { id: `q${++this.qaSeq}`, docId: doc.id, quote: "", question: message, chat: true, askedAt: Date.now() };
		// Render the user's message with the same pipeline as the agent reply so the page can show it
		// as Markdown; assigned before the broadcast, so the SSE ask frame already carries it.
		entry.questionHtml = renderMarkdown(message).html;
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

	// ------------------------------------------------------------- revisions

	/**
	 * The preview page submitted a batch of revision comments: store the newest batch of the
	 * document and wake the agent once for the whole batch. No QaEntry is created and the
	 * render version is untouched (the file watcher owns content updates).
	 */
	revise(docId: string, items: { quote: string; comment: string }[]): { batchId: number; count: number } {
		const doc = this.docs.get(docId);
		if (!doc || items.length === 0) return { batchId: 0, count: 0 }; // documented no-op
		const prev = this.revisions.get(doc.id);
		const batchId = ++this.revisionSeq;
		if (prev && prev.doneAt === undefined) prev.supersededBy = batchId; // newest batch wins
		const record: RevisionRecord = {
			batchId,
			docId: doc.id,
			title: this.titleFor(doc),
			filePath: doc.filePath,
			items: items.map((i) => ({ quote: i.quote, comment: i.comment })),
			createdAt: Date.now(),
			baseVersion: doc.version,
			highlights: [],
		};
		this.revisions.set(doc.id, record);
		this.lastActiveDocId = doc.id;
		try {
			this.onRevise?.({
				batchId,
				docId: doc.id,
				title: record.title,
				filePath: record.filePath,
				items: record.items,
				requestedAt: record.createdAt,
			});
		} catch {
			/* injection failure must not lose the batch record */
		}
		return { batchId, count: record.items.length };
	}

	/**
	 * md_preview_revision_done tool entry point: mark the newest revision batch done, push the
	 * edited HTML first and only then broadcast the highlights every open tab must mark.
	 */
	async revisionDone(
		docId: string | undefined,
		highlights?: string[],
	): Promise<{ ok: boolean; message: string; docId?: string; batchId?: number }> {
		const target = this.resolveRevisionTarget(docId);
		if ("error" in target) return { ok: false, message: target.error };
		const doc = target.doc;
		const rec = this.revisionRecord(doc.id);
		if (!rec) {
			return {
				ok: false,
				message:
					`No revision batch is pending for "${this.titleFor(doc)}" (${doc.id}); the last batch expired after ` +
					`${Math.round(revisionTtlMs() / 60_000)} minutes. The file edits are kept - ask the user to re-send the ` +
					"revision comments from the preview page if the highlight is still needed.",
			};
		}
		const clean = (highlights ?? [])
			.map((h) => (h ?? "").trim())
			.filter(Boolean)
			.slice(0, MAX_HIGHLIGHTS)
			.map((h) => (h.length > MAX_HIGHLIGHT_LEN ? h.slice(0, MAX_HIGHLIGHT_LEN) : h));
		if (clean.length > 0) rec.highlights = clean; // an omitted list keeps earlier highlights (idempotent re-call)
		const repeat = rec.doneAt !== undefined;
		const doneAt = rec.doneAt ?? Date.now(); // a second call must not extend the recovery window
		rec.doneAt = doneAt;

		// Ordering: every tab must already hold the edited HTML before it is told what to mark.
		const before = doc.version;
		await this.refreshIfStale(doc);
		if (doc.version !== before) this.broadcastUpdate(doc);
		const state: RevisionState = { batchId: rec.batchId, highlights: rec.highlights, at: doneAt };
		this.broadcastEvent(doc.id, "revision-done", JSON.stringify({ docId: doc.id, ...state }));

		const match = await this.matchHighlights(doc, rec.highlights);
		const tabs = doc.viewers.size;
		const head = repeat
			? `Revision batch #${rec.batchId} was already marked done; highlights refreshed on "${rec.title}" (${doc.id}).`
			: `Revision batch #${rec.batchId} marked done on "${rec.title}" (${doc.id}): ${rec.highlights.length} highlight(s) pushed to ${tabs} open tab(s).`;
		const missNote = match.missed.length
			? ` ${match.missed.length} highlight(s) did not match the file bytes verbatim (Markdown markers are stripped on the page, so they may still mark correctly): ${match.missed.map((h: string) => JSON.stringify(h)).join(", ")}.`
			: "";
		return { ok: true, message: `${head}${missNote}`, docId: doc.id, batchId: rec.batchId };
	}

	/** Expiry-checked revision record lookup; deletes the record once its window has passed. */
	private revisionRecord(docId: string): RevisionRecord | null {
		const rec = this.revisions.get(docId);
		if (!rec) return null;
		const expiresAt = (rec.doneAt ?? rec.createdAt) + revisionTtlMs();
		if (Date.now() > expiresAt) {
			this.revisions.delete(docId);
			return null;
		}
		return rec;
	}

	/** Page payload of a completed batch; null while pending or after expiry (pending batches paint no stale marks). */
	private revisionState(docId: string): RevisionState | null {
		const rec = this.revisionRecord(docId);
		return rec && rec.doneAt !== undefined
			? { batchId: rec.batchId, highlights: rec.highlights, at: rec.doneAt }
			: null;
	}

	/** Resolve a document by id or by absolute/relative Markdown path. */
	private docByRef(ref: string): DocState | null {
		const byId = this.docs.get(ref);
		if (byId) return byId;
		let abs: string;
		try {
			abs = path.resolve(ref);
		} catch {
			return null;
		}
		const byResolved = this.byPath.get(abs);
		if (byResolved) return byResolved;
		// Fallback for a document whose byPath entry no longer matches (defensive, byPath is kept in sync).
		for (const doc of this.docs.values()) if (doc.filePath === abs) return doc;
		return null;
	}

	/**
	 * Resolve the tool's `doc` argument: id, absolute/relative file path, or the most recently
	 * active document. Never guesses between several equally plausible documents.
	 */
	private resolveRevisionTarget(docId: string | undefined): { doc: DocState } | { error: string } {
		if (docId) {
			const doc = this.docByRef(docId);
			if (doc) return { doc };
			return {
				error:
					`No previewed document matches "${docId}". Pass doc with a document id such as d1, ` +
					"or the Markdown file path that was previewed.",
			};
		}
		const withRevision = [...this.docs.values()].filter((d) => this.revisionRecord(d.id) !== null);
		if (withRevision.length === 1) {
			const only = withRevision[0];
			if (only) return { doc: only };
		}
		const lastActive = this.lastActiveDocId ? this.docs.get(this.lastActiveDocId) : undefined;
		if (lastActive) return { doc: lastActive };
		if (this.docs.size === 1) {
			const only = [...this.docs.values()][0];
			if (only) return { doc: only };
		}
		if (this.docs.size === 0) {
			return {
				error:
					"No Markdown preview document is open; pass doc with a document id such as d1, " +
					"or the Markdown file path that was previewed.",
			};
		}
		return {
			error:
				`Several previewed documents are open (${[...this.docs.values()].map((d) => d.id).join(", ")}); ` +
				"pass doc with the document id that matches the revision request.",
		};
	}

	/** Which highlight needles appear verbatim in the current file (an unreadable file counts as all missed). */
	private async matchHighlights(doc: DocState, highlights: string[]): Promise<{ matched: string[]; missed: string[] }> {
		if (highlights.length === 0) return { matched: [], missed: [] };
		let source = "";
		try {
			source = await fs.promises.readFile(doc.filePath, "utf8");
		} catch {
			return { matched: [], missed: [...highlights] };
		}
		const matched: string[] = [];
		const missed: string[] = [];
		for (const h of highlights) (source.includes(h) ? matched : missed).push(h);
		return { matched, missed };
	}

	// --------------------------------------------------------------- routes

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const p = url.pathname;
		// Browser favicon probes never carry the token. An empty 204 reveals nothing and
		// keeps the console/logs free of auth noise, so it stays a fast path above the gate.
		if (p === "/favicon.ico") {
			res.statusCode = 204;
			res.end();
			return;
		}
		// Auth gate: every other route (local requests and SSE included) requires the token.
		// Runs before any routing/state mutation, so a 401 never registers documents,
		// starts watchers, or touches lifecycle counters.
		if (url.searchParams.get("token") !== this.token) return this.serveUnauthorized(res, url);
		if (p === "/" || p === "/index.html") return this.serveIndex(res);
		if (p === "/prefs") {
			if (req.method === "GET") return this.servePrefs(res);
			if (req.method === "POST") return this.serveSavePrefs(req, res);
			res.statusCode = 405;
			res.setHeader("Allow", "GET, POST");
			res.end("method not allowed");
			return;
		}
		if (p === "/mermaid.mjs") return this.serveMermaid(res);
		if (p.startsWith("/asset/")) return this.serveAsset(res, p.slice("/asset/".length));
		const m = p.match(/^\/doc\/([^/]+)(\/ask-batch|\/revise|\/events|\/close|\/ask|\/chat|\/download)?$/);
		if (m) {
			const token = m[1] ?? "";
			const sub = m[2] ?? "";
			const doc = this.resolveDocToken(token);
			if (!doc) return notFound(res, "document not found");
			if (sub === "/events") return this.serveEvents(req, res, doc, url);
			if (sub === "/close") return this.serveClose(req, res, doc, url);
			if (sub === "/ask-batch") return this.serveAskBatch(req, res, doc);
			if (sub === "/revise") return this.serveRevise(req, res, doc);
			if (sub === "/ask") return this.serveAsk(req, res, doc);
			if (sub === "/chat") return this.serveChat(req, res, doc);
			if (sub === "/download") return this.serveDownload(res, doc);
			return this.serveDoc(res, doc);
		}
		return notFound(res, "not found");
	}

	/**
	 * Attach `?token=...` to a server-generated URL. The token joins with `&` when a
	 * query already exists and is inserted before any `#fragment`, so anchors (if ever
	 * preserved) stay after the query string.
	 */
	private withToken(urlPath: string): string {
		const hashAt = urlPath.indexOf("#");
		const base = hashAt >= 0 ? urlPath.slice(0, hashAt) : urlPath;
		const frag = hashAt >= 0 ? urlPath.slice(hashAt) : "";
		return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}${frag}`;
	}

	/** 401 for a missing/invalid token. Language follows the target document when known, else resolveUiLang() (the index page included). */
	private serveUnauthorized(res: http.ServerResponse, url: URL): void {
		const m = url.pathname.match(/^\/doc\/([^/]+)/);
		const doc = m ? this.docs.get(m[1] ?? "") : undefined;
		const lang = doc?.uiLang ?? resolveUiLang();
		res.statusCode = 401;
		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(lang === "zh"
			? "缺少或无效的访问令牌，请在 URL 中附加 ?token=<token>。"
			: "Missing or invalid access token; append ?token=<token> to the URL.");
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
		// A document opened through a Markdown link is active too: md_preview_revision_done may omit `doc`.
		this.lastActiveDocId = doc.id;
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
			updateUrl: this.withToken(`/doc/${doc.id}/events?c=${cid}&v=${doc.version}`),
			closeUrl: this.withToken(`/doc/${doc.id}/close?c=${cid}`),
			askUrl: this.withToken(`/doc/${doc.id}/ask`),
			// Batch endpoints carry their own tokens: the page hides the queue buttons and the
			// "revise" action whenever these are missing, so they must be injected together with askUrl.
			askBatchUrl: this.withToken(`/doc/${doc.id}/ask-batch`),
			reviseUrl: this.withToken(`/doc/${doc.id}/revise`),
			chatUrl: this.withToken(`/doc/${doc.id}/chat`),
			qa: this.qaList(doc.id),
			version: resolveVersion(),
			themeHint,
			prefScale: prefs.scale,
			prefLineHeight: prefs.lineHeight,
			prefBg: prefs.bg,
			prefsUrl: this.withToken("/prefs"),
			downloadUrl: this.withToken(`/doc/${doc.id}/download`),
			mermaidUrl: this.withToken("/mermaid.mjs"),
			lang: doc.uiLang,
			revision: this.revisionState(doc.id),
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
		// Full payload (a superset of the old { id, askedAt }) so the POST response can render the
		// question as Markdown without waiting for the SSE echo.
		res.end(JSON.stringify(this.qaPayload(entry)));
	}

	/**
	 * Batch entry point for staged selected-text questions: validates `{ items: [{ quote, question }] }`
	 * and answers with every created payload, so the page can render its cards from the POST response.
	 */
	private async serveAskBatch(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState): Promise<void> {
		if (req.method !== "POST") {
			res.statusCode = 405;
			res.setHeader("Allow", "POST");
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.end("method not allowed");
			return;
		}
		const body = await readBodyLimited(req, MAX_BATCH_BODY_BYTES);
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		if (body === null) {
			res.statusCode = 413;
			res.end(JSON.stringify({ error: `request body exceeds ${MAX_BATCH_BODY_BYTES} bytes` }));
			return;
		}
		const parsed = parseBatchItems(body, "question");
		if (!parsed.ok) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: parsed.error ?? "invalid request" }));
			return;
		}
		const entries = this.askBatch(doc.id, parsed.items.map((i) => ({ quote: i.quote, question: i.text })));
		res.statusCode = 200;
		res.end(JSON.stringify({ ok: true, count: entries.length, items: entries.map((e) => this.qaPayload(e)) }));
	}

	/**
	 * Batch entry point for staged revision comments: validates `{ items: [{ quote, comment }] }`,
	 * stores the newest batch of the document and wakes the agent once.
	 */
	private async serveRevise(req: http.IncomingMessage, res: http.ServerResponse, doc: DocState): Promise<void> {
		if (req.method !== "POST") {
			res.statusCode = 405;
			res.setHeader("Allow", "POST");
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.end("method not allowed");
			return;
		}
		const body = await readBodyLimited(req, MAX_BATCH_BODY_BYTES);
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		if (body === null) {
			res.statusCode = 413;
			res.end(JSON.stringify({ error: `request body exceeds ${MAX_BATCH_BODY_BYTES} bytes` }));
			return;
		}
		const parsed = parseBatchItems(body, "comment");
		if (!parsed.ok) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: parsed.error ?? "invalid request" }));
			return;
		}
		const result = this.revise(doc.id, parsed.items.map((i) => ({ quote: i.quote, comment: i.text })));
		res.statusCode = 200;
		res.end(JSON.stringify({ ok: true, batchId: result.batchId, count: result.count }));
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
			this.writeSse(res, "init", JSON.stringify({ html: doc.rendered.html, toc: doc.rendered.toc, title: this.titleFor(doc), qa: this.qaList(doc.id), lang: doc.uiLang, revision: this.revisionState(doc.id) }));
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
			.map((d) => `<li><a href="${this.withToken(`/doc/${d.id}`)}">${escapeHtml(this.titleFor(d))}</a> <code>${escapeHtml(d.filePath)}</code></li>`)
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
		// Release expired revision records; correctness does not depend on this pass
		// because revisionRecord() re-checks expiry on every read.
		const expiryNow = Date.now();
		for (const [docId, rec] of this.revisions) {
			if (expiryNow > (rec.doneAt ?? rec.createdAt) + revisionTtlMs()) this.revisions.delete(docId);
		}
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
		this.revisions.clear();
		this.lastActiveDocId = null;
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

/** Per-server auth token: MD_PREVIEW_TOKEN when set (stable remote access), else fresh random URL-safe bytes. */
function resolveToken(): string {
	const env = process.env.MD_PREVIEW_TOKEN?.trim();
	return env || crypto.randomBytes(24).toString("base64url");
}

/**
 * Bind-address env, in precedence order: `MD_PREVIEW_BIND` (canonical) then
 * `MD_PREVIEW_HOST` (deprecated alias kept for backward compatibility).
 */
export function envBindHost(): string | undefined {
	return process.env.MD_PREVIEW_BIND?.trim() || process.env.MD_PREVIEW_HOST?.trim() || undefined;
}

/** Listen host priority: explicit arg > bind env (`MD_PREVIEW_BIND`, legacy `MD_PREVIEW_HOST`) > 127.0.0.1. */
function resolveListenHost(explicit?: string): string {
	return explicit?.trim() || envBindHost() || "127.0.0.1";
}

/**
 * Host used in generated URLs. A wildcard bind address is not a connectable destination,
 * so loopback is used instead (a wildcard binding covers loopback); concrete addresses are
 * used verbatim (IPv6 literals get brackets).
 */
function urlHostFor(listenHost: string): string {
	if (listenHost === "0.0.0.0") return "127.0.0.1";
	if (listenHost === "::" || listenHost === "[::]") return "[::1]";
	if (listenHost.includes(":") && !listenHost.startsWith("[")) return `[${listenHost}]`;
	return listenHost;
}

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

/** Read a body up to maxBytes; resolves null when the limit is exceeded (caller answers 413). */
function readBodyLimited(req: http.IncomingMessage, maxBytes: number): Promise<string | null> {
	return new Promise((resolve) => {
		req.setEncoding("utf8");
		let data = "";
		let bytes = 0;
		let overflow = false;
		req.on("data", (chunk: string) => {
			if (overflow) return;
			bytes += Buffer.byteLength(chunk, "utf8");
			if (bytes > maxBytes) {
				overflow = true;
				data = "";
				return;
			}
			data += chunk;
		});
			req.on("end", () => resolve(overflow ? null : data));
		req.on("error", () => resolve(overflow ? null : data));
		req.on("close", () => resolve(overflow ? null : data)); // aborted request: never leave the handler pending
	});
}

interface ParsedBatchItem {
	quote: string;
	text: string;
}

/** Validation result of a batch body; `error` is set only when ok is false, `items` only when ok is true. */
interface ParsedBatch {
	ok: boolean;
	error?: string;
	items: ParsedBatchItem[];
}

/** Validate `{"items":[{quote, <textKey>}]}`: 1..20 entries, both fields trimmed non-empty and <= 2000 chars. */
function parseBatchItems(body: string, textKey: "question" | "comment"): ParsedBatch {
	const bad = (error: string): ParsedBatch => ({ ok: false, error, items: [] });
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(body);
	} catch {
		return bad("body must be a JSON object with an items array");
	}
	const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	const raw = obj.items;
	if (!Array.isArray(raw)) return bad("items must be an array");
	if (raw.length === 0 || raw.length > MAX_BATCH_ITEMS) return bad(`items must contain 1..${MAX_BATCH_ITEMS} entries`);
	const items: ParsedBatchItem[] = [];
	for (let i = 0; i < raw.length; i++) {
		const it: unknown = raw[i];
		if (!it || typeof it !== "object") return bad(`items[${i}] must be an object`);
		const row = it as Record<string, unknown>;
		const quote = typeof row.quote === "string" ? row.quote.trim() : "";
		const text = typeof row[textKey] === "string" ? (row[textKey] as string).trim() : "";
		if (!quote) return bad(`items[${i}].quote must be a non-empty string`);
		if (quote.length > 2000) return bad(`items[${i}].quote must be at most 2000 characters`);
		if (!text) return bad(`items[${i}].${textKey} must be a non-empty string`);
		if (text.length > 2000) return bad(`items[${i}].${textKey} must be at most 2000 characters`);
		items.push({ quote, text });
	}
	return { ok: true, items };
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
	onAsk?: (event: AskEvent) => void;
	onRevise?: (notice: RevisionNotice) => void;
	host?: string;
}): Promise<PreviewServer> {
	if (instance && instance.isOpen) return Promise.resolve(instance);
	if (!starting) {
		const server = new PreviewServer(opts?.onShutdown, resolveListenHost(opts?.host));
		if (opts?.onAsk) server.onAsk = opts.onAsk;
		if (opts?.onRevise) server.onRevise = opts.onRevise;
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
