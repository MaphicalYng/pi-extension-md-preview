/**
 * Markdown -> HTML rendering for the preview server.
 *
 * Uses `marked` (GFM) with custom heading / code / link / image rendering plus
 * admonition and footnote extensions, so the page can offer a table of contents,
 * stable anchors, callouts, endnotes, code-block chrome, and safe in-preview
 * links to sibling Markdown files and assets.
 */
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked";

export interface TocItem {
	id: string;
	text: string;
	level: number;
}

export interface RenderedDoc {
	html: string;
	toc: TocItem[];
	/** Plain-text title taken from the first level-1 heading, if any. */
	title: string | null;
}

export interface RenderOptions {
	/**
	 * Rewrites a relative link/image target found in the document.
	 * Return a page-relative URL to rewrite it, or null to leave it untouched.
	 */
	resolveLink?: (kind: "link" | "asset", target: string) => string | null;
}

const ADMONITION_LABELS = {
	note: "Note",
	tip: "Tip",
	important: "Important",
	warning: "Warning",
	caution: "Caution",
} as const;

type AdmonitionKind = keyof typeof ADMONITION_LABELS;

const ADMONITION_BLOCK_RE = /^(?: {0,3}>[^\n]*(?:\n|$))+/;
const ADMONITION_PREFIX_RE = /^ {0,3}> ?/;
const ADMONITION_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i;
const FOOTNOTE_DEF_RE = /^ {0,3}\[\^([^\]\n]+)\]:[ \t]?(.*)$/;
const FOOTNOTE_REF_RE = /^\[\^([^\]\n]+)\]/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

interface AdmonitionToken extends Tokens.Generic {
	type: "admonition";
	raw: string;
	kind: AdmonitionKind;
	text: string;
	tokens: Token[];
}

interface FootnoteRefToken extends Tokens.Generic {
	type: "footnoteRef";
	raw: string;
	label: string;
	index: number;
	refIndex: number;
	refId: string;
}

interface FootnoteRefEntry {
	label: string;
	index: number;
	refIds: string[];
}

interface RenderState {
	definitions: Map<string, string>;
	refs: Map<string, FootnoteRefEntry>;
	/** True while a footnote body is being rendered: headings and refs stay inert. */
	inFootnoteBody: boolean;
}

/**
 * Pull GitHub-style footnote definitions out of the document body, before
 * lexing. Definitions are only recognized outside fenced code blocks, so a
 * literal `[^1]: ...` inside a fence is preserved as code.
 */
