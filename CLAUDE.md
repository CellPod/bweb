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
- **`playwright-cli`/CDP clicks cannot verify `-webkit-app-region` drag-region bugs, in either
  direction.** A CDP-injected click goes straight to the renderer and never exercises the
  native window's drag-region hit-test, so a button trapped inside a `drag` region (missing
  its own `no-drag`) still reports as "clicked successfully" in automated testing while being
  completely dead in real usage (this shipped once, 2026-09-18: `#homeTopTabs` moved into
  `.app-titlebar`, a drag region, without its own `no-drag`). Whenever new interactive markup
  lands inside a `-webkit-app-region: drag` element, check `getComputedStyle(el)
  .getPropertyValue('-webkit-app-region')` resolves to `no-drag` on it or an ancestor. That's
  as far as automated verification goes; real click confirmation needs the user.
- **Scope `no-drag` to the actual interactive element, not a wrapper sized to fill most of
  the drag region around it.** Fixing the bug above by putting `no-drag` on `#homeTopTabs`
  (a `flex: 1` box spanning nearly the whole titlebar) shipped a worse regression the same
  day: it made all the empty space around the Fetch/Queue/History pill undraggable too, so
  the window could barely be moved at all. `no-drag` belongs on `.content-top-tabs-frame`
  (the visible pill itself), not on every ancestor between it and the drag region.

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
  Queue and History are reached through `#homeTopTabs`, a segmented bar living in
  `.app-titlebar` (see the shell bullet below) so it can stay visible across all three.
  `switchTab()` shows/hides it and syncs its active pill via the `HOME_TABS` array, the same
  pattern `TOOL_TABS` uses for the Tools hub. Clicking the titlebar logo/app-name also calls
  `switchTab('download')`.
- **App shell is titlebar + sidebar + content card, in that nesting** (as of 2026-09-18, the
  OmniGet-style "window within the window" restructure, see `HISTORY.md`). `.app-titlebar` is
  one full-width bar above both the sidebar and the content: `.titlebar-sidebar-spacer` (an
  empty element the exact width of `.sidebar`, via the shared `--sidebar-w` token) comes
  first, then `#homeTopTabs` (centered in the space after it, so it lines up with the hero
  below rather than the full window width), then `.titlebar-brand` pinned to the far right
  with `margin-left: auto` regardless of whether `#homeTopTabs` is visible. The spacer also
  covers the macOS traffic lights (it's always well over their ~80px, even at the sidebar's
  140px resize minimum), so there's no separate padding-left rule for them here.
  `initSidebarResize()` in `renderer.js` updates `--sidebar-w` (not `.sidebar.style.width`
  directly) so the spacer tracks a live resize drag; `.sidebar`'s own `width` reads from the
  same token, don't hardcode 186px again in either place. `.sidebar` starts below the
  titlebar, not at the top of the window. `.app-titlebar` is `46px` tall (trimmed down from
  its original `56px` on 2026-09-18 to match the OmniGet reference more closely);
  `.content-top-tabs-frame`/`.content-top-tab` padding was trimmed to match. That alone
  didn't fix the gap the user kept flagging between the Fetch/Queue/History pill and the
  sidebar nav below it: `.content-top-tabs-frame` is already correctly centered inside the
  46px bar (6px above, 6px below, confirmed with `getBoundingClientRect()`), but `.sidebar`
  used to add its own `padding-top: 10px` on top of that before its first nav item, on top
  of `.sidebar-nav`'s own 4px padding, making the space below the pill (20px) about 3x the
  space above it (6px) despite the pill itself being centered. Confirmed pixel-precise via
  the user annotating the live app directly (`playwright-cli show --annotate`) rather than
  another round of guessing from screenshots. Fixed by removing `.sidebar`'s own
  `padding-top` entirely: `.sidebar-nav`'s existing 4px top padding is now the only inset,
  bringing the gap down to 10px, close to the 6px above the pill. `.content-area` is a
  visually distinct card
  (`--card` background, border, `--radius-lg`, margin gutter on all 4 sides) over
  `.app-body`'s `--sidebar-bg`, not a flush panel. Don't reintroduce a header row inside
  `.sidebar` or `.content-area` (that's what caused two independent traffic-light-clearance
  zones stacked instead of one, the original bug this restructure fixed). Any new chrome-level
  element (brand, global tabs, future search/actions) belongs in `.app-titlebar`.
