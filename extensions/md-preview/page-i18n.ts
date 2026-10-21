/**
 * Bilingual UI strings for the Markdown preview page (module B of the i18n
 * effort).
 *
 * A single flat `PageStrings` interface plus `Record<Lang, PageStrings>` keeps
 * the en/zh key sets in lockstep at compile time: a missing translation is a
 * `tsc` error. Flat keys also let the in-page runtime (`PAGE_JS`) and the
 * offline export runtime (`EXPORT_JS`) read copy as plain `T.key` lookups with
 * no nested traversal.
 *
 * `locale` / `htmlLang` are language-related but not UI copy: they travel with
 * the table so the date formatter and `<html lang>` follow the active language.
 *
 * Everything user-visible that lives in this file is *data*; comments and code
 * stay in English. The zh values are the only Chinese allowed anywhere in
 * `page.ts` / `page-i18n.ts`.
 */

/** Supported UI languages. */
export type Lang = "en" | "zh";

/** All user-visible UI strings of the preview page, per language. */
export interface PageStrings {
	/** BCP-47 locale for date/time formatting (QA cards, export badge). */
	locale: string;
	/** Value for the <html lang> attribute. */
	htmlLang: string;
	/** Document title suffix after "·". */
	titleSuffix: string;

	// ---- topbar: workspace badge (last path segment of the previewing session cwd) ----
	cwdBadge: string;

	// ---- topbar: live pill ----
	liveSyncText: string;
	liveSyncTitle: string;
	liveDownText: string;
	liveDownTitle: string;

	// ---- topbar: theme / background / font / line-height / doc actions ----
	groupTheme: string;
	themeSystem: string;
	themeLight: string;
	themeDark: string;
	groupBg: string;
	bgWhite: string;
	bgDim: string;
	bgWood: string;
	bgCyan: string;
	groupFont: string;
	fontMinusLabel: string;
	fontPlusLabel: string;
	groupLine: string;
	lineMinusLabel: string;
	linePlusLabel: string;
	groupDoc: string;
	downloadTitle: string;
	downloadLabel: string;
	exportTitle: string;
	exportLabel: string;
	resetDefault: string;

	// ---- topbar: language switch ----
	groupLang: string;
	langEn: string;
	langZh: string;

	// ---- topbar: message delivery mode ----
	modeLabel: string;
	modeFollowUp: string;
	modeSteer: string;
	modeHintFollowUp: string;
	modeHintSteer: string;

	// ---- footer / toc ----
	versionPrefix: string;
	footerNote: string;
	tocTitle: string;

	// ---- document admonitions ([!NOTE] … [!CAUTION]) ----
	admonitionNote: string;
	admonitionTip: string;
	admonitionImportant: string;
	admonitionWarning: string;
	admonitionCaution: string;

	// ---- QA (ask the agent) ----
	qaRailLabel: string;
	qaBadge: string;
	qaLabelQuote: string;
	qaLabelQuestion: string;
	qaWaiting: string;
	qaSelBtn: string;
	qaPanelPlaceholder: string;
	qaSend: string;
	qaCancel: string;
	qaAskToast: string;
	qaAskFailToast: string;
	qaAnsweredToast: string;
	qaPendingExport: string;
	qaViewFull: string;
	qaFullTitle: string;
	qaClose: string;

	// ---- stashed queues (batch ask / batch revise) ----
	queueGroupAria: string;
	queueAskBtn: string;
	queueRevBtn: string;
	queueAskAria: string;
	queueRevAria: string;
	queueSending: string;
	queueAskSent: string;
	queueRevSent: string;
	queueSendFail: string;
	queueFull: string;
	stashOkAsk: string;
	stashOkRev: string;
	panelTitleAsk: string;
	panelTitleRev: string;
	panelRevPlaceholder: string;
	panelStash: string;
	panelEmpty: string;
	qaWaitingSend: string;
	qaPending: string;
	// ---- live Q&A progress (M1): stage line inside a pending card / chat turn ----
	progThinking: string;
	progTool: string;
	progToolName: string;
	progWriting: string;
	progChars: string;
	reviseDone: string;
	selRevBtn: string;
	selAskAria: string;
	selRevAria: string;

