#!/usr/bin/env node
/**
 * L1 checks for the page-i18n module (module B).
 *
 * Pure Node, no test framework and no third-party dependencies. The extension
 * is compiled with tsconfig.demo.json (CommonJS under .demo/build) like
 * scripts/demo.mjs does, then these are asserted:
 *
 *   1. en/zh key-set alignment in STRINGS (a runtime duplicate of the type check);
 *   2. copy safety: no "<", no "</script>" and no backtick in any string value;
 *   3. static hardening of the EXPORT_JS template inside page.ts, plus the
 *      language-freeze wiring of the export flow;
 *   4. renderPage output for en / zh / normalization, the i18n anchors, the
 *      bilingual window.__MDP__ bundle and inline-script parseability.
 *
 * Usage: node scripts/page-i18n-check.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (ok, message) => {
	if (!ok) failures.push(message);
};
const HAN = /[\u4e00-\u9fff]/;

/* 1. Compile the host-independent modules (page.ts imports page-i18n.ts). */
execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.demo.json"], {
	cwd: root,
	stdio: "inherit",
});
const buildDir = join(root, ".demo", "build");
writeFileSync(join(buildDir, "package.json"), '{"type":"commonjs"}\n', "utf8");

const require = createRequire(import.meta.url);
const { STRINGS, normalizeLang } = require(join(buildDir, "page-i18n.js"));
const { renderPage } = require(join(buildDir, "page.js"));

/* 2. Key alignment + copy safety. */
const enKeys = Object.keys(STRINGS.en).sort();
const zhKeys = Object.keys(STRINGS.zh).sort();
check(enKeys.length > 0 && zhKeys.length > 0, "STRINGS.en / STRINGS.zh must not be empty");
check(
	enKeys.join("\n") === zhKeys.join("\n"),
	"en/zh key sets differ: en-only=[" +
		enKeys.filter((k) => !zhKeys.includes(k)) +
		"] zh-only=[" +
		zhKeys.filter((k) => !enKeys.includes(k)) +
		"]",
);
for (const lang of ["en", "zh"]) {
	for (const [key, value] of Object.entries(STRINGS[lang])) {
		if (typeof value !== "string") {
			failures.push("STRINGS." + lang + "." + key + " is not a string");
			continue;
		}
		if (value.includes("<")) failures.push("STRINGS." + lang + "." + key + ' contains "<"');
		if (value.includes("</script>")) failures.push("STRINGS." + lang + "." + key + ' contains "</script>"');
		if (value.includes("`")) failures.push("STRINGS." + lang + "." + key + " contains a backtick");
	}
}
check(STRINGS.en.locale === "en-US", "STRINGS.en.locale must be en-US");
check(STRINGS.zh.locale === "zh-CN", "STRINGS.zh.locale must be zh-CN");
check(STRINGS.zh.htmlLang === "zh-CN", "STRINGS.zh.htmlLang must be zh-CN");
check(HAN.test(STRINGS.zh.titleSuffix), "STRINGS.zh does not look localized");
check(normalizeLang("zh") === "zh", 'normalizeLang("zh") must be "zh"');
check(normalizeLang("zh-CN") === "zh", 'normalizeLang("zh-CN") must be "zh"');
check(normalizeLang("en") === "en", 'normalizeLang("en") must be "en"');
check(normalizeLang("fr") === "en", 'normalizeLang("fr") must fall back to "en"');
check(normalizeLang(undefined) === "en", 'normalizeLang(undefined) must fall back to "en"');

/* 3. Static hardening of page.ts. */
const pageSrc = readFileSync(join(root, "extensions", "md-preview", "page.ts"), "utf8");
const exportMatch = pageSrc.match(/const EXPORT_JS = `([\s\S]*?)`;/);
if (!exportMatch) {
	failures.push("could not extract the EXPORT_JS template from page.ts");
} else {
	const body = exportMatch[1];
	check(!body.includes("`"), "EXPORT_JS body contains a backtick");
	check(!body.includes("${"), "EXPORT_JS body contains ${");
	check(!body.includes("</script>"), "EXPORT_JS body contains </script>");
	check(!HAN.test(body), "EXPORT_JS still contains Chinese literals");
	check(body.includes('getAttribute("data-export-i18n")'), "EXPORT_JS does not read the frozen data-export-i18n copy");
}
check(!HAN.test(pageSrc), "page.ts still contains Chinese characters");

