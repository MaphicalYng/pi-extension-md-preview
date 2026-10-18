# pi-md-preview logo

A Markdown file becoming a page: the **ink tile** is the preview window it opens in,
the **warm paper** is the typeset document, and the **blue folded corner** is the raw
file lifting away to reveal the rendered result. The dark title bar and two grey rules
are the typographic content — a heading, a paragraph, and a ragged last line.

The same page-with-folded-corner idea already lives in the preview page's own topbar
icon (a 17px line-art glyph in `extensions/md-preview/page.ts`); this is its filled,
app-icon-sized counterpart.

## Files

| File | Use | Notes |
| --- | --- | --- |
| `logo.svg` | primary mark | ink tile + gradient paper, drop shadows; 512×512 |
| `logo-mark.svg` | transparent glyph | same art, no tile; for light/coloured photos backgrounds |
| `logo-mono.svg` | single colour | `currentColor`; the fold is a knocked-out crease |
| `favicon.svg` | 16–32px | flat colours, heavier bars, bigger paper; no shadows |
| `logo-512.png` / `logo-128.png` | raster of `logo.svg` | transparent rounded corners |
| `favicon-32.png` / `favicon-16.png` | raster of `favicon.svg` | |

## Palette

| Role | Value |
| --- | --- |
| Ink tile | `#0e1116` flat; gradient `#1e2838 → #121822 → #090c11` in `logo.svg` |
| Paper | `#f7f3ea` flat; gradient `#fffefa → #f9f5ec → #efe9dc` |
| Accent (fold) | `#4a86f0` flat; gradient `#aacdff → #5090f7 → #2a61d8` |
| Type (heading / rules) | `#12161d` at 100% / 42–45% |

## Rules

- **Clear space** — keep at least 1/8 of the mark's height free on every side.
- **Minimum size** — 40px for `logo.svg`; below that switch to `favicon.svg`
  (16–32px), which is drawn specifically for the tab strip.
- **Do not** recolour the fold, rotate or skew the mark, add strokes, or replace the
  warm paper with pure white — the paper tone is what keeps the mark from looking
  like a generic file icon.
- **On dark or busy backgrounds** use the tile version; `logo-mark.svg` needs
  contrast behind the paper edge, so avoid it on mid-grey.
- **Mono** — `logo-mono.svg` paints in `currentColor`; set `color` on a parent.
  Do not try to reproduce the tile in mono.

## Where it is used

- `README.md` / `README.zh-CN.md` hero (`logo-512.png`, 104px).
- Browser tab icon: the `favicon.svg` markup is inlined as an `encodeURIComponent`ed
  data URI in `extensions/md-preview/page.ts` (`FAVICON_SVG`), so the page stays
  single-file and offline-safe. **If you edit `favicon.svg`, update that constant too.**
- The in-page topbar keeps its 17px line-art icon — a filled mark turns to mush at
  that size.

## Regenerating the PNGs

Uses headless Chrome; no other tooling is required.

```sh
L=assets/logo
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --default-background-color=00000000 \
  --window-size=512,512 --screenshot=$L/logo-512.png "file://$PWD/$L/logo.svg"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --default-background-color=00000000 \
  --window-size=512,512 --screenshot=/tmp/favicon-512.png "file://$PWD/$L/favicon.svg"

sips -z 128 128 "$L/logo-512.png" --out "$L/logo-128.png"
sips -z 32 32 /tmp/favicon-512.png --out "$L/favicon-32.png"
sips -z 16 16 /tmp/favicon-512.png --out "$L/favicon-16.png"
```
