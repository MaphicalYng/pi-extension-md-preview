/**
 * md-preview — render Markdown files as polished web pages in the browser.
 *
 * Requirements it implements:
 *  1. Renders agent-written Markdown files as web pages (professional layout,
 *     table of contents, code highlighting, light/dark themes, font-size control).
 *  2. The agent can proactively present a report / Markdown file: the `md_preview`
 *     tool starts a tiny local server and opens the browser tab automatically.
 *  3. The agent does not need to keep working afterwards: the preview server runs
 *     on its own and exits automatically once the user closes the tab (it also
 *     exits when the pi session shuts down).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { currentServer, ensureServer, envBindHost, type AskNotice, type QaEntry } from "./server";
import { openBrowser } from "./browser";
import { loadPrefs, savePrefs, prefsFilePath, browserHostError, pickBrowserHost, type UiLang } from "./prefs";

type Notify = (message: string, type?: "info" | "warning" | "error") => void;

/** Best-effort notification: the session (or its UI) may already be gone. */
function notifySafely(notify: Notify | undefined, message: string, type?: "info" | "warning" | "error"): void {
	try {
		notify?.(message, type);
	} catch {
		/* notification is best-effort */
	}
}

/**
 * Session messenger injected by the extension factory; it delivers a preview-page
 * question into the pi session. A follow-up is delivered immediately when the
 * agent is idle, and queued to wake a turn after the current one when it is busy.
 */
let sessionMessenger: ((text: string) => void) | null = null;

/** Format a preview-page question as a user message injected into the pi session. */
function formatAskMessage(qa: QaEntry & { title: string }): string {
	const quote = qa.quote.length > 1200 ? `${qa.quote.slice(0, 1200)}\n…[quote truncated]` : qa.quote;
	return [
		"[Markdown preview page question]",
		"",
		`Document: "${qa.title}"`,
		"",
		"The user selected the following passage in the preview page:",
		"",
		"```text",
		quote,
		"```",
		"",
		`Question: ${qa.question}`,
		"",
		`Answer based on the relevant file contents, then send the reply back to the preview page with the md_preview_reply tool (question_id: "${qa.id}").`,
	].join("\n");
}

/** Turns of chat history summarized into the injected chat message (contract item 4). */
const CHAT_CONTEXT_TURNS = 5;
/** Max characters kept per verbatim excerpt in the chat context summary. */
const CHAT_EXCERPT_MAX = 300;

/**
 * Collapse fenced code blocks in a history excerpt into a one-line placeholder.
 * Code blocks are token-heavy and rarely needed for chat context; the placeholder keeps the
 * language and body line count so the model still knows what the turn contained.
 */
function collapseCodeBlocks(text: string): string {
	return text.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
		const info = (block.split("\n", 1)[0] ?? "").slice(3).trim() || "text";
		const lines = block.split("\n").length - 2; // body lines between the fences
		return `\`\`\`${info} [code block, ${lines} line${lines === 1 ? "" : "s"} collapsed]\`\`\``;
	});
}

/**
 * Trim a history excerpt to CHAT_EXCERPT_MAX chars: fenced code blocks are collapsed first, then
 * the remainder is cut at a paragraph (or line) boundary when possible. The cut is annotated with
 * how many lines / characters were dropped, so truncation is always explainable, never silent.
 */
function excerpt(text: string): string {
	const clean = collapseCodeBlocks((text ?? "").trim());
	if (clean.length <= CHAT_EXCERPT_MAX) return clean;
	const minKeep = Math.floor(CHAT_EXCERPT_MAX / 2);
	let cutAt = clean.lastIndexOf("\n\n", CHAT_EXCERPT_MAX);
	if (cutAt < minKeep) cutAt = clean.lastIndexOf("\n", CHAT_EXCERPT_MAX);
	if (cutAt < minKeep) cutAt = CHAT_EXCERPT_MAX;
	const dropped = clean.slice(cutAt).replace(/^\n+/, "");
	const droppedLines = dropped ? dropped.split("\n").length : 0;
	return `${clean.slice(0, cutAt)}\n…[truncated: ${droppedLines} more line${droppedLines === 1 ? "" : "s"}, ${dropped.length} chars omitted]`;
}