/* 3b. Every i18n key referenced from PAGE_JS or from a data-i18n anchor must exist in
   both bundles. PAGE_JS is a plain string, so tsc cannot catch a typo like T.revDoneToast. */
const PAGE_JS_SRC = (pageSrc.match(/const PAGE_JS = `([\s\S]*?)`;/) || [null, ""])[1];
check(PAGE_JS_SRC.length > 0, "could not extract the PAGE_JS template from page.ts");
const keySet = new Set(enKeys);
const tRefs = new Set();
for (const m of PAGE_JS_SRC.matchAll(/\bT\.([A-Za-z_$][\w$]*)/g)) tRefs.add(m[1]);
const missingT = Array.from(tRefs).filter((k) => !keySet.has(k));
check(tRefs.size > 0, "PAGE_JS does not reference any T.<key>");
check(missingT.length === 0, "PAGE_JS references i18n keys missing from both bundles: " + missingT.join(", "));
const anchorKeys = new Set();
for (const m of pageSrc.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([A-Za-z][\w]*)"/g)) anchorKeys.add(m[1]);
const missingAnchors = Array.from(anchorKeys).filter((k) => !keySet.has(k));
check(anchorKeys.size > 0, "renderPage emits no data-i18n anchors");
check(missingAnchors.length === 0, "data-i18n anchors reference missing keys: " + missingAnchors.join(", "));
check(!/T\.(?:revDoneToast|resDoneToast)\b/.test(PAGE_JS_SRC), "PAGE_JS still references a removed revise-toast key");
check(pageSrc.includes('clone.setAttribute("data-export-i18n", JSON.stringify(T))'), "buildExportDocument does not freeze data-export-i18n");
const CLONE_STRIP = ["exportBtn", "downloadBtn", "qaSelBtn", "revSelBtn", "qaSelBar", "askPanel", "langSeg", "qaModal", "queueGroup", "revToast"];
check(
	pageSrc.includes(
		'removeInClone(clone, ["exportBtn", "downloadBtn", "qaSelBtn", "revSelBtn", "qaSelBar", "askPanel", "langSeg", "qaModal", "queueGroup", "revToast"])',
	),
	"export does not strip every UI-only node via the pinned removeInClone list",
);
const cloneStripCall = pageSrc.match(/removeInClone\(clone, \[([^\]]*)\]\)/);
const strippedIds = cloneStripCall ? Array.from(cloneStripCall[1].matchAll(/"([^"]+)"/g), (m) => m[1]) : [];
for (const id of CLONE_STRIP) {
	check(strippedIds.includes(id), "export does not strip #" + id);
}
check(pageSrc.includes('if (d.lang === "en" || d.lang === "zh")'), "PAGE_JS does not consume the SSE lang field");
check(pageSrc.includes('if (chosen !== "en" && chosen !== "zh") applyLang(d.lang);'), "SSE lang must not override a localStorage choice");
check(pageSrc.includes("localStorage.setItem(\"mdp.lang\", v)"), "language switch does not remember mdp.lang");

/* 4. renderPage assertions. */
const base = {
	docId: "doc-1",
	title: "Sample",
	subtitle: "sample.md",
	bodyHtml: "<p>body</p>",
	toc: [],
	updateUrl: "/__md_preview/updates",
	closeUrl: "/__md_preview/close",
	version: "2026-01-01 · abc1234",
};
const en = renderPage({ ...base, lang: undefined });
const zh = renderPage({ ...base, lang: "zh" });
const zhCN = renderPage({ ...base, lang: "zh-CN" });
const fr = renderPage({ ...base, lang: "fr" });

