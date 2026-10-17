/**
 * Self-contained HTML page for the Markdown preview.
 *
 * The emitted document has no external assets: CSS and JS are inlined so the
 * preview works fully offline. The page supports light/dark/system themes,
 * font-size adjustment, a table of contents with scroll spy, scroll progress,
 * code copy buttons, lightweight syntax highlighting, and live updates pushed
 * by the preview server over SSE.
 */
import type { TocItem } from "./render";
import { escapeHtml } from "./render";
import type { BgPref } from "./prefs";
import type { Lang } from "./page-i18n";
import { normalizeLang, STRINGS } from "./page-i18n";

/** Q&A entry handed to the page (answerHtml === null means still unanswered). */
export interface PageQaEntry {
	id: string;
	quote: string;
	question: string;
	answerHtml?: string | null;
	askedAt: number;
	answeredAt?: number | null;
	/** true = bottom chat message (quote === ""); absent/false = selection Q&A entry. */
	chat?: boolean;
}

export interface PageOptions {
	docId: string;
	title: string;
	/** Small subtitle shown under the title, typically the file name. */
	subtitle: string;
	bodyHtml: string;
	toc: TocItem[];
	/** SSE endpoint for live updates. */
	updateUrl: string;
	/** POST endpoint used by the close beacon. */
	closeUrl: string;
	/** Optional default theme from MD_PREVIEW_THEME; user-level persisted prefs override it server-side. */
	themeHint?: "system" | "light" | "dark";
	/** User-level persisted font scale (0.7–1.6) served from the prefs file; null/undefined = not set. */
	prefScale?: number | null;
	/** User-level persisted line height (1.4–2.2) served from the prefs file; null/undefined = not set. */
	prefLineHeight?: number | null;
	/** User-level persisted reading background (white/dim/wood/cyan); null/undefined = pure white. */
	prefBg?: BgPref | null;
	/** GET endpoint that downloads the raw Markdown source of the current document. */
	downloadUrl?: string;
	/** POST endpoint that persists theme/scale changes into the user-level prefs file. */
	prefsUrl?: string;
	/** POST endpoint that submits a question about the selected text. */
	askUrl?: string;
	/** POST endpoint for bottom chat messages (body { message }); omitted = no chat area rendered. */
	chatUrl?: string;
	/**
	 * Same-origin URL of the bundled mermaid ESM runtime. The server appends the
	 * auth token as a query parameter; omitted/empty falls back to "/mermaid.mjs"
	 * so the module stays compilable and demonstrable standalone.
	 */
	mermaidUrl?: string;
	/** Existing Q&A entries embedded at render time so cards survive reloads. */
	qa?: PageQaEntry[];
	/** Footer version stamp (e.g. 2026-10-13 · 9311172); omitted = no version in the footer. */
	version?: string | null;
	/**
	 * UI language chosen by the server (contract values: "en" | "zh").
	 * Optional — missing or unrecognized values fall back to "en".
	 */
	lang?: Lang | (string & {}) | null;
}

const THEME_BOOT = `<script>
(function () {
	var d = document.documentElement;
	var t = null, s = null, lh = null, b = null;
	try { t = localStorage.getItem("mdp.theme"); s = localStorage.getItem("mdp.scale"); lh = localStorage.getItem("mdp.lineHeight"); b = localStorage.getItem("mdp.bg"); } catch (e) {}
	// Theme priority: local localStorage (last action on this origin) > hint. The server
	// already merged the user-level prefs file into the hint (user prefs > the
	// MD_PREVIEW_THEME env var); the final fallback is "follow system".
	if (t !== "light" && t !== "dark" && t !== "system") {
		var hint = d.getAttribute("data-theme-hint");
		t = (hint === "light" || hint === "dark" || hint === "system") ? hint : "system";
	}
	d.dataset.themePref = t;
	d.dataset.theme = t === "system"
		? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
		: t;
	if (!(parseFloat(s) > 0)) {
		var ps = parseFloat(d.getAttribute("data-pref-scale") || "");
		if (ps > 0) s = String(ps);
	}
	if (s) d.style.setProperty("--font-scale", s);
	// Line height follows the same priority as font size: local localStorage > the
	// user-level pref pushed by the server (data-pref-line-height).
	if (!(parseFloat(lh) > 0)) {
		var plh = parseFloat(d.getAttribute("data-pref-line-height") || "");
		if (plh > 0) lh = String(plh);
	}
	if (lh) d.style.setProperty("--line-height", lh);
	// Reading background follows the same priority as font size: local localStorage >
	// the user-level pref pushed by the server (data-pref-bg); with neither, pure white.
	if (b !== "white" && b !== "dim" && b !== "wood" && b !== "cyan") {
		var pb = d.getAttribute("data-pref-bg");
		b = (pb === "white" || pb === "dim" || pb === "wood" || pb === "cyan") ? pb : "white";
	}
	d.dataset.bg = b;
	// UI language priority mirrors the theme: localStorage (mdp.lang) > server hint
	// (data-lang-hint) > "en"; fix <html lang> before first paint.
	var lg = null;
	try { lg = localStorage.getItem("mdp.lang"); } catch (e) {}
	if (lg !== "en" && lg !== "zh") {
		var lh2 = d.getAttribute("data-lang-hint");
		lg = (lh2 === "en" || lh2 === "zh") ? lh2 : "en";
	}
	d.dataset.mdpLang = lg;
	d.setAttribute("lang", lg === "zh" ? "zh-CN" : "en");
})();
</script>`;

const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
	--font-scale: 1;
	--line-height: 1.75;
	--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
		"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
	--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	--topbar-h: 60px;
	--ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

:root[data-theme="light"] {
	color-scheme: light;
	--bg: #fbfbfd;
	--bg-elev: #ffffff;
	--text: #1b2027;
	--text-2: #525c6b;
	--text-3: #8a94a3;
	--border: #e7e9ee;
	--border-soft: #eff1f5;
	--accent: #2f6feb;
	--accent-hover: #255ed0;
	--accent-soft: rgba(47, 111, 235, 0.09);
	/* Chat feed tints stay deliberately faint: the conversation reads first, the
	   color coding only whispers who said what. */
	--chat-you-bg: rgba(47, 111, 235, 0.05);
	--chat-you-bar: rgba(47, 111, 235, 0.4);
	--chat-agent-bg: rgba(116, 128, 144, 0.07);
	--chat-agent-bar: rgba(116, 128, 144, 0.3);
	--code-bg: #f5f6f9;
	--code-head: #eef0f4;
	--inline-code-bg: #f0f2f6;
	--mark-bg: rgba(255, 214, 102, 0.45);
	--quote-bg: #f6f7fa;
	--mmd-err: #e0a03c;
	--shadow-1: 0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06);
	--shadow-2: 0 8px 24px rgba(16, 24, 40, 0.10);
	--topbar-bg: rgba(251, 251, 253, 0.82);
}

:root[data-theme="dark"] {
	color-scheme: dark;
	--bg: #0e1116;
	--bg-elev: #141922;
	--text: #e5e9f0;
	--text-2: #a4aec0;
	--text-3: #6d7787;
	--border: #242c38;
	--border-soft: #1c232d;
	--accent: #6ea8fe;
	--accent-hover: #8dbcff;
	--accent-soft: rgba(110, 168, 254, 0.13);
	--chat-you-bg: rgba(110, 168, 254, 0.09);
	--chat-you-bar: rgba(110, 168, 254, 0.5);
	--chat-agent-bg: rgba(255, 255, 255, 0.05);
	--chat-agent-bar: rgba(255, 255, 255, 0.25);
	--code-bg: #11161e;
	--code-head: #171e28;
	--inline-code-bg: #1a2129;
	--mark-bg: rgba(255, 214, 102, 0.25);
	--quote-bg: #131922;
	--mmd-err: #e2ab5c;
	--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
	--shadow-2: 0 8px 28px rgba(0, 0, 0, 0.45);
	--topbar-bg: rgba(14, 17, 22, 0.82);
}

/* ---------- reading background (data-bg, pure white by default) ----------
   Only paper-related surface colors are overridden; text, accents and shadows
   stay with the active light/dark theme. */

:root[data-theme="light"][data-bg="white"] {
	--bg: #ffffff;
	--bg-elev: #ffffff;
	--quote-bg: #f7f8fa;
	--code-bg: #f5f6f9;
	--code-head: #eef0f4;
	--inline-code-bg: #f0f2f6;
	--topbar-bg: rgba(255, 255, 255, 0.85);
}

:root[data-theme="light"][data-bg="dim"] {
	--bg: #f4f2ed;
	--bg-elev: #fbfaf7;
	--border: #e4e1d9;
	--border-soft: #eceae4;
	--quote-bg: #edeae3;
	--code-bg: #ecebe5;
	--code-head: #e6e4dc;
	--inline-code-bg: #e9e7e0;
	--topbar-bg: rgba(244, 242, 237, 0.85);
}

:root[data-theme="light"][data-bg="wood"] {
	--bg: #f4ead8;
	--bg-elev: #fbf4e6;
	--border: #e3d6be;
	--border-soft: #ecdfc9;
	--quote-bg: #efe3cc;
	--code-bg: #efe7d4;
	--code-head: #e8dec7;
	--inline-code-bg: #ece2cb;
	--topbar-bg: rgba(244, 234, 216, 0.85);
}

:root[data-theme="light"][data-bg="cyan"] {
	--bg: #e3edec;
	--bg-elev: #f2f7f6;
	--border: #cfe0de;
	--border-soft: #dbe8e6;
	--quote-bg: #dae7e5;
	--code-bg: #dee9e8;
	--code-head: #d6e3e1;
	--inline-code-bg: #d9e5e4;
	--topbar-bg: rgba(227, 237, 236, 0.85);
}

/* Dark variants of the same background preference (matching hue, dark-theme lightness). */
:root[data-theme="dark"][data-bg="dim"] {
	--bg: #171512;
	--bg-elev: #1e1c18;
	--border: #2e2b26;
	--border-soft: #252220;
	--quote-bg: #1c1916;
	--code-bg: #1a1714;
	--code-head: #211e1a;
	--inline-code-bg: #211e19;
	--topbar-bg: rgba(23, 21, 18, 0.85);
}

:root[data-theme="dark"][data-bg="wood"] {
	--bg: #1b1510;
	--bg-elev: #241c14;
	--border: #33291f;
	--border-soft: #2a221a;
	--quote-bg: #211a13;
	--code-bg: #1f1812;
	--code-head: #261e16;
	--inline-code-bg: #261e15;
	--topbar-bg: rgba(27, 21, 16, 0.85);
}

:root[data-theme="dark"][data-bg="cyan"] {
	--bg: #101d1d;
	--bg-elev: #182828;
	--border: #284141;
	--border-soft: #203636;
	--quote-bg: #162323;
	--code-bg: #142222;
	--code-head: #1b2a2a;
	--inline-code-bg: #1a2929;
	--topbar-bg: rgba(16, 29, 29, 0.85);
}

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-family: var(--font-sans);
	font-size: calc(16px * var(--font-scale));
	line-height: var(--line-height);
	transition: background-color 0.25s var(--ease), color 0.25s var(--ease);
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

::selection { background: var(--accent-soft); }

/* ---------- progress + topbar ---------- */

.progress {
	position: fixed;
	top: 0; left: 0; right: 0;
	height: 2px;
	z-index: 60;
	background: transparent;
}
.progress-bar {
	height: 100%;
	width: 0;
	background: linear-gradient(90deg, var(--accent), var(--accent-hover));
	transition: width 0.12s linear;
}

.topbar {
	position: sticky;
	top: 0;
	z-index: 50;
	height: var(--topbar-h);
	background: var(--topbar-bg);
	backdrop-filter: blur(14px) saturate(1.4);
	-webkit-backdrop-filter: blur(14px) saturate(1.4);
	border-bottom: 1px solid transparent;
	transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease), background-color 0.25s var(--ease);
}
.topbar.scrolled { border-bottom-color: var(--border); box-shadow: var(--shadow-1); }

.topbar-inner {
	max-width: 1240px;
	height: 100%;
	margin: 0 auto;
	padding: 0 24px;
	display: flex;
	align-items: center;
	gap: 16px;
}

.brand {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
	flex: 1;
}
.brand-mark {
	width: 32px; height: 32px;
	flex: none;
	border-radius: 9px;
	display: grid;
	place-items: center;
	background: var(--accent-soft);
	color: var(--accent);
}
.brand-text { min-width: 0; }
.doc-title {
	font-size: 0.95rem;
	font-weight: 650;
	letter-spacing: -0.01em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.doc-sub {
	font-size: 0.74rem;
	color: var(--text-3);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.controls { display: flex; align-items: center; gap: 10px; flex: none; }

.seg {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 3px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--bg-elev);
}
.seg button {
	appearance: none;
	border: 0;
	background: transparent;
	color: var(--text-2);
	height: 28px;
	min-width: 30px;
	padding: 0 8px;
	border-radius: 7px;
	font: inherit;
	font-size: 0.8rem;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 5px;
	transition: background-color 0.18s var(--ease), color 0.18s var(--ease), transform 0.12s var(--ease);
}
.seg button:hover { background: var(--accent-soft); color: var(--text); }
.seg button:active { transform: scale(0.94); }
.seg button.active { background: var(--accent); color: #fff; }
:root[data-theme="dark"] .seg button.active { color: #0e1116; }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.seg svg { width: 15px; height: 15px; }

/* Reading-background swatches: the dot is the paper color of that preset. */
.seg button.bg-swatch { width: 24px; min-width: 24px; padding: 0; }
.seg button.bg-swatch::after {
	content: "";
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--dot);
	border: 1px solid rgba(120, 110, 95, 0.55);
}
.seg button.bg-swatch:hover { background: var(--accent-soft); }
.seg button.bg-swatch.active { background: transparent; box-shadow: inset 0 0 0 1.5px var(--accent); }

/* Download / export HTML: icon buttons in one group; <a> and <button> share the styling. */
.seg .dl-btn {
	border: 0;
	background: transparent;
	color: var(--text-2);
	height: 28px;
	min-width: 30px;
	padding: 0 8px;
	border-radius: 7px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	text-decoration: none;
	transition: background-color 0.18s var(--ease), color 0.18s var(--ease), transform 0.12s var(--ease);
}
.seg button.dl-btn { font: inherit; cursor: pointer; }
.seg .dl-btn:hover { background: var(--accent-soft); color: var(--text); }
.seg .dl-btn:active { transform: scale(0.94); }
.seg .dl-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dl-btn.busy { opacity: 0.5; pointer-events: none; }

#fontValue {
	min-width: 42px;
	text-align: center;
	font-size: 0.76rem;
	font-variant-numeric: tabular-nums;
	color: var(--text-2);
	user-select: none;
}

.live-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 0.72rem;
	color: var(--text-3);
	padding: 4px 10px;
	border-radius: 999px;
	border: 1px solid var(--border);
	background: var(--bg-elev);
	white-space: nowrap;
}
.live-dot {
	width: 7px; height: 7px;
	border-radius: 50%;
	background: #34c77b;
	transition: background-color 0.25s var(--ease);
}
.live-pill.down .live-dot { background: #e0a03c; }
.live-pill.down { color: var(--text-2); }

/* ---------- layout ---------- */

.layout {
	max-width: 1240px;
	margin: 0 auto;
	padding: 40px 24px 120px;
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr) 236px;
	gap: 56px;
	align-items: start;
}