/** Format a preview-page chat message as a user message injected into the pi session, preceded by a short chat history summary. */
function formatChatMessage(qa: AskNotice): string {
	const history = qa.history ?? [];
	const total = history.length;
	const recent = history.slice(-CHAT_CONTEXT_TURNS);
	// 1-based chat turn numbers over the document's full chat history (older turns stay addressable).
	const firstNo = total - recent.length + 1;
	const context: string[] = [];
	if (recent.length) {
		const omitted = firstNo - 1;
		context.push(
			`Recent chat on this preview page (oldest first): turns ${firstNo}-${total} of ${total}` +
				(omitted ? `; turn${omitted === 1 ? "" : "s"} 1${omitted === 1 ? "" : `-${omitted}`} omitted (older entries dropped).` : "."),
		);
		context.push("");
		context.push(
			recent
				.map((h, i) => {
					const n = firstNo + i;
					return [
						`#${n} user [${h.id}]: ${excerpt(h.question)}`,
						`#${n} assistant: ${h.answerHtml ? excerpt(h.answerText ?? "") : "(not answered yet)"}`,
					].join("\n");
				})
				.join("\n\n---\n\n"),
		);
	} else {
		context.push("This is the first chat message on this preview page.");
	}
	const unanswered = history.filter((h) => !h.answerHtml).map((h) => h.id);
	const lines = [
		"[Markdown preview page chat]",
		"",
		`Document: "${qa.title}"`,
		"",
		...context,
		"",
		`User message (turn #${total + 1}):`,
		"",
		"```text",
		qa.question,
		"```",
	];
	if (unanswered.length) lines.push("", `Earlier chat messages are still unanswered (${unanswered.join(", ")}); answer them too with md_preview_reply when appropriate.`);
	lines.push("", `Reply to this chat message with the md_preview_reply tool (question_id: "${qa.id}"). Write the reply in Markdown; it is rendered as Markdown on the preview page.`);
	return lines.join("\n");
}

interface PreviewOutcome {
	ok: boolean;
	/** Markdown shown to the model (and, for the command, in the transcript). */
	text: string;
	url?: string;
	opened?: boolean;
	/** UI language that actually took effect for the document. */
	uiLang?: UiLang;
	/** Non-fatal hint, e.g. the requested browser host is likely not covered by the bind address. */
	warning?: string;
}

/** Parsed `/md-preview` arguments: the file path (may contain spaces) plus an optional --host override. */
export interface PreviewArgs {
	file: string;
	host?: string;
	error?: string;
}

/** Matches `--host <value>` / `--host=<value>` / `--host "value"` anywhere in the line. */
const HOST_FLAG_RE = /(^|\s)--host(?=$|[\s=])(?:=|\s+)?("[^"]*"|'[^']*'|\S*)/;

/**
 * Parse `/md-preview` arguments.
 *
 * The `--host` fragment is cut out of the raw line and everything else is taken verbatim as the
 * file path, so paths containing spaces keep working and the legacy `/md-preview <file>` form is
 * unchanged. Errors are explicit: a malformed `--host` never silently previews the wrong target.
 */
export function parsePreviewArgs(raw: string): PreviewArgs {
	let rest = raw;
	let host: string | undefined;
	const m = HOST_FLAG_RE.exec(rest);
	if (m) {
		const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
		if (!value || value.startsWith("-")) {
			return { file: "", error: "`--host` requires an IP or hostname, e.g. `/md-preview report.md --host 192.0.2.10`." };
		}
		if (value.includes("/")) {
			return { file: "", error: `\`--host\` expects a bare IP or hostname, not \`${value}\` (no scheme / path / port).` };
		}
		host = value;
		rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length); // remove only the flag; the remainder is the file path
		if (HOST_FLAG_RE.test(rest)) return { file: "", error: "`--host` was given more than once." };
	}
	return { file: rest.trim(), host };
}

