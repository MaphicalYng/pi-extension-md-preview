#!/usr/bin/env node
/**
 * Regression check for module A (agent-i18n): agent-facing English text plus the
 * UI-language channel (prefs -> openDocument -> page render options / SSE).
 *
 *   node scripts/i18n-check.mjs
 *
 * Compiles the host-independent modules the same way scripts/demo.mjs and
 * scripts/restart-check.mjs do, then asserts:
 *   1. normalizeUiLang folds case/language tags and rejects invalid input
 *   2. resolveUiLang priority: tool argument > MD_PREVIEW_LANG > "en"
 *   3. openDocument contract exposes uiLang on the preview handle
 *   4. Language hot-update: an explicit uiLang updates an open document and the
 *      SSE update/init payloads carry `lang`; an omitted uiLang keeps the
 *      document's current language (PM revision, no reset to env/default)
 *   5. Read-failure notice is localized at render time (zh / en)
 *   6. answerQuestion messages are English
 *   7. serveAsk 400 payload is English
 *   8. Static scan: no CJK in comments; no CJK at all in index/render/prefs;
 *      server.ts CJK only inside string literals (the lang alternatives)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, ".demo", "build");
const extensionDir = join(root, "extensions", "md-preview");

/* Isolate the user-level prefs file (same trick as scripts/demo.mjs --smoke). */
const tmpConfig = mkdtempSync(join(tmpdir(), "mdp-i18n-"));
process.env.XDG_CONFIG_HOME = tmpConfig;
delete process.env.MD_PREVIEW_LANG;
delete process.env.MD_PREVIEW_THEME;

const failures = [];
const check = (label, cond, detail = "") => {
	if (!cond) failures.push(detail ? `${label} — ${detail}` : label);
};

/* Compile fresh: .demo/build may hold stale output from demo / restart-check. */
execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.demo.json"], { cwd: root, stdio: "inherit" });
writeFileSync(join(buildDir, "package.json"), '{"type":"commonjs"}\n', "utf8");

const require = createRequire(import.meta.url);
const { normalizeUiLang, resolveUiLang } = require(join(buildDir, "prefs.js"));
const { createPreviewServerManager } = require(join(buildDir, "server.js"));

/* ------------------------------------------------------------------ helpers */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open an SSE stream and pump it continuously, so no event can be lost between
 * assertions (a raced read would silently swallow the chunk it won).
 */
async function openSse(url) {
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	const pump = (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
			}
		} catch {
			/* stream cancelled */
		}
	})();
	return {
		get text() {
			return text;
		},
		/** Poll until predicate(text) holds or ms elapse; resolves with the verdict. */
		async waitFor(predicate, ms) {
			const deadline = Date.now() + ms;
			for (;;) {
				if (predicate(text)) return true;
				if (Date.now() >= deadline) return predicate(text);
				await sleep(25);
			}
		},
		async close() {
			try {
				await reader.cancel();
			} catch {
				/* already closed */
			}
			await pump.catch(() => {});
		},
	};
}

/** SSE event payloads of the given event name in a stream dump. */
function ssePayloads(dump, event) {
	return [...dump.matchAll(new RegExp(`event: ${event}\\ndata: ([^\\n]*)\\n`, "g"))].map((m) => m[1]);
}

const writeDoc = (name, body) => {
	const file = join(tmpConfig, name);
	writeFileSync(file, body, "utf8");
	return file;
};

/**
 * Build a `/doc/<id>` sub-route URL for a preview handle.
 *
 * `handle.url` already carries `?token=...`, so the old `${handle.url}/events` form appended
 * the sub-route into the query string and every request came back 401. Rebuild the path from
 * the handle's doc id, keep the handle's origin (host + port) and re-attach the token; extra
 * query parameters are joined with `&` by URLSearchParams.
 */
function docUrl(handle, sub = "", params) {
	let url;
	try {
		url = new URL(`/doc/${handle.docId}${sub}`, new URL(handle.url).origin);
	} catch (error) {
		throw new Error(`i18n-check: preview handle has an unusable url (${JSON.stringify(handle.url)}): ${error.message}`);
	}
	url.searchParams.set("token", handle.token);
	for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
	return url.toString();
}

const servers = createPreviewServerManager();
const server = await servers.ensure();