function extractFootnotes(source: string): { source: string; definitions: Map<string, string> } {
	const lines = source.split("\n");
	const out: string[] = [];
	const definitions = new Map<string, string>();
	let fence: { char: string; length: number } | null = null;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		const fenceOpen = FENCE_OPEN_RE.exec(line);
		if (fence) {
			out.push(line);
			if (fenceOpen && fenceOpen[1] && fenceOpen[1][0] === fence.char && fenceOpen[1].length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (fenceOpen && fenceOpen[1]) {
			fence = { char: fenceOpen[1][0] ?? "`", length: fenceOpen[1].length };
			out.push(line);
			continue;
		}

		const match = FOOTNOTE_DEF_RE.exec(line);
		if (!match) {
			out.push(line);
			continue;
		}

		const label = (match[1] ?? "").trim();
		const body: string[] = [match[2] ?? ""];
		let next = i + 1;
		for (; next < lines.length; next += 1) {
			const candidate = lines[next] ?? "";
			if (/^(?: {4}|\t)/.test(candidate)) {
				body.push(candidate.replace(/^(?: {4}|\t)/, ""));
				continue;
			}
			// A blank line stays inside the definition only when an indented
			// continuation follows it (multi-paragraph footnote bodies).
			if (candidate.trim() === "") {
				const after = lines[next + 1];
				if (after !== undefined && /^(?: {4}|\t)/.test(after)) {
					body.push("");
					continue;
				}
			}
			break;
		}
		if (!definitions.has(label)) definitions.set(label, body.join("\n").replace(/\s+$/, ""));
		i = next - 1;
	}

	return { source: out.join("\n"), definitions };
}

/** GitHub-style `> [!NOTE]` … `> [!CAUTION]` callouts, rendered as styled boxes. */
function admonitionExtension(): TokenizerAndRendererExtension {
	return {
		name: "admonition",
		level: "block",
		start(src: string) {
			const m = /^ {0,3}>/m.exec(src);
			return m ? m.index : undefined;
		},
		tokenizer(src: string) {
			const block = ADMONITION_BLOCK_RE.exec(src);
			if (!block) return undefined;
			const raw = block[0];
			const stripped = raw.replace(/\n$/, "").split("\n").map((line) => line.replace(ADMONITION_PREFIX_RE, ""));
			const firstLine = stripped[0] ?? "";
			const marker = ADMONITION_MARKER_RE.exec(firstLine);
			if (!marker) return undefined;
			const kind = (marker[1] ?? "").toLowerCase() as AdmonitionKind;
			const text = [firstLine.slice(marker[0].length), ...stripped.slice(1)]
				.join("\n")
				.replace(/^\n+/, "")
				.replace(/\s+$/, "");
			const token: AdmonitionToken = {
				type: "admonition",
				raw,
				kind,
				text,
				tokens: text ? this.lexer.blockTokens(text) : [],
			};
			return token;
		},
		renderer(token: Tokens.Generic) {
			const t = token as AdmonitionToken;
			const body = this.parser.parse(t.tokens);
			const key = `admonition${t.kind.charAt(0).toUpperCase()}${t.kind.slice(1)}`;
			return (
				`<div class="admonition admonition-${t.kind}" data-admonition="${t.kind}">\n` +
				`<p class="admonition-title"><span data-i18n="${key}">${ADMONITION_LABELS[t.kind]}</span></p>\n` +
				`<div class="admonition-body">\n${body}</div>\n</div>\n`
			);
		},
	};
}

/** Inline `[^label]` footnote references; numbering follows first-reference order. */
function footnoteExtension(state: RenderState): TokenizerAndRendererExtension {
	return {
		name: "footnoteRef",
		level: "inline",
		start(src: string) {
			const index = src.indexOf("[^");
			return index === -1 ? undefined : index;
		},
		tokenizer(src: string) {
			if (state.inFootnoteBody) return undefined;
			const m = FOOTNOTE_REF_RE.exec(src);
			if (!m) return undefined;
			const label = (m[1] ?? "").trim();
			if (!state.definitions.has(label)) return undefined;
			let entry = state.refs.get(label);
			if (!entry) {
				entry = { label, index: state.refs.size + 1, refIds: [] };
				state.refs.set(label, entry);
			}
			const refIndex = entry.refIds.length + 1;
			const refId = refIndex === 1 ? `fnref-${entry.index}` : `fnref-${entry.index}-${refIndex}`;
			entry.refIds.push(refId);
			const token: FootnoteRefToken = {
				type: "footnoteRef",
				raw: m[0],
				label,
				index: entry.index,
				refIndex,
				refId,
			};
			return token;
		},
		renderer(token: Tokens.Generic) {
			const t = token as FootnoteRefToken;
			return `<sup class="footnote-ref" id="${t.refId}"><a href="#fn-${t.index}" aria-label="Footnote ${t.index}">[${t.index}]</a></sup>`;
		},
	};
}

const NAMED_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&apos;": "'",
	"&nbsp;": " ",
};

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&#x?[0-9a-fA-F]+;/g, (m) => {
			const hex = m.startsWith("&#x");
			const code = Number.parseInt(hex ? m.slice(3, -1) : m.slice(2, -1), hex ? 16 : 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		})
		.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (m) => NAMED_ENTITIES[m] ?? m);
}

function slugify(text: string): string {
	const slug = text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s\-_]/gu, "")
		.replace(/[\s_]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "section";
}

