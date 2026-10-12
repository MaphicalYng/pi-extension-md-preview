/**
 * Markdown -> HTML rendering for the preview server.
 *
 * Uses `marked` (GFM) with custom heading / code / link / image rendering so the
 * page can offer a table of contents, stable anchors, code-block chrome, and
 * safe in-preview links to sibling Markdown files and assets.
 */
import { Marked, type Tokens } from "marked";

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

	const makeId = (plain: string): string => {
		const base = slugify(plain);
		const seen = usedIds.get(base) ?? 0;
		usedIds.set(base, seen + 1);
		return seen === 0 ? base : `${base}-${seen}`;
	};

	const md = new Marked({ gfm: true, breaks: false });

	md.use({
		renderer: {
			// Raw embedded HTML (block or inline) is rendered as escaped text per the
			// README contract — preview pages never execute document-supplied markup.
			html(token: Tokens.HTML | Tokens.Tag) {
				return escapeHtml(token.text);
			},
			heading(this: { parser: { parseInline(tokens: Tokens.Heading["tokens"]): string } }, token: Tokens.Heading) {
				const inner = this.parser.parseInline(token.tokens);
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

	const html = md.parse(source) as string;

	// Give tables a horizontal scroll wrapper without touching their markup.
	const wrapped = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

	return { html: wrapped, toc, title };
}

export { escapeHtml };