.article {
	max-width: 780px;
	min-width: 0;
	animation: rise 0.5s var(--ease) both;
}

@keyframes rise {
	from { opacity: 0; transform: translateY(10px); }
	to { opacity: 1; transform: none; }
}

.content > :first-child { margin-top: 0; }

/* ---------- typography ---------- */

.content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
	font-weight: 650;
	letter-spacing: -0.012em;
	line-height: 1.35;
	scroll-margin-top: calc(var(--topbar-h) + 24px);
	position: relative;
}
.content h1 { font-size: 2em; margin: 1.6em 0 0.7em; padding-bottom: 0.35em; border-bottom: 1px solid var(--border-soft); }
.content h2 { font-size: 1.52em; margin: 1.8em 0 0.65em; }
.content h3 { font-size: 1.24em; margin: 1.6em 0 0.55em; }
.content h4 { font-size: 1.06em; margin: 1.5em 0 0.5em; }
.content h5, .content h6 { font-size: 1em; margin: 1.4em 0 0.5em; color: var(--text-2); }

.heading-anchor {
	position: absolute;
	left: -0.9em;
	opacity: 0;
	color: var(--text-3);
	text-decoration: none;
	font-weight: 400;
	transition: opacity 0.18s var(--ease);
	padding-right: 0.2em;
}
.content h1:hover .heading-anchor,
.content h2:hover .heading-anchor,
.content h3:hover .heading-anchor,
.content h4:hover .heading-anchor,
.content h5:hover .heading-anchor,
.content h6:hover .heading-anchor { opacity: 0.85; }
.heading-anchor:hover { color: var(--accent); }

.content p { margin: 0.95em 0; }
.content a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.18s var(--ease), color 0.18s var(--ease); }
.content a:hover { border-bottom-color: var(--accent); }

.content strong { font-weight: 650; }
.content mark { background: var(--mark-bg); color: inherit; padding: 0.05em 0.25em; border-radius: 3px; }

.content ul, .content ol { margin: 0.9em 0; padding-left: 1.6em; }
.content li { margin: 0.32em 0; }
.content li > ul, .content li > ol { margin: 0.28em 0; }
.content li::marker { color: var(--text-3); }

.content input[type="checkbox"] {
	accent-color: var(--accent);
	margin-right: 0.5em;
	transform: translateY(1.5px);
}
.content .task-list-item { list-style: none; margin-left: -1.55em; }

.content hr {
	border: 0;
	height: 1px;
	background: var(--border);
	margin: 2.4em 0;
}

.content blockquote {
	margin: 1.3em 0;
	padding: 0.75em 1.25em;
	border-left: 3px solid var(--accent);
	background: var(--quote-bg);
	border-radius: 0 10px 10px 0;
	color: var(--text-2);
}
.content blockquote > :first-child { margin-top: 0.15em; }
.content blockquote > :last-child { margin-bottom: 0.15em; }

.content img { max-width: 100%; height: auto; border-radius: 10px; box-shadow: var(--shadow-1); }

.content code {
	font-family: var(--font-mono);
	font-size: 0.875em;
	background: var(--inline-code-bg);
	border: 1px solid var(--border-soft);
	padding: 0.12em 0.38em;
	border-radius: 6px;
	white-space: break-spaces;
	word-break: break-word;
}
.content pre code {
	background: none;
	border: 0;
	padding: 0;
	font-size: 0.855em;
	line-height: 1.7;
	white-space: pre;
	word-break: normal;
}

/* ---------- code blocks ---------- */

.code-block {
	margin: 1.5em 0;
	border: 1px solid var(--border);
	border-radius: 12px;
	overflow: hidden;
	background: var(--code-bg);
}
.code-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 7px 12px 7px 16px;
	background: var(--code-head);
	border-bottom: 1px solid var(--border-soft);
}
.code-lang {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	letter-spacing: 0.04em;
	color: var(--text-3);
	user-select: none;
}
.copy-btn {
	appearance: none;
	border: 1px solid var(--border);
	background: var(--bg-elev);
	color: var(--text-2);
	font: inherit;
	font-size: 0.72rem;
	line-height: 1;
	padding: 5px 10px;
	border-radius: 7px;
	cursor: pointer;
	transition: color 0.18s var(--ease), border-color 0.18s var(--ease), transform 0.12s var(--ease);
}
.copy-btn:hover { color: var(--accent); border-color: var(--accent); }
.copy-btn:active { transform: scale(0.93); }
.copy-btn.done { color: #34c77b; border-color: #34c77b; }
.code-block pre {
	margin: 0;
	padding: 16px 18px;
	overflow-x: auto;
	tab-size: 4;
}
.code-block pre::-webkit-scrollbar { height: 8px; }
.code-block pre::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; }

