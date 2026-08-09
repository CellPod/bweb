# Product

## Register

product

## Users

Non-technical people who want a video/creator toolbox that "just works" — they are not
developers and do not want to touch code or configuration. They expect an app that feels
close to finished/polished out of the box, the way a well-made consumer app does. Primary
jobs: download/convert video and audio locally, plus a growing set of everyday creator
utilities (compress, watermark, redact, remove backgrounds, generate QR codes) — all
100% local, no cloud, no uploads, no tracking. Privacy and "runs entirely on your machine"
is part of the product's actual value, not just a footnote.

## Product Purpose

A local-first, privacy-respecting alternative to scattered web tools and paid SaaS
utilities for creators — one app instead of ten browser tabs and ten different privacy
trade-offs. Success looks like: a first-time user can find and complete any task (fetch a
video, compress an image, remove a background) without needing to read documentation or
guess what a control does.

## Brand Personality

Warm, accessible, reassuring — sober, not flashy, but never cold or clinical. Explicitly
NOT generic "AI-slop" (templated gradients, meaningless motion, cookie-cutter card grids).
Clean and well organized, in the spirit of Airbnb or Apple's product design: calm surfaces,
confident typography, one warm accent color doing real work (the existing orange/tomato
accent is right — keep it, don't replace it with something colder). Small, tasteful
animations are welcome (state transitions, subtle entrance/hover feedback) but should never
feel decorative for its own sake — motion earns its place by clarifying what happened, not
by being "delightful" for its own sake.

## Anti-references

- Generic AI-generated SaaS look: gradient-on-dark heroes, identical card grids, eyebrow
  labels on every section, purple/blue glow accents, Inter-everywhere with no hierarchy.
- Anything that reads as "unfinished" or "developer tool with no polish" — this app is for
  people who do not touch code and expect a consumer-grade experience.
- Overly clinical/cold enterprise-dashboard aesthetics (dense data-table look, no warmth).

## Design Principles

- **Never make the user guess.** Every control should be understandable without reading
  documentation — this is the core reason "Error Correction"/raw pixel inputs were removed
  from the QR Code tool in favor of plain-language controls.
- **Warm but restrained.** One accent color carries meaning; everything else stays quiet
  so the accent (and the content) can stand out.
- **Motion with a job to do.** Small animations are used to confirm state changes and guide
  attention, not sprinkled in decoratively. A little more motion than a strict minimal
  product is fine, but never at the cost of feeling slow or fussy.
- **Consistency over novelty per tab.** A shared visual vocabulary (cards, empty states,
  buttons, spacing) should read as one coherent app across Download/Convert/Compress/
  Privacy/QR Code/Background Remover, not seven separately designed mini-apps.
- **Privacy is a design fact, not just a feature list item.** Where relevant (destination
  paths, "nothing uploaded" messaging), the UI should make the local-only nature of an
  action legible, reinforcing user trust.

## Accessibility & Inclusion

Target: WCAG AA (contrast ≥4.5:1 body text / ≥3:1 large text, visible focus indicators,
keyboard operability). Respect `prefers-reduced-motion` for anyone who needs it, but the
product's default motion level is slightly above a strict "minimal/static" baseline — small
purposeful animations are part of the intended feel, not something to strip out by default.