	// ---- bottom chat with the agent ----
	chatTitle: string;
	chatEmpty: string;
	chatPlaceholder: string;
	chatSend: string;
	chatYouLabel: string;
	chatAgentLabel: string;
	chatWaiting: string;
	chatAskToast: string;
	chatFailToast: string;
	chatPendingExport: string;
	/** aria-label of the message list; tells screen-reader users the newest message is on top. */
	chatLogLabel: string;

	// ---- code copy / toasts ----
	copyBtn: string;
	copyDone: string;
	copyToast: string;
	copyFailToast: string;

	// ---- live updates ----
	docUpdatedToast: string;
	serverExitToast: string;

	// ---- export (used by the PAGE_JS export flow and the EXPORT_JS offline runtime) ----
	exportBadge: string;
	exportMermaidThemeToast: string;
	exportPreparingToast: string;
	exportPartialToast: string;
	exportDoneToast: string;
	exportFailToast: string;

	// ---- misc ----
	toTop: string;
}

export const STRINGS: Record<Lang, PageStrings> = {
	en: {
		locale: "en-US",
		htmlLang: "en",
		titleSuffix: "Markdown Preview",
		cwdBadge: "Workspace",

		liveSyncText: "Live sync",
		liveSyncTitle: "The page updates automatically when the file changes",
		liveDownText: "Disconnected",
		liveDownTitle: "Connection to the preview server was lost",

		groupTheme: "Theme",
		themeSystem: "Follow system",
		themeLight: "Light mode",
		themeDark: "Dark mode",
		groupBg: "Reading background",
		bgWhite: "Pure white",
		bgDim: "Dim white",
		bgWood: "Wood",
		bgCyan: "Cyan",
		groupFont: "Font size",
		fontMinusLabel: "Decrease font size",
		fontPlusLabel: "Increase font size",
		groupLine: "Line height",
		lineMinusLabel: "Decrease line height",
		linePlusLabel: "Increase line height",
		groupDoc: "Document actions",
		downloadTitle: "Download this document (raw Markdown)",
		downloadLabel: "Download document",
		exportTitle: "Export HTML (includes Agent replies, works offline)",
		exportLabel: "Export HTML",
		resetDefault: "Click to reset to default",

		groupLang: "UI language",
		langEn: "EN",
		langZh: "中",

		modeLabel: "Message delivery",
		modeFollowUp: "Follow up",
		modeSteer: "Steering",
		modeHintFollowUp: "Waits until this turn finishes, then delivers as a new turn.",
		modeHintSteer: "Injected after the current tool batch; can redirect mid-turn, never aborts.",

		versionPrefix: "Version ",
		footerNote: "Rendered live from the source file; closing this page shuts down the preview server",
		tocTitle: "Contents",

		admonitionNote: "Note",
		admonitionTip: "Tip",
		admonitionImportant: "Important",
		admonitionWarning: "Warning",
		admonitionCaution: "Caution",

		qaRailLabel: "Agent replies",
		qaBadge: "Agent reply",
		qaLabelQuote: "Quote",
		qaLabelQuestion: "Q",
		qaWaiting: "Waiting for the Agent…",
		qaSelBtn: "✦ Ask",
		qaPanelPlaceholder: "Ask the Agent about the selection… (Enter to send, Shift+Enter for a new line)",
		qaSend: "Send",
		qaCancel: "Cancel",
		qaAskToast: "Question sent; waiting for the Agent…",
		qaAskFailToast: "Failed to send the question; please retry",
		qaAnsweredToast: "Agent replied",
		qaPendingExport: "⏳ This question was still unanswered at export time",
		qaViewFull: "View full text",
		qaFullTitle: "Full reply",
		qaClose: "Close",

		queueGroupAria: "Stashed batches",
		queueAskBtn: "Ask",
		queueRevBtn: "Revise",
		queueAskAria: "Send {n} stashed questions to the Agent",
		queueRevAria: "Send {n} stashed revision comments to the Agent",
		queueSending: "Sending…",
		queueAskSent: "Sent {n} questions; waiting for the Agent…",
		queueRevSent: "Sent {n} revision comments; waiting for the Agent…",
		queueSendFail: "Failed to send the queue; nothing was dropped, please retry",
		queueFull: "A batch can carry at most 20 items; send the queue before stashing more",
		stashOkAsk: "Stashed; it goes out with the queue",
		stashOkRev: "Stashed; it goes out with the queue",
		panelTitleAsk: "Ask about the selection",
		panelTitleRev: "Revise the selection",
		panelRevPlaceholder: "Describe the change you want… (Enter to send, Shift+Enter for a new line)",
		panelStash: "Stash",
		panelEmpty: "Select a passage and write something first",
		qaWaitingSend: "Sending…",
		qaPending: "Waiting for the reply…",
		progThinking: "Agent is thinking…",
		progTool: "Running a tool…",
		progToolName: "Running {tool}…",
		progWriting: "Writing the reply…",
		progChars: "{n} chars",
		reviseDone: "Revision complete; the document has been updated",
		selRevBtn: "✎ Revise",
		selAskAria: "Ask the Agent about the selected text",
		selRevAria: "Request a revision of the selected text",

		chatTitle: "Chat with the Agent",
		chatEmpty: "No messages yet — ask the Agent anything about this document.",
		chatPlaceholder: "Message the Agent… (Enter to send, Shift+Enter for a new line)",
		chatSend: "Send",
		chatYouLabel: "You",
		chatAgentLabel: "Agent",
		chatWaiting: "Waiting for the Agent…",
		chatAskToast: "Message sent; waiting for the Agent…",
		chatFailToast: "Failed to send the message; please retry",
		chatPendingExport: "⏳ This message was still unanswered at export time",
		chatLogLabel: "Message history, newest first",

		copyBtn: "Copy",
		copyDone: "Copied",
		copyToast: "Code copied to clipboard",
		copyFailToast: "Copy failed",

		docUpdatedToast: "Document updated",
		serverExitToast: "Preview server exited",

		exportBadge: "Offline export · ",
		exportMermaidThemeToast: "Diagram colors stay at the exported theme",
		exportPreparingToast: "Generating the export file…",
		exportPartialToast: "Some diagrams were still rendering; source code was exported",
		exportDoneToast: "HTML exported",
		exportFailToast: "Export failed; please retry",

		toTop: "Back to top",
	},
	zh: {
		locale: "zh-CN",
		htmlLang: "zh-CN",
		titleSuffix: "Markdown 预览",
		cwdBadge: "工作目录",

		liveSyncText: "实时同步",
		liveSyncTitle: "文件修改后页面会自动更新",
		liveDownText: "连接断开",
		liveDownTitle: "与预览服务的连接已断开",

		groupTheme: "主题",
		themeSystem: "跟随系统",
		themeLight: "浅色模式",
		themeDark: "深色模式",
		groupBg: "阅读背景",
		bgWhite: "纯白",
		bgDim: "暗白",
		bgWood: "木色",
		bgCyan: "青色",
		groupFont: "字号",
		fontMinusLabel: "减小字号",
		fontPlusLabel: "增大字号",
		groupLine: "行距",
		lineMinusLabel: "减小行距",
		linePlusLabel: "增大行距",
		groupDoc: "文档操作",
		downloadTitle: "下载当前文档（Markdown 原文）",
		downloadLabel: "下载当前文档",
		exportTitle: "导出 HTML（含 Agent 回复，可离线打开）",
		exportLabel: "导出 HTML",
		resetDefault: "点击恢复默认",

		groupLang: "界面语言",
		langEn: "EN",
		langZh: "中",

		modeLabel: "消息投递方式",
		modeFollowUp: "Follow up",
		modeSteer: "Steering",
		modeHintFollowUp: "等本轮全部完成后才投递，视为一条新的用户消息。",
		modeHintSteer: "当前工具批次结束后注入，可中途纠偏，但不会打断或中止本轮。",

		versionPrefix: "版本 ",
		footerNote: "内容实时渲染自源文件，关闭本页面后预览服务自动退出",
		tocTitle: "目录",

		admonitionNote: "说明",
		admonitionTip: "提示",
		admonitionImportant: "重要",
		admonitionWarning: "警告",
		admonitionCaution: "谨慎",

		qaRailLabel: "Agent 回复",
		qaBadge: "Agent 回复",
		qaLabelQuote: "原文",
		qaLabelQuestion: "问",
		qaWaiting: "等待 Agent 回复…",
		qaSelBtn: "✦ 提问",
		qaPanelPlaceholder: "就选中内容向 Agent 提问…（Enter 发送，Shift+Enter 换行）",
		qaSend: "发送",
		qaCancel: "取消",
		qaAskToast: "已提问，等待 Agent 回复…",
		qaAskFailToast: "提问发送失败，请重试",
		qaAnsweredToast: "Agent 已回复",
		qaPendingExport: "⏳ 导出时该提问尚未回复",
		qaViewFull: "查看全文",
		qaFullTitle: "完整回复",
		qaClose: "关闭",

		queueGroupAria: "暂存的批次",
		queueAskBtn: "问答",
		queueRevBtn: "修订",
		queueAskAria: "把 {n} 条暂存提问发给 Agent",
		queueRevAria: "把 {n} 条暂存修订发给 Agent",
		queueSending: "发送中…",
		queueAskSent: "已发送 {n} 条提问，等待 Agent 回复…",
		queueRevSent: "已发送 {n} 条修订，等待 Agent 处理…",
		queueSendFail: "队列发送失败，条目已保留，请重试",
		queueFull: "单批最多暂存 20 条，请先发送当前队列。",
		stashOkAsk: "已暂存，将随队列一起发送",
		stashOkRev: "已暂存，将随队列一起发送",
		panelTitleAsk: "就选中内容提问",
		panelTitleRev: "修改选中内容",
		panelRevPlaceholder: "描述你想要的修改…（Enter 发送，Shift+Enter 换行）",
		panelStash: "暂存",
		panelEmpty: "请先选中文字并填写内容",
		qaWaitingSend: "发送中…",
		qaPending: "等待回复…",
		progThinking: "Agent 正在思考…",
		progTool: "正在调用工具…",
		progToolName: "正在调用 {tool}…",
		progWriting: "正在生成回答…",
		progChars: "已生成 {n} 字",
		reviseDone: "修订完成，文档已更新",
		selRevBtn: "✎ 修订",
		selAskAria: "就选中文字向 Agent 提问",
		selRevAria: "请 Agent 修订选中文字",

		chatTitle: "与 Agent 对话",
		chatEmpty: "还没有消息，直接向 Agent 提问吧",
		chatPlaceholder: "向 Agent 发送消息…（Enter 发送，Shift+Enter 换行）",
		chatSend: "发送",
		chatYouLabel: "你",
		chatAgentLabel: "Agent",
		chatWaiting: "等待 Agent 回复…",
		chatAskToast: "已发送，等待 Agent 回复…",
		chatFailToast: "消息发送失败，请重试",
		chatPendingExport: "⏳ 导出时该消息尚未回复",
		chatLogLabel: "消息记录，最新在前",

		copyBtn: "复制",
		copyDone: "已复制",
		copyToast: "代码已复制到剪贴板",
		copyFailToast: "复制失败",

		docUpdatedToast: "文档已更新",
		serverExitToast: "预览服务已退出",

		exportBadge: "离线导出 · ",
		exportMermaidThemeToast: "图表配色保持导出时的主题",
		exportPreparingToast: "正在生成导出文件…",
		exportPartialToast: "部分图表仍在渲染中，已导出源码",
		exportDoneToast: "已导出 HTML",
		exportFailToast: "导出失败，请重试",

		toTop: "回到顶部",
	},
};

/** Normalize external lang values to table keys; anything not Chinese maps to "en". */
export function normalizeLang(value: unknown): Lang {
	return value === "zh" || value === "zh-CN" ? "zh" : "en";
}