/* syntax tokens */
.tok-c { color: var(--text-3); font-style: italic; }
.tok-s { color: #2f9c6b; }
.tok-k { color: #b5731f; font-weight: 550; }
.tok-n { color: #9a5fd0; }
.tok-f { color: var(--accent); }
.tok-y { color: #d0562e; }
.tok-t { color: #2b8a9e; }
:root[data-theme="dark"] .tok-s { color: #6bcf9e; }
:root[data-theme="dark"] .tok-k { color: #e2ab5c; }
:root[data-theme="dark"] .tok-n { color: #c39bf0; }
:root[data-theme="dark"] .tok-y { color: #ef9267; }
:root[data-theme="dark"] .tok-t { color: #6fc2d8; }

/* ---------- mermaid diagrams ---------- */

.content pre.mermaid,
.content .mermaid-rendered {
	max-width: 100%;
	margin: 1.5em auto;
	padding: 18px;
	background: var(--code-bg);
	border: 0; /* do not inherit code-block borders */
	border-radius: 12px;
	overflow-x: auto;
}
.content pre.mermaid {
	font-family: var(--font-mono);
	font-size: 0.855em;
	line-height: 1.7;
	white-space: pre;
}
.content .mermaid-rendered { text-align: center; }
.content pre.mermaid svg,
.content .mermaid-rendered svg { max-width: 100%; height: auto; }

/* Loading: pulse the placeholder pre (escaped source). */
.content pre.mermaid[data-status="loading"] { animation: mmdPulse 1.3s ease-in-out infinite; }
@keyframes mmdPulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.45; }
}
/* Render failed: keep plain-source styling, only add a warning-colored border. */
.content pre.mermaid[data-status="error"] { border: 1px solid var(--mmd-err); }

/* ---------- tables ---------- */

.table-wrap {
	margin: 1.5em 0;
	overflow-x: auto;
	border: 1px solid var(--border);
	border-radius: 12px;
}
.content table {
	border-collapse: collapse;
	width: 100%;
	font-size: 0.93em;
	background: var(--bg-elev);
}
.content th, .content td {
	border-bottom: 1px solid var(--border-soft);
	padding: 10px 16px;
	text-align: left;
	vertical-align: top;
}
.content th {
	background: var(--code-head);
	font-weight: 600;
	font-size: 0.92em;
	white-space: nowrap;
}
.content tbody tr:last-child td { border-bottom: 0; }
.content tbody tr { transition: background-color 0.15s var(--ease); }
.content tbody tr:hover { background: var(--accent-soft); }

/* ---------- toc ---------- */

.toc {
	position: sticky;
	top: calc(var(--topbar-h) + 32px);
	max-height: calc(100vh - var(--topbar-h) - 64px);
	overflow-y: auto;
	font-size: 0.82rem;
	animation: rise 0.55s var(--ease) both;
}
.toc.hidden { display: none; }
.toc-title {
	font-size: 0.72rem;
	font-weight: 650;
	letter-spacing: 0.09em;
	text-transform: uppercase;
	color: var(--text-3);
	margin-bottom: 12px;
}
.toc-link {
	display: block;
	padding: 4px 10px;
	margin-left: -10px;
	border-left: 2px solid transparent;
	color: var(--text-3);
	text-decoration: none;
	line-height: 1.5;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	transition: color 0.18s var(--ease), border-color 0.18s var(--ease), transform 0.18s var(--ease);
}
.toc-link:hover { color: var(--text); transform: translateX(2px); }
.toc-link.active { color: var(--accent); border-left-color: var(--accent); font-weight: 550; }
.toc-link.level-2 { padding-left: 22px; }
.toc-link.level-3 { padding-left: 36px; }
.toc-link.level-4, .toc-link.level-5, .toc-link.level-6 { padding-left: 50px; }

/* ---------- footer, toast, to-top ---------- */

.doc-foot {
	margin-top: 64px;
	padding-top: 20px;
	border-top: 1px solid var(--border-soft);
	color: var(--text-3);
	font-size: 0.78rem;
	display: flex;
	align-items: center;
	gap: 8px;
}

.toast {
	position: fixed;
	left: 50%;
	bottom: 32px;
	transform: translate(-50%, 10px);
	background: var(--text);
	color: var(--bg);
	padding: 9px 18px;
	border-radius: 999px;
	font-size: 0.82rem;
	box-shadow: var(--shadow-2);
	opacity: 0;
	pointer-events: none;
	transition: opacity 0.25s var(--ease), transform 0.25s var(--ease);
	z-index: 80;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

.to-top {
	position: fixed;
	right: 28px;
	bottom: 28px;
	width: 40px; height: 40px;
	border-radius: 12px;
	border: 1px solid var(--border);
	background: var(--bg-elev);
	color: var(--text-2);
	cursor: pointer;
	display: grid;
	place-items: center;
	box-shadow: var(--shadow-1);
	opacity: 0;
	visibility: hidden;
	transform: translateY(8px);
	transition: opacity 0.25s var(--ease), transform 0.25s var(--ease), visibility 0.25s, color 0.18s var(--ease);
	z-index: 70;
}
.to-top.show { opacity: 1; visibility: visible; transform: none; }
.to-top:hover { color: var(--accent); transform: translateY(-2px); }
.to-top svg { width: 16px; height: 16px; }

/* ---------- qa rail (Agent reply cards) ---------- */

.qa-rail { display: none; }
.layout.with-qa .qa-rail { display: block; position: absolute; left: 0; top: 0; bottom: 0; width: 320px; z-index: 5; }

.qa-card {
	position: absolute;
	left: 0; right: 0;
	background: var(--bg-elev);
	border: 1px solid var(--border);
	border-radius: 12px;
	padding: 12px 14px;
	box-shadow: var(--shadow-1);
	font-size: 0.875em;
	line-height: 1.6;
	pointer-events: auto;
}
.qa-card.pending { border-style: dashed; box-shadow: none; }
.qa-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.qa-badge { font-size: 0.75rem; font-weight: 650; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.qa-time { font-size: 0.75rem; color: var(--text-3); white-space: nowrap; }
.qa-label { font-weight: 650; margin-right: 4px; }
.qa-quote {
	border-left: 3px solid #e88911;
	background: rgba(232, 137, 17, 0.1);
	padding: 5px 8px;
	border-radius: 0 6px 6px 0;
	color: var(--text-2);
	margin: 6px 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	word-break: break-all;
}
.qa-q { color: var(--text-2); margin: 4px 0; word-break: break-all; }
.qa-a { color: var(--text); }
.qa-a > :first-child { margin-top: 0.2em; }
.qa-a > :last-child { margin-bottom: 0.2em; }
.qa-a code { font-size: 0.85em; }
/* Long answers are clamped to a few lines; a "view full text" button
   (revealed only when the clamp actually hides content) opens a centered
   modal with the complete reply. */
.qa-a.clampable { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.qa-a.is-clamped { -webkit-line-clamp: 6; }
.qa-more {
	appearance: none;
	border: 0;
	background: none;
	padding: 4px 0 0;
	font: inherit;
	font-size: 0.78rem;
	font-weight: 600;
	color: var(--accent);
	cursor: pointer;
}
.qa-more:hover { color: var(--accent-hover); text-decoration: underline; }

/* Centered modal showing the full reply of a clamped card. */
.qa-modal {
	position: fixed;
	inset: 0;
	z-index: 400;
	display: none;
	align-items: center;
	justify-content: center;
	padding: 24px;
	background: rgba(14, 17, 22, 0.5);
}
.qa-modal.show { display: flex; }
.qa-modal-card {
	width: min(760px, 100%);
	max-height: min(82vh, 900px);
	display: flex;
	flex-direction: column;
	background: var(--bg-elev);
	border: 1px solid var(--border);
	border-radius: 14px;
	box-shadow: var(--shadow-2);
}
.qa-modal-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 16px;
	border-bottom: 1px solid var(--border);
}
.qa-modal-title { font-weight: 650; font-size: 0.95rem; }
.qa-modal-close {
	appearance: none;
	border: 0;
	background: none;
	font: inherit;
	font-size: 1.25rem;
	line-height: 1;
	color: var(--text-3);
	cursor: pointer;
	padding: 2px 6px;
	border-radius: 6px;
}
.qa-modal-close:hover { color: var(--text); background: var(--accent-soft); }
.qa-modal-quote {
	margin: 12px 16px 0;
	border-left: 3px solid #e88911;
	background: rgba(232, 137, 17, 0.1);
	padding: 5px 8px;
	border-radius: 0 6px 6px 0;
	color: var(--text-2);
	font-size: 0.85em;
	word-break: break-all;
}
.qa-modal-body { overflow: auto; padding: 12px 16px 16px; line-height: var(--line-height); }
.qa-modal-body > :first-child { margin-top: 0.2em; }
.qa-modal-body > :last-child { margin-bottom: 0.2em; }
.qa-wait { color: var(--text-3); display: flex; align-items: center; gap: 7px; padding: 4px 0; }
.qa-pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: qaPulse 1.2s ease-in-out infinite; }
@keyframes qaPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

/* Quoted selection highlight (orange). */
.content mark.mdp-qa-hl {
	background: rgba(232, 137, 17, 0.35);
	color: inherit;
	padding: 0.05em 0;
	border-bottom: 2px solid rgba(232, 137, 17, 0.7);
	border-radius: 2px;
}
:root[data-theme="dark"] .content mark.mdp-qa-hl { background: rgba(232, 137, 17, 0.42); }

/* Selection Q&A interaction: floating button + ask panel. */
.qa-sel-btn {
	position: absolute;
	z-index: 90;
	appearance: none;
	border: 0;
	background: var(--accent);
	color: #fff;
	font: inherit;
	font-size: 0.78rem;
	font-weight: 600;
	padding: 5px 12px;
	border-radius: 8px;
	cursor: pointer;
	box-shadow: var(--shadow-2);
}
:root[data-theme="dark"] .qa-sel-btn { color: #0e1116; }
.qa-sel-btn:hover { background: var(--accent-hover); }

.qa-panel {
	position: absolute;
	z-index: 95;
	width: 330px;
	max-width: calc(100vw - 24px);
	background: var(--bg-elev);
	border: 1px solid var(--border);
	border-radius: 12px;
	box-shadow: var(--shadow-2);
	padding: 12px;
	font-size: 0.82rem;
}
.qa-panel-quote {
	border-left: 3px solid #e88911;
	background: rgba(232, 137, 17, 0.1);
	padding: 4px 8px;
	border-radius: 0 6px 6px 0;
	color: var(--text-2);
	margin-bottom: 8px;
	max-height: 3.4em;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	word-break: break-all;
}
.qa-panel textarea {
	width: 100%;
	resize: vertical;
	font: inherit;
	font-size: 0.82rem;
	color: var(--text);
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 8px 10px;
	outline: none;
}
.qa-panel textarea:focus { border-color: var(--accent); }
.qa-panel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.qa-panel-actions button {
	appearance: none;
	font: inherit;
	font-size: 0.78rem;
	padding: 5px 14px;
	border-radius: 8px;
	border: 1px solid var(--border);
	background: var(--bg);
	color: var(--text-2);
	cursor: pointer;
}
.qa-panel-actions button:hover { color: var(--text); border-color: var(--text-3); }
.qa-panel-actions button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
:root[data-theme="dark"] .qa-panel-actions button.primary { color: #0e1116; }

/* ---------- document chat (bottom conversation) ---------- */

.chat {
	margin-top: 48px;
	border: 1px solid var(--border);
	border-radius: 14px;
	background: var(--bg-elev);
	padding: 16px 18px;
}
.chat-head { margin-bottom: 12px; }
.chat-title { font-weight: 650; font-size: 0.95rem; }
.chat-list { display: flex; flex-direction: column; gap: 16px; }
.chat-empty { color: var(--text-3); font-size: 0.86rem; text-align: center; padding: 14px 8px; }
/* Reversed timeline: the list reads newest first, every turn keeps its own anchor. */
.chat-turn { display: flex; flex-direction: column; gap: 8px; }
/* Alternating rows instead of bubbles: a role chip plus a full-width tinted row
   (accent left bar for the reader, neutral bar for the agent) tells the sides apart.
   Row tints use the faint --chat-* vars so the blocks stay quiet. */
.chat-row {
	display: flex;
	flex-direction: column;
	gap: 5px;
	width: 100%;
	padding: 10px 14px;
	border-radius: 10px;
	border-left: 3px solid transparent;
}
.chat-row.you { background: var(--chat-you-bg); border-left-color: var(--chat-you-bar); }
.chat-row.agent { background: var(--chat-agent-bg); border-left-color: var(--chat-agent-bar); }
.chat-meta { display: flex; align-items: baseline; gap: 8px; font-size: 0.72rem; color: var(--text-3); }
.chat-role {
	display: inline-block;
	font-size: 0.72rem;
	font-weight: 650;
	line-height: 1.6;
	padding: 0 9px;
	border-radius: 999px;
}
.chat-role.you { background: var(--accent-soft); color: var(--text); }
.chat-role.agent { background: var(--bg-elev); color: var(--text-2); border: 1px solid var(--border-soft); }
/* The body carries the .content class for rendered Markdown, so the article's typography
   (headings, lists, quotes, inline code, .code-block, tables, mermaid) applies there
   without copying any of it. */
.chat-body { font-size: 0.93em; word-break: break-word; }
.chat-body > :first-child { margin-top: 0.2em; }
.chat-body > :last-child { margin-bottom: 0.2em; }
/* Plain-text fallback when the server sent no questionHtml; keeps the old bubble line breaks. */
.chat-plain { white-space: pre-wrap; }
/* Rendered headings inside a row show no article anchor icon. */
.chat-body .heading-anchor { display: none; }
/* block:"start" scrolls this area's top edge into view; keep it clear of the sticky topbar. */
.chat { scroll-margin-top: calc(var(--topbar-h) + 16px); }
.chat-input { margin-bottom: 14px; display: flex; gap: 8px; align-items: flex-end; }
.chat-input textarea {
	flex: 1;
	resize: vertical;
	font: inherit;
	font-size: 0.82rem;
	color: var(--text);
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 8px 10px;
	outline: none;
}
.chat-input textarea:focus { border-color: var(--accent); }
.chat-input button {
	appearance: none;
	font: inherit;
	font-size: 0.78rem;
	padding: 5px 14px;
	border-radius: 8px;
	border: 1px solid var(--border);
	background: var(--bg);
	color: var(--text-2);
	cursor: pointer;
}
.chat-input button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
:root[data-theme="dark"] .chat-input button.primary { color: #0e1116; }

/* ---------- responsive ---------- */

@media (max-width: 1080px) {
	.layout { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 28px; }
	.toc { display: none; }
	.article { max-width: 100%; }
	.layout.with-qa .qa-rail { display: none; }
}
@media (max-width: 720px) {
	.topbar-inner { padding: 0 14px; gap: 10px; }
	.layout { padding: 20px 16px 96px; }
	.brand-mark { display: none; }
	.doc-sub { display: none; }
	.content h1 { font-size: 1.72em; }
	.heading-anchor { display: none; }
	.to-top { right: 16px; bottom: 16px; }
	.chat { padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
	html { scroll-behavior: auto; }
	*, *::before, *::after {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
	}
}

@media print {
	.progress, .topbar, .toc, .to-top, .toast, .copy-btn, .heading-anchor, .qa-rail, .qa-sel-btn, .qa-panel, .chat-input { display: none !important; }
	body { background: #fff; color: #000; }
	.layout { display: block; padding: 0; }
	.code-block { break-inside: avoid; }
}
`;

/**
 * Offline runtime of the exported file: injected as a standalone <script> into
 * the clone at export time. It takes over theme/background/font-size/line-height,
 * code copy and back-to-top so the export looks like the preview at export time.
 *
 * Hard constraints (see docs/web-export-plan.md §5 R1/R8): no backticks, no ${},
 * no regex escapes and never a `</script>` sequence in the body; PAGE_JS injects
 * it through JSON.stringify + \u003c replacement. Deliberately no localStorage
 * and no network requests — opening the export offline must not touch the online
 * preview's user prefs.
 */
const EXPORT_JS = `
(function () {
	"use strict";
	var root = document.documentElement;
	// Frozen UI copy of the export, written by buildExportDocument as a data
	// attribute so the snapshot never needs the online i18n bundle at runtime.
	var T = {};
	try { T = JSON.parse(root.getAttribute("data-export-i18n") || "{}"); } catch (e) { T = {}; }
	var toastEl = document.getElementById("toast");
	var toastTimer = null;
	function toast(msg) {
		if (!toastEl) return;
		toastEl.textContent = msg;
		toastEl.classList.add("show");
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
	}

	/* ---------- offline snapshot badge ----------
	   The static HTML already carries the badge written at export time (correct
	   without JS); rewrite it here from the frozen timestamp so it stays the
	   export's identity marker and follows the frozen locale. */

	function snapshotTime() {
		var at = parseInt(root.getAttribute("data-exported-at") || "", 10);
		var t = new Date(isFinite(at) && at > 0 ? at : Date.now());
		try { return t.toLocaleString(T.locale, { hour12: false }); } catch (e) { return t.toString(); }
	}
	var pillText = document.querySelector("#livePill .live-text");
	if (pillText) pillText.textContent = (T.exportBadge || "") + snapshotTime();

	/* ---------- theme / reading background: only touch the DOM and CSS variables ---------- */

	function markActive(attr, value) {
		var btns = document.querySelectorAll("[" + attr + "]");
		for (var i = 0; i < btns.length; i++) {
			var on = btns[i].getAttribute(attr) === value;
			btns[i].classList.toggle("active", on);
			btns[i].setAttribute("aria-pressed", on ? "true" : "false");
		}
	}
	function resolveTheme(pref) {
		if (pref === "light" || pref === "dark") return pref;
		return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
	}
	function applyTheme(pref) {
		root.setAttribute("data-theme-pref", pref);
		root.setAttribute("data-theme", resolveTheme(pref));
		markActive("data-theme-set", pref);
		// The export has no mermaid runtime: after a theme switch the SVG colors
		// stay at the snapshot theme (known limitation).
		if (document.querySelector(".mermaid-rendered svg")) toast(T.exportMermaidThemeToast);
	}
	function applyBg(pref) {
		root.setAttribute("data-bg", pref);
		markActive("data-bg-set", pref);
	}
	document.addEventListener("click", function (e) {
		var t = e.target;
		while (t && t !== document) {
			if (t.getAttribute) {
				if (t.getAttribute("data-theme-set")) { applyTheme(t.getAttribute("data-theme-set")); return; }
				if (t.getAttribute("data-bg-set")) { applyBg(t.getAttribute("data-bg-set")); return; }
			}
			t = t.parentNode;
		}
	});
	// Sync frozen values into button state: highlight the current theme/background when
	// the export opens (both were frozen to concrete light/dark values at export time).
	markActive("data-theme-set", root.getAttribute("data-theme-pref") || "system");
	markActive("data-bg-set", root.getAttribute("data-bg") || "white");

	/* ---------- font size / line height (clamping semantics match the online version) ---------- */

	var scale = parseFloat(root.style.getPropertyValue("--font-scale") || "");
	if (!isFinite(scale) || scale <= 0) scale = 1;
	var fontValue = document.getElementById("fontValue");
	function setScale(v) {
		scale = Math.min(1.6, Math.max(0.7, Math.round(v * 100) / 100));
		root.style.setProperty("--font-scale", String(scale));
		if (fontValue) fontValue.textContent = Math.round(scale * 100) + "%";
	}
	var LINE_MIN = 1.4, LINE_MAX = 2.2, LINE_STEP = 0.15, LINE_DEFAULT = 1.75;
	var lineHeight = parseFloat(root.style.getPropertyValue("--line-height") || "");
	if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = LINE_DEFAULT;
	var lineHeightValue = document.getElementById("lineHeightValue");
	function setLineHeight(v) {
		lineHeight = Math.min(LINE_MAX, Math.max(LINE_MIN, Math.round(v * 100) / 100));
		root.style.setProperty("--line-height", String(lineHeight));
		if (lineHeightValue) lineHeightValue.textContent = lineHeight.toFixed(2);
	}
	var fontMinus = document.getElementById("fontMinus");
	var fontPlus = document.getElementById("fontPlus");
	var lineMinus = document.getElementById("lineHeightMinus");
	var linePlus = document.getElementById("lineHeightPlus");
	if (fontMinus) fontMinus.addEventListener("click", function () { setScale(scale - 0.1); });
	if (fontPlus) fontPlus.addEventListener("click", function () { setScale(scale + 0.1); });
	if (fontValue) {
		fontValue.addEventListener("click", function () { setScale(1); });
		fontValue.style.cursor = "pointer";
		fontValue.title = T.resetDefault;
	}
	if (lineMinus) lineMinus.addEventListener("click", function () { setLineHeight(lineHeight - LINE_STEP); });
	if (linePlus) linePlus.addEventListener("click", function () { setLineHeight(lineHeight + LINE_STEP); });
	if (lineHeightValue) {
		lineHeightValue.addEventListener("click", function () { setLineHeight(LINE_DEFAULT); });
		lineHeightValue.style.cursor = "pointer";
		lineHeightValue.title = T.resetDefault;
	}

	/* ---------- code copy (file:// may reject the clipboard API; execCommand fallback) ---------- */

	function legacyCopy(text) {
		var ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "readonly");
		ta.style.position = "fixed";
		ta.style.top = "-1000px";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		var ok = false;
		try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
		document.body.removeChild(ta);
		return ok;
	}
	function onCopy(e) {
		var btn = e.currentTarget;
		var block = btn.closest ? btn.closest(".code-block") : null;
		var pre = block ? block.querySelector("pre") : null;
		if (!pre) return;
		var text = pre.innerText;
		var done = function () {
			btn.textContent = T.copyDone;
			btn.classList.add("done");
			toast(T.copyToast);
			setTimeout(function () { btn.textContent = T.copyBtn; btn.classList.remove("done"); }, 1600);
		};
		var failed = function () { toast(T.copyFailToast); };
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () {
				if (legacyCopy(text)) done(); else failed();
			});
		} else if (legacyCopy(text)) {
			done();
		} else {
			failed();
		}
	}
	var copyBtns = document.querySelectorAll(".copy-btn");
	for (var ci = 0; ci < copyBtns.length; ci++) copyBtns[ci].addEventListener("click", onCopy);

	/* ---------- back to top + sticky shadow (no scroll-spy; static snapshot semantics) ---------- */

	var toTop = document.getElementById("toTop");
	var topbar = document.getElementById("topbar");
	if (toTop) toTop.addEventListener("click", function () { window.scrollTo(0, 0); });
	function onScroll() {
		var y = window.pageYOffset || root.scrollTop || 0;
		if (toTop) toTop.classList.toggle("show", y > 600);
		if (topbar) topbar.classList.toggle("scrolled", y > 8);
	}
	window.addEventListener("scroll", onScroll, { passive: true });
	onScroll();
})();
`;

const PAGE_JS = `
(function () {
	"use strict";
	var DOC = window.__MDP__ || {};
	var root = document.documentElement;
	var motionOK = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

	/* ---------- i18n: UI language + localized strings ---------- */

	// Full bilingual bundle injected by the server; the effective language comes
	// from THEME_BOOT (localStorage > server hint) so an in-page choice survives.
	var BUNDLE = DOC.i18n || {};
	var lang = root.dataset.mdpLang || DOC.lang || "en";
	if (lang !== "en" && lang !== "zh") lang = "en";
	var T = BUNDLE[lang] || BUNDLE.en || {};
	var liveState = "live";   // remembered so the live pill can be retranslated

	// Re-render every static localized element that carries a data-i18n* anchor.
	function applyStaticStrings() {
		var els = document.querySelectorAll("[data-i18n]");
		for (var i = 0; i < els.length; i++) els[i].textContent = T[els[i].getAttribute("data-i18n")] || "";
		var attrs = [["data-i18n-title", "title"], ["data-i18n-aria", "aria-label"], ["data-i18n-placeholder", "placeholder"]];
		for (var a = 0; a < attrs.length; a++) {
			var list = document.querySelectorAll("[" + attrs[a][0] + "]");
			for (var j = 0; j < list.length; j++) {
				var k = list[j].getAttribute(attrs[a][0]);
				list[j].setAttribute(attrs[a][1], T[k] || "");
			}
		}
	}

	function markLangActive() {
		var btns = document.querySelectorAll("[data-lang-set]");
		for (var i = 0; i < btns.length; i++) {
			var on = btns[i].getAttribute("data-lang-set") === lang;
			btns[i].classList.toggle("active", on);
			btns[i].setAttribute("aria-pressed", on ? "true" : "false");
		}
	}

	// Switch the whole page to the requested language: static chrome, dynamic
	// chrome, QA cards, <html lang> and the document-title suffix.
	function applyLang(next) {
		if (next !== "en" && next !== "zh") return;
		lang = next;
		T = BUNDLE[lang] || BUNDLE.en || {};
		root.dataset.mdpLang = lang;
		root.setAttribute("lang", T.htmlLang || (lang === "zh" ? "zh-CN" : "en"));
		applyStaticStrings();
		setLive(liveState);
		fontValue.title = T.resetDefault;
		lineHeightValue.title = T.resetDefault;
		var copyBtns = document.querySelectorAll(".copy-btn");
		for (var i = 0; i < copyBtns.length; i++) {
			copyBtns[i].textContent = copyBtns[i].classList.contains("done") ? T.copyDone : T.copyBtn;
		}
		for (var id in qaState) {
			if (Object.prototype.hasOwnProperty.call(qaState, id)) {
				var card = qaRail.querySelector('.qa-card[data-qa="' + id + '"]');
				if (card) { card.innerHTML = cardInnerHtml(qaState[id]); updateCardClamp(card); }
			}
		}
		layoutQaCards();
		// Rebuild every chat turn so dynamic copy (sender labels, waiting text, timestamps) follows the new language.
		var chatTurns = chatList ? chatList.querySelectorAll(".chat-turn") : [];
		for (var ct = 0; ct < chatTurns.length; ct++) {
			var chatTurnId = chatTurns[ct].getAttribute("data-chat");
			if (chatTurnId && chatState[chatTurnId]) {
				chatTurns[ct].innerHTML = chatTurnInnerHtml(chatState[chatTurnId]);
				enhanceChatTurn(chatTurns[ct]);
			}
		}
		markLangActive();
		var titleEl = document.getElementById("docTitle");
		if (titleEl) document.title = titleEl.textContent + " \\u00b7 " + (T.titleSuffix || "Markdown Preview");
	}

	// In-page language switch. The choice is remembered in localStorage (mdp.lang)
	// and, per contract, wins over the language pushed by the server over SSE.
	document.addEventListener("click", function (e) {
		var t = e.target;
		while (t && t !== document) {
			if (t.getAttribute && t.getAttribute("data-lang-set")) {
				var v = t.getAttribute("data-lang-set");
				try { localStorage.setItem("mdp.lang", v); } catch (err) {}
				applyLang(v);
				return;
			}
			t = t.parentNode;
		}
	});

	/* ---------- auth failure (the server rejects a missing/invalid token) ---------- */

	// Auth copy is inline: page.ts must stay free of non-ASCII literals (the
	// scripts/page-i18n-check.mjs gate asserts that) and page-i18n.ts has no key
	// for it yet. tx() prefers a future STRINGS key named exactly like these
	// fields and only falls back to this dict; the zh side spells CJK as unicode
	// escapes so this source file and the emitted inline script stay pure ASCII.
	var AUTH_TEXT = {
		en: {
			authFailToast: "Authentication failed: the token in this link is invalid or has expired",
			authFailLiveText: "Auth failed",
			authFailLiveTitle: "The access token was rejected; reopen the preview from pi for a fresh link",
		},
		zh: {
			authFailToast: "\\u9274\\u6743\\u5931\\u8d25\\uff1a\\u94fe\\u63a5\\u4e2d\\u7684 token \\u65e0\\u6548\\u6216\\u5df2\\u8fc7\\u671f",
			authFailLiveText: "\\u9274\\u6743\\u5931\\u8d25",
			authFailLiveTitle: "\\u8bbf\\u95ee\\u53d7\\u9650\\uff1atoken \\u88ab\\u62d2\\u7edd\\uff0c\\u8bf7\\u4ece pi \\u91cd\\u65b0\\u6253\\u5f00\\u9884\\u89c8\\u9875\\u9762\\u83b7\\u53d6\\u65b0\\u94fe\\u63a5",
		},
	};

	// STRINGS first (so a later page-i18n.ts key wins without touching this file),
	// inline dict second; reads the current lang so an in-page switch re-translates.
	function tx(key) {
		if (T[key]) return T[key];
		var pack = lang === "zh" ? AUTH_TEXT.zh : AUTH_TEXT.en;
		return pack[key] || "";
	}
	function isAuthStatus(s) { return s === 401 || s === 403; }

	// Sticky by design: one clear message beats one toast per failing request, and a
	// rejected token cannot become valid again without reopening the link.
	var authFailed = false;
	function authFail() {
		if (authFailed) return;
		authFailed = true;
		setLive("auth");
		toast(tx("authFailToast"));
	}
	function markAuthFromResponse(res) {
		if (res && isAuthStatus(res.status)) { authFail(); return true; }
		return false;
	}

	// probeAuth: one short GET on the SSE endpoint, aborted right after the headers.
	// EventSource error events carry no status code, so this is the only way to tell
	// a rejected token (401/403) from a transient disconnect on a fatal connection.
	function probeAuth() {
		if (!window.fetch || !window.AbortController) { authFail(); return; }
		var ctrl = new AbortController();
		fetch(DOC.updateUrl, { signal: ctrl.signal }).then(function (res) {
			ctrl.abort();
			if (isAuthStatus(res.status)) authFail(); else setLive("down");
		}).catch(function () {
			setLive("down");   // a network error is not an auth error
		});
	}

	/* ---------- user-level prefs (server-side, cross-session) ---------- */

	var prefsUrl = DOC.prefsUrl || "";
	var prefsTimer = null;
	var prefsPending = null;
	function flushPrefs() {
		if (prefsTimer) { clearTimeout(prefsTimer); prefsTimer = null; }
		if (!prefsPending || !prefsUrl) return;
		var body = JSON.stringify(prefsPending);
		prefsPending = null;
		try {
			if (window.fetch) {
				window.fetch(prefsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true })
					.then(function (res) { markAuthFromResponse(res); })
					.catch(function () {});
			} else if (navigator.sendBeacon) {
				navigator.sendBeacon(prefsUrl, new Blob([body], { type: "application/json" }));
			}
		} catch (e) { /* prefs persistence is best-effort and must not block interaction */ }
	}
	function savePrefs(patch) {
		if (!prefsUrl) return;
		prefsPending = prefsPending || {};
		for (var k in patch) {
			if (Object.prototype.hasOwnProperty.call(patch, k)) prefsPending[k] = patch[k];
		}
		if (!prefsTimer) prefsTimer = setTimeout(flushPrefs, 250);
	}
	window.addEventListener("pagehide", flushPrefs);

	/* ---------- theme ---------- */

	var themePref = root.dataset.themePref || "system";
	function resolveTheme(pref) {
		if (pref === "system") {
			return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
		}
		return pref;
	}
	function applyTheme(pref, persist) {
		themePref = pref;
		root.dataset.themePref = pref;
		root.dataset.theme = resolveTheme(pref);
		if (persist !== false) {
			try { localStorage.setItem("mdp.theme", pref); } catch (e) {}
			savePrefs({ theme: pref });
		}
		var btns = document.querySelectorAll("[data-theme-set]");
		for (var i = 0; i < btns.length; i++) {
			var on = btns[i].getAttribute("data-theme-set") === pref;
			btns[i].classList.toggle("active", on);
			btns[i].setAttribute("aria-pressed", on ? "true" : "false");
		}
		// Re-render already rendered mermaid diagrams for the new theme (see the mermaid section).
		rerenderMermaidForTheme();
	}
	document.addEventListener("click", function (e) {
		var t = e.target;
		while (t && t !== document) {
			if (t.getAttribute && t.getAttribute("data-theme-set")) {
				applyTheme(t.getAttribute("data-theme-set"), true);
				return;
			}
			t = t.parentNode;
		}
	});
	if (window.matchMedia) {
		var mq = window.matchMedia("(prefers-color-scheme: dark)");
		var onScheme = function () { if (themePref === "system") applyTheme("system", false); };
		if (mq.addEventListener) mq.addEventListener("change", onScheme);
		else if (mq.addListener) mq.addListener(onScheme);
	}
	applyTheme(themePref, false);

	/* ---------- reading background ---------- */

	var bgPref = root.dataset.bg || "white";
	function applyBg(pref, persist) {
		bgPref = pref;
		root.dataset.bg = pref;
		if (persist !== false) {
			try { localStorage.setItem("mdp.bg", pref); } catch (e) {}
			savePrefs({ bg: pref });
		}
		var dots = document.querySelectorAll("[data-bg-set]");
		for (var i = 0; i < dots.length; i++) {
			var on = dots[i].getAttribute("data-bg-set") === pref;
			dots[i].classList.toggle("active", on);
			dots[i].setAttribute("aria-pressed", on ? "true" : "false");
		}
	}
	document.addEventListener("click", function (e) {
		var t = e.target;
		while (t && t !== document) {
			if (t.getAttribute && t.getAttribute("data-bg-set")) {
				applyBg(t.getAttribute("data-bg-set"), true);
				return;
			}
			t = t.parentNode;
		}
	});
	applyBg(bgPref, false);

	/* ---------- font size ---------- */

	var scale = parseFloat(root.style.getPropertyValue("--font-scale") || "1");
	if (!isFinite(scale) || scale <= 0) scale = 1;
	var fontValue = document.getElementById("fontValue");
	function setScale(v) {
		scale = Math.min(1.6, Math.max(0.7, Math.round(v * 100) / 100));
		root.style.setProperty("--font-scale", String(scale));
		try { localStorage.setItem("mdp.scale", String(scale)); } catch (e) {}
		savePrefs({ scale: scale });
		fontValue.textContent = Math.round(scale * 100) + "%";
		layoutQaCards();
		updateAllQaClamp();
	}
	document.getElementById("fontMinus").addEventListener("click", function () { setScale(scale - 0.1); });
	document.getElementById("fontPlus").addEventListener("click", function () { setScale(scale + 0.1); });
	fontValue.addEventListener("click", function () { setScale(1); });
	fontValue.style.cursor = "pointer";
	fontValue.title = T.resetDefault;
	// The initial setScale call is deferred to the boot phase, where the Q&A
	// section's variables (qaRail etc.) are already assigned; otherwise
	// setScale -> layoutQaCards would run before qaRail exists (it has its own guard).

	/* ---------- line height ---------- */

	var LINE_MIN = 1.4, LINE_MAX = 2.2, LINE_STEP = 0.15, LINE_DEFAULT = 1.75;
	var lineHeightValue = document.getElementById("lineHeightValue");
	var lineHeight = parseFloat(root.style.getPropertyValue("--line-height") || String(LINE_DEFAULT));
	if (!isFinite(lineHeight) || lineHeight <= 0) lineHeight = LINE_DEFAULT;
	// setLineHeight is self-contained (no dependency on layoutQaCards), so calling it before boot is safe.
	function setLineHeight(v) {
		lineHeight = Math.min(LINE_MAX, Math.max(LINE_MIN, Math.round(v * 100) / 100));
		root.style.setProperty("--line-height", String(lineHeight));
		try { localStorage.setItem("mdp.lineHeight", String(lineHeight)); } catch (e) {}
		savePrefs({ lineHeight: lineHeight });
		lineHeightValue.textContent = lineHeight.toFixed(2);
	}
	document.getElementById("lineHeightMinus").addEventListener("click", function () { setLineHeight(lineHeight - LINE_STEP); });
	document.getElementById("lineHeightPlus").addEventListener("click", function () { setLineHeight(lineHeight + LINE_STEP); });
	lineHeightValue.addEventListener("click", function () { setLineHeight(LINE_DEFAULT); });
	lineHeightValue.style.cursor = "pointer";
	lineHeightValue.title = T.resetDefault;

	/* ---------- toast ---------- */

	var toastEl = document.getElementById("toast");
	var toastTimer = null;
	function toast(msg) {
		toastEl.textContent = msg;
		toastEl.classList.add("show");
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
	}

	/* ---------- table of contents ---------- */

	var tocAside = document.getElementById("toc");
	var tocNav = document.getElementById("tocNav");
	function buildToc(toc) {
		tocNav.innerHTML = "";
		if (!toc || toc.length < 2) { tocAside.classList.add("hidden"); return; }
		tocAside.classList.remove("hidden");
		for (var i = 0; i < toc.length; i++) {
			var item = toc[i];
			var a = document.createElement("a");
			a.className = "toc-link level-" + item.level;
			a.href = "#" + item.id;
			a.textContent = item.text;
			a.setAttribute("data-target", item.id);
			tocNav.appendChild(a);
		}
	}
	tocNav.addEventListener("click", function (e) {
		var a = e.target.closest ? e.target.closest(".toc-link") : null;
		if (!a) return;
		e.preventDefault();
		var el = document.getElementById(a.getAttribute("data-target"));
		if (el) {
			el.scrollIntoView({ behavior: motionOK ? "smooth" : "auto", block: "start" });
			if (history.replaceState) history.replaceState(null, "", "#" + encodeURIComponent(a.getAttribute("data-target")));
		}
	});

	/* ---------- scroll: progress, spy, chrome ---------- */

	var progressBar = document.getElementById("progressBar");
	var topbar = document.getElementById("topbar");
	var toTop = document.getElementById("toTop");
	var ticking = false;
	function onScroll() {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(function () {
			ticking = false;
			var doc = document.documentElement;
			var max = doc.scrollHeight - doc.clientHeight;
			progressBar.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + "%";
			topbar.classList.toggle("scrolled", doc.scrollTop > 8);
			toTop.classList.toggle("show", doc.scrollTop > 600);

			var links = tocNav.querySelectorAll(".toc-link");
			if (links.length) {
				var active = links[0];
				for (var i = 0; i < links.length; i++) {
					var target = document.getElementById(links[i].getAttribute("data-target"));
					if (target && target.getBoundingClientRect().top <= 110) active = links[i];
				}
				for (var j = 0; j < links.length; j++) links[j].classList.toggle("active", links[j] === active);
			}
		});
	}
	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", onScroll);
	toTop.addEventListener("click", function () {
		window.scrollTo({ top: 0, behavior: motionOK ? "smooth" : "auto" });
	});

	/* ---------- syntax highlighting (conservative tokenizer) ---------- */

	var KW = {
		clike: ("abstract as async await break case catch class const continue debugger default delete do else enum " +
			"export extends false final finally for from function get if implements import in instanceof interface let " +
			"new null of override package private protected public return set static super switch this throw true try " +
			"type typeof undefined var void while with yield struct impl trait pub use mod match loop where fun val " +
			"declare namespace").split(" "),
		hash: ("and as assert async await break class continue def del elif else except false finally for from global if " +
			"import in is lambda none nonlocal not or pass raise return true try while with yield require then fi done " +
			"function local export alias esac elif").split(" "),
		sql: ("select from where insert into values update delete set join left right inner outer on group by order having " +
			"limit offset as distinct union all create table alter drop primary key foreign references index view with " +
			"case when then else end and or not null asc desc").split(" "),
		json: "true false null".split(" "),
	};

	function kwSet(words) {
		var s = Object.create(null);
		for (var i = 0; i < words.length; i++) s[words[i]] = 1;
		return s;
	}
	KW.clike = kwSet(KW.clike);
	KW.hash = kwSet(KW.hash);
	KW.sql = kwSet(KW.sql);
	KW.json = kwSet(KW.json);

	var RE_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y;
	var RE_NUM = /0[xXbBoO][0-9a-fA-F_]+|(?:\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)|#[0-9a-fA-F]{3,8}\\b/y;
	var RE_LINE_COMMENT = /\\/\\/[^\\n]*/y;
	var RE_HASH_COMMENT = /#[^\\n]*/y;
	var RE_SQL_COMMENT = /--[^\\n]*/y;
	var RE_BLOCK_COMMENT = /\\/\\*[\\s\\S]*?(?:\\*\\/|$)/y;
	var RE_XML_COMMENT = /<!--[\\s\\S]*?(?:-->|$)/y;
	var RE_STR_D = /"(?:\\\\.|[^"\\\\\\n])*(?:"|$)/y;
	var RE_STR_S = /'(?:\\\\.|[^'\\\\\\n])*(?:'|$)/y;
	var RE_STR_T = /\\x60(?:\\\\.|[^\\x60\\\\])*?(?:\\x60|$)/y;
	var RE_TAG = /<\\/?[A-Za-z][A-Za-z0-9:_-]*/y;

	function rulesFor(lang) {
		var l = (lang || "").toLowerCase();
		var strings = [
			{ cls: "s", re: RE_STR_D }, { cls: "s", re: RE_STR_S }, { cls: "s", re: RE_STR_T },
		];
		var nums = [{ cls: "n", re: RE_NUM }];
		if (["js", "mjs", "cjs", "javascript", "jsx", "ts", "typescript", "tsx", "java", "c", "cpp", "cc", "h", "hpp",
			"cs", "c#", "go", "golang", "rs", "rust", "swift", "kt", "kotlin", "scala", "dart", "groovy"].indexOf(l) >= 0) {
			return [{ cls: "c", re: RE_LINE_COMMENT }, { cls: "c", re: RE_BLOCK_COMMENT }].concat(strings, [
				{ cls: "ident", re: RE_IDENT, kw: KW.clike }, { cls: "y", re: RE_TAG },
			], nums);
		}
		if (["py", "python", "rb", "ruby", "sh", "bash", "zsh", "shell", "console", "yaml", "yml", "toml", "ini",
			"make", "makefile", "dockerfile", "perl", "r", "lua", "ps1", "powershell"].indexOf(l) >= 0) {
			return [{ cls: "c", re: RE_HASH_COMMENT }].concat(strings, [
				{ cls: "ident", re: RE_IDENT, kw: KW.hash },
			], nums);
		}
		if (["sql", "pgsql", "mysql", "sqlite", "postgres"].indexOf(l) >= 0) {
			return [{ cls: "c", re: RE_SQL_COMMENT }, { cls: "c", re: RE_BLOCK_COMMENT }].concat(strings, [
				{ cls: "ident", re: RE_IDENT, kw: KW.sql },
			], nums);
		}
		if (["json", "jsonc"].indexOf(l) >= 0) {
			return [{ cls: "s", re: RE_STR_D }, { cls: "ident", re: RE_IDENT, kw: KW.json }].concat(nums);
		}
		if (["css", "scss", "less", "styl"].indexOf(l) >= 0) {
			return [{ cls: "c", re: RE_BLOCK_COMMENT }].concat(strings, nums);
		}
		if (["html", "xml", "svg", "vue", "svelte", "markdown", "md"].indexOf(l) >= 0) {
			return [{ cls: "c", re: RE_XML_COMMENT }, { cls: "y", re: RE_TAG }].concat(strings, nums);
		}
		return [{ cls: "c", re: RE_LINE_COMMENT }, { cls: "c", re: RE_BLOCK_COMMENT }].concat(strings, nums);
	}

	function escText(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function highlight(code, lang) {
		var rules = rulesFor(lang);
		var out = "";
		var pos = 0;
		var len = code.length;
		while (pos < len) {
			var hitCls = null, hitText = null, hitKw = null;
			for (var i = 0; i < rules.length; i++) {
				var re = rules[i].re;
				re.lastIndex = pos;
				var m = re.exec(code);
				if (m && m[0]) {
					hitCls = rules[i].cls;
					hitText = m[0];
					hitKw = rules[i].kw || null;
					break;
				}
			}
			if (hitText) {
				if (hitCls === "ident") {
					var next = code.charAt(pos + hitText.length);
					var cls = null;
					if (hitKw && hitKw[hitText.toLowerCase()]) cls = "tok-k";
					else if (next === "(") cls = "tok-f";
					else if (/^[A-Z]/.test(hitText)) cls = "tok-t";
					out += cls ? '<span class="' + cls + '">' + escText(hitText) + "</span>" : escText(hitText);
				} else {
					out += '<span class="tok-' + hitCls + '">' + escText(hitText) + "</span>";
				}
				pos += hitText.length;
			} else {
				out += escText(code.charAt(pos));
				pos += 1;
			}
		}
		return out;
	}

	/* ---------- code enhancements ---------- */

	function enhanceCode(scope) {
		var blocks = (scope || document).querySelectorAll(".code-block");
		for (var i = 0; i < blocks.length; i++) {
			var block = blocks[i];
			var head = block.querySelector(":scope > .code-head");
			if (head && !head.querySelector(".copy-btn")) {
				var btn = document.createElement("button");
				btn.type = "button";
				btn.className = "copy-btn";
				btn.textContent = T.copyBtn;
				btn.addEventListener("click", onCopy);
				head.appendChild(btn);
			}
			var code = block.querySelector(":scope > pre > code");
			if (code && !code.getAttribute("data-hl")) {
				code.setAttribute("data-hl", "1");
				code.innerHTML = highlight(code.textContent, (block.getAttribute("data-lang") || "").replace(/^language-/, ""));
			}
		}
		var bare = (scope || document).querySelectorAll("pre:not(.code-block pre)");
		for (var j = 0; j < bare.length; j++) {
			var pre = bare[j];
			if (pre.closest && pre.closest(".code-block")) continue;
			// Keep mermaid blocks as bare pre (pre.mermaid and .mermaid children); renderMermaidBlocks owns them, so skip the code-block wrapper.
			if (pre.classList.contains("mermaid") || (pre.closest && pre.closest(".mermaid"))) continue;
			var wrap = document.createElement("div");
			wrap.className = "code-block";
			wrap.setAttribute("data-lang", "text");
			var h = document.createElement("div");
			h.className = "code-head";
			h.innerHTML = '<span class="code-lang">text</span>';
			pre.parentNode.insertBefore(wrap, pre);
			wrap.appendChild(h);
			wrap.appendChild(pre);
		}
	}

	function onCopy(e) {
		var btn = e.currentTarget;
		var block = btn.closest(".code-block");
		var pre = block ? block.querySelector("pre") : null;
		if (!pre) return;
		var text = pre.innerText;
		var done = function () {
			btn.textContent = T.copyDone;
			btn.classList.add("done");
			toast(T.copyToast);
			setTimeout(function () { btn.textContent = T.copyBtn; btn.classList.remove("done"); }, 1600);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () { toast(T.copyFailToast); });
		} else {
			var ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); done(); } catch (err) { toast(T.copyFailToast); }
			document.body.removeChild(ta);
		}
	}

	/* ---------- mermaid diagrams (lazy-load the injected same-origin runtime, fully offline) ---------- */

	// The server-injected URL carries ?token=; the bare path is the standalone
	// fallback used when the server does not pass mermaidUrl at all.
	var mermaidUrl = DOC.mermaidUrl || "/mermaid.mjs";

	var mermaidPromise = null;
	var mermaidSeq = 0;      // mermaid.render requires a unique id on every call
	var mermaidTheme = "";   // theme already passed to initialize(); re-initialize before rendering after a switch

	// Called only when the document contains pre.mermaid; a failed load clears the cache so the next call retries.
	function loadMermaid() {
		if (!mermaidPromise) {
			mermaidPromise = import(mermaidUrl).catch(function (e) {
				mermaidPromise = null;
				throw e;
			});
		}
		return mermaidPromise;
	}

	// Render one block: on success an adjacent div.mermaid-rendered carries the svg and
	// the pre is hidden as a source backup; on failure the escaped source stays visible.
	// Never throws outwards.
	function renderMermaidOne(mermaid, pre) {
		try {
			var id = "mmd-" + (++mermaidSeq);
			mermaid.render(id, pre.textContent).then(function (r) {
				var svg = r && r.svg ? r.svg : "";
				// The pre may have been replaced by an SSE update; do not insert into the DOM then.
				if (!svg || !pre.parentNode) throw new Error("mermaid empty svg");
				var box = document.createElement("div");
				box.className = "mermaid-rendered";
				box.innerHTML = svg;
				pre.parentNode.insertBefore(box, pre.nextSibling);
				pre.style.display = "none";
				pre.setAttribute("data-mmd", "done");
				pre.setAttribute("data-status", "done");
			}).catch(function (e) {
				try {
					pre.style.display = "";
					pre.setAttribute("data-status", "error");
				} catch (err) { /* the node may have been replaced; ignore */ }
				console.warn("[md-preview] mermaid render failed:", e);
			});
		} catch (e) {
			try { pre.setAttribute("data-status", "error"); } catch (err) { /* ignore */ }
			console.warn("[md-preview] mermaid render failed:", e);
		}
	}

	// Render pre.mermaid nodes inside scope that are still unprocessed (no data-mmd marker).
	function renderMermaidBlocks(scope) {
		var list = [];
		try {
			var nodes = (scope || document).querySelectorAll("pre.mermaid");
			for (var i = 0; i < nodes.length; i++) {
				if (nodes[i].getAttribute("data-mmd")) continue;
				nodes[i].setAttribute("data-mmd", "pending");   // guard against duplicate rendering from concurrent calls
				nodes[i].setAttribute("data-status", "loading");
				list.push(nodes[i]);
			}
		} catch (e) {
			console.warn("[md-preview] mermaid scan failed:", e);
			return;
		}
		if (!list.length) return;
		loadMermaid().then(function (mod) {
			var mermaid = (mod && mod.default) || mod;
			// initialize the theme once; re-initialize before rendering after a theme switch
			var theme = root.dataset.theme === "dark" ? "dark" : "default";
			if (mermaidTheme !== theme) {
				mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme });
				mermaidTheme = theme;
			}
			for (var i = 0; i < list.length; i++) renderMermaidOne(mermaid, list[i]);
		}).catch(function (e) {
			// mermaid failed to load/initialize: fall back to source view for every block
			for (var i = 0; i < list.length; i++) {
				try {
					list[i].style.display = "";
					list[i].setAttribute("data-status", "error");
				} catch (err) { /* ignore */ }
			}
			console.warn("[md-preview] mermaid load failed:", e);
		});
	}

	// Re-render after a theme switch: drop old div.mermaid-rendered nodes, show the pre again, render for the new theme.
	function rerenderMermaidForTheme() {
		try {
			var done = document.querySelectorAll('pre.mermaid[data-mmd="done"]');
			if (!done.length) return;
			for (var i = 0; i < done.length; i++) {
				var pre = done[i];
				var box = pre.nextElementSibling;
				if (box && box.classList.contains("mermaid-rendered") && box.parentNode) {
					box.parentNode.removeChild(box);
				}
				pre.style.display = "";
				pre.removeAttribute("data-mmd");
				pre.removeAttribute("data-status");
			}
			renderMermaidBlocks(document);
		} catch (e) {
			console.warn("[md-preview] mermaid theme re-render failed:", e);
		}
	}

	/* ---------- live updates ---------- */

	var livePill = document.getElementById("livePill");
	function setLive(state) {
		liveState = state;
		if (state === "live") {
			livePill.classList.remove("down");
			livePill.title = T.liveSyncTitle;
			livePill.querySelector(".live-text").textContent = T.liveSyncText;
		} else if (state === "auth") {
			// Token rejected: the pill keeps the reason visible after the toast fades.
			livePill.classList.add("down");
			livePill.title = tx("authFailLiveTitle");
			livePill.querySelector(".live-text").textContent = tx("authFailLiveText");
		} else {
			livePill.classList.add("down");
			livePill.title = T.liveDownTitle;
			livePill.querySelector(".live-text").textContent = T.liveDownText;
		}
	}

	function applyUpdate(d, quiet) {
		// The server may switch the UI language; a local choice (localStorage) still wins.
		if (d.lang === "en" || d.lang === "zh") {
			DOC.lang = d.lang;
			var chosen = null;
			try { chosen = localStorage.getItem("mdp.lang"); } catch (err) {}
			if (chosen !== "en" && chosen !== "zh") applyLang(d.lang);
		}
		var content = document.getElementById("content");
		content.innerHTML = d.html;
		if (d.title) {
			document.title = d.title + " \\u00b7 " + (T.titleSuffix || "Markdown Preview");
			document.getElementById("docTitle").textContent = d.title;
		}
		buildToc(d.toc || []);
		enhanceCode(content);
		renderMermaidBlocks(content);
		restoreQaHighlights();
		onScroll();
		if (!quiet) toast(T.docUpdatedToast);
	}

	if (DOC.updateUrl && window.EventSource) {
		var es = new EventSource(DOC.updateUrl);
		var esOpened = false;
		var esErrors = 0;
		var esAuthProbed = false;
		es.onopen = function () { esOpened = true; esErrors = 0; setLive("live"); };
		es.onerror = function () {
			esErrors++;
			// Fatal (readyState 2 / CLOSED): EventSource refuses to retry, which is how a
			// 401 or 403 from the token check surfaces. The error event has no status
			// code, so confirm with one probe request before blaming the token. Some
			// browsers keep retrying even on 4xx: probe too after a few consecutive
			// failures without a single successful open.
			if (es.readyState === 2 || (!esOpened && esErrors >= 3)) {
				if (!esAuthProbed) { esAuthProbed = true; probeAuth(); }
				return;
			}
			setLive("down");   // retryable: the pill says disconnected, onopen restores it
		};
		es.addEventListener("update", function (e) {
			try { applyUpdate(JSON.parse(e.data)); } catch (err) { /* ignore malformed frames */ }
		});
		es.addEventListener("init", function (e) {
			try {
				var d = JSON.parse(e.data);
				applyUpdate(d, true);
				syncChatFromQa(d.qa);
			} catch (err) { /* ignore malformed frames */ }
		});
		es.addEventListener("closing", function () {
			setLive("down");
			toast(T.serverExitToast);
		});
		es.addEventListener("ask", function (e) {
			try {
				var qa = JSON.parse(e.data);
				// Chat entries (quote === "") go to the bottom conversation area; the qa rail path below is untouched.
				if (qa.chat) { addChat(qa); return; }
				// A question submitted by this tab is highlighted precisely with the still-live selection Range (supports spanning elements).
				if (pendingSubmit && qa.quote === pendingSubmit.quote && qa.question === pendingSubmit.question) {
					addQa(qa, pendingSubmit.range);
					pendingSubmit = null;
				} else {
					addQa(qa);
				}
			} catch (err) { /* ignore malformed frames */ }
		});
		es.addEventListener("answer", function (e) {
			try {
				var d = JSON.parse(e.data);
				if (chatState[d.id]) {
					chatState[d.id].answerHtml = d.answerHtml;
					chatState[d.id].answeredAt = d.answeredAt;
					refreshChat(d.id);
					toast(T.qaAnsweredToast);
					return;
				}
				var entry = qaState[d.id];
				if (!entry) return;
				entry.answerHtml = d.answerHtml;
				entry.answeredAt = d.answeredAt;
				refreshCard(d.id);
				toast(T.qaAnsweredToast);
			} catch (err) { /* ignore malformed frames */ }
		});
	}

	if (DOC.closeUrl && navigator.sendBeacon) {
		window.addEventListener("pagehide", function () {
			navigator.sendBeacon(DOC.closeUrl);
		});
	}

	/* ---------- ask about the selection (Q&A with the agent) ---------- */

	var askUrl = DOC.askUrl || "";
	var layoutEl = document.getElementById("layout");
	var contentEl = document.getElementById("content");
	var qaRail = document.getElementById("qaRail");
	var qaState = {};
	var qaStackTop = 0;
	var pendingSubmit = null;

	function esc(s) {
		return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}
	function fmtTime(t) {
		try { return new Date(t).toLocaleString(T.locale, { hour12: false }); } catch (e) { return ""; }
	}

	// Wrap the still-live Range precisely (supports selections that span elements).
	function highlightRange(id, range) {
		if (!range || range.collapsed || !range.startContainer) return false;
		if (!contentEl.contains(range.commonAncestorContainer)) return false;
		var frag = null;
		try {
			frag = range.extractContents();
			var walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
			var nodes = [], t;
			while ((t = walker.nextNode())) if (t.nodeValue && t.nodeValue.trim()) nodes.push(t);
			if (!nodes.length) return false;
			for (var i = 0; i < nodes.length; i++) {
				var mark = document.createElement("mark");
				mark.className = "mdp-qa-hl";
				mark.setAttribute("data-qa", id);
				nodes[i].parentNode.insertBefore(mark, nodes[i]);
				mark.appendChild(nodes[i]);
			}
			range.insertNode(frag);
			frag = null;
			return true;
		} catch (err) {
			try { if (frag && frag.childNodes.length) range.insertNode(frag); } catch (e2) { /* best-effort restore of the original content */ }
			return false;
		}
	}

	// Restore cases (reload / re-render / other tabs): locate the quote in the body and wrap it.
	// Only quotes inside a single text node are highlighted on restore (the card still shows).
	function highlightByText(id, quote) {
		if (!quote) return false;
		if (contentEl.querySelector('mark[data-qa="' + id + '"]')) return true;
		var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
			acceptNode: function (n) {
				if (!n.nodeValue || n.nodeValue.indexOf(quote) < 0) return NodeFilter.FILTER_REJECT;
				var p = n.parentNode;
				while (p && p !== contentEl) {
					if (p.classList && p.classList.contains("mdp-qa-hl")) return NodeFilter.FILTER_REJECT;
					p = p.parentNode;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		var n = walker.nextNode();
		if (!n) return false;
		var idx = n.nodeValue.indexOf(quote);
		var mark = document.createElement("mark");
		mark.className = "mdp-qa-hl";
		mark.setAttribute("data-qa", id);
		n.splitText(idx);
		var after = n.nextSibling;
		after.splitText(quote.length);
		after.parentNode.insertBefore(mark, after);
		mark.appendChild(after);
		return true;
	}

	function cardInnerHtml(entry) {
		var answered = !!entry.answerHtml;
		var time = answered && entry.answeredAt ? fmtTime(entry.answeredAt) : "";
		return '<div class="qa-head"><span class="qa-badge">' + esc(T.qaBadge) + '</span><span class="qa-time">' + esc(time) + "</span></div>"
			+ '<div class="qa-quote"><span class="qa-label">' + esc(T.qaLabelQuote) + "</span>" + esc(entry.quote) + "</div>"
			+ '<div class="qa-q"><span class="qa-label">' + esc(T.qaLabelQuestion) + "</span>" + esc(entry.question) + "</div>"
			+ (answered
				? '<div class="qa-a">' + entry.answerHtml + '</div><button type="button" class="qa-more" hidden>' + esc(T.qaViewFull) + "</button>"
				: '<div class="qa-wait"><span class="qa-pulse"></span>' + esc(T.qaWaiting) + "</div>");
	}

	function buildCard(id, entry) {
		var card = document.createElement("div");
		card.className = "qa-card" + (entry.answerHtml ? "" : " pending");
		card.setAttribute("data-qa", id);
		card.innerHTML = cardInnerHtml(entry);
		return card;
	}

	function refreshCard(id) {
		var entry = qaState[id];
		if (!entry) return;
		var card = qaRail.querySelector('.qa-card[data-qa="' + id + '"]');
		if (!card) return;
		card.classList.remove("pending");
		card.innerHTML = cardInnerHtml(entry);
		updateCardClamp(card);
		layoutQaCards();
	}

	/* Long-reply clamping + full-text modal.
	   Answers longer than the CSS line clamp (-webkit-line-clamp: 6) get an
	   ellipsis and a "view full text" button; clicking it opens a centered
	   modal with the complete reply. Measurement trick: apply the clamp,
	   compare scrollHeight (full content) against clientHeight (clamped
	   viewport); a real difference means content is actually hidden. */
	function updateCardClamp(card) {
		var a = card.querySelector(".qa-a");
		var btn = card.querySelector(".qa-more");
		if (!a) { if (btn) btn.hidden = true; return; }
		a.classList.add("clampable");
		a.classList.add("is-clamped");
		var clamped = a.scrollHeight - a.clientHeight > 2;
		a.classList.toggle("is-clamped", clamped);
		if (btn) btn.hidden = !clamped;
	}

	function updateAllQaClamp() {
		if (!qaRail) return;
		var cards = qaRail.children;
		for (var i = 0; i < cards.length; i++) updateCardClamp(cards[i]);
	}

	var qaModal = document.getElementById("qaModal");
	var qaModalQuote = document.getElementById("qaModalQuote");
	var qaModalBody = document.getElementById("qaModalBody");

	function openQaModal(id) {
		var entry = qaState[id];
		if (!entry || !entry.answerHtml || !qaModal) return;
		qaModalQuote.innerHTML = '<span class="qa-label">' + esc(T.qaLabelQuote) + "</span>" + esc(entry.quote);
		qaModalBody.innerHTML = entry.answerHtml;
		try { enhanceCode(qaModalBody); } catch (err) { /* copy buttons are a nice-to-have */ }
		qaModal.classList.add("show");
		document.body.style.overflow = "hidden";
	}

	function closeQaModal() {
		if (!qaModal) return;
		qaModal.classList.remove("show");
		document.body.style.overflow = "";
	}

	if (qaModal) {
		qaModal.addEventListener("click", function (e) { if (e.target === qaModal) closeQaModal(); });
		var qaModalCloseBtn = document.getElementById("qaModalClose");
		if (qaModalCloseBtn) qaModalCloseBtn.addEventListener("click", closeQaModal);
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && qaModal.classList.contains("show")) closeQaModal();
		});
		// Cards re-render their innerHTML on refresh/lang switch, so delegate.
		qaRail.addEventListener("click", function (e) {
			var btn = e.target && e.target.closest ? e.target.closest(".qa-more") : null;
			if (!btn || btn.hidden) return;
			var card = btn.closest(".qa-card");
			if (card) openQaModal(card.getAttribute("data-qa"));
		});
	}

	function anchorY(id) {
		var m = contentEl.querySelector('mark[data-qa="' + id + '"]');
		if (!m) return 0;
		// Both rects are measured in the same frame, so page scroll cancels out in the delta;
		// no scrollY compensation is needed.
		var mr = m.getBoundingClientRect();
		return mr.top - qaRail.getBoundingClientRect().top;
	}

	function layoutQaCards() {
		// Guard: this function may run before the Q&A section assigns qaRail/contentEl
		// (e.g. setScale during font-size init); bail out instead of throwing a TypeError
		// that would abort the whole IIFE.
		if (!qaRail || !contentEl) return;
		// The rail's right edge stops 16px left of the article; cards stretch left into the
		// empty viewport area (capped at 560px). In narrow windows the rail stays at least
		// 280px wide: covering the article's left edge beats leaving the viewport.
		// Recalculated by this function on resize.
		var layoutRect = layoutEl.getBoundingClientRect();
		var contentRect = contentEl.getBoundingClientRect();
		var railRight = contentRect.left - 16;                 // viewport x of the rail's right edge (16px gap to the article)
		var width = Math.round(Math.min(Math.max(railRight, 280), 560));
		var left = railRight - width - layoutRect.left;        // convert to an offset from the layout's left border
		left = Math.max(left, 12 - layoutRect.left);           // never leave the viewport's left edge by less than 12px
		qaRail.style.width = width + "px";
		qaRail.style.left = left + "px";
		qaStackTop = 0;
		var cards = qaRail.children;
		for (var i = 0; i < cards.length; i++) {
			var id = cards[i].getAttribute("data-qa");
			var top = Math.max(anchorY(id), qaStackTop);
			cards[i].style.top = top + "px";
			qaStackTop = top + cards[i].offsetHeight + 12;
		}
	}

	function addQa(entry, range) {
		if (!entry || !entry.id || qaState[entry.id]) return;
		qaState[entry.id] = entry;
		layoutEl.classList.add("with-qa");
		var ok = false;
		if (range) ok = highlightRange(entry.id, range);
		if (!ok) highlightByText(entry.id, entry.quote);
		var freshCard = buildCard(entry.id, entry);
		qaRail.appendChild(freshCard);
		updateCardClamp(freshCard);
		layoutQaCards();
	}

	function restoreQaHighlights() {
		for (var id in qaState) {
			if (Object.prototype.hasOwnProperty.call(qaState, id)) highlightByText(id, qaState[id].quote);
		}
		layoutQaCards();
	}
	window.addEventListener("resize", function () { layoutQaCards(); updateAllQaClamp(); });

	/* selection interaction: floating ask button + ask panel */
	var selBtn = document.getElementById("qaSelBtn");
	var askPanel = document.getElementById("askPanel");
	var panelQuote = document.getElementById("qaPanelQuote");
	var panelInput = document.getElementById("qaPanelInput");
	var selTimer = null;
	var pendingRange = null;
	var pendingQuote = "";

	function updateSelBtn() {
		if (!askUrl || (askPanel && !askPanel.hidden)) return;
		var sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) { selBtn.hidden = true; return; }
		var range = sel.getRangeAt(0);
		if (!contentEl.contains(range.commonAncestorContainer)) { selBtn.hidden = true; return; }
		var text = sel.toString();
		if (!text || !text.trim()) { selBtn.hidden = true; return; }
		pendingRange = range.cloneRange();
		pendingQuote = text;
		var rect = range.getBoundingClientRect();
		selBtn.style.top = (rect.bottom + window.scrollY + 8) + "px";
		selBtn.style.left = Math.max(8, rect.left + window.scrollX) + "px";
		selBtn.hidden = false;
	}

	if (askUrl) {
		document.addEventListener("selectionchange", function () {
			clearTimeout(selTimer);
			selTimer = setTimeout(updateSelBtn, 160);
		});
		selBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
		selBtn.addEventListener("click", function () {
			selBtn.hidden = true;
			panelQuote.textContent = pendingQuote.length > 120 ? pendingQuote.slice(0, 120) + "…" : pendingQuote;
			panelInput.value = "";
			askPanel.style.top = selBtn.style.top;
			askPanel.style.left = selBtn.style.left;
			askPanel.hidden = false;
			panelInput.focus();
		});
		document.getElementById("qaPanelCancel").addEventListener("click", function () {
			askPanel.hidden = true;
		});
		panelInput.addEventListener("keydown", function (e) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				submitAsk();
			}
		});
		document.getElementById("qaPanelSend").addEventListener("click", submitAsk);

		function submitAsk() {
			var q = panelInput.value.trim();
			if (!q || !pendingQuote) return;
			// Match the server-side trim so the SSE echo can be matched to pendingSubmit.
			var quote = pendingQuote.trim();
			var range = pendingRange;
			pendingSubmit = { quote: quote, question: q, range: range };
			panelInput.disabled = true;
			fetch(askUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ quote: quote, question: q }),
			}).then(function (res) {
				if (markAuthFromResponse(res)) throw new Error("auth");
				if (!res.ok) throw new Error("http " + res.status);
				return res.json();
			}).then(function (data) {
				askPanel.hidden = true;
				pendingSubmit = null;
				if (!qaState[data.id]) addQa({ id: data.id, quote: quote, question: q, answerHtml: null, askedAt: data.askedAt || Date.now(), answeredAt: null }, range);
				toast(T.qaAskToast);
			}).catch(function () {
				pendingSubmit = null;
				toast(authFailed ? tx("authFailToast") : T.qaAskFailToast);
			}).then(function () {
				panelInput.disabled = false;
			});
		}
	}

	/* ---------- document chat (bottom conversation with the agent) ---------- */

	// The endpoint's presence decides whether the chat area exists at all: until the
	// server (module A) passes chatUrl there is no DOM here and every entry point below
	// stays dormant instead of failing.
	var chatUrl = DOC.chatUrl || "";
	var chatList = document.getElementById("chatList");
	var chatEmpty = document.getElementById("chatEmpty");
	var chatText = document.getElementById("chatText");
	var chatSend = document.getElementById("chatSend");
	var chatState = {};   // id -> entry; the DOM lists turns newest-first, so ordering uses askedAt

	// One turn = the user row plus the agent row, drawn as two full-width alternating rows.
	// Every dynamic string except the pre-rendered *Html fields goes through esc().
	function chatTurnInnerHtml(entry) {
		var answered = !!entry.answerHtml;
		var askedAt = entry.askedAt ? fmtTime(entry.askedAt) : "";
		var answeredAt = answered && entry.answeredAt ? fmtTime(entry.answeredAt) : "";
		// questionHtml is rendered server-side by the same pipeline as answerHtml (raw HTML escaped).
		// esc(question) is the fallback for an older server or a frame that raced ahead of the render.
		var questionBody = entry.questionHtml
			? '<div class="chat-body content">' + entry.questionHtml + "</div>"
			: '<div class="chat-body chat-plain">' + esc(entry.question) + "</div>";
		return '<div class="chat-row you">'
			+ '<div class="chat-meta"><span class="chat-role you" data-i18n="chatYouLabel">' + esc(T.chatYouLabel) + '</span><span class="chat-time">' + esc(askedAt) + "</span></div>"
			+ questionBody
			+ "</div>"
			+ '<div class="chat-row agent">'
			+ '<div class="chat-meta"><span class="chat-role agent" data-i18n="chatAgentLabel">' + esc(T.chatAgentLabel) + '</span><span class="chat-time">' + esc(answeredAt) + "</span></div>"
			+ (answered
				? '<div class="chat-body content">' + entry.answerHtml + "</div>"
				: '<div class="chat-body"><div class="qa-wait"><span class="qa-pulse"></span>' + esc(T.chatWaiting) + "</div></div>")
			+ "</div>";
	}

	// The turn node keeps the class/data attributes that the export clone and refreshChat rely on.
	function buildChatTurn(entry) {
		var turn = document.createElement("div");
		turn.className = "chat-turn" + (entry.answerHtml ? "" : " pending");
		turn.setAttribute("data-chat", entry.id);
		turn.innerHTML = chatTurnInnerHtml(entry);
		return turn;
	}

	// Copy buttons, syntax highlighting and mermaid are scoped to this one turn, so
	// neither the article body nor the qa rail is touched.
	function enhanceChatTurn(turn) {
		try { enhanceCode(turn); renderMermaidBlocks(turn); } catch (e) { /* enhancements are best-effort */ }
	}

	// Reversed timeline: the newest message sits at the top of the list, right under
	// the input, so "show the new message" means the chat area's top edge. force =
	// false keeps the old guard: only scroll when the area is on screen, so an
	// arriving answer cannot yank a reader away from the article.
	function chatScrollTop(force) {
		var target = document.getElementById("chat");
		if (!target) return;
		if (!force) {
			var rect = target.getBoundingClientRect();
			var vh = window.innerHeight || 0;
			if (!(rect.top < vh && rect.bottom > 0)) return;
		}
		try { target.scrollIntoView({ behavior: motionOK ? "smooth" : "auto", block: "start" }); }
		catch (e) { target.scrollIntoView(); }
	}

	// chatList DOM order is now newest-first; the server still sends entries oldest
	// first (init frame, boot DOC.qa), so insert by askedAt descending instead of
	// appending. Strict "<" keeps same-millisecond ties in arrival order.
	function insertChatTurn(turn, entry) {
		var turns = chatList.querySelectorAll(".chat-turn");
		for (var i = 0; i < turns.length; i++) {
			var other = chatState[turns[i].getAttribute("data-chat")];
			if (other && other.askedAt < entry.askedAt) {
				chatList.insertBefore(turn, turns[i]);
				return;
			}
		}
		chatList.appendChild(turn);
	}

	// Idempotent by id: the SSE echo and the POST response race, whichever lands first wins.
	// quiet = true (boot hydration) keeps the initial viewport where the reader expects it.
	function addChat(entry, quiet) {
		if (!entry || !entry.id || !chatList) return;
		var known = chatState[entry.id];
		if (known) {
			// The SSE echo and the POST response race; whichever lands first wins and
			// the loser only upgrades fields the winner lacked (questionHtml / answer).
			var changed = false;
			if (entry.questionHtml && !known.questionHtml) { known.questionHtml = entry.questionHtml; changed = true; }
			if (entry.answerHtml && !known.answerHtml) {
				known.answerHtml = entry.answerHtml;
				known.answeredAt = entry.answeredAt;
				changed = true;
			}
			if (changed) refreshChat(entry.id);
			return;
		}
		chatState[entry.id] = entry;
		if (chatEmpty) chatEmpty.hidden = true;
		var turn = buildChatTurn(entry);
		insertChatTurn(turn, entry);
		enhanceChatTurn(turn);
		chatScrollTop(!quiet);
	}

	function refreshChat(id) {
		var entry = chatState[id];
		if (!entry || !chatList) return;
		var turn = chatList.querySelector('.chat-turn[data-chat="' + id + '"]');
		if (!turn) return;
		// The reply refreshes in place under its question, so this must not scroll: a reader
		// parked further down the reversed timeline would otherwise be yanked around.
		turn.classList.toggle("pending", !entry.answerHtml);
		turn.innerHTML = chatTurnInnerHtml(entry);
		enhanceChatTurn(turn);
	}

	// Reconnect catch-up: the init frame embeds the whole qa list (oldest first), so feed every
	// chat entry through addChat: unknown ones are ordered into the reversed list, known ones are
	// patched with whatever arrived while this tab was offline.
	function syncChatFromQa(list) {
		if (!chatUrl || !list || !list.length) return;
		for (var i = 0; i < list.length; i++) {
			var item = list[i];
			if (!item || !item.chat || !item.id) continue;
			addChat(item);
		}
	}

	function sendChat() {
		if (!chatUrl || !chatText) return;
		var msg = String(chatText.value || "").trim();
		if (!msg) return;
		if (msg.length > 2000) { toast(T.chatFailToast); return; }
		chatText.value = "";
		fetch(chatUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: msg }),
		}).then(function (res) {
			if (markAuthFromResponse(res)) throw new Error("auth");
			if (!res.ok) throw new Error("http " + res.status);
			return res.json();
		}).then(function (data) {
			// The response is a full payload carrying questionHtml, so the row renders Markdown right
			// away; addChat is idempotent and only patches what the SSE echo (if it won) lacked.
			addChat({
				id: data.id,
				question: data.question || msg,
				questionHtml: data.questionHtml || null,
				answerHtml: null,
				askedAt: data.askedAt || Date.now(),
				answeredAt: null,
				chat: true,
			});
			toast(T.chatAskToast);
			chatScrollTop(true);
		}).catch(function () {
			// Restore the draft so the message is not lost.
			chatText.value = msg;
			toast(authFailed ? tx("authFailToast") : T.chatFailToast);
		});
	}

	if (chatUrl && chatSend) chatSend.addEventListener("click", sendChat);
	if (chatUrl && chatText) chatText.addEventListener("keydown", function (e) {
		if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
	});

	/* ---------- export HTML (offline snapshot: clone -> sanitize -> freeze -> inline images -> download) ---------- */

	var EXPORT_RUNTIME = ${JSON.stringify(EXPORT_JS).replace(/</g, "\\u003c")};

	function removeInClone(clone, ids) {
		for (var i = 0; i < ids.length; i++) {
			var el = clone.querySelector("#" + ids[i]);
			if (el && el.parentNode) el.parentNode.removeChild(el);
		}
	}

	// R7: the topbar subtitle is the absolute source path (the server passes doc.filePath);
	// keep only the file name before sharing the export.
	function baseName(p) {
		var normalized = String(p || "").split(String.fromCharCode(92)).join("/");
		var parts = normalized.split("/");
		while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
		return parts.length ? parts[parts.length - 1] : normalized;
	}

	// File-name sanitization: filter character by character (no regex inside the template string);
	// illegal characters collapse to a single "-".
	function exportFileName() {
		var titleEl = document.getElementById("docTitle");
		var raw = titleEl ? String(titleEl.textContent || "") : "";
		var out = "";
		var lastDash = false;
		for (var i = 0; i < raw.length && out.length < 60; i++) {
			var ch = raw.charAt(i);
			var code = raw.charCodeAt(i);
			var bad = code < 32 || code === 127 || code === 92 || ch === "/" || ch === ":" ||
				ch === "*" || ch === "?" || ch === '"' || ch === "<" || ch === ">" || ch === "|";
			if (bad || ch === " " || ch === "-") {
				if (lastDash || !out.length) continue;
				out += "-";
				lastDash = true;
				continue;
			}
			out += ch;
			lastDash = false;
		}
		while (out.length && (out.charAt(out.length - 1) === "-" || out.charAt(out.length - 1) === ".")) out = out.slice(0, -1);
		if (!out) out = "document";
		var d = new Date();
		var pad = function (n) { return (n < 10 ? "0" : "") + n; };
		return "md-preview-" + out + "-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".html";
	}

	// mermaid may still be importing + rendering: wait up to 3s, then export anyway
	// (source visible) and report the timeout flag.
	function waitForMermaid() {
		return new Promise(function (resolve) {
			var deadline = Date.now() + 3000;
			var check = function () {
				var loading = document.querySelectorAll('pre.mermaid[data-status="loading"]');
				if (!loading.length) { resolve(false); return; }
				if (Date.now() >= deadline) { resolve(true); return; }
				setTimeout(check, 150);
			};
			check();
		});
	}

	function imageToDataUrl(src) {
		return fetch(src, { credentials: "same-origin" }).then(function (res) {
			if (markAuthFromResponse(res)) throw new Error("auth");
			if (!res.ok) throw new Error("http " + res.status);
			return res.blob();
		}).then(function (blob) {
			return new Promise(function (resolve, reject) {
				var reader = new FileReader();
				reader.onload = function () { resolve(String(reader.result || "")); };
				reader.onerror = function () { reject(reader.error || new Error("read failed")); };
				reader.readAsDataURL(blob);
			});
		});
	}

	// Inline same-origin /asset/<token> images as data URLs; skip data:/http(s):;
	// on failure keep the original src and do not block the export.
	function inlineImages(clone) {
		var imgs = clone.querySelectorAll("img[src]");
		var jobs = [];
		for (var i = 0; i < imgs.length; i++) {
			var src = imgs[i].getAttribute("src") || "";
			if (!src || src.slice(0, 5) === "data:" || src.slice(0, 5) === "http:" || src.slice(0, 6) === "https:") continue;
			(function (el, s) {
				jobs.push(imageToDataUrl(s).then(function (dataUrl) {
					if (dataUrl) el.setAttribute("src", dataUrl);
				}, function () { /* inline failed: keep the original src (may not display offline) */ }));
			})(imgs[i], src);
		}
		return Promise.all(jobs);
	}

	function buildExportDocument() {
		var clone = document.documentElement.cloneNode(true);

		/* 1) Freeze the appearance into concrete values (the export no longer follows system/prefs drift) */
		var theme = root.dataset.theme === "dark" ? "dark" : "light";
		clone.setAttribute("data-theme", theme);
		clone.setAttribute("data-theme-pref", theme);
		clone.removeAttribute("data-theme-hint");
		clone.removeAttribute("data-pref-scale");
		clone.removeAttribute("data-pref-line-height");
		clone.removeAttribute("data-pref-bg");
		clone.style.setProperty("--font-scale", String(scale));
		clone.style.setProperty("--line-height", String(lineHeight));
		// Freeze the effective language (including an in-page switch) into the snapshot.
		clone.setAttribute("data-export-i18n", JSON.stringify(T));

		/* 2) Strip scripts and online interactions (entries that would surely fail or be wrong offline) */
		var scripts = clone.querySelectorAll("script");
		for (var i = 0; i < scripts.length; i++) scripts[i].parentNode.removeChild(scripts[i]);
		removeInClone(clone, ["exportBtn", "downloadBtn", "qaSelBtn", "askPanel", "langSeg", "qaModal"]);
		removeInClone(clone, ["chatInput"]);
		var prog = clone.querySelector(".progress");
		if (prog && prog.parentNode) prog.parentNode.removeChild(prog);
		/* Transient toast state must not be frozen into the snapshot: the
		   "preparing export" toast is on-screen while this clone is taken.
		   Keep the #toast element (the offline runtime reuses it for its own
		   feedback) but clear the showing state and text. */
		var toastClone = clone.querySelector("#toast");
		if (toastClone) {
			toastClone.classList.remove("show");
			toastClone.textContent = "";
		}
		var exportedAt = Date.now();
		clone.setAttribute("data-exported-at", String(exportedAt));
		var pill = clone.querySelector("#livePill");
		if (pill) {
			pill.innerHTML = '<span class="live-dot"></span><span class="live-text">' + esc(T.exportBadge) + esc(fmtTime(exportedAt)) + "</span>";
		}
		var sub = clone.querySelector(".doc-sub");
		if (sub) sub.textContent = baseName(sub.textContent);

		/* 3) QA: keep answered cards as-is; turn waiting ones into a static note (dashed border kept, pulse removed) */
		var waiting = clone.querySelectorAll(".qa-card.pending .qa-wait");
		for (var j = 0; j < waiting.length; j++) waiting[j].textContent = T.qaPendingExport;
		// Long replies are clamped in the live view; the offline export must show
		// them in full, without the "view full text" button.
		var clampedAnswers = clone.querySelectorAll(".qa-a");
		for (var ca = 0; ca < clampedAnswers.length; ca++) clampedAnswers[ca].classList.remove("clampable", "is-clamped");
		var moreBtns = clone.querySelectorAll(".qa-more");
		for (var mb = 0; mb < moreBtns.length; mb++) if (moreBtns[mb].parentNode) moreBtns[mb].parentNode.removeChild(moreBtns[mb]);
		var rail = clone.querySelector("#qaRail");
		if (rail && !rail.querySelector(".qa-card")) {
			if (rail.parentNode) rail.parentNode.removeChild(rail);
			var layoutClone = clone.querySelector("#layout");
			if (layoutClone) layoutClone.classList.remove("with-qa");
		}

		/* 3b) Chat: an empty conversation leaves no trace; waiting turns become static notes */
		var chatClone = clone.querySelector("#chat");
		if (chatClone && !chatClone.querySelector("#chatList .chat-turn")) {
			if (chatClone.parentNode) chatClone.parentNode.removeChild(chatClone);
		} else if (chatClone) {
			var chatEmptyClone = chatClone.querySelector("#chatEmpty");
			if (chatEmptyClone && chatEmptyClone.parentNode) chatEmptyClone.parentNode.removeChild(chatEmptyClone);
			var pendingTurns = chatClone.querySelectorAll(".chat-turn.pending");
			for (var pt = 0; pt < pendingTurns.length; pt++) {
				pendingTurns[pt].classList.remove("pending");
				var waits = pendingTurns[pt].querySelectorAll(".qa-wait");
				for (var wt = 0; wt < waits.length; wt++) waits[wt].textContent = T.chatPendingExport;
			}
		}

		/* 4) Inject the offline runtime (theme/background/font size/line height/copy/back-to-top) */
		var runtime = document.createElement("script");
		runtime.textContent = EXPORT_RUNTIME;
		clone.querySelector("body").appendChild(runtime);

		/* 5) Inline images + wait for mermaid to settle, then serialize into a single-file HTML */
		return Promise.all([waitForMermaid(), inlineImages(clone)]).then(function (r) {
			return { html: "<!doctype html>\\n" + clone.outerHTML, partial: !!r[0] };
		});
	}

	function exportHtml() {
		var btn = document.getElementById("exportBtn");
		if (btn) { btn.disabled = true; btn.classList.add("busy"); }
		toast(T.exportPreparingToast);
		buildExportDocument().then(function (res) {
			var blob = new Blob([res.html], { type: "text/html;charset=utf-8" });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = exportFileName();
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
			toast(res.partial ? T.exportPartialToast : T.exportDoneToast);
		}).catch(function (e) {
			console.warn("[md-preview] export failed:", e);
			toast(T.exportFailToast);
		}).then(function () {
			if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
		});
	}

	var exportBtnEl = document.getElementById("exportBtn");
	if (exportBtnEl) exportBtnEl.addEventListener("click", exportHtml);

	/* ---------- boot ---------- */

	applyLang(lang);
	setScale(scale);
	setLineHeight(lineHeight);
	buildToc(DOC.toc || []);
	enhanceCode(document);
	renderMermaidBlocks(document);
	var bootQa = DOC.qa || [];
	for (var bi = 0; bi < bootQa.length; bi++) {
		// quiet = true: hydrating history on load must not yank the page down to the chat area.
		if (bootQa[bi].chat) addChat(bootQa[bi], true); else addQa(bootQa[bi]);
	}
	onScroll();
})();
`;

function icon(name: string): string {
	const icons: Record<string, string> = {
		logo:
			'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9L20 9.5v9A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M14 4v6h6"/><path d="M8 13.5h6M8 16.5h4"/></svg>',
		system:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7"/></svg>',
		sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>',
		moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>',
		up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
		download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M6.5 10.5 12 16l5.5-5.5"/><path d="M4.5 19.5h15"/></svg>',
		export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9z"/><path d="M13.5 3.5V9H19"/><path d="M12 17v-6"/><path d="M9.5 13.5 12 11l2.5 2.5"/></svg>',
	};
	return icons[name] ?? "";
}

export function renderPage(options: PageOptions): string {
	const { title, subtitle, bodyHtml, toc, docId, updateUrl, closeUrl, themeHint, prefScale, prefLineHeight, prefBg, downloadUrl, prefsUrl, askUrl, chatUrl, mermaidUrl, qa, version } = options;
	const lang = normalizeLang(options.lang);
	const t = STRINGS[lang];
	const docState = JSON.stringify({ docId, toc, updateUrl, closeUrl, prefsUrl, askUrl, chatUrl: chatUrl ?? null, mermaidUrl: mermaidUrl ?? null, qa: qa ?? [], downloadUrl: downloadUrl ?? null, lang, i18n: STRINGS }).replace(/</g, "\\u003c");
	const hintAttr = themeHint ? ` data-theme-hint="${escapeHtml(themeHint)}"` : "";
	const scaleAttr = typeof prefScale === "number" && isFinite(prefScale) ? ` data-pref-scale="${prefScale}"` : "";
	const lineHeightAttr = typeof prefLineHeight === "number" && isFinite(prefLineHeight) ? ` data-pref-line-height="${prefLineHeight}"` : "";
	const bgAttr = prefBg ? ` data-pref-bg="${escapeHtml(prefBg)}"` : "";

	return `<!doctype html>