check(en.includes('<html lang="en" data-lang-hint="en"'), 'default render must use <html lang="en" data-lang-hint="en"');
check(zh.includes('<html lang="zh-CN" data-lang-hint="zh"'), 'zh render must use <html lang="zh-CN" data-lang-hint="zh"');
check(en.includes('title="Follow system"'), 'en render must contain title="Follow system"');
check(zh.includes('title="跟随系统"'), 'zh render must contain title="跟随系统"');
check(en.includes(">Contents<"), "en render must contain Contents");
check(zh.includes(">目录<"), "zh render must contain 目录");
check(en.includes(">Version "), "en render must contain the Version prefix");
check(zh.includes(">版本 "), "zh render must contain the 版本 prefix");
check(zhCN.includes('<html lang="zh-CN" data-lang-hint="zh"'), 'lang "zh-CN" must normalize to zh');
check(fr.includes('<html lang="en" data-lang-hint="en"'), 'unknown lang "fr" must fall back to en');

for (const [label, html] of [
	["en", en],
	["zh", zh],
]) {
	check(html.includes('data-i18n="footerNote"'), label + ' render must contain data-i18n="footerNote"');
	check(html.includes('data-i18n="tocTitle"'), label + ' render must contain data-i18n="tocTitle"');
	check(html.includes('data-i18n-placeholder="qaPanelPlaceholder"'), label + " render must contain the localized placeholder anchor");
	check(html.includes('data-i18n-title="liveSyncTitle"'), label + " render must contain the live-pill title anchor");
	check(html.includes('data-lang-set="zh"'), label + " render must contain the zh language switch button");
	check(html.includes('id="langSeg"'), label + " render must contain the language switch group");
}

function parseDocState(html) {
	const m = html.match(/<script>window\.__MDP__ = ([\s\S]*?);<\/script>/);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch (e) {
		failures.push("window.__MDP__ is not valid JSON: " + e.message);
		return null;
	}
}
const enState = parseDocState(en);
const zhState = parseDocState(zh);
check(!!enState && enState.lang === "en", "en render must negotiate lang: en in window.__MDP__");
check(!!zhState && zhState.lang === "zh", "zh render must negotiate lang: zh in window.__MDP__");
check(!!(enState && enState.i18n && enState.i18n.en && enState.i18n.zh), "docState.i18n must carry the full bilingual bundle");
check(
	!!(enState && enState.i18n && enState.i18n.en.titleSuffix === "Markdown Preview" && enState.i18n.zh.titleSuffix === "Markdown 预览"),
	"docState.i18n bundle values are wrong",
);
check(en.includes("Offline export") && en.includes("离线导出"), "window.__MDP__ must embed both en and zh copy (demo.mjs relies on the zh badge text)");

const scripts = [...en.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check(scripts.length >= 3, "expected at least 3 inline scripts, found " + scripts.length);
for (let i = 0; i < scripts.length; i++) {
	try {
		new Script(scripts[i]);
	} catch (e) {
		failures.push("inline script #" + (i + 1) + " does not parse: " + e.message);
	}
}

/* 5. Chat area (module B): conditional render + export stripping + routing. */
const enChat = renderPage({ ...base, chatUrl: "/doc/doc-1/chat", lang: undefined });
const zhChat = renderPage({ ...base, chatUrl: "/doc/doc-1/chat", lang: "zh" });
for (const [label, html] of [
	["en", enChat],
	["zh", zhChat],
]) {
	check(html.includes('id="chatList"'), label + " chat render must contain chatList");
	check(html.includes('data-i18n="chatTitle"'), label + " chat render must contain the chat title anchor");
	check(html.includes('data-i18n-placeholder="chatPlaceholder"'), label + " chat render must contain the chat placeholder anchor");
	check(html.includes('id="chatSend"'), label + " chat render must contain the chat send button");
}
check(!en.includes('id="chatInput"'), "render without chatUrl must not contain the chat area");
check(pageSrc.includes('removeInClone(clone, ["chatInput"])'), "export does not strip the chat input area");
check(pageSrc.includes("if (qa.chat) { addChat(qa); return; }"), "ask SSE does not route chat entries to the chat area");
check(pageSrc.includes("chatState[d.id]"), "answer SSE does not route chat replies");

/* 5b. Content-level i18n anchors: admonition titles need labels in both bundles. */
const { renderMarkdown } = require(join(buildDir, "render.js"));
for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
	const key = "admonition" + kind.charAt(0) + kind.slice(1).toLowerCase();
	const probe = renderMarkdown("> [!" + kind + "]\n> body\n");
	check(probe.html.includes('data-i18n="' + key + '"'), "render.ts admonition " + kind + ' must emit data-i18n="' + key + '"');
	check(
		typeof STRINGS.en[key] === "string" && typeof STRINGS.zh[key] === "string",
		"STRINGS.en/zh." + key + " is missing",
	);
}
check(
	/content\.innerHTML = d\.html;[\s\S]{0,400}applyStaticStrings\(\);/.test(pageSrc),
	"content updates must re-apply static i18n strings (admonition titles)",
);

