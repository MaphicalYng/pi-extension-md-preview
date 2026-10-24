<p align="center"><img src="assets/logo/logo-512.png" width="104" alt=""></p>

# pi-md-preview

English | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/pi-md-preview)](https://www.npmjs.com/package/pi-md-preview)
[![npm downloads](https://img.shields.io/npm/dm/pi-md-preview)](https://www.npmjs.com/package/pi-md-preview)
[![pi.dev package page](https://img.shields.io/badge/pi.dev-package_page-8B5CF6)](https://pi.dev/packages/pi-md-preview)
[![license](https://img.shields.io/npm/l/pi-md-preview)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that renders agent-written Markdown files as polished, minimal, modern web pages and presents them in the browser.

Built for structured-content delivery — **whenever the agent is about to output structured content (a report, research findings, a design document, a README, a multi-section article, a table, a list, a code example, …) longer than 150 characters, it must call this extension**: write the `.md` file, invoke one tool, and a beautifully typeset page opens in the browser. The agent does not need to keep working afterwards — once the user closes the tab, the preview server exits on its own.

## Features

| Capability | Implementation |
| --- | --- |
| Agent-initiated preview + auto-open browser | The `md_preview` tool starts a local server and opens the page in the system default browser (macOS `open` / Linux `xdg-open` / Windows `start`), de-duplicating across tabs (an already-open tab is reused); `/md-preview <file> --host <ip>` can pick which IP the tab opens with, and `/md-preview-host <ip>` persists that choice in the user-level config so every pi instance opens at it |
| No babysitting | The tool returns immediately and the server runs on its own. It exits 8 s after the last tab closes (or 5 min after start if no tab ever opened), with a final safety exit when the Pi session shuts down |
| Workspace badge in the top bar | Next to the document path, the top bar shows the working directory of the pi session that opened the document: the last path segment only, with the full path on hover. Below 720px the label is hidden and the directory name stays. Reopening the same document from a session with a different working directory refreshes the badge |
| Ask the agent about selected text | Select text in the page → floating "Ask" button → the question is injected into the Pi session to wake the agent → the answer is pushed back live via the `md_preview_reply` tool as a reply card (quote / answer / timestamp) beside the document, with the quoted text highlighted in orange. Replies longer than six lines offer **View full text**; the modal highlights the portion already visible in the clamped card so reading can resume at the first unhighlighted text |
| Stash a batch of questions | Select a passage → "✦ Ask" → type the question → **Stash** parks it in the queue and closes the panel (the toolbar's **Ask** button shows how many are waiting); one click later sends the whole batch as a single token-gated `POST /doc/<id>/ask-batch`, and the agent's per-item `md_preview_reply` calls fill in each item's own Q&A card |
| Chat with the agent about the document | A chat area at the bottom of the page takes a message about the whole document (no text selection needed) and injects it into the Pi session together with a summary of the recent chat turns; the agent replies with `md_preview_reply` and the answer appears as an "Agent" message in the chat feed (newest first), restored after refresh/reopen |
| Stash a batch of revisions | Select a passage → "✎ Revise" → **Stash** the revision comment (the toolbar's **Revise** button counts the queue); one click submits it via `POST /doc/<id>/revise`, the agent edits the Markdown file directly **without posting replies**, then calls `md_preview_revision_done` (`doc?`, `highlights?`) so the page marks the rewritten passages with a color block that fades out in ~3 s |
| Live progress on a pending wait row | While the agent works on a pending question or chat message, its wait row replaces the static waiting line with the current stage — `Agent is thinking…` → `Running {tool}…` → `Writing the reply… · {n} chars` — and the answer replaces the row when it arrives. Frames are throttled (at most ~8 per second), sent only while that document still has an unanswered entry, shared by every tab of the document; a tab that missed a re-render catches up from the init frame, which carries the current snapshot. Only the stage, tool name, character count and an ≤80-character tail of the text reach the browser — never thinking text, tool arguments or the reply body |
| Message delivery mode | The top bar's settings popover switches how page messages reach the agent: **Follow up** (default) queues the question or chat turn until the current turn has finished, while **Steering** is injected as soon as the running tool batch completes, so it can redirect the agent mid-turn without aborting the answer being written or the tool being run. Steering appends a short convention to the prompt (carry on with the work you had not finished, do not start another turn on your own, pausing to ask is allowed). It is a user-level setting shared by every pi instance |
| Markdown as a web page | GFM renderer built on `marked`: headings, tables, fenced code (25+ languages highlighted), blockquotes (incl. `[!NOTE]` … `[!CAUTION]` admonitions), task lists, footnotes, images, autolinks |
| Mermaid diagrams | `mermaid` fenced blocks render as diagrams; the mermaid runtime is lazy-loaded from the preview server's own origin (flowcharts, sequence diagrams, …) |
| Bilingual UI (en / zh) | The agent always picks the page UI language explicitly via the required `ui_lang` tool parameter, chosen from the user's language; an in-page 中/EN switch lets the reader override it (remembered in `localStorage`) |
| Clean, modern reading experience | Minimal reading layout, paper-texture backgrounds, page progress bar, table of contents with scroll highlighting, code blocks with language label + one-click copy |
| Deliberate motion | Smooth theme transitions, sliding TOC indicator, hover micro-interactions, fade-in on content refresh, scroll-aware back-to-top |
| Light / dark mode | Three modes: follow system / forced light / forced dark (one click in the toolbar) |
| Font-size control | A- / A+ in ±10% steps across 0.7× – 1.6× |
| Line-height control | Stepped control across 1.4 – 2.2 (default 1.75) |
| User-level persistence | Theme, reading background, font scale, line height and message delivery mode persist to a user-level config file (`$XDG_CONFIG_HOME/md-preview/settings.json`), surviving sessions and random ports; browser `localStorage` acts as a same-origin fast cache for reading preferences |
| Export HTML snapshot | One click exports a self-contained offline HTML file: images inlined, current theme/background/font/language frozen, interactive-only controls stripped — it reads exactly like the live preview |
| Bonus: live sync | When the source file changes, the page refreshes automatically (SSE) — no need to call the tool again |

## Quick start

### Install from npm

The package is published on npm as [`pi-md-preview`](https://www.npmjs.com/package/pi-md-preview), and has a page on the Pi site with its manifest and README: [`pi.dev/packages/pi-md-preview`](https://pi.dev/packages/pi-md-preview).

```bash
pi install npm:pi-md-preview@0.5.0
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
/md-preview reports/summary.md --host 192.0.2.10     # open the tab at this IP (the server must listen on 0.0.0.0)
/md-preview-host 192.0.2.20                          # persist this browser host for every preview
/md-preview-host --clear                             # forget it and fall back to the server bind address
/md-preview              # list documents currently being previewed
```

The port and the `?token=` access token are preserved when `--host` rewrites the URL; see [Listening address & access token](#listening-address--access-token).

The browser host is resolved on every preview call as **explicit `--host` > persisted `browserHost` > the server bind address** (`127.0.0.1` for a wildcard bind). Because the persisted value is read at call time, a pi instance that is already running picks it up on its next preview — no `/reload` and no restart needed.

### Standalone demo (no Pi session needed)

```bash
npm install
npm run demo               # render the sample report and open the browser
npm run demo -- --smoke    # headless smoke test: compile, serve, assert, exit
```

### Website

The `website/` directory contains an independent bilingual (Chinese/English) responsive single-page product website built with React + Vite. It follows the browser language by default, with a persistent language switch in the navigation bar:

```bash
cd website
npm install
npm run dev       # local development
npm run build     # production output in website/dist/
npm run preview   # preview the production build
```


## How it works

```
Agent writes .md ──► md_preview tool ──► local preview server (127.0.0.1:random port, token-gated URLs)
                                             │
                 browser tab ◄── auto-open ──┘
                        │  SSE: source change → page auto-refresh
                        │  sendBeacon: tab close → viewer count -1
                        ▼
   server exits 8 s after the last tab closes (5 min if none ever opened)
   Pi session_shutdown → final safety exit
```

- **Process lifecycle**: the server starts lazily on first use (tool or command) and never blocks the tool's return; exit decisions run in a lightweight 3-second patrol loop with no external dependencies.
- **Ask-about-selection pipeline**: the page POSTs `/doc/{id}/ask` → the server stores the Q&A record and broadcasts an SSE `ask` → the extension injects the question into the Pi session via `pi.sendUserMessage` (`deliverAs` comes from the page's delivery-mode preference: `followUp` by default, `steer` when selected); after reading the relevant files, the agent calls `md_preview_reply` → the server renders the Markdown answer and broadcasts SSE `answer` → a reply card appears beside the document in every tab showing it, with the quoted text highlighted in orange.
- **Batch pipelines**: a stashed queue leaves the page as one request — `POST /doc/{id}/ask-batch` or `POST /doc/{id}/revise` (token-gated like every other route) — and the extension wakes the agent once per batch (`onAsk` / `onRevise`) instead of once per item. An ask batch fans out into one Q&A record per item, each answered by its own `md_preview_reply` `question_id`, so the cards fill in one by one; a revise batch creates no Q&A record at all — the file is the deliverable, and `md_preview_revision_done` is the terminal step that pushes the new HTML and broadcasts the fading highlight marks. Only the newest batch per document is kept (an unfinished earlier one is superseded).
- **Cross-tab de-duplication**: multiple tabs of the same file share one document render; edits refresh all tabs together.
- **UI language**: the `md_preview` tool requires an explicit `ui_lang` (`"en"` or `"zh"`), which the agent chooses based on the user's language. The `/md-preview` command resolves it as `MD_PREVIEW_LANG` environment variable > `"en"` (when a document is first opened). An in-page 中/EN switch overrides the server-sent language and is remembered per browser origin in `localStorage` (`mdp.lang`). The language is intentionally *not* written to the user-level prefs file.
- **Download source**: the toolbar offers one-click download of the current document's Markdown source (`GET /doc/{id}/download`, `Content-Disposition: attachment`, always read fresh from disk).
- **Export HTML**: one click produces a standalone snapshot — the live DOM is cloned, sanitized, frozen (current theme/background/font/line-height/language), images are inlined as data URLs, and interactive-only controls (export/download buttons, ask panel, language switch) are stripped. Mermaid SVG colors stay at their snapshot-time theme (known limitation).
- **Markdown link routing**: relative links that point to Markdown files open in-place as new previewed documents (and join live sync); links to images/attachments are served as static assets. Link resolution is confined to (session cwd ∪ previewed document directories); links outside that set are marked unavailable in the page.

## Page tour

- Left table of contents (shown when ≥2 headings): highlights the current section while scrolling, smooth-scrolls on click, collapses into a drawer on mobile.
- Top toolbar: a settings gear opens the popover for message delivery, theme (system / light / dark), reading background (white / dim / wood / cyan — paper tones in light mode, matching dark variants in dark mode), font size (A- / A+), line height and language (中 / EN); download source, export HTML and a page progress bar remain directly accessible.
- Workspace badge: the last path segment of the working directory of the session that opened the document, with the full path on hover; below 720px the label is hidden and only the directory name stays.
- Code blocks: language label, one-click copy (with success feedback), per-language highlighting; unsupported languages degrade to plain text.
- Live progress: a pending question card or chat turn shows the agent's stage — thinking, running a tool (with its name), then writing with a character count and a short tail of the text — and the answer replaces the wait line when it arrives.
- Delivery mode: the settings popover's **Message delivery** switch picks between **Follow up** (queue until the turn ends) and **Steering** (injected after the current tool batch, for mid-turn corrections); the hint beside it explains the selected mode, and arrows / Home / End move the selection.
- Ask about selection: select any body text and click the floating "Ask" button; once the agent replies, a card appears beside the document with the quote, answer and timestamp, and the quoted text is highlighted in orange. The full-text modal for a long reply highlights the portion already shown in its clamped card.
- Stash queue: the toolbar's **Ask** / **Revise** buttons carry a count badge for stashed items (hidden at zero, disabled while a send is in flight); one click flushes that whole queue in a single request, and a failed send keeps every entry and its badge.
- Revision wash: when a revision batch is marked done, each matching passage gets a color block that holds for ~2 s and fades out by ~3 s; a reload inside that window replays it on the original schedule.
- Footer version stamp: commit date + short commit id (from git; `-dirty` appended when the working tree has uncommitted changes; hidden when git is unavailable).
- Reading details: `scroll-margin-top` keeps anchor jumps clear of the sticky toolbar; narrow screens adapt (TOC collapses, tables scroll horizontally).

## Project structure

```
extensions/md-preview/
├── index.ts       # extension entry: md_preview / md_preview_reply / md_preview_revision_done tools + /md-preview + /md-preview-host commands + shutdown safety net
├── render.ts      # Markdown → HTML renderer (marked/GFM): TOC, anchors, admonitions, footnotes, code-block chrome
├── page.ts        # page template: CSS theme system + interaction scripts (TOC/theme/font/line-height/code highlighting/live sync/ask/chat/stash queue/revision wash/export)
├── page-i18n.ts   # bilingual UI string table (en/zh) + language normalization
├── server.ts      # local HTTP server: routing, SSE live sync, viewer counting, auto-exit, /prefs, /doc/{id}/ask, /doc/{id}/ask-batch, /doc/{id}/revise, /doc/{id}/download
├── prefs.ts       # user-level preferences (reading/message delivery + persisted browser host): load, validate, atomic debounced persistence
├── vendor/        # vendored self-contained Mermaid ESM build (MIT), served lazily from the preview origin
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
| `MD_PREVIEW_BIND` | Bind address, default `127.0.0.1`. Set `0.0.0.0` (or a specific NIC IP) to serve other machines. **Read when the preview server starts (the first preview of the session)**; an env change mid-session needs a pi restart to take effect. It only decides the bind address — which host the browser opens is chosen by the persisted setting (`/md-preview-host`) and `--host`. The old name `MD_PREVIEW_HOST` is still accepted as a deprecated alias (`MD_PREVIEW_BIND` wins when both are set) |
| `MD_PREVIEW_TOKEN` | Fixed access token, overriding the random URL-safe token generated at startup (useful for a stable remote link). Every page URL carries `?token=` |
| `MD_PREVIEW_THEME` | Initial theme hint: `system` / `light` / `dark` (only applies until the user picks a theme) |
| `MD_PREVIEW_LANG` | Fallback UI language: `en` / `zh` (used by the `/md-preview` command; the `md_preview` tool always passes `ui_lang` explicitly) |

### Listening address & access token

The preview HTTP server is private by default: it binds to `127.0.0.1`, and **every** route — the document page, `/prefs`, the SSE stream, `/asset/*` and every `/doc/*` sub-route (events / close / ask / chat / download) — requires the session's access token in the `?token=` query parameter. Local requests are checked too: a missing or wrong token returns `401`. The token is a URL-safe random string generated when the server starts, unless `MD_PREVIEW_TOKEN` pins it.

Every URL the extension prints (tool output, command transcript) already carries the token. Copy and share it in full — dropping the `?token=...` query turns the link into a 401.

To serve other machines, opt in with a reachable bind address and tell the command which IP the tab should open with:

```bash
MD_PREVIEW_BIND=0.0.0.0 pi

# inside the session
/md-preview reports/summary.md                     # -> http://127.0.0.1:<port>/doc/<id>?token=…
/md-preview reports/summary.md --host 192.0.2.10 # -> http://192.0.2.10:<port>/doc/<id>?token=…
```

- `--host <ip>` only decides which host the browser and the shared URL use; the port and `?token=` always match the server's. It accepts `--host <ip>`, `--host=<ip>` and `--host "<ip>"`, before or after the file path.
- `/md-preview-host <ip|hostname>` persists the browser host in the user-level config: it is used whenever a preview opens without `--host`, in this instance and in every other pi instance (the value is read at call time). `/md-preview-host` shows the persisted value, the effective value with its source and the settings file path; `/md-preview-host --clear` removes it. A persisted host the bind address does not cover keeps working with the same warning described below.
- Binding `0.0.0.0` (or `::`) without `--host` and without a persisted host opens the browser at `127.0.0.1` — the local reading view. A remote reader needs `--host <ip-reachable-from-them>` (or the equivalent manual edit) and must keep the `?token=`.
- A `--host` the bind address does not cover (bound to `127.0.0.1`, asking for a LAN IP) still previews, but the transcript and the UI warning tell you to start pi with `MD_PREVIEW_BIND=0.0.0.0` and restart: the server is a per-session singleton, so an env change mid-session does not rebind an already-running server.
- A malformed `--host` (missing value, given twice, or a URL such as `http://host`) is rejected with an explicit error and no browser is opened.

> Full remote-access walkthrough (pi on a remote server, browser on your laptop, Agent Q&A over the network, plus an SSH-tunnel option): [remote access guide](docs/remote-access.md).

### User-level preference persistence

Theme, reading background, font scale and line height persist on two levels; message delivery mode is also persisted at the user level:

1. **User-level (global)**: `$XDG_CONFIG_HOME/md-preview/settings.json` (`~/.config/md-preview/settings.json` when `XDG_CONFIG_HOME` is unset). Page interactions are debounced and posted to `POST /prefs`, then written atomically; every future preview — any session, any random port — picks them up.
2. **Browser `localStorage`** (`mdp.theme` / `mdp.bg` / `mdp.scale` / `mdp.lineHeight` / `mdp.lang`): same-origin fast cache, effective immediately within a session; when it misses (e.g. a new port), the user-level file is the fallback.

Load priority: `localStorage` (most recent action on this origin) > user prefs file > `MD_PREVIEW_THEME` env hint > built-in defaults (follow system, white background, 100% font, 1.75 line height). Background and line height have no env hint and fall back straight to the built-in defaults. The UI language follows its own chain: in-page `localStorage` choice > server-sent language (tool param / env / default). Message delivery mode is read from the user-level file and defaults to **Follow up**.

`browserHost` is also **user-level only**, but the preview page cannot write it — `POST /prefs` accepts the five page keys (`theme` / `bg` / `scale` / `lineHeight` / `messageMode`) and the server whitelists exactly those, so a page request can never change the saved host. It is set from the `/md-preview-host` command and resolved for every preview as `--host` > persisted `browserHost` > `localBrowserHost(server.host)` (a wildcard bind opens on `127.0.0.1`).

Example prefs file:

```json
{
  "theme": "dark",
  "bg": "wood",
  "scale": 1.15,
  "lineHeight": 1.75,
  "messageMode": "followUp"
}
```

Posting an explicit `null` (e.g. `{"theme": null}`) to `POST /prefs` resets that key to its default.

### Ask the agent about selected text

While reading, select any body text and click the floating "✦ Ask" button to type a question (Enter to send). The server stores a Q&A record and broadcasts an SSE `ask` event; the extension then injects the question into the Pi session as a user message (`deliverAs` follows the page's delivery-mode preference — `followUp` by default, delivered immediately when idle and queued behind a busy turn; `steer` when selected, injected as soon as the running tool batch completes). After answering with the help of the repository's files, the agent calls the `md_preview_reply` tool:

```jsonc
// tool call (omit question_id to answer the earliest unanswered question)
{ "question_id": "q1", "text": "The latency drop mostly comes from a higher cache hit rate… (Markdown supported)" }
```

The reply appears in real time as a card **beside the document** (synced across every tab showing it), containing the quote, the answer and the timestamp; the quoted text is highlighted in orange in the body. Q&A lives with the server — cards and highlights restore automatically after refresh/reopen (highlights are re-located by quote text, so a cross-element selection may lose its highlight on restore; the card itself is unaffected). Pending cards show "Waiting for the agent's reply…", replaced by the live stage while the agent works on it (thinking, running a tool with its name, then writing with a character count). On narrow screens (<1080px) the side rail is hidden and only the orange highlight remains.

To ask about several passages in one go, see [Stash a batch of questions and revisions](#stash-a-batch-of-questions-and-revisions).

### Stash a batch of questions and revisions

Both floating buttons can defer their work instead of sending it immediately.

**Questions.** Select text → "✦ Ask" → write the question → click **Stash** instead of Send. The panel closes, the draft joins the queue, and the toolbar's **Ask** button now carries a count badge. Repeat for as many passages as you like, then click **Ask** once: the page POSTs `POST /doc/<id>/ask-batch` and the extension wakes the agent a single time with every item, each tagged with its own `question_id`. **Send** inside the panel behaves the same way — it stashes the current draft first and then flushes the whole queue, so a half-typed question is never lost. The agent answers item by item:

```jsonc
// one md_preview_reply call per stashed question
{ "question_id": "q4", "text": "… (Markdown supported)" }
```

Each reply lands in that item's own Q&A card, exactly like a single question: the cards start at "Waiting for the reply…" and fill in as the answers arrive; while the batch is being processed they carry the same live stage as a single question. A failed send keeps the queue intact (the toast says so) and drops nothing.

**Revisions.** Select text → "✎ Revise" → describe the change → **Stash** or **Send**; the toolbar's **Revise** button counts the queue and submits it via `POST /doc/<id>/revise`. The injected message is an explicit *document edit request*: the agent edits the Markdown file in place and does **not** answer through `md_preview_reply` or post a chat message — the rewritten document is the only deliverable, so no reply card appears.

Once the file is saved, the agent closes the batch with one call:

```jsonc
// tool call — once per batch, after the edits are on disk
{
  "doc": "d1",                       // optional: document id or its Markdown path; omit for the most recent preview
  "highlights": ["cache hit rate", "p95 fell to 180 ms"]  // optional: one short verbatim phrase per revised passage
}
```

The tool re-renders the document, pushes the new HTML to every open tab, then broadcasts `revision-done`. The page shows the toast "Revision complete; the document has been updated" and marks each matching passage with a color block that holds for ~2 s and fades out by ~3 s. Highlights are plain-text needles copied from the freshly edited text (the rendered page contains no Markdown markers such as `**` or backticks, so pass plain text), up to 20 phrases of 300 characters each. The call is **idempotent**: calling it again for the same batch keeps the original timestamp, so the fade window is not extended — a repeat only refreshes which passages are marked (omitting `highlights` keeps the earlier list). A reload inside the window replays the marks on the original schedule.

**Limits and older servers.** One batch carries at most 20 items: stashing a 21st entry is refused with a toast, so the queue can always be sent as-is. The page has no control to drop an individual stashed entry, and no way to clear the queue either — the batch can only go out whole. Both endpoints are injected into the page with the session token. When the server does not provide `askBatchUrl` / `reviseUrl` — an older extension — the page hides the matching queue button, hides the **Stash** button in that panel, and hides the "✎ Revise" entry entirely; **Send** in the ask panel falls back to the legacy one-shot `POST /doc/{id}/ask`, so the original single-question flow keeps working without queueing.

## Security considerations

- The server binds to loopback by default. **Every route — including requests from the local machine — requires the `?token=` access token**; a missing or wrong token returns `401`. Exposing the server to other machines is opt-in (`MD_PREVIEW_BIND`), and even then access stays token-protected. The page itself makes no external network requests (no CDN, no external assets).
- The token travels in the URL, so it can appear in browser history and terminal transcripts — that is the deliberate trade-off of a share-the-link design. Pin it with `MD_PREVIEW_TOKEN` when you need a stable, known link; `--host` only changes the host of the opened/shared URL and never relaxes authentication.
- The mermaid runtime is served same-origin by the preview server (`/mermaid.mjs`), so diagram rendering produces no external requests either.
- Static assets and link resolution are validated to stay inside (session cwd ∪ previewed document directories); unknown file types return 404, and dangerous types like `text/html` are force-served as `text/plain`.
- The extension never invokes a shell: opening the browser uses `spawn` (`open` / `xdg-open` / `cmd start`) with immediate `unref`, degrading gracefully to "open the URL manually"; the footer version stamp spawns `git` once per process against the extension root (no shell, cached), silently degrading to hidden on failure.
- Exported HTML snapshots keep the workspace badge but drop the absolute path inside it: the `title`, `aria-label` and `data-cwd` attributes are cleared, leaving the directory name. Local paths inside the document body follow the existing rendering rules.
- The port is random (`listen(0)`); tab-close detection uses both `sendBeacon` and SSE disconnect, and server shutdown is idempotent.

## Known limitations

- Markdown support covers the common GFM subset; inline HTML such as `<details>` is rendered as escaped text (for safety).
- Code highlighting is applied client-side in the page using built-in lexical rules (25+ common languages); unsupported languages render as plain-text code blocks; `mermaid` fences bypass highlighting and render as diagrams.
- "Exit 8 s after the last tab closes" is a design choice, not a bug: a quick refresh or network hiccup won't kill your preview; calling the tool again revives it at any time.
- In exported HTML snapshots, mermaid SVG colors stay at the snapshot-time theme even if you switch themes in the snapshot.
- A batch carries at most 20 items; the 21st entry is refused when stashed, so a queue is always sendable — there is no in-page control to drop individual stashed items or to clear the queue.
- Revision highlights are located by plain-text needle: a phrase that spans inline elements, or no longer matches the edited text, marks nothing (the tool's output names the misses).
- Delivery mode is one user-level setting, not per tab or per document, and the page cannot tell whether the agent is busy: a **Steering** message sent while the agent is idle still starts a new turn. If the host or the steering queue is unavailable the message still arrives as **Follow up**, without the steering convention and with no in-page notice; `followUp` messages queued during a turn that never ends wait indefinitely; a failed preference write does not roll the switch back.
- Question progress is document-level, not per-question: pi events carry no document id, so a pending question or chat message shows the agent's current stage even while the turn works on something else. It is a stage indicator, not a log — no history, no percentage, no cancel control.

## Development

```bash
npm install                 # install type-checking dependencies
npm run check               # strict TypeScript check (run after every change)
npm run check:i18n          # bilingual string-table + language-channel assertions
npm run demo -- --smoke     # end-to-end smoke: render + server + SSE
```

## License

MIT. This package vendors a self-contained [Mermaid](https://github.com/mermaid-js/mermaid) build (`extensions/md-preview/vendor/mermaid.esm.min.mjs`, MIT License) served lazily from the preview server's own origin — see `NOTICE`.
