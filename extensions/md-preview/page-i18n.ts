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

	// ---- footer / toc ----
	versionPrefix: string;
	footerNote: string;
	tocTitle: string;

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

		versionPrefix: "Version ",
		footerNote: "Rendered live from the source file; closing this page shuts down the preview server",
		tocTitle: "Contents",

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

		versionPrefix: "版本 ",
		footerNote: "内容实时渲染自源文件，关闭本页面后预览服务自动退出",
		tocTitle: "目录",

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