/** Rewrite only the host of a preview URL; port and query (including `?token=`) are preserved. */
export function withUrlHost(url: string, host: string): string {
	try {
		const u = new URL(url);
		u.hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; // IPv6 literal -> [::1]
		return u.toString();
	} catch {
		return url; // unparseable URL: hand back what the server produced instead of throwing mid-preview
	}
}

/** A wildcard bind address is not browsable: open the browser on loopback instead. */
export function localBrowserHost(host: string): string {
	return host === "0.0.0.0" || host === "::" || host === "[::]" || host === "" ? "127.0.0.1" : host;
}

/** True when the browser-target host is probably not covered by the server's bind address. */
export function needsHostWarning(listenHost: string, targetHost: string): boolean {
	const wildcard = (h: string) => h === "0.0.0.0" || h === "::" || h === "[::]";
	const loopback = (h: string) => h === "127.0.0.1" || h === "localhost" || h === "::1";
	if (wildcard(listenHost)) return false; // listening on every interface: any target is reachable
	if (targetHost === listenHost) return false; // exactly the bind address
	if (loopback(targetHost) && loopback(listenHost)) return false; // local -> local
	return true; // bound to 127.0.0.1 but opening a LAN IP, or a different bound IP
}

/**
 * Explain a host mismatch. Must keep three points explicit: the current bind, the
 * MD_PREVIEW_BIND=0.0.0.0 fix (needs a restart) and the per-session singleton semantics.
 */
function hostMismatchWarning(listenHost: string, targetHost: string, port: number): string {
	return (
		`the preview server is listening on ${listenHost} only, so http://${targetHost}:${port}/... may not be reachable. ` +
		`Set MD_PREVIEW_BIND=0.0.0.0 (or MD_PREVIEW_BIND=${targetHost}) and restart pi to serve that address. ` +
		"The preview server is a per-session singleton: it keeps its original bind even if MD_PREVIEW_BIND changes mid-session - the new value only takes effect after a restart."
	);
}

/** True when the legacy bind env name is the only one in use. */
function usesLegacyBindEnv(): boolean {
	return !process.env.MD_PREVIEW_BIND?.trim() && !!process.env.MD_PREVIEW_HOST?.trim();
}

/**
 * The live preview server, if any. `currentServer()` keeps returning the last instance after it
 * exits (auto-exit / shutdown), so callers that report or warn about "the running server" must
 * check `isOpen` first.
 */
function liveServer() {
	const server = currentServer();
	return server && server.isOpen ? server : null;
}