<html lang="${t.htmlLang}" data-lang-hint="${lang}"${hintAttr}${scaleAttr}${lineHeightAttr}${bgAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} &middot; ${escapeHtml(t.titleSuffix)}</title>
${THEME_BOOT}
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="progress"><div class="progress-bar" id="progressBar"></div></div>

<header class="topbar" id="topbar">
	<div class="topbar-inner">
		<div class="brand">
			<div class="brand-mark">${icon("logo")}</div>
			<div class="brand-text">
				<div class="doc-title" id="docTitle">${escapeHtml(title)}</div>
				<div class="doc-sub">${escapeHtml(subtitle)}</div>
			</div>
		</div>
		<div class="controls">
			<span class="live-pill" id="livePill" title="${escapeHtml(t.liveSyncTitle)}" data-i18n-title="liveSyncTitle"><span class="live-dot"></span><span class="live-text" data-i18n="liveSyncText">${escapeHtml(t.liveSyncText)}</span></span>
			<div class="seg" role="group" aria-label="${escapeHtml(t.groupTheme)}" data-i18n-aria="groupTheme">
				<button type="button" data-theme-set="system" title="${escapeHtml(t.themeSystem)}" aria-label="${escapeHtml(t.themeSystem)}" data-i18n-title="themeSystem" data-i18n-aria="themeSystem">${icon("system")}</button>
				<button type="button" data-theme-set="light" title="${escapeHtml(t.themeLight)}" aria-label="${escapeHtml(t.themeLight)}" data-i18n-title="themeLight" data-i18n-aria="themeLight">${icon("sun")}</button>
				<button type="button" data-theme-set="dark" title="${escapeHtml(t.themeDark)}" aria-label="${escapeHtml(t.themeDark)}" data-i18n-title="themeDark" data-i18n-aria="themeDark">${icon("moon")}</button>
			</div>
			<div class="seg" role="group" aria-label="${escapeHtml(t.groupBg)}" data-i18n-aria="groupBg">
				<button type="button" class="bg-swatch" data-bg-set="white" style="--dot:#ffffff" title="${escapeHtml(t.bgWhite)}" aria-label="${escapeHtml(t.bgWhite)}" data-i18n-title="bgWhite" data-i18n-aria="bgWhite"></button>
				<button type="button" class="bg-swatch" data-bg-set="dim" style="--dot:#f4f2ed" title="${escapeHtml(t.bgDim)}" aria-label="${escapeHtml(t.bgDim)}" data-i18n-title="bgDim" data-i18n-aria="bgDim"></button>
				<button type="button" class="bg-swatch" data-bg-set="wood" style="--dot:#f4ead8" title="${escapeHtml(t.bgWood)}" aria-label="${escapeHtml(t.bgWood)}" data-i18n-title="bgWood" data-i18n-aria="bgWood"></button>
				<button type="button" class="bg-swatch" data-bg-set="cyan" style="--dot:#e3edec" title="${escapeHtml(t.bgCyan)}" aria-label="${escapeHtml(t.bgCyan)}" data-i18n-title="bgCyan" data-i18n-aria="bgCyan"></button>
			</div>
			<div class="seg" role="group" aria-label="${escapeHtml(t.groupFont)}" data-i18n-aria="groupFont">
				<button type="button" id="fontMinus" title="${escapeHtml(t.fontMinusLabel)}" aria-label="${escapeHtml(t.fontMinusLabel)}" data-i18n-title="fontMinusLabel" data-i18n-aria="fontMinusLabel">A&minus;</button>
				<span id="fontValue">100%</span>
				<button type="button" id="fontPlus" title="${escapeHtml(t.fontPlusLabel)}" aria-label="${escapeHtml(t.fontPlusLabel)}" data-i18n-title="fontPlusLabel" data-i18n-aria="fontPlusLabel">A+</button>
			</div>
			<div class="seg" role="group" aria-label="${escapeHtml(t.groupLine)}" data-i18n-aria="groupLine">
				<button type="button" id="lineHeightMinus" title="${escapeHtml(t.lineMinusLabel)}" aria-label="${escapeHtml(t.lineMinusLabel)}" data-i18n-title="lineMinusLabel" data-i18n-aria="lineMinusLabel">&minus;</button>
				<span id="lineHeightValue">1.75</span>
				<button type="button" id="lineHeightPlus" title="${escapeHtml(t.linePlusLabel)}" aria-label="${escapeHtml(t.linePlusLabel)}" data-i18n-title="linePlusLabel" data-i18n-aria="linePlusLabel">+</button>
			</div>
			<div class="seg" role="group" aria-label="${escapeHtml(t.groupDoc)}" data-i18n-aria="groupDoc">
				<a class="dl-btn" id="downloadBtn" href="${escapeHtml(downloadUrl ?? "#")}" download title="${escapeHtml(t.downloadTitle)}" aria-label="${escapeHtml(t.downloadLabel)}" data-i18n-title="downloadTitle" data-i18n-aria="downloadLabel">${icon("download")}</a>
				<button type="button" class="dl-btn" id="exportBtn" title="${escapeHtml(t.exportTitle)}" aria-label="${escapeHtml(t.exportLabel)}" data-i18n-title="exportTitle" data-i18n-aria="exportLabel">${icon("export")}</button>
			</div>
			<div class="seg" id="langSeg" role="group" aria-label="${escapeHtml(t.groupLang)}" data-i18n-aria="groupLang">
				<button type="button" data-lang-set="en" title="${escapeHtml(t.langEn)}" aria-label="${escapeHtml(t.langEn)}" data-i18n-title="langEn" data-i18n-aria="langEn">${escapeHtml(t.langEn)}</button>
				<button type="button" data-lang-set="zh" title="${escapeHtml(t.langZh)}" aria-label="${escapeHtml(t.langZh)}" data-i18n-title="langZh" data-i18n-aria="langZh">${escapeHtml(t.langZh)}</button>
			</div>
		</div>
	</div>
