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
import { currentServer, ensureServer, type QaEntry } from "./server";
import { openBrowser } from "./browser";

type Notify = (message: string, type?: "info" | "warning" | "error") => void;

/**
 * 会话信使：由扩展工厂注入，用于把预览页提问送进 pi 会话。
 * followUp 投递在 Agent 空闲时立即唤起新 turn，忙时排队到当前 turn 结束后唤起。
 */
let sessionMessenger: ((text: string) => void) | null = null;

/** 把预览页提问格式化为注入 pi 会话的用户消息。 */
function formatAskMessage(qa: QaEntry & { title: string }): string {
	const quote = qa.quote.length > 1200 ? `${qa.quote.slice(0, 1200)}\n…（原文过长已截断）` : qa.quote;
	return [
		"【Markdown 预览页提问】",
		"",
		`文档：《${qa.title}》`,
		"",
		"用户在预览页选中了以下原文：",
		"",
		"```text",
		quote,
		"```",
		"",
		`问题：${qa.question}`,
		"",
		`请结合相关文件内容回答，并调用 md_preview_reply 工具把答复送回预览页（question_id: "${qa.id}"）。`,
	].join("\n");
}

interface PreviewOutcome {
	ok: boolean;
	/** Markdown shown to the model (and, for the command, in the transcript). */
	text: string;
	url?: string;
	opened?: boolean;
}

/** Shared by the `md_preview` tool and the `/md-preview` command. */
async function previewMarkdown(
	file: string,
	opts: { cwd: string; title?: string; open?: boolean; notify?: Notify },
): Promise<PreviewOutcome> {
	const abs = path.isAbsolute(file) ? path.normalize(file) : path.resolve(opts.cwd, file);
	let stat: fs.Stats;
	try {
		stat = await fs.promises.stat(abs);
	} catch {
		return { ok: false, text: `预览失败：找不到文件 \`${abs}\`。请先用 write 工具创建该文件。` };
	}
	if (!stat.isFile()) {
		return { ok: false, text: `预览失败：\`${abs}\` 不是一个普通文件。` };
	}

	const server = await ensureServer({
		onShutdown: (reason) => {
			try {
				opts.notify?.(`Markdown 预览：${reason}`, "info");
			} catch {
				/* session may already be gone; nothing to notify */
			}
		},
	});
	// 预览页提问 → 注入 pi 会话唤醒 Agent 作答。
	server.onAsk = (qa) => sessionMessenger?.(formatAskMessage(qa));
	const handle = await server.openDocument(abs, { cwd: opts.cwd, title: opts.title });

	const tabAlreadyOpen = handle.liveViewers > 0;
	const opened = !tabAlreadyOpen && opts.open !== false ? openBrowser(handle.url) : false;
	try {
		opts.notify?.(`Markdown 预览已就绪：${handle.title}`, "info");
	} catch {
		/* notification is best-effort */
	}

	const browserLine = tabAlreadyOpen
		? "复用已打开的预览标签页（文件更新会自动同步过去）"
		: opened
			? "已自动打开浏览器预览标签页"
			: "未能自动打开浏览器，请手动访问上面的地址";

	return {
		ok: true,
		opened,
		url: handle.url,
		text: [
			`Markdown 预览已就绪：**${handle.title}**`,
			`- 页面地址：<${handle.url}>`,
			`- 源文件：\`${abs}\``,
			`- 浏览器：${browserLine}`,
			`- 实时同步：文件内容修改后页面会自动刷新，无需再次调用本工具`,
			`- 自动退出：用户关闭浏览器标签页后预览服务会自动停止，你无需保持工作或轮询状态`,
			``,
			`请把页面地址发给用户，供其阅读；随后即可继续你的其他工作。`,
		].join("\n"),
	};
}

const mdPreviewTool = defineTool({
	name: "md_preview",
	label: "Markdown 预览",
	description:
		"用专业排版的 Web 页面渲染一个 Markdown 文件，并自动打开浏览器标签页供用户阅读。" +
		"当你要向用户呈现需要仔细阅读的报告、调研结果、设计文档、README 或其他 Markdown 内容时，" +
		"先把内容写入 .md 文件，然后调用本工具展示。页面自带目录导航、代码高亮、明亮/黑暗模式和字体大小调节；" +
		"源文件被修改后页面自动刷新。工具立即返回，之后你无需保持工作：用户关闭标签页时预览服务会自动退出。",
	promptSnippet: "md_preview: 用 Web 页面渲染 Markdown 报告并在浏览器打开",
	promptGuidelines: [
		"向用户呈现需要仔细阅读的长篇报告或 Markdown 文档时，将内容写入 .md 文件后调用 md_preview 在浏览器中展示，而不是只在终端里输出。",
		"md_preview 返回后，把页面地址发给用户即可继续后续工作，不要等待用户关闭页面，也不要重复调用来刷新页面。",
	],
	parameters: Type.Object({
		file: Type.String({
			description: "要预览的 Markdown 文件路径（绝对路径，或相对当前工作目录的路径）",
		}),
		title: Type.Optional(Type.String({ description: "页面标题；默认取文档第一个一级标题" })),
		open_browser: Type.Optional(Type.Boolean({ description: "是否自动打开浏览器标签页，默认 true" })),
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
			open: params.open_browser,
			notify: ctx.hasUI ? (message, type) => ctx.ui.notify(message, type) : undefined,
		});
		return {
			content: [{ type: "text", text: outcome.text }],
			details: {
				file: params.file,
				url: outcome.url ?? null,
				opened: outcome.opened ?? false,
			},
			isError: !outcome.ok,
		};
	},
});

/**
 * Agent 回复预览页提问的出口：页面提问经 onAsk 注入会话后，模型阅读相关文件，
 * 再通过本工具把答复送回预览页（SSE 推送到所有打开该文档的标签页）。
 */
const mdPreviewReplyTool = defineTool({
	name: "md_preview_reply",
	label: "回复预览页提问",
	description:
		"回复用户在 Markdown 预览页面中就选中文本提出的提问。仅当收到「Markdown 预览页提问」消息时调用；" +
		"回复会以卡片形式显示在预览页文档左侧，包含原文、回复内容与回复时间。",
	parameters: Type.Object({
		question_id: Type.Optional(Type.String({
			description: "提问 ID（提问消息中会给出，如 q1）；省略时回复最早未回复的提问",
		})),
		text: Type.String({ description: "回复内容，支持 Markdown" }),
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
			return { content: [{ type: "text", text: "当前没有运行中的 Markdown 预览服务。" }], isError: true, details: undefined };
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
				/* 会话繁忙且不支持排队：提问保留在预览页待回复列表中 */
			}
		}
	};
	pi.registerTool(mdPreviewTool);
	pi.registerTool(mdPreviewReplyTool);

	pi.registerCommand("md-preview", {
		description: "用 Web UI 渲染并预览 Markdown 文件：/md-preview <文件路径>",
		getArgumentCompletions: completeMarkdownFiles,
		handler: async (args, ctx) => {
			const file = args.trim();
			const notify: Notify = (message, type) => ctx.ui.notify(message, type);
			if (!file) {
				const docs = currentServer()?.listDocuments() ?? [];
				const list = docs.length
					? docs.map((d) => `- ${d.title}（${d.filePath}，${d.viewers} 个标签页）`).join("\n")
					: "（当前没有预览中的文档）";
				pi.sendMessage({
					customType: "md_preview",
					display: true,
					content: `用法：\`/md-preview <文件路径>\`\n\n当前预览：\n${list}`,
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
		void currentServer()?.shutdown(`pi 会话结束（${event.reason}）`);
	});
}