/** Shared by the `md_preview` tool and the `/md-preview` command. */
async function previewMarkdown(
	file: string,
	opts: { cwd: string; title?: string; uiLang?: UiLang; open?: boolean; notify?: Notify; host?: string },
): Promise<PreviewOutcome> {
	const abs = path.isAbsolute(file) ? path.normalize(file) : path.resolve(opts.cwd, file);
	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(abs);
	} catch {
		return { ok: false, text: `Preview failed: file not found at \`${abs}\`. Create it first (for example with the write tool).` };
	}
	if (!stat.isFile()) {
		return { ok: false, text: `Preview failed: \`${abs}\` is not a regular file.` };
	}

	const server = await ensureServer({
		host: envBindHost(), // MD_PREVIEW_BIND (or legacy MD_PREVIEW_HOST): same precedence as the contract chain
		onShutdown: (reason) => {
			try {
				opts.notify?.(`Markdown preview: ${reason}`, "info");
			} catch {
				/* session may already be gone; nothing to notify */
			}
		},
	});
	// Preview-page question -> wake the agent by injecting it into the pi session.
	server.onAsk = (qa) => sessionMessenger?.(qa.chat ? formatChatMessage(qa) : formatAskMessage(qa));
	const handle = await server.openDocument(abs, { cwd: opts.cwd, title: opts.title, uiLang: opts.uiLang });

	// One page URL drives the browser, the transcript and details.url (never mix hosts).
	// The host is read at call time (not extension load): a host saved by another pi instance - or by
	// /md-preview-host in this one - takes effect on the very next preview, no reload needed.
	const { host: targetHost } = pickBrowserHost(
		opts.host, // explicit --host from the command (the tool has no host parameter)
		loadPrefs().browserHost, // persisted user-level setting; loadPrefs re-reads the file on every call
		localBrowserHost(server.host), // bind fallback (a wildcard bind opens on loopback)
	);
	const pageUrl = withUrlHost(handle.url, targetHost);

	const tabAlreadyOpen = handle.liveViewers > 0;
	const opened = !tabAlreadyOpen && opts.open !== false ? openBrowser(pageUrl) : false;
	const warning = needsHostWarning(server.host, targetHost) ? hostMismatchWarning(server.host, targetHost, handle.port) : undefined;
	if (warning) notifySafely(opts.notify, `Markdown preview: ${warning}`, "warning");
	notifySafely(opts.notify, `Markdown preview is ready: ${handle.title}`, "info");

	const browserLine = tabAlreadyOpen
		? "Reusing the already-open preview tab (file updates sync automatically)"
		: opened
			? "Opened the browser preview tab automatically"
			: "Could not open the browser automatically; open the URL above manually";

	return {
		ok: true,
		opened,
		url: pageUrl,
		uiLang: handle.uiLang,
		warning,
		text: [
			`Markdown preview is ready: **${handle.title}**`,
			`- Page URL: <${pageUrl}>`,
			`- Source file: \`${abs}\``,
			`- Browser: ${browserLine}`,
			`- Live sync: the page refreshes automatically when the file changes; no need to call this tool again`,
			`- Auto-exit: the preview server stops once the user closes the browser tab, so you do not need to keep working or poll its status`,
			...(warning ? [`- Warning: ${warning}`] : []),
			...(usesLegacyBindEnv()
				? ["- Warning: `MD_PREVIEW_HOST` is deprecated for the bind address; use `MD_PREVIEW_BIND` (the old name still works)."]
				: []),
			``,
			"Share the page URL with the user exactly as returned - it carries a required `?token=` access token - then continue with your other work.",
		].join("\n"),
	};
}

