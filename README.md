# pi-md-preview

English | [简体中文](README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that renders agent-written Markdown files as polished, minimal, modern web pages and presents them in the browser.

Built for structured-content delivery — **whenever the agent is about to output structured content (a report, research findings, a design document, a README, a multi-section article, a table, a list, a code example, …) longer than 150 characters, it must call this extension**: write the `.md` file, invoke one tool, and a beautifully typeset page opens in the browser. The agent does not need to keep working afterwards — once the user closes the tab, the preview server exits on its own.

## Features

| Capability | Implementation |
| --- | --- |
| Markdown as a web page | Self-contained, zero-dependency Markdown renderer (GFM-style): headings, tables, fenced code (25+ languages highlighted), blockquotes (incl. `[!NOTE]` admonitions), task lists, footnotes, images, autolinks |
| Mermaid diagrams | `mermaid` fenced blocks render as diagrams; the mermaid runtime is lazy-loaded from the preview server's own origin (flowcharts, sequence diagrams, …) |
| Agent-initiated preview + auto-open browser | The `md_preview` tool starts a local server and opens the page in the system default browser (macOS `open` / Linux `xdg-open` / Windows `start`), de-duplicating across tabs (an already-open tab is reused) |
| No babysitting | The tool returns immediately and the server runs on its own. It exits 8 s after the last tab closes (or 5 min after start if no tab ever opened), with a final safety exit when the Pi session shuts down |
| Bilingual UI (en / zh) | The agent always picks the page UI language explicitly via the required `ui_lang` tool parameter, chosen from the user's language; an in-page 中/EN switch lets the reader override it (remembered in `localStorage`) |
| Clean, modern reading experience | Minimal reading layout, paper-texture backgrounds, page progress bar, table of contents with scroll highlighting, code blocks with language label + one-click copy |
| Deliberate motion | Smooth theme transitions, sliding TOC indicator, hover micro-interactions, fade-in on content refresh, scroll-aware back-to-top |
| Light / dark mode | Three modes: follow system / forced light / forced dark (one click in the toolbar) |
| Font-size control | A- / A+ in ±10% steps across 0.7× – 1.6× |
| Line-height control | Stepped control across 1.4 – 2.2 (default 1.75) |
| User-level persistence | Theme, reading background, font scale and line height persist to a user-level config file (`$XDG_CONFIG_HOME/md-preview/settings.json`), surviving sessions and random ports; browser `localStorage` acts as a same-origin fast cache |
| Ask the agent about selected text | Select text in the page → floating "Ask" button → the question is injected into the Pi session to wake the agent → the answer is pushed back live via the `md_preview_reply` tool as a reply card (quote / answer / timestamp) beside the document, with the quoted text highlighted in orange |
| Export HTML snapshot | One click exports a self-contained offline HTML file: images inlined, current theme/background/font/language frozen, interactive-only controls stripped — it reads exactly like the live preview |
| Bonus: live sync | When the source file changes, the page refreshes automatically (SSE) — no need to call the tool again |

## Quick start

### Install from npm

```bash
pi install npm:pi-md-preview@0.1.0
```

Restart your Pi session after installing. To try it for one invocation without installing:

```bash
pi -e npm:pi-md-preview
```

### Install a local checkout (development)

From a clone of this repository:

```bash
pi install ./pi-extension-md-preview
```

Or load it temporarily without installing:

```bash
pi --extension ./extensions/md-preview/index.ts
```

### In a session

**Agent-initiated (recommended path)**: trigger rule — when the output is structured content (report, research, design doc, multi-section text, table, list, code example, …) longer than 150 characters, the agent **must** call the tool instead of printing to the terminal. It writes the `.md` file first:

```jsonc
// tool call
{
  "file": "/path/to/report.md",        // required: Markdown file (absolute, or relative to cwd)
  "title": "Q3 Infrastructure Migration Report",  // optional: page title; defaults to the first H1
  "ui_lang": "en",                     // required: "en" | "zh" — always choose based on the user's language
  "open_browser": true                 // optional: default true, auto-open a browser tab
}
```

The tool returns the page URL; the agent shares it with the user and moves on — no waiting, no polling. Calling again with a different `ui_lang` hot-switches the language of an already-previewed document (live-synced to open tabs).

**User command**: inside a session (Tab-completion for Markdown filenames included):

```
/md-preview reports/summary.md
/md-preview              # list documents currently being previewed
```

### Standalone demo (no Pi session needed)

```bash
npm install
npm run demo               # render the sample report and open the browser
npm run demo -- --smoke    # headless smoke test: compile, serve, assert, exit
```

## How it works

```
Agent writes .md ──► md_preview tool ──► local preview server (127.0.0.1:random port)
                                             │
                 browser tab ◄── auto-open ──┘
                        │  SSE: source change → page auto-refresh
                        │  sendBeacon: tab close → viewer count -1
                        ▼
   server exits 8 s after the last tab closes (5 min if none ever opened)
   Pi session_shutdown → final safety exit
```

- **Process lifecycle**: the server starts lazily on first use (tool or command) and never blocks the tool's return; exit decisions run in a lightweight 3-second patrol loop with no external dependencies.
- **Ask-about-selection pipeline**: the page POSTs `/doc/{id}/ask` → the server stores the Q&A record and broadcasts an SSE `ask` → the extension injects the question into the Pi session via `pi.sendUserMessage` (`deliverAs: "followUp"`); after reading the relevant files, the agent calls `md_preview_reply` → the server renders the Markdown answer and broadcasts SSE `answer` → a reply card appears beside the document in every tab showing it, with the quoted text highlighted in orange.
- **Cross-tab de-duplication**: multiple tabs of the same file share one document render; edits refresh all tabs together.
- **UI language**: the `md_preview` tool requires an explicit `ui_lang` (`"en"` or `"zh"`), which the agent chooses based on the user's language. The `/md-preview` command resolves it as `MD_PREVIEW_LANG` environment variable > `"en"` (when a document is first opened). An in-page 中/EN switch overrides the server-sent language and is remembered per browser origin in `localStorage` (`mdp.lang`). The language is intentionally *not* written to the user-level prefs file.
- **Download source**: the toolbar offers one-click download of the current document's Markdown source (`GET /doc/{id}/download`, `Content-Disposition: attachment`, always read fresh from disk).
- **Export HTML**: one click produces a standalone snapshot — the live DOM is cloned, sanitized, frozen (current theme/background/font/line-height/language), images are inlined as data URLs, and interactive-only controls (export/download buttons, ask panel, language switch) are stripped. Mermaid SVG colors stay at their snapshot-time theme (known limitation).
- **Markdown link routing**: relative links that point to Markdown files open in-place as new previewed documents (and join live sync); links to images/attachments are served as static assets. Link resolution is confined to (session cwd ∪ previewed document directories); links outside that set are marked unavailable in the page.

## Page tour

- Left table of contents (shown when ≥2 headings): highlights the current section while scrolling, smooth-scrolls on click, collapses into a drawer on mobile.
- Top toolbar: theme switcher (system / light / dark), reading-background swatches (white / dim / wood / cyan — paper tones in light mode, matching dark variants in dark mode), font-size A- / A+, line-height stepper, language switch (中 / EN), download source, export HTML, and a page progress bar.
- Code blocks: language label, one-click copy (with success feedback), per-language highlighting; unsupported languages degrade to plain text.
- Ask about selection: select any body text and click the floating "Ask" button; once the agent replies, a card appears beside the document with the quote, answer and timestamp, and the quoted text is highlighted in orange.
- Footer version stamp: commit date + short commit id (from git; `-dirty` appended when the working tree has uncommitted changes; hidden when git is unavailable).
- Reading details: `scroll-margin-top` keeps anchor jumps clear of the sticky toolbar; narrow screens adapt (TOC collapses, tables scroll horizontally).

## Project structure

```
extensions/md-preview/
├── index.ts       # extension entry: md_preview / md_preview_reply tools + /md-preview command + shutdown safety net
├── render.ts      # zero-dependency Markdown → HTML renderer (GFM subset + code highlighting)
├── page.ts        # page template: CSS theme system + interaction scripts (TOC/theme/font/live sync/ask/export)
├── page-i18n.ts   # bilingual UI string table (en/zh) + language normalization
├── server.ts      # local HTTP server: routing, SSE live sync, viewer counting, auto-exit, /prefs, /doc/{id}/ask, /doc/{id}/download
├── prefs.ts       # user-level preferences (theme/bg/scale/line-height): load, validate, atomic debounced persistence
└── browser.ts     # cross-platform default-browser opener
scripts/
├── check.mjs             # npm run check: link host type definitions and run strict TypeScript checks
├── i18n-check.mjs        # language-priority / openDocument contract / SSE lang assertions
├── page-i18n-check.mjs   # string-table alignment, copy safety, bilingual render assertions
└── demo.mjs              # npm run demo: standalone render demo / --smoke headless test
```

Pi loads the TypeScript sources directly via jiti — no build step; `tsconfig.json` exists only for type checking (`npm run check`), and `tsconfig.demo.json` only compiles the host-independent modules into CommonJS for the demo.

## Configuration

| Environment variable | Effect |
| --- | --- |
| `MD_PREVIEW_HOST` | Bind address, default `127.0.0.1` (safe default; never exposed to the network) |
| `MD_PREVIEW_THEME` | Initial theme hint: `system` / `light` / `dark` (only applies until the user picks a theme) |
| `MD_PREVIEW_LANG` | Fallback UI language: `en` / `zh` (used by the `/md-preview` command; the `md_preview` tool always passes `ui_lang` explicitly) |

### User-level preference persistence

Theme, reading background, font scale and line height persist on two levels:

1. **User-level (global)**: `$XDG_CONFIG_HOME/md-preview/settings.json` (`~/.config/md-preview/settings.json` when `XDG_CONFIG_HOME` is unset). Page interactions are debounced and posted to `POST /prefs`, then written atomically; every future preview — any session, any random port — picks them up.
2. **Browser `localStorage`** (`mdp.theme` / `mdp.bg` / `mdp.scale` / `mdp.lineHeight` / `mdp.lang`): same-origin fast cache, effective immediately within a session; when it misses (e.g. a new port), the user-level file is the fallback.

Load priority: `localStorage` (most recent action on this origin) > user prefs file > `MD_PREVIEW_THEME` env hint > built-in defaults (follow system, white background, 100% font, 1.75 line height). Background and line height have no env hint and fall back straight to the built-in defaults. The UI language follows its own chain: in-page `localStorage` choice > server-sent language (tool param / env / default).

Example prefs file:

```json
{
  "theme": "dark",
  "bg": "wood",
  "scale": 1.15,
  "lineHeight": 1.75
}
```

Posting an explicit `null` (e.g. `{"theme": null}`) to `POST /prefs` resets that key to its default.

### Ask the agent about selected text

While reading, select any body text and click the floating "✦ Ask" button to type a question (Enter to send). The server stores a Q&A record and broadcasts an SSE `ask` event; the extension then injects the question into the Pi session as a user message (`deliverAs: "followUp"`: delivered immediately when idle, queued behind a busy turn). After answering with the help of the repository's files, the agent calls the `md_preview_reply` tool:

```jsonc
// tool call (omit question_id to answer the earliest unanswered question)
{ "question_id": "q1", "text": "The latency drop mostly comes from a higher cache hit rate… (Markdown supported)" }
```

The reply appears in real time as a card **beside the document** (synced across every tab showing it), containing the quote, the answer and the timestamp; the quoted text is highlighted in orange in the body. Q&A lives with the server — cards and highlights restore automatically after refresh/reopen (highlights are re-located by quote text, so a cross-element selection may lose its highlight on restore; the card itself is unaffected). Pending cards show "Waiting for the agent's reply…". On narrow screens (<1080px) the side rail is hidden and only the orange highlight remains.

## Security considerations

- The server binds to loopback only, and the page itself makes no external network requests (no CDN, no external assets).
- The mermaid runtime is served same-origin by the preview server (`/mermaid.mjs`), so diagram rendering produces no external requests either.
- Static assets and link resolution are validated to stay inside (session cwd ∪ previewed document directories); unknown file types return 404, and dangerous types like `text/html` are force-served as `text/plain`.
- The extension never invokes a shell: opening the browser uses `spawn` (`open` / `xdg-open` / `cmd start`) with immediate `unref`, degrading gracefully to "open the URL manually"; the footer version stamp spawns `git` once per process against the extension root (no shell, cached), silently degrading to hidden on failure.
- The port is random (`listen(0)`); tab-close detection uses both `sendBeacon` and SSE disconnect, and server shutdown is idempotent.

## Known limitations

- Markdown support covers the common GFM subset; inline HTML such as `<details>` is rendered as escaped text (for safety).
- Code highlighting uses built-in lexical rules (25+ common languages); unsupported languages render as plain-text code blocks; `mermaid` fences bypass highlighting and render as diagrams.
- "Exit 8 s after the last tab closes" is a design choice, not a bug: a quick refresh or network hiccup won't kill your preview; calling the tool again revives it at any time.
- In exported HTML snapshots, mermaid SVG colors stay at the snapshot-time theme even if you switch themes in the snapshot.

## Development

```bash
npm install                 # install type-checking dependencies
npm run check               # strict TypeScript check (run after every change)
npm run check:i18n          # bilingual string-table + language-channel assertions
npm run demo -- --smoke     # end-to-end smoke: render + server + SSE
```

## License

MIT. This package vendors a self-contained [Mermaid](https://github.com/mermaid-js/mermaid) build (`extensions/md-preview/vendor/mermaid.esm.min.mjs`, MIT License) served lazily from the preview server's own origin — see `NOTICE`.