</header>

<div class="layout" id="layout">
	<div class="qa-rail" id="qaRail" aria-label="${escapeHtml(t.qaRailLabel)}" data-i18n-aria="qaRailLabel"></div>
	<main class="article">
		<div class="content" id="content">
${bodyHtml}
		</div>
		${chatUrl ? `<section class="chat" id="chat" aria-label="${escapeHtml(t.chatTitle)}" data-i18n-aria="chatTitle">
			<div class="chat-head"><span class="chat-title" data-i18n="chatTitle">${escapeHtml(t.chatTitle)}</span></div>
			<div class="chat-input" id="chatInput">
				<textarea id="chatText" rows="3" maxlength="2000" placeholder="${escapeHtml(t.chatPlaceholder)}" data-i18n-placeholder="chatPlaceholder"></textarea>
				<button type="button" id="chatSend" class="primary" data-i18n="chatSend">${escapeHtml(t.chatSend)}</button>
			</div>
			<div class="chat-list" id="chatList" role="log" aria-live="polite" aria-label="${escapeHtml(t.chatLogLabel)}" data-i18n-aria="chatLogLabel">
				<div class="chat-empty" id="chatEmpty" data-i18n="chatEmpty">${escapeHtml(t.chatEmpty)}</div>
			</div>
		</section>` : ""}
		<footer class="doc-foot">
			<span>pi &middot; md-preview</span>
			<span>&middot;</span>
			${version ? `<span><span data-i18n="versionPrefix">${escapeHtml(t.versionPrefix)}</span>${escapeHtml(version)}</span><span>&middot;</span>` : ""}
			<span data-i18n="footerNote">${escapeHtml(t.footerNote)}</span>
		</footer>
	</main>
	<aside class="toc" id="toc">
		<div class="toc-title" data-i18n="tocTitle">${escapeHtml(t.tocTitle)}</div>
		<nav id="tocNav"></nav>
	</aside>