const mdPreviewTool = defineTool({
	name: "md_preview",
	label: "Markdown Preview",
	description:
		"Render a Markdown file as a professionally typeset web page and open a browser tab for the user to read. " +
		"Mandatory trigger rule: whenever the output you are about to produce is structured content (a report, research findings, a design document, a README, a multi-paragraph/multi-section article, a table, a list, a code example, etc.) and is longer than 150 characters, you must first write it to a .md file and then call this tool to present it; never output it only in the terminal. " +
		"The page ships with table-of-contents navigation, code highlighting, light/dark modes, and font-size controls; " +
		"the page refreshes automatically after the source file is modified. The tool returns immediately and you do not need to keep working afterwards: the preview server exits automatically once the user closes the tab. The returned page URL carries a required `?token=` access token; share it in full.",
	promptSnippet: "md_preview: mandatory when the output is structured content longer than 150 characters — write the .md file first, then present it as a web page in the browser",
	promptGuidelines: [
		"Mandatory rule: when the output is structured content (a report, a document, multi-paragraph/multi-section text, a table, a list, a code example, etc.) longer than 150 characters, you must write it to a .md file and call md_preview to present it in the browser; never output it only in the terminal, and do not hesitate or downgrade to a plain-text reply.",
		"When presenting a long report or Markdown document that the user needs to read carefully, write it to a .md file and call md_preview to present it in the browser instead of only printing it in the terminal.",
		"ui_lang is REQUIRED on every call — never omit it: choose it based on the user's language (\"zh\" when the user communicates in Chinese, otherwise \"en\").",
		"After md_preview returns, share the page URL with the user and continue with your other work; do not wait for the user to close the page, and do not call the tool repeatedly just to refresh the page.",
		"The page URL returned by md_preview carries a required `?token=` access token: share it exactly as returned - never truncate it, and never strip or rewrite the query string, or the user will get a 401 error instead of the page.",
	],
	parameters: Type.Object({
		file: Type.String({
			description: "Path of the Markdown file to preview (absolute, or relative to the current working directory)",
		}),
		title: Type.Optional(Type.String({ description: "Page title; defaults to the first level-1 heading of the document" })),
		open_browser: Type.Optional(Type.Boolean({ description: "Whether to open a browser tab automatically; default true" })),
		ui_lang: Type.Union([Type.Literal("en"), Type.Literal("zh")], {
			description:
				'UI language of the preview page: "en" or "zh". REQUIRED — never omit it. ' +
				'Always choose it based on the user\'s language: use "zh" when the user communicates in Chinese, otherwise use "en". ' +
				"Passing a different value on a later call updates the language of an already-open document.",
		}),
	}),
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const outcome = await previewMarkdown(params.file, {
			cwd: ctx.cwd,
			title: params.title,
			uiLang: params.ui_lang,
			open: params.open_browser,
			notify: ctx.hasUI ? (message, type) => ctx.ui.notify(message, type) : undefined,
		});
		return {
			content: [{ type: "text", text: outcome.text }],
			details: {
				file: params.file,
				url: outcome.url ?? null,
				opened: outcome.opened ?? false,
				ui_lang: outcome.uiLang ?? null,
			},
			isError: !outcome.ok,
		};
	},
});

/**
 * Exit point for agent replies to preview-page questions: after a question is
 * injected into the session through onAsk, the model reads the relevant files and
 * sends the answer back with this tool (pushed to every open tab over SSE).
 */
const mdPreviewReplyTool = defineTool({
	name: "md_preview_reply",
	label: "Reply to Preview Question",
	description:
		"Reply to a message the user sent from the Markdown preview page: a question about a passage selected in the page (the message starts with \"[Markdown preview page question]\") or a message typed in the chat box at the bottom of the page (the message starts with \"[Markdown preview page chat]\"). " +
		"Call it only after receiving one of those messages; the reply is rendered as Markdown on the preview page, as a reply card that shows the quoted passage for selected-text questions or as an assistant message in the page chat.",
	parameters: Type.Object({
		question_id: Type.Optional(Type.String({
			description: "Question ID (given in the question message, e.g. q1); omit to reply to the earliest unanswered question",
		})),
		text: Type.String({ description: "Reply text (Markdown supported)" }),
	}),
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const server = currentServer();
		if (!server) {
			return { content: [{ type: "text", text: "No Markdown preview server is running." }], isError: true, details: undefined };
		}
		const result = server.answerQuestion(params.question_id ?? undefined, params.text);
		return {
			content: [{ type: "text", text: result.message }],
			isError: !result.ok,
			details: { question_id: params.question_id ?? null },
		};
	},
});

/** Complete `/md-preview` with Markdown files under the current working directory. */
function completeMarkdownFiles(prefix: string): { value: string; label: string }[] | null {
	if (prefix.startsWith("-")) return null; // typing --host: do not offer file completions
	const cwd = process.cwd();
	const dir = prefix.includes("/") ? path.dirname(prefix) : ".";
	const base = prefix.includes("/") ? path.basename(prefix) : prefix;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(path.resolve(cwd, dir), { withFileTypes: true });
	} catch {
		return null;
	}
	const hits = entries
		.filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name) && e.name.startsWith(base))
		.slice(0, 20)
		.map((e) => {
			const value = dir === "." ? e.name : `${dir.replace(/\/$/, "")}/${e.name}`;
			return { value, label: value };
		});
	return hits.length > 0 ? hits : null;
}

