# bWeb — Agent Instructions

bWeb is an Electron desktop app wrapping yt-dlp + ffmpeg for downloading/converting
video and audio, forked from [ArcDLP](https://github.com/archisvaze/arcdlp) and now
pivoting into a broader local-first creator toolbox (Compress, Watermark, Redact,
Background Remover, QR Generator shipped; Transcript next).

**Before touching this project, read `TODO.md` in full.** It's gitignored (local-only,
not on GitHub) and is the actual source of truth for the backlog, what's shipped, what
was tried and reverted, and every non-obvious bug/decision from past sessions — don't
rely on memory of its contents, it gets rewritten often. `README.md` is the public-facing
doc (git-tracked) — keep it in sync whenever a user-visible feature ships or changes.

## Documentation des libs

Avant d'écrire du code qui utilise une bibliothèque (React, Next.js, Node, Prisma, etc.) :
- Récupère la doc à jour via Context7.
- Ne te base pas uniquement sur ta connaissance d'entraînement.
- Préfère les APIs de la version installée dans le projet.

## License discipline

This project avoids copyleft (GPL/AGPL) in favor of permissive alternatives (MIT/Apache-2.0)
whenever one exists — verify each dependency's actual license on its own repo/npm page
individually, don't assume from a package's popularity or category. When a copyleft
dependency is genuinely the only real option (e.g. `@jspawn/ghostscript-wasm`, AGPL-3.0,
runs in-process — no portable native Ghostscript binary exists for macOS/Linux), say so
explicitly and get the user's explicit sign-off rather than silently absorbing it — this
project is private/non-commercial with higher risk tolerance than a commercial product,
but that's a judgment call for the user to make, not to assume. When a dependency bundles
a non-standard license (e.g. Meta's DINOv3 license behind `withoutbg`), the attribution/
credit obligation is real and must actually ship — see `licenses/` and the About screen.

## Testing discipline

- **Test UI changes at a realistic window size, not just the small dev-default window.**
  Several real bugs this project has hit (a circle frame becoming a squashed oval, content
  floating detached from its own title) were completely invisible at a small ~1200×800
  test window and only showed up around 1900px — always resize the browser via
  `playwright-cli resize` to something wide before calling a layout fix verified.
- **Verify the actual exported/output file, not just the live preview.** A bug can exist
  in export-time compositing code that never touches the preview path, or vice versa —
  composite exported images onto a checkerboard and inspect them, don't just eyeball the
  in-app preview.
- **When working with ML model output (masks, scores, confidence), verify the model's own
  raw values, not just a rendered visualization.** A visualization can be made to look
  like there's a clear signal through min-max stretching a range that's actually a flat,
  low-confidence dud — read `output.data` min/max directly before trusting what an image
  of a mask *looks* like.
- **Match each model's own reference implementation's postprocessing exactly** (sigmoid vs.
  min-max stretch vs. plain clip) — a generic recipe applied to every model manufactures
  false confidence on one that was never meant to be stretched.

## Architecture rules

- **Local file tools live in the Tools catalog hub, not as individual sidebar rows** (as of
  2026-09-18, see `HISTORY.md` for the OmniGet-driven redesign). Sidebar has one "Tools" row
  (`#tab-tools` in `index.html`, `.tools-grid`/`.tool-tile` in `index.css`); each tool is a
  tile that calls `switchTab(<tool>)`. A new tool means a new tile in that grid plus a new
  `--tool-<name>`/`--tool-<name>-soft` color pair in `index.css`, never a new top-level
  sidebar row. `switchTab()` in `renderer.js` keeps the sidebar's "Tools" row highlighted
  while any tool tab is open via the `TOOL_TABS` array, don't forget to add a new tool's
  tabId there too. Every tool view needs a `.tool-back-link` (see Convert/Compress/Watermark/
  Redact/QR/BgRemove in `index.html`) since there's no sidebar row of its own to click back to.
  **Each tool is its own tile and its own tab, full stop, don't merge two tools behind an
  internal mode-switcher again** (this was tried once for Watermark/Redact under a shared
  "Privacy" tab and reverted 2026-09-18: it made no sense once the tile grid itself already
  solved the sidebar-clutter problem that merge existed for, and users couldn't tell there
  even were two separate tools inside).
- **Download/Queue/History share one "Home" sidebar row** (as of 2026-09-18), not three
  separate rows. Fetch is the centered Home hero (`.dl-hero` in `index.html`/`index.css`);
  Queue and History are reached through `#homeTopTabs`, a segmented bar that's a sibling of
  `.view` (not inside one) so it can stay visible across all three. `switchTab()` shows/hides
  it and syncs its active pill via the `HOME_TABS` array, the same pattern `TOOL_TABS` uses
  for the Tools hub. Clicking the sidebar logo/app-name also calls `switchTab('download')`.
- **Don't assume a shared CSS class is safe to reuse across tabs without checking its
  assumptions fit the new context.** `.convert-container`'s `margin: 0 auto` centering
  is right for Convert/Compress's centered empty-drop-zone hero state, but wrong for a
  left-aligned form like QR Code — reusing it there floated the whole tab's content
  detached from its own left-aligned title. Check what a shared class actually *does*
  before reusing it, don't assume "it's already used elsewhere so it's safe here too."

## Recurring CSS bugs to watch for

These have each cost real debugging time more than once in this codebase:

1. **`el.style.display = ''` does not show an element whose CSS default is `display:none`**
   — clearing an inline style just re-exposes the CSS default. Set an explicit value
   (`'block'`, `'flex'`, etc.) instead.
2. **`sharp` silently promotes a single-channel raw buffer to 3 channels during `.resize()`**
   — force `.toColourspace('b-w')` before `.raw().toBuffer()` when working with a mask.
3. **A circle only fully contains a square if its radius reaches the square's corners**
   (≥ `√2/2 ≈ 70.7%` of the side, i.e. half the diagonal) — not just half the side. Too
   little padding clips corner content every time; this must be computed from the actual
   content size, not a fixed guess.
4. **`margin: 0 auto` on a flex item with no explicit `width` disables the parent's default
   stretch** — the item shrinks to fit only its own content instead of filling available
   space. Needs an explicit `width: 100%` (or similar) alongside `max-width` + `margin: auto`.
5. **A dark theme can pass on text contrast while still being unreadable**, because borders
   and input/card boundaries are a separate WCAG check (non-text contrast, 3:1) that text
   contrast math doesn't cover. bWeb's original dark tokens had `--text` at 16:1 against `--bg`
   (fine) but `--border`/`--input-border` at only 1.4:1 against their surface (invisible),
   which read as "everything is black" even though headings were legible. Fixed 2026-09-18 by
   computing actual contrast ratios (see `HISTORY.md`) instead of eyeballing oklch numbers,
   don't just nudge lightness values and hope.

## Recurring build/release bugs to watch for

1. **electron-builder's per-platform `files`/`asarUnpack`/`extraFiles` *replace* the
   top-level array, they don't merge with it.** A per-platform override with only
   exclusion patterns and no positive include disables the whole whitelist — always
   repeat the top-level patterns inside it. This once leaked gitignored internal files
   into a published `app.asar`.
2. **After changing `files`/`asarUnpack`/`extraFiles`, run `asar list` on the built
   `app.asar` and compare its size to the previous release before publishing**, not
   after.

## Git conventions

- Commit messages: short summary line, then bullets or prose explaining *why*, matching
  the existing log style (`git log` for examples) — not a changelog of every line touched.
- **Never add a `Co-Authored-By` line without asking first.**
- **Never commit a file over ~100MB** (GitHub hard-blocks it) — gitignore it and add a
  fetch step to `scripts/postinstall.js` instead, following the existing yt-dlp/deno/
  withoutbg-model pattern, so a fresh clone still works without a manual step.
- Don't create a GitHub Release unless explicitly asked — a plain push to `main` is the
  default when the user says "push"/"save the work."