/** Renders one Markdown source document. */
export function renderMarkdown(source: string, options: RenderOptions = {}): RenderedDoc {
	const toc: TocItem[] = [];
	const usedIds = new Map<string, number>();
	let title: string | null = null;
	const { source: documentSource, definitions } = extractFootnotes(source);
	const state: RenderState = { definitions, refs: new Map(), inFootnoteBody: false };

	const makeId = (plain: string): string => {
		const base = slugify(plain);
		const seen = usedIds.get(base) ?? 0;
		usedIds.set(base, seen + 1);
		return seen === 0 ? base : `${base}-${seen}`;
	};

	const md = new Marked({ gfm: true, breaks: false });

	md.use({ extensions: [admonitionExtension(), footnoteExtension(state)] });
	md.use({
		renderer: {
			// Raw embedded HTML (block or inline) is rendered as escaped text per the
			// README contract — preview pages never execute document-supplied markup.
			html(token: Tokens.HTML | Tokens.Tag) {
				return escapeHtml(token.text);
			},
			heading(this: { parser: { parseInline(tokens: Tokens.Heading["tokens"]): string } }, token: Tokens.Heading) {
				const inner = this.parser.parseInline(token.tokens);
				// Footnote bodies must not add headings to the document TOC or title.
				if (state.inFootnoteBody) return `<h${token.depth}>${inner}</h${token.depth}>\n`;
				const plain = stripTags(inner);
				const id = makeId(plain);
				toc.push({ id, text: plain, level: token.depth });
				if (title === null && token.depth === 1) title = plain;
				const tag = `h${token.depth}`;
				return (
					`<${tag} id="${escapeHtml(id)}">` +
					`<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Anchor link">#</a>` +
					`${inner}</${tag}>\n`
				);
			},
			code(token: Tokens.Code) {
				const lang = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
				// Mermaid diagram blocks emit a bare <pre> placeholder (holding the escaped
				// source); page.ts detects `.mermaid` and loads the same-origin runtime to
				// draw it, bypassing the code-block / code-head enhancement path.
				if (lang.toLowerCase() === "mermaid") {
					return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
				}
				const label = lang ? escapeHtml(lang) : "text";
				const codeHtml = escapeHtml(token.text);
				return (
					`<div class="code-block" data-lang="${label}">` +
					`<div class="code-head"><span class="code-lang">${label}</span></div>` +
					`<pre><code class="language-${label}">${codeHtml}</code></pre>` +
					`</div>\n`
				);
			},
			link(token: Tokens.Link) {
				const inner = this.parser.parseInline(token.tokens);
				const href = rewrite(token.href, "link") ?? token.href;
				const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
				const external = /^https?:\/\//i.test(href);
				const rel = external ? ' rel="noopener noreferrer" target="_blank"' : "";
				return `<a href="${escapeHtml(href)}"${titleAttr}${rel}>${inner}</a>`;
			},
			image(token: Tokens.Image) {
				const src = rewrite(token.href, "asset") ?? token.href;
				const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
				return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${titleAttr} loading="lazy">`;
			},
		},
	});

	function rewrite(target: string, kind: "link" | "asset"): string | null {
		if (!options.resolveLink) return null;
		if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) {
			return null;
		}
		return options.resolveLink(kind, target);
	}

	const html = md.parse(documentSource) as string;

	// Footnote bodies render after the document so numbering follows the first
	// reference; headings inside them stay out of the TOC.
	let withFootnotes = html;
	const referenced = [...state.refs.values()].sort((a, b) => a.index - b.index);
	if (referenced.length > 0) {
		state.inFootnoteBody = true;
		const items = referenced.map((entry) => {
			const definition = state.definitions.get(entry.label) ?? "";
			const body = (md.parse(definition) as string).trimEnd();
			const backrefs = entry.refIds
				.map(
					(refId, i) =>
						`<a href="#${refId}" class="footnote-backref" aria-label="Back to footnote ${entry.index}${i > 0 ? ` reference ${i + 1}` : ""}">&#8617;${i > 0 ? `<sup>${i + 1}</sup>` : ""}</a>`,
				)
				.join(" ");
			return `<li id="fn-${entry.index}">${body}<p class="footnote-backrefs">${backrefs}</p></li>`;
		});
		state.inFootnoteBody = false;
		withFootnotes += `\n<section class="footnotes" data-footnotes>\n<ol>\n${items.join("\n")}\n</ol>\n</section>\n`;
	}

	// Give tables a horizontal scroll wrapper without touching their markup.
	const wrapped = withFootnotes.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

	return { html: wrapped, toc, title };
}

export { escapeHtml };
