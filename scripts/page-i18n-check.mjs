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
check(pageSrc.includes('clone.setAttribute("data-export-i18n", JSON.stringify(T))'), "buildExportDocument does not freeze data-export-i18n");
check(
	pageSrc.includes('removeInClone(clone, ["exportBtn", "downloadBtn", "qaSelBtn", "askPanel", "langSeg"])'),
	"export does not strip the language switch group (langSeg)",
);
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

/* Report. */
if (failures.length) {
	console.error("\npage-i18n-check: " + failures.length + " failure(s)");
	for (const message of failures) console.error("  - " + message);
	process.exit(1);
}
console.log("page-i18n-check: all assertions passed (" + enKeys.length + " keys x 2 languages)");
