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
	/** User-level persisted font scale (0.7–1.6), served from the prefs file; null/undefined = 未设置。 */
	prefScale?: number | null;
	/** POST endpoint that persists theme/scale changes into the user-level prefs file. */
	prefsUrl?: string;
}

const THEME_BOOT = `<script>
(function () {
	var d = document.documentElement;
	var t = null, s = null;
	try { t = localStorage.getItem("mdp.theme"); s = localStorage.getItem("mdp.scale"); } catch (e) {}
	// 主题优先级：本机 localStorage（同端口内最近一次操作）> hint——服务端渲染
	// 时已把用户级偏好文件合并进 hint（用户偏好 > MD_PREVIEW_THEME 环境变量），
	// 再往下回退跟随系统。
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
})();
</script>`;

const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
	--font-scale: 1;
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
	--code-bg: #f5f6f9;
	--code-head: #eef0f4;
	--inline-code-bg: #f0f2f6;
	--mark-bg: rgba(255, 214, 102, 0.45);
	--quote-bg: #f6f7fa;
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
	--code-bg: #11161e;
	--code-head: #171e28;
	--inline-code-bg: #1a2129;
	--mark-bg: rgba(255, 214, 102, 0.25);
	--quote-bg: #131922;
	--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
	--shadow-2: 0 8px 28px rgba(0, 0, 0, 0.45);
	--topbar-bg: rgba(14, 17, 22, 0.82);
}

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-family: var(--font-sans);
	font-size: calc(16px * var(--font-scale));
	line-height: 1.75;
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

/* ---------- responsive ---------- */

@media (max-width: 1080px) {
	.layout { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 28px; }
	.toc { display: none; }
	.article { max-width: 100%; }
}
@media (max-width: 720px) {
	.topbar-inner { padding: 0 14px; gap: 10px; }
	.layout { padding: 20px 16px 96px; }
	.brand-mark { display: none; }
	.doc-sub { display: none; }
	.content h1 { font-size: 1.72em; }
	.heading-anchor { display: none; }
	.to-top { right: 16px; bottom: 16px; }
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
	.progress, .topbar, .toc, .to-top, .toast, .copy-btn, .heading-anchor { display: none !important; }
	body { background: #fff; color: #000; }
	.layout { display: block; padding: 0; }
	.code-block { break-inside: avoid; }
}
`;

const PAGE_JS = `
(function () {
	"use strict";
	var DOC = window.__MDP__ || {};
	var root = document.documentElement;
	var motionOK = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

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
				window.fetch(prefsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
			} else if (navigator.sendBeacon) {
				navigator.sendBeacon(prefsUrl, new Blob([body], { type: "application/json" }));
			}
		} catch (e) { /* 偏好持久化是尽力而为，不阻塞交互 */ }
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
	}
	document.getElementById("fontMinus").addEventListener("click", function () { setScale(scale - 0.1); });
	document.getElementById("fontPlus").addEventListener("click", function () { setScale(scale + 0.1); });
	fontValue.addEventListener("click", function () { setScale(1); });
	fontValue.style.cursor = "pointer";
	fontValue.title = "点击恢复默认";
	setScale(scale);

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
				btn.textContent = "复制";
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
			btn.textContent = "已复制";
			btn.classList.add("done");
			toast("代码已复制到剪贴板");
			setTimeout(function () { btn.textContent = "复制"; btn.classList.remove("done"); }, 1600);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () { toast("复制失败"); });
		} else {
			var ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); done(); } catch (err) { toast("复制失败"); }
			document.body.removeChild(ta);
		}
	}

	/* ---------- live updates ---------- */

	var livePill = document.getElementById("livePill");
	function setLive(state) {
		if (state === "live") {
			livePill.classList.remove("down");
			livePill.title = "文件修改后页面会自动更新";
			livePill.querySelector(".live-text").textContent = "实时同步";
		} else {
			livePill.classList.add("down");
			livePill.title = "与预览服务的连接已断开";
			livePill.querySelector(".live-text").textContent = "连接断开";
		}
	}

	function applyUpdate(d, quiet) {
		var content = document.getElementById("content");
		content.innerHTML = d.html;
		if (d.title) {
			document.title = d.title + " \\u00b7 Markdown Preview";
			document.getElementById("docTitle").textContent = d.title;
		}
		buildToc(d.toc || []);
		enhanceCode(content);
		onScroll();
		if (!quiet) toast("文档已更新");
	}

	if (DOC.updateUrl && window.EventSource) {
		var es = new EventSource(DOC.updateUrl);
		es.onopen = function () { setLive("live"); };
		es.onerror = function () { setLive("down"); };
		es.addEventListener("update", function (e) {
			try { applyUpdate(JSON.parse(e.data)); } catch (err) { /* ignore malformed frames */ }
		});
		es.addEventListener("init", function (e) {
			try { applyUpdate(JSON.parse(e.data), true); } catch (err) { /* ignore malformed frames */ }
		});
		es.addEventListener("closing", function () {
			setLive("down");
			toast("预览服务已退出");
		});
	}

	if (DOC.closeUrl && navigator.sendBeacon) {
		window.addEventListener("pagehide", function () {
			navigator.sendBeacon(DOC.closeUrl);
		});
	}

	/* ---------- boot ---------- */

	buildToc(DOC.toc || []);
	enhanceCode(document);
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
	};
	return icons[name] ?? "";
}

