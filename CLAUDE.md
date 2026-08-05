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

- Every new tool is a new top-level sidebar tab (never folded into an existing tab like
  Convert). Small related tools get grouped as sub-tabs *within* one tab (e.g. Watermark/
  Redact under "Privacy") to avoid sidebar clutter — this has been explicitly re-decided
  more than once, don't propose "just extend Convert" again.
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

## Git conventions

- Commit messages: short summary line, then bullets or prose explaining *why*, matching
  the existing log style (`git log` for examples) — not a changelog of every line touched.
- **Never add a `Co-Authored-By` line without asking first.**
- **Never commit a file over ~100MB** (GitHub hard-blocks it) — gitignore it and add a
  fetch step to `scripts/postinstall.js` instead, following the existing yt-dlp/deno/
  withoutbg-model pattern, so a fresh clone still works without a manual step.
- Don't create a GitHub Release unless explicitly asked — a plain push to `main` is the
  default when the user says "push"/"save the work."