/* 1. normalizeUiLang ------------------------------------------------------- */
const normCases = [
	["en", "en"],
	["EN", "en"],
	["en-US", "en"],
	["en_US", "en"],
	[" en ", "en"],
	["zh", "zh"],
	["zh-CN", "zh"],
	["zh_CN", "zh"],
	["ZH-TW", "zh"],
	["fr", null],
	["", null],
	["   ", null],
	[null, null],
	[undefined, null],
	[42, null],
	[{ lang: "en" }, null],
];
for (const [input, expected] of normCases) {
	const got = normalizeUiLang(input);
	check(`normalizeUiLang(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, got === expected, `got ${JSON.stringify(got)}`);
}

/* 2. resolveUiLang priority ------------------------------------------------ */
process.env.MD_PREVIEW_LANG = "en";
check('resolveUiLang("zh") beats MD_PREVIEW_LANG=en', resolveUiLang("zh") === "zh", `got ${resolveUiLang("zh")}`);
process.env.MD_PREVIEW_LANG = "zh-CN";
check("resolveUiLang() reads MD_PREVIEW_LANG=zh-CN", resolveUiLang() === "zh", `got ${resolveUiLang()}`);
delete process.env.MD_PREVIEW_LANG;
check('resolveUiLang() defaults to "en"', resolveUiLang() === "en", `got ${resolveUiLang()}`);
process.env.MD_PREVIEW_LANG = "fr";
check('invalid MD_PREVIEW_LANG falls back to "en"', resolveUiLang() === "en", `got ${resolveUiLang()}`);
delete process.env.MD_PREVIEW_LANG;

/* 3. openDocument contract ------------------------------------------------- */
const docA = writeDoc("doc-a.md", "# Doc A\n\nBody text.\n");
const hZh = await server.openDocument(docA, { cwd: tmpConfig, uiLang: "zh" });
check('openDocument({uiLang:"zh"}).uiLang === "zh"', hZh.uiLang === "zh", `got ${JSON.stringify(hZh.uiLang)}`);
check("first open is not reused", hZh.reused === false, `got ${hZh.reused}`);

process.env.MD_PREVIEW_LANG = "zh";
const docB = writeDoc("doc-b.md", "# Doc B\n");
const hEnv = await server.openDocument(docB, { cwd: tmpConfig });
check("new document honors MD_PREVIEW_LANG=zh", hEnv.uiLang === "zh", `got ${JSON.stringify(hEnv.uiLang)}`);
delete process.env.MD_PREVIEW_LANG;

const docC = writeDoc("doc-c.md", "# Doc C\n");
const hDefault = await server.openDocument(docC, { cwd: tmpConfig });
check('new document defaults to "en"', hDefault.uiLang === "en", `got ${JSON.stringify(hDefault.uiLang)}`);

/* 4. Language hot-update + SSE lang --------------------------------------- */
const sse = await openSse(docUrl(hZh, "/events", { c: "i18n-live" }));
await sse.waitFor((text) => text.includes('"lang":"zh"'), 2000);
check('SSE init carries lang="zh"', sse.text.includes('"lang":"zh"'), sse.text.slice(0, 200));

/* Omitted uiLang must NOT reset the document language (PM revision). */
const beforeOmitted = sse.text.length;
const hOmitted = await server.openDocument(docA, { cwd: tmpConfig });
check("omitted uiLang keeps the open document language", hOmitted.uiLang === "zh", `got ${JSON.stringify(hOmitted.uiLang)}`);
await sleep(600);
check("omitted uiLang does not broadcast an update", !sse.text.slice(beforeOmitted).includes("event: update"), sse.text.slice(beforeOmitted).slice(0, 200));

/* An explicit different uiLang updates the open document and broadcasts. */
const hEn = await server.openDocument(docA, { cwd: tmpConfig, uiLang: "en" });
check('explicit uiLang switches the open document to "en"', hEn.uiLang === "en", `got ${JSON.stringify(hEn.uiLang)}`);
check("switching language reports reused=true", hEn.reused === true, `got ${hEn.reused}`);
await sse.waitFor((text) => text.includes("event: update"), 3000);
const updatePayloads = ssePayloads(sse.text, "update");
check("SSE update event was broadcast on the language switch", updatePayloads.length >= 1, `payloads=${JSON.stringify(updatePayloads)}`);
check('SSE update payload carries lang="en"', updatePayloads.every((p) => p.includes('"lang":"en"')), JSON.stringify(updatePayloads));
const initEn = ssePayloads(sse.text, "init");
check('SSE init payload carries a lang field', initEn.every((p) => /"lang":"(en|zh)"/.test(p)), JSON.stringify(initEn));

const hEnAgain = await server.openDocument(docA, { cwd: tmpConfig });
check('omitted uiLang keeps "en" after the explicit switch', hEnAgain.uiLang === "en", `got ${JSON.stringify(hEnAgain.uiLang)}`);
await sse.close();

const sseEn = await openSse(docUrl(hZh, "/events", { c: "i18n-live-en" }));
await sseEn.waitFor((text) => text.includes('"lang":"en"'), 2000);
check('new SSE init carries lang="en" after the switch', sseEn.text.includes('"lang":"en"'), sseEn.text.slice(0, 200));
await sseEn.close();

/* 5. Localized read-failure notice ---------------------------------------- */
const missingZh = writeDoc("missing-zh.md", "# Missing zh\n");
const hMissingZh = await server.openDocument(missingZh, { cwd: tmpConfig, uiLang: "zh" });
unlinkSync(missingZh);
const zhNotice = await (await fetch(hMissingZh.url)).text();
check("zh document renders the Chinese read-failure notice", zhNotice.includes("文件无法读取"), zhNotice.slice(0, 160));

const missingEn = writeDoc("missing-en.md", "# Missing en\n");
const hMissingEn = await server.openDocument(missingEn, { cwd: tmpConfig, uiLang: "en" });
unlinkSync(missingEn);
const enNotice = await (await fetch(hMissingEn.url)).text();
check("en document renders the English read-failure notice", enNotice.includes("Cannot read file"), enNotice.slice(0, 160));

/* 6. answerQuestion messages are English ---------------------------------- */
const emptyReply = server.answerQuestion(undefined, "   ");
check('empty reply message is "Reply text is empty."', emptyReply.ok === false && emptyReply.message === "Reply text is empty.", JSON.stringify(emptyReply));

const orphan = server.answerQuestion("q999", "orphan reply");
check("unknown question id message is English", orphan.ok === false && orphan.message.includes("No pending question found"), JSON.stringify(orphan));

const askRes = await fetch(docUrl(hEn, "/ask"), {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ quote: "Doc A", question: "What is this?" }),
});
const askData = askRes.ok ? await askRes.json() : {};
check("POST /ask accepted the question", askRes.status === 200 && Boolean(askData.id), `status ${askRes.status}`);
const answered = server.answerQuestion(askData.id, "A **test** answer.");
check("success message is English", answered.ok === true && answered.message.includes("Answered preview question"), JSON.stringify(answered));

/* 7. serveAsk 400 payload is English -------------------------------------- */
const badAsk = await fetch(docUrl(hEn, "/ask"), {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ quote: "", question: "" }),
});
const badAskBody = await badAsk.text();
check("POST /ask with empty quote/question returns 400", badAsk.status === 400, `status ${badAsk.status}`);
check("400 payload is the English error string", badAskBody.includes("quote and question must be non-empty strings"), badAskBody);

/* 8. Static CJK scan ------------------------------------------------------ */
const HAN = /[\u4e00-\u9fff]/;
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;

/** Han characters appearing on comment lines. */
function hanInComments(source) {
	return source
		.split("\n")
		.map((text, index) => ({ line: index + 1, text }))
		.filter(({ text }) => COMMENT_LINE.test(text) && HAN.test(text));
}

/**
 * Han characters in code position: outside comments and outside string /
 * template literals. `${...}` interpolations are scanned as code, so Han inside
 * an interpolation expression is reported while Han inside a literal is not.
 *
 * Regex literals are recognised as well, and scanned as code rather than as a
 * string: without that, the `"` inside something like `/[^\x20-\x7e]/g` opened a
 * string state that never closed, so Han later in the file was silently missed
 * while Han inside legitimate string literals was reported. A `/` starts a regex
 * when the token before it cannot end an expression (an operator or a value-taking
 * keyword such as `return`); otherwise it is division.
 */
function hanInCode(source) {
	const hits = [];
	const stack = []; // "template" markers for nested ${...} expressions
	let mode = "code"; // code | line | block | single | double | template | regex
	let line = 1;
	let i = 0;
	let prev = ""; // last significant character in code position
	let word = ""; // identifier currently being read
	let lastWord = ""; // last completed identifier
	let regexClass = false; // inside a [...] class of a regex literal
	const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "delete", "void", "in", "of", "instanceof", "new", "do", "else", "yield", "await"]);
	const REGEX_AFTER_CHAR = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
	const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);
	const endWord = () => {
		if (word) lastWord = word;
		word = "";
	};
	const startsRegex = () => REGEX_AFTER_WORD.has(lastWord) || REGEX_AFTER_CHAR.has(prev);
	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "\n") line++;
		if (mode === "line") {
			if (ch === "\n") {
				mode = "code";
				prev = "";
				endWord();
			}
			i++;
		} else if (mode === "block") {
			if (ch === "*" && next === "/") {
				mode = "code";
				prev = "";
				endWord();
				i += 2;
			} else i++;
		} else if (mode === "single" || mode === "double") {
			if (ch === "\\") i += 2;
			else {
				if (ch === (mode === "single" ? "'" : '"')) {
					mode = "code";
					prev = ")";
					endWord();
				}
				i++;
			}
		} else if (mode === "template") {
			if (ch === "\\") i += 2;
			else if (ch === "`") {
				mode = stack.pop() ?? "code";
				prev = ")";
				endWord();
				i++;
			} else if (ch === "$" && next === "{") {
				stack.push("template");
				mode = "code";
				prev = "";
				endWord();
				i += 2;
			} else i++;
		} else if (mode === "regex") {
			if (ch === "\\") i += 2;
			else if (ch === "[") {
				regexClass = true;
				i++;
			} else if (ch === "]") {
				regexClass = false;
				i++;
			} else if (ch === "/" && !regexClass) {
				mode = "code";
				prev = ")";
				endWord();
				i++;
				// Consume the flag letters so `/g` never leaks into code position.
				while (i < source.length && /[A-Za-z]/.test(source[i])) i++;
			} else {
				if (HAN.test(ch)) hits.push({ line, char: ch });
				i++;
			}
		} else if (ch === "/" && next === "/") {
			mode = "line";
			i += 2;
		} else if (ch === "/" && next === "*") {
			mode = "block";
			i += 2;
		} else if (ch === "/" && startsRegex()) {
			mode = "regex";
			regexClass = false;
			prev = "";
			endWord();
			i++;
		} else if (ch === "'") {
			mode = "single";
			prev = "";
			endWord();
			i++;
		} else if (ch === '"') {
			mode = "double";
			prev = "";
			endWord();
			i++;
		} else if (ch === "`") {
			stack.push("code");
			mode = "template";
			prev = "";
			endWord();
			i++;
		} else if (ch === "}" && stack[stack.length - 1] === "template") {
			stack.pop();
			mode = "template";
			prev = "";
			endWord();
			i++;
		} else if (/\s/.test(ch)) {
			endWord();
			i++;
		} else if (isWordChar(ch)) {
			word += ch;
			prev = ch;
			i++;
		} else {
			if (HAN.test(ch)) hits.push({ line, char: ch });
			prev = ch;
			endWord();
			i++;
		}
	}
	return hits;
}

for (const name of ["index", "server", "render", "prefs"]) {
	const source = readFileSync(join(extensionDir, `${name}.ts`), "utf8");
	const comments = hanInComments(source);
	check(`${name}.ts has no CJK in comments`, comments.length === 0, comments.map((h) => `line ${h.line}`).join(", "));
	if (name === "server") {
		const code = hanInCode(source);
		check("server.ts keeps CJK only inside string literals", code.length === 0, code.map((h) => `line ${h.line} (${h.char})`).join(", "));
		check(
			"server.ts keeps both language alternatives",
			source.includes("文件无法读取") && source.includes("Cannot read file") && source.includes("Markdown Preview"),
			"missing zh or en notice/heading",
		);
	} else {
		check(`${name}.ts has no CJK at all`, !HAN.test(source));
	}
}

/* ------------------------------------------------------------------ cleanup */
try {
	await server.shutdown("i18n-check complete");
} catch {
	/* already shut down */
}
rmSync(tmpConfig, { recursive: true, force: true });

if (failures.length) {
	console.error("i18n-check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("i18n-check passed: language priority, openDocument contract, SSE lang, localized notices and English messages are all correct.");