/** Parsed `/md-preview-host` arguments: show the setting, set it, or clear it. */
interface HostCmdArgs {
	mode: "show" | "set" | "clear";
	value?: string;
	error?: string;
}

/** Usage line shared by every `/md-preview-host` transcript output. */
const HOST_CMD_USAGE =
	"Usage: `/md-preview-host <ip|hostname>` sets the persistent browser host · `/md-preview-host --clear` removes it · `/md-preview-host` (no argument) shows the current setting";

/**
 * Parse `/md-preview-host` arguments. No argument means show; an explicit empty value is an error,
 * so "forgot the IP" never silently clears the setting. Validation is shared with the prefs layer.
 */
function parseHostCmdArgs(raw: string): HostCmdArgs {
	const head = raw.trim();
	if (!head) return { mode: "show" }; // bare `/md-preview-host` shows the current setting
	const v = head.replace(/^["']|["']$/g, "").trim();
	if (!v)
		return {
			mode: "show",
			error: "host must not be empty; provide a bare IP or hostname (e.g. `192.0.2.10`) or `--clear` to remove the saved host",
		};
	if (v === "--clear" || v === "clear") return { mode: "clear" }; // "clear" is an ergonomic alias; a machine literally named "clear" is not a plausible target
	if (v.startsWith("-")) return { mode: "show", error: `unknown option \`${v}\`` };
	const err = browserHostError(v);
	if (err) return { mode: "show", error: err };
	return { mode: "set", value: v };
}

export default function mdPreviewExtension(pi: ExtensionAPI) {
	sessionMessenger = (text) => {
		try {
			pi.sendUserMessage(text, { deliverAs: "followUp" });
		} catch {
			try {
				pi.sendUserMessage(text);
			} catch {
				/* session busy and queueing unsupported: the question stays pending on the preview page */
			}
		}
	};
	pi.registerTool(mdPreviewTool);
	pi.registerTool(mdPreviewReplyTool);

	pi.registerCommand("md-preview", {
		description: "Render and preview a Markdown file in the web UI: /md-preview <file path> [--host <ip>]",
		getArgumentCompletions: completeMarkdownFiles,
		handler: async (args, ctx) => {
			const parsed = parsePreviewArgs(args);
			const notify: Notify = (message, type) => ctx.ui.notify(message, type);
			if (parsed.error) {
				// Explicit error, no browser: never preview the wrong target because of a typo.
				pi.sendMessage({
					customType: "md_preview",
					display: true,
					content: [`Invalid \`/md-preview\` arguments: ${parsed.error}`, ``, `Usage: \`/md-preview <file path> [--host <ip>]\``].join("\n"),
				});
				notifySafely(notify, `Markdown preview: ${parsed.error}`, "error");
				return;
			}
			if (!parsed.file) {
				const docs = currentServer()?.listDocuments() ?? [];
				const list = docs.length
					? docs.map((d) => `- ${d.title} (${d.filePath}, ${d.viewers} tab(s))`).join("\n")
					: " (no documents being previewed)";
				pi.sendMessage({
					customType: "md_preview",
					display: true,
					content: [
						"Usage: `/md-preview <file path> [--host <ip>]`",
						"",
						"`--host <ip>` opens the browser tab at that IP instead of the bind address, e.g. `/md-preview reports/summary.md --host 192.0.2.10`. The port and the `?token=` access token are preserved. The preview server must listen on an address that covers that IP: start pi with `MD_PREVIEW_BIND=0.0.0.0` (the bind address is fixed for the whole session, so a restart is required).",
						"",
						"To avoid passing `--host` on every call, persist it once with `/md-preview-host <ip|hostname>` (user-level settings, shared by every pi instance); `/md-preview-host --clear` removes it. An explicit `--host` still wins per call.",
						"",
						`Current previews:\n${list}`,
					].join("\n"),
				});
				return;
			}
			const outcome = await previewMarkdown(parsed.file, { cwd: ctx.cwd, notify, host: parsed.host });
			pi.sendMessage({ customType: "md_preview", display: true, content: outcome.text });
		},
	});

	pi.registerCommand("md-preview-host", {
		description:
			"Persist the browser host used when opening previews: /md-preview-host <ip|hostname> | --clear | (no argument shows the current setting)",
		getArgumentCompletions: (prefix) =>
			"--clear".startsWith(prefix.trim()) ? [{ value: "--clear", label: "--clear (remove the saved host)" }] : null,
		handler: async (args, ctx) => {
			const notify: Notify = (message, type) => ctx.ui.notify(message, type);
			const send = (content: string) => pi.sendMessage({ customType: "md_preview", display: true, content });
			const parsed = parseHostCmdArgs(args);
			if (parsed.error) {
				// Explicit error, no write: an invalid host must never reach the settings file.
				send([`Invalid \`/md-preview-host\` arguments: ${parsed.error}`, ``, HOST_CMD_USAGE].join("\n"));
				notifySafely(notify, `Markdown preview: ${parsed.error}`, "error");
				return;
			}
			if (parsed.mode === "set") {
				const saved = savePrefs({ browserHost: parsed.value! }); // synchronous atomic write: visible to every instance right away
				const host = saved.browserHost!; // validation already passed, so the canonical (de-bracketed) value is non-null
				const server = liveServer();
				// An already-running server keeps its original bind: warn (do not block) when it does not cover the new host.
				const warn = server && needsHostWarning(server.host, host) ? hostMismatchWarning(server.host, host, server.port) : undefined;
				if (warn) notifySafely(notify, `Markdown preview: ${warn}`, "warning");
				notifySafely(notify, `Markdown preview: browser host set to ${host}`, "info");
				send(
					[
						`Browser host saved: \`${host}\` — every preview (this and any other pi instance) opens at this host from its next preview on.`,
						...(warn ? [`Warning: ${warn}`] : []),
						``,
						"An explicit `--host` on `/md-preview` still overrides this per call; `/md-preview-host --clear` removes it.",
					].join("\n"),
				);
				return;
			}
			if (parsed.mode === "clear") {
				savePrefs({ browserHost: null });
				notifySafely(notify, "Markdown preview: browser host cleared", "info");
				send("Browser host cleared — previews fall back to the server bind address.");
				return;
			}
			// show: report the persisted value, the value the next preview would use and its source.
			const persisted = loadPrefs().browserHost;
			const server = liveServer();
			const bindFallback = server
				? localBrowserHost(server.host)
				: localBrowserHost(envBindHost() ?? "127.0.0.1");
			const picked = pickBrowserHost(undefined, persisted, bindFallback);
			const sourceLabel = picked.source === "persisted" ? "persisted setting" : "server bind fallback";
			const envBind = envBindHost();
			const bindLine = server
				? `${server.host} (running)`
				: envBind
					? `${envBind} (from ${process.env.MD_PREVIEW_BIND?.trim() ? "MD_PREVIEW_BIND" : "MD_PREVIEW_HOST (deprecated)"})`
					: "no preview server running; default 127.0.0.1";
			send(
				[
					"Markdown preview browser host:",
					`- Persisted setting: ${persisted ?? "not set"}`,
					`- Effective for the next preview: ${picked.host} (source: ${sourceLabel})`,
					`- Server bind: ${bindLine}`,
					`- Settings file: ${prefsFilePath()}`,
					``,
					"Precedence: explicit `/md-preview <file> --host <ip>` > persisted setting > server bind address.",
					"The setting is read at every preview call, so all pi instances use it from their next preview on.",
					HOST_CMD_USAGE,
				].join("\n"),
			);
		},
	});

	// Safety net: never leak the preview server past the session. The server also
	// self-exits shortly after the user closes the browser tab.
	pi.on("session_shutdown", (event) => {
		void currentServer()?.shutdown(`pi session ended (${event.reason})`);
	});
}