- **`#tab-download` centers vertically, other views don't** (as of 2026-09-18). It's the only
  `.view` with `justify-content: safe center` (`#tab-download.view.active` in `index.css`): the
  `safe` keyword falls back to top alignment once fetched results make it taller than the
  viewport, so a long result list still scrolls from the top instead of centering with its top
  clipped. Don't add this to Queue/History/Tools/tool views, they're lists meant to start at
  the top like OmniGet's own Downloads/History tabs.
- **Never hand-draw or AI-generate an SVG icon for this app, full stop (rule set 2026-09-18,
  immutable).** Every icon in the sprite at the top of `index.html` must come from the real
  Iconoir set (iconoir.com / github.com/iconoir-icons/iconoir, MIT), fetched and copied
  verbatim, never invented. Two icons broke this before the rule existed and were swapped for
  the genuine Iconoir path once caught: `ic-grid` (was a hand-drawn square-with-cross-lines,
  now Iconoir's real `dots-grid-3x3`) and the original `.tool-back-link` arrow (was a hand-
  drawn arrow-with-shaft, now Iconoir's real `nav-arrow-left` chevron, see the bullet above).
  If the exact icon needed doesn't exist in Iconoir, say so and ask, don't approximate one.
- **Don't assume a shared CSS class is safe to reuse across tabs without checking its
  assumptions fit the new context.** `.convert-container`'s `margin: 0 auto` centering
  is right for Convert/Compress's centered empty-drop-zone hero state, but wrong for a
  left-aligned form like QR Code — reusing it there floated the whole tab's content
  detached from its own left-aligned title. Check what a shared class actually *does*
  before reusing it, don't assume "it's already used elsewhere so it's safe here too."
- **Every tool view's `.view-header-text` needs its `.view-title` AND a `.view-subtitle`
  describing what the tool does** (restored 2026-09-18: all six had lost their subtitle
  during the OmniGet restructure, leaving only a bare title with no explanation of what the
  tool does; only the Tools hub tiles still had the description text). Reuse the exact same
  `*.subtitle` i18n key the tool's own hub tile already uses (`convert.subtitle`,
  `qrcode.subtitle`, etc.) rather than writing new copy, so the tile and the tool's own page
  never say something different. `.view-header` uses `align-items: center` (not
  `flex-start`) specifically so `.view-header-actions` (the "Saving to" button) centers
  against this now-3-line block instead of hugging its top edge.
- **A 2-column `.qr-body`/`.redact-body` grid (content + 220px sidebar) needs a widened
  container, not the default `.convert-container` (`max-width: 600px`).** Redact already had
  `.redact-container { max-width: 980px }` for this. QR Code didn't, so its grid was
  squeezed into ~300px of usable width and read as "not centered, kind of a mess" (verbatim
  user feedback, 2026-09-18). Fixed with the same recipe: `.qr-container { max-width: 980px }`
  added alongside `.convert-container` on QR's own container div. Any future 2-column tool
  page needs this same override, the 600px default is sized for the single-column drop-zone
  tools (Convert/Compress/Watermark/Background Remover), not a sidebar layout.
- **`.format-picker`'s default width is `220px`, centered (`margin: 0 auto`), not `100%`**
  (changed 2026-09-18). Convert's 3 sub-view format triggers (video/audio, image, document)
  used to stretch to fill `.convert-option-group`, reading as an oversized bar with the
  value pinned left and the chevron pinned at the far right: "not centered" even though the
  wrapper column itself was. Now matches the fixed-width recipe `.batch-quality-picker`
  already used, made the app-wide default instead of a one-off override, sized to
  comfortably fit the longest real trigger label (`MP4 · H.264`). `.convert-option-group`
  gained `align-items: center` to match. `.batch-quality-picker`'s own width/margin
  declaration is now redundant with the base default but was left in place rather than
  removed, so Batch's sizing stays self-contained if the Convert-driven default ever
  changes again for a Convert-specific reason.

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