export function renderPage(options: PageOptions): string {
	const { title, subtitle, bodyHtml, toc, docId, updateUrl, closeUrl, themeHint, prefScale, prefsUrl } = options;
	const docState = JSON.stringify({ docId, toc, updateUrl, closeUrl, prefsUrl }).replace(/</g, "\\u003c");
	const hintAttr = themeHint ? ` data-theme-hint="${escapeHtml(themeHint)}"` : "";
	const scaleAttr = typeof prefScale === "number" && isFinite(prefScale) ? ` data-pref-scale="${prefScale}"` : "";

	return `<!doctype html>
<html lang="zh-CN"${hintAttr}${scaleAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} &middot; Markdown Preview</title>
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
			<span class="live-pill" id="livePill" title="实时同步"><span class="live-dot"></span><span class="live-text">实时同步</span></span>
			<div class="seg" role="group" aria-label="主题">
				<button type="button" data-theme-set="system" title="跟随系统" aria-label="跟随系统">${icon("system")}</button>
				<button type="button" data-theme-set="light" title="浅色模式" aria-label="浅色模式">${icon("sun")}</button>
				<button type="button" data-theme-set="dark" title="深色模式" aria-label="深色模式">${icon("moon")}</button>
			</div>
			<div class="seg" role="group" aria-label="字号">
				<button type="button" id="fontMinus" title="减小字号" aria-label="减小字号">A&minus;</button>
				<span id="fontValue">100%</span>
				<button type="button" id="fontPlus" title="增大字号" aria-label="增大字号">A+</button>
			</div>
		</div>
	</div>
</header>

<div class="layout">
	<main class="article">
		<div class="content" id="content">
${bodyHtml}
		</div>
		<footer class="doc-foot">
			<span>pi &middot; md-preview</span>
			<span>&middot;</span>
			<span>内容实时渲染自源文件，关闭本页面后预览服务自动退出</span>
		</footer>
	</main>
	<aside class="toc" id="toc">
		<div class="toc-title">目录</div>
		<nav id="tocNav"></nav>
	</aside>
</div>

<button class="to-top" id="toTop" type="button" aria-label="回到顶部" title="回到顶部">${icon("up")}</button>
<div class="toast" id="toast" role="status"></div>

<script>window.__MDP__ = ${docState};</script>
<script>${PAGE_JS}</script>
</body>
</html>`;
}