</div>

<button type="button" class="qa-sel-btn" id="qaSelBtn" hidden data-i18n="qaSelBtn">${escapeHtml(t.qaSelBtn)}</button>
<div class="qa-panel" id="askPanel" hidden>
	<div class="qa-panel-quote" id="qaPanelQuote"></div>
	<textarea id="qaPanelInput" rows="3" placeholder="${escapeHtml(t.qaPanelPlaceholder)}" data-i18n-placeholder="qaPanelPlaceholder"></textarea>
	<div class="qa-panel-actions">
		<button type="button" id="qaPanelSend" class="primary" data-i18n="qaSend">${escapeHtml(t.qaSend)}</button>
		<button type="button" id="qaPanelCancel" data-i18n="qaCancel">${escapeHtml(t.qaCancel)}</button>
	</div>
</div>

<button class="to-top" id="toTop" type="button" aria-label="${escapeHtml(t.toTop)}" title="${escapeHtml(t.toTop)}" data-i18n-title="toTop" data-i18n-aria="toTop">${icon("up")}</button>
<div class="toast" id="toast" role="status"></div>

<div class="qa-modal" id="qaModal">
	<div class="qa-modal-card" role="dialog" aria-modal="true" aria-labelledby="qaModalTitle">
		<div class="qa-modal-head">
			<span class="qa-modal-title" id="qaModalTitle" data-i18n="qaFullTitle">${escapeHtml(t.qaFullTitle)}</span>
			<button type="button" class="qa-modal-close" id="qaModalClose" aria-label="${escapeHtml(t.qaClose)}" title="${escapeHtml(t.qaClose)}" data-i18n-title="qaClose" data-i18n-aria="qaClose">&times;</button>
		</div>
		<div class="qa-modal-quote" id="qaModalQuote"></div>
		<div class="qa-modal-body" id="qaModalBody"></div>
	</div>
</div>

<script>window.__MDP__ = ${docState};</script>
<script>${PAGE_JS}</script>
</body>
</html>`;
}