/* 5c. Batch ask/revise queue (module C): the stashed queues, the toolbar and the revise wash. */
for (const id of [
	"queueGroup",
	"askQueueBtn",
	"revQueueBtn",
	"askQueueBadge",
	"revQueueBadge",
	"askQueueLabel",
	"revQueueLabel",
	"qaSelBar",
	"qaSelBtn",
	"revSelBtn",
	"revToast",
]) {
	check(en.includes('id="' + id + '"'), "render is missing #" + id);
}
for (const [label, html] of [
	["en", en],
	["zh", zh],
]) {
	check(html.includes('id="qaSelBar"'), label + " render must wrap both selection actions in one toolbar");
	check(html.includes('data-i18n="queueAskBtn"'), label + " render must localize the queue label dynamically");
	check(/id="queueGroup"[^>]*hidden/.test(html), label + " render must start with the queue group hidden");
	check(html.includes('aria-live="polite" id="revToast"') || html.includes('id="revToast" role="status" aria-live="polite"'), label + " render must expose revToast as a live region");
}
// The selection toolbar must exist for ask OR revise, never only for ask.
check(pageSrc.includes('var canAsk = !!(askUrl || askBatchUrl);') && pageSrc.includes("var canRev = !!reviseUrl;"), "canAsk/canRev no longer cover both batch endpoints");
check(pageSrc.includes("if (canAsk || canRev) {") && pageSrc.includes("if (!canAsk && !canRev) { selBar.hidden = true; return; }"), "the selection toolbar must install for ask OR revise");
check(pageSrc.includes('var REV_HOLD = 2200;') && pageSrc.includes('var REV_WINDOW = 3000;'), "revision flash timing constants changed");
// Regression pin (round 3): a paragraph whose one sentence the agent rewrote lost its wash
// because the whole quote and its 80/48/24 prefixes all missed. Clauses still match.
check(/function locClauses\(quote\)/.test(pageSrc), "locateBlocks has no clause fallback: an edited sentence loses its wash");
check(/split\(\/\[[^\]]*、：:/.test(pageSrc), "the clause splitter lost its punctuation set");
check(/、：:[\\]{2}n\]/.test(pageSrc), "the splitter must escape its newline: a raw newline breaks the regex literal in the page");
check(/if \(needle\.length >= LOC_MIN\) out\.push\(needle\)/.test(pageSrc), "clauses shorter than LOC_MIN must not become needles");
check(/out\.sort\(function \(a, b\) \{ return b\.length - a\.length; \}\)/.test(pageSrc), "clauses must be tried longest first");
const locateBody = (pageSrc.match(/function locateBlocks\(idx, quote\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(locateBody.length > 0, "could not extract the locateBlocks body from page.ts");
check(/locClauses\(quote\)/.test(locateBody), "locateBlocks never consults the clauses");
check(/locRange\(idx, clauses\[c\]\)/.test(locateBody), "locateBlocks does not retry the clauses through locRange");
check(/seen\.indexOf\(block\)/.test(locateBody), "locateBlocks does not dedupe clause hits");
check(/out\.length < cap/.test(locateBody) && /var cap = REV_MAX_BLOCKS \|\| 40;/.test(locateBody), "clause hits are not capped by REV_MAX_BLOCKS (with a hoisting-proof fallback)");
check(pageSrc.includes('"revision-done"'), "PAGE_JS does not handle the revision-done SSE event");
check(/flashRevision\(\);[\s\S]{0,600}?restoreQaHighlights\(\);|restoreQaHighlights\(\);[\s\S]{0,600}?flashRevision\(\);/.test(pageSrc), "content updates must replay the revision wash after re-rendering");
check(/qdropItems\(kind, source\.slice\(0, take\)\)/.test(pageSrc), "a successful batch send must drop the sent snapshot, not the server ids");
// Regression pin (round 3): server ids never match the local queue, so dropping by them
// silently leaves the badge and localStorage full forever.
check(/function qdropItems\(kind, items\)/.test(pageSrc), "qdropItems is missing: the queue cannot be cleared by snapshot");
check(/ids\.indexOf\(QS\[kind\]\[j\]\.id\) < 0/.test(pageSrc), "qdropItems must match on the local id (a qsave re-materializes the objects)");
check(!/qdrop\(kind,/.test(pageSrc), "sendQueue must not drop by the ids the server returns");
check(/var take = accepted \? Math\.min\(accepted\.length, source\.length\) : source\.length;/.test(pageSrc), "the accepted prefix must be clamped to the sent snapshot length");
check(pageSrc.includes('{ quote: source[i].quote, question: source[i].text }'), "ask-batch payload shape changed");
check(pageSrc.includes('{ quote: source[i].quote, comment: source[i].text }'), "revise payload shape changed");
// Cap drift (round 4): the page sends the whole queue as one batch, so QCAP must track the
// server's MAX_BATCH_ITEMS. A larger page cap deadlocks the queue at 21+ items.
const serverSrc = readFileSync(join(root, "extensions", "md-preview", "server.ts"), "utf8");
const batchCap = Number((serverSrc.match(/export const MAX_BATCH_ITEMS = (\d+);/) || [null, ""])[1]);
const pageCap = Number((pageSrc.match(/var QCAP = (\d+);/) || [null, ""])[1]);
check(Number.isFinite(batchCap) && batchCap > 0, "could not read MAX_BATCH_ITEMS from server.ts");
check(pageCap === batchCap, "QCAP (" + pageCap + ") must equal server.ts MAX_BATCH_ITEMS (" + batchCap + ")");
check(/if \(qcount\(kind\) >= QCAP\) \{ toast\(T\.queueFull\); return false; \}/.test(pageSrc), "qpush must reject an over-cap item and keep the panel open");
for (const lang of ["en", "zh"]) {
	check(String(STRINGS[lang].queueFull).indexOf(String(batchCap)) >= 0, "STRINGS." + lang + ".queueFull must state the real batch cap (" + batchCap + ")");
}
// Stashing must close the panel, but only after the draft really entered the queue.
const stashClick = (pageSrc.match(/if \(panelStash\) panelStash\.addEventListener\("click", ([^\n]*)\);/ ) || [null, ""])[1];
check(stashClick.length > 0, "#qaPanelStash lost its click listener");
check(/stashPanel\(/.test(stashClick), "#qaPanelStash no longer stashes the draft");
check(/closePanel\(true\)/.test(stashClick), "#qaPanelStash does not close the panel: the next selection inherits the old quote");
check(/if \(stashPanel\(false\)\)/.test(stashClick), "#qaPanelStash must keep the panel open when the stash fails (empty draft)");
// Cancel and Escape only close; send is stash + close + flush.
check(/cancelBtn\.addEventListener\("click", function \(\) \{ closePanel\(true\); \}\)/.test(pageSrc), "the cancel button must close without queueing");
const escHandler = (pageSrc.match(/if \(e\.key === "Escape" && askPanel && !askPanel\.hidden\) ([^\n]*);/) || [null, ""])[1];
check(escHandler.length > 0, "Escape no longer closes the panel");
check(/closePanel\(true\)/.test(escHandler) && !/stashPanel/.test(escHandler), "Escape must close the panel without stashing");
const submitPanelBody = (pageSrc.match(/function submitPanel\(\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(submitPanelBody.length > 0, "could not extract the submitPanel body from page.ts");
check(/stashPanel\(true\)/.test(submitPanelBody) && /closePanel\(true\)/.test(submitPanelBody), "send must stash then close the panel");
check(/sendQueue\("rev"\)/.test(submitPanelBody) && /sendQueue\("ask"\)/.test(submitPanelBody), "send must flush the matching queue");
check(/bindEnterSend\(panelInput, submitPanel\)/.test(pageSrc), "Enter must still go through submitPanel (stash + send + close)");
check(/bindEnterSend\(chatText, sendChat\)/.test(pageSrc), "Enter in the global chat must still send");
// IME safety: Enter that confirms a candidate must never submit. Chromium reports
// isComposing/keyCode 229; Safari fires Enter right after compositionend.
const enterBody = (pageSrc.match(/function bindEnterSend\(el, send\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(enterBody.length > 0, "could not extract the bindEnterSend body from page.ts");
check(/if \(e\.key !== "Enter" \|\| e\.shiftKey\) return;/.test(enterBody), "bindEnterSend must only act on a plain Enter");
check(/composing \|\| e\.isComposing \|\| e\.keyCode === 229/.test(enterBody), "Enter during IME composition must not submit");
check(/compositionstart/.test(enterBody) && /compositionend/.test(enterBody), "bindEnterSend must track the composition lifecycle");
check(/setTimeout\(function \(\) \{ composing = false; \}, 0\)/.test(enterBody), "Safari's trailing Enter after compositionend must be swallowed");

/* 5d. Regression pins for defects found in review round 1. Each one fails on the old code. */
// (a) Both queue buttons must actually flush their queue.
check(pageSrc.includes('askQueueBtn.addEventListener("click"'), "#askQueueBtn has no click handler: the ask queue can never be sent");
check(pageSrc.includes('revQueueBtn.addEventListener("click"'), "#revQueueBtn has no click handler: the revise queue can never be sent");
check(/askQueueBtn\.addEventListener\("click", function \(\) \{ sendQueue\("ask"\); \}\)/.test(pageSrc), "#askQueueBtn does not call sendQueue('ask')");
check(/revQueueBtn\.addEventListener\("click", function \(\) \{ sendQueue\("rev"\); \}\)/.test(pageSrc), "#revQueueBtn does not call sendQueue('rev')");
// (b) init/update frames must adopt d.revision (the revision-done frame may arrive first).
const applyUpdateBody = (pageSrc.match(/function applyUpdate\(d, quiet\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(applyUpdateBody.length > 0, "could not extract the applyUpdate body from page.ts");
check(/d\.revision/.test(applyUpdateBody), "applyUpdate ignores d.revision: an update that lands after revision-done never re-locates the flash");
check(/applyRevision\(/.test(applyUpdateBody), "applyUpdate does not replay d.revision through applyRevision");
// (c) A 200 with ok:false is a rejection, not a success.
const sendQueueBody = (pageSrc.match(/function sendQueue\(kind\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(sendQueueBody.length > 0, "could not extract the sendQueue body from page.ts");
check(/data\.ok === false/.test(sendQueueBody), "sendQueue treats an {ok:false} response as success");
check(/qdropItems\(kind, source\.slice\(0, take\)\)/.test(sendQueueBody), "sendQueue drops the whole queue instead of the accepted prefix");
check(/Math\.min\(accepted\.length, source\.length\)/.test(sendQueueBody), "sendQueue does not clamp the accepted prefix to the snapshot");
// (d) Empty drafts never enter the queue, and closing the panel ends the selection.
check(/if \(!quote\.trim\(\) \|\| !text\.trim\(\)\) continue;/.test(pageSrc), "qstrip keeps entries with an empty quote or comment");
const closePanelBody = (pageSrc.match(/function closePanel\(refocus\) \{([\s\S]*?)\n\t\}/) || [null, ""])[1];
check(/removeAllRanges\(\)/.test(closePanelBody) && /pendingRange = null;/.test(closePanelBody), "closePanel does not clear the selection and pendingRange");
// (e) The revise copy promises the document, not just the marks.
check(STRINGS.en.reviseDone.indexOf("document has been updated") >= 0, "STRINGS.en.reviseDone text was not updated");
check(STRINGS.zh.reviseDone.indexOf("文档已更新") >= 0, "STRINGS.zh.reviseDone text was not updated");

/* Report. */
if (failures.length) {
	console.error("\npage-i18n-check: " + failures.length + " failure(s)");
	for (const message of failures) console.error("  - " + message);
	process.exit(1);
}
console.log("page-i18n-check: all assertions passed (" + enKeys.length + " keys x 2 languages)");
