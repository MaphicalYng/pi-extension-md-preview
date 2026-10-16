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
import { currentServer, ensureServer, type AskNotice, type QaEntry } from "./server";
import { openBrowser } from "./browser";
import type { UiLang } from "./prefs";

type Notify = (message: string, type?: "info" | "warning" | "error") => void;

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

/** Trim a verbatim excerpt to CHAT_EXCERPT_MAX chars, marking cuts with an ellipsis line. */
function excerpt(text: string): string {
	const clean = (text ?? "").trim();
	return clean.length > CHAT_EXCERPT_MAX ? `${clean.slice(0, CHAT_EXCERPT_MAX)}\n…[excerpt truncated]` : clean;
}

/** Format a preview-page chat message as a user message injected into the pi session, preceded by a short chat history summary. */
function formatChatMessage(qa: AskNotice): string {
	const history = qa.history ?? [];
	const recent = history.slice(-CHAT_CONTEXT_TURNS);
	const context: string[] = [];
	if (recent.length) {
		context.push(`Recent chat on this preview page (oldest first, last ${recent.length} turns):`);
		for (const h of recent) context.push(`- user: ${excerpt(h.question)}\n  assistant: ${h.answerHtml ? excerpt(h.answerText ?? "") : "(not answered yet)"}`);
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
		"User message:",
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
}

/** Shared by the `md_preview` tool and the `/md-preview` command. */
async function previewMarkdown(
	file: string,
	opts: { cwd: string; title?: string; uiLang?: UiLang; open?: boolean; notify?: Notify },
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

	const tabAlreadyOpen = handle.liveViewers > 0;
	const opened = !tabAlreadyOpen && opts.open !== false ? openBrowser(handle.url) : false;
	try {
		opts.notify?.(`Markdown preview is ready: ${handle.title}`, "info");
	} catch {
		/* notification is best-effort */
	}

	const browserLine = tabAlreadyOpen
		? "Reusing the already-open preview tab (file updates sync automatically)"
		: opened
			? "Opened the browser preview tab automatically"
			: "Could not open the browser automatically; open the URL above manually";

	return {
		ok: true,
		opened,
		url: handle.url,
		uiLang: handle.uiLang,
		text: [
			`Markdown preview is ready: **${handle.title}**`,
			`- Page URL: <${handle.url}>`,
			`- Source file: \`${abs}\``,
			`- Browser: ${browserLine}`,
			`- Live sync: the page refreshes automatically when the file changes; no need to call this tool again`,
			`- Auto-exit: the preview server stops once the user closes the browser tab, so you do not need to keep working or poll its status`,
			``,
			`Share the page URL with the user so they can read it, then continue with your other work.`,
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
		"the page refreshes automatically after the source file is modified. The tool returns immediately and you do not need to keep working afterwards: the preview server exits automatically once the user closes the tab.",
	promptSnippet: "md_preview: mandatory when the output is structured content longer than 150 characters — write the .md file first, then present it as a web page in the browser",
	promptGuidelines: [
		"Mandatory rule: when the output is structured content (a report, a document, multi-paragraph/multi-section text, a table, a list, a code example, etc.) longer than 150 characters, you must write it to a .md file and call md_preview to present it in the browser; never output it only in the terminal, and do not hesitate or downgrade to a plain-text reply.",
		"When presenting a long report or Markdown document that the user needs to read carefully, write it to a .md file and call md_preview to present it in the browser instead of only printing it in the terminal.",
		"ui_lang is REQUIRED on every call — never omit it: choose it based on the user's language (\"zh\" when the user communicates in Chinese, otherwise \"en\").",
		"After md_preview returns, share the page URL with the user and continue with your other work; do not wait for the user to close the page, and do not call the tool repeatedly just to refresh the page.",
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
		description: "Render and preview a Markdown file in the web UI: /md-preview <file path>",
		getArgumentCompletions: completeMarkdownFiles,
		handler: async (args, ctx) => {
			const file = args.trim();
			const notify: Notify = (message, type) => ctx.ui.notify(message, type);
			if (!file) {
				const docs = currentServer()?.listDocuments() ?? [];
				const list = docs.length
					? docs.map((d) => `- ${d.title} (${d.filePath}, ${d.viewers} tab(s))`).join("\n")
					: " (no documents being previewed)";
				pi.sendMessage({
					customType: "md_preview",
					display: true,
					content: `Usage: \`/md-preview <file path>\`\n\nCurrent previews:\n${list}`,
				});
				return;
			}
			const outcome = await previewMarkdown(file, { cwd: ctx.cwd, notify });
			pi.sendMessage({ customType: "md_preview", display: true, content: outcome.text });
		},
	});

	// Safety net: never leak the preview server past the session. The server also
	// self-exits shortly after the user closes the browser tab.
	pi.on("session_shutdown", (event) => {
		void currentServer()?.shutdown(`pi session ended (${event.reason})`);
	});
}
