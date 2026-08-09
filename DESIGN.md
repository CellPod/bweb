---
name: bWeb
description: A local-first, privacy-respecting creator toolbox (download, convert, compress, watermark, redact, remove backgrounds, generate QR codes)
colors:
  bg: "oklch(0.96 0.012 60)"
  surface: "oklch(0.99 0.004 55)"
  surface-2: "oklch(0.93 0.015 58)"
  surface-3: "oklch(0.88 0.018 55)"
  border: "oklch(0.88 0.015 58)"
  sidebar-bg: "oklch(0.91 0.010 58)"
  text: "oklch(0.18 0.025 40)"
  text-2: "oklch(0.42 0.020 40)"
  text-3: "oklch(0.64 0.015 40)"
  accent: "oklch(0.52 0.195 35)"
  accent-hover: "oklch(0.44 0.165 35)"
  accent-soft: "oklch(0.52 0.195 35 / 0.10)"
  danger: "oklch(0.55 0.22 20)"
  success: "oklch(0.60 0.18 145)"
  warning: "oklch(0.62 0.17 60)"
typography:
  page-title:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 700
  card-title:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "6px"
    padding: "6px 12px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
---

# Design System: bWeb

## 1. Overview

**Creative North Star: "The Trusted Local Workshop"**

bWeb is a set of everyday creator tools (download, compress, watermark, redact, remove
backgrounds, generate QR codes) that runs entirely on the user's own machine — no cloud,
no uploads, no account. The design has to earn the trust that claim implies: calm,
legible, never showy. It borrows its confidence from consumer products like Airbnb or
Apple's own apps — clean surfaces, one warm accent doing real work, generous but not
wasteful whitespace — rather than from developer tools or admin dashboards. The audience
is explicitly non-technical: every screen should read as finished and self-explanatory,
never like a tool that assumes prior configuration knowledge.

This system explicitly rejects the generic AI-SaaS look: no gradient-on-dark heroes, no
identical card grids, no eyebrow labels stacked above every section, no purple/blue glow
accents, no Inter-everywhere-with-no-hierarchy. It also rejects the opposite failure mode —
a cold, dense, enterprise-dashboard aesthetic with no warmth at all.

**Key Characteristics:**
- One warm accent color (currently a deep tomato/crimson, oklch hue 35) carries all
  interactive meaning — buttons, active nav state, focus rings, badges.
- Flat-by-default surfaces with very subtle elevation, not glassy or gradient-heavy.
- Small, purposeful motion (button press feedback, panel open/close, hover states) —
  present but never showy or decorative.
- A single sans typeface (Inter) at a disciplined 8-step type scale, never a display/serif
  pairing — this is a utility app, not a marketing site.

## 2. Colors

The palette is a warm, slightly tinted neutral scale (oklch hue ~40-60) with one saturated
accent breaking through it. Both a light theme (default) and a dark "anthracite" theme
exist, following the OS preference or a manual override.

### Primary
- **Deep Tomato** (oklch(0.52 0.195 35), lighter oklch(0.66 0.200 35) in dark mode): the
  single accent. Used for primary buttons, the active nav-item state, focus/selection
  states, and progress indicators. Nothing else in the interface competes with it for
  attention — this is the one color users are meant to associate with "action."

### Neutral
- **Warm Paper** (oklch(0.96 0.012 60)): app background (light theme).
- **Warm White** (oklch(0.99 0.004 55)): card/surface background (light theme).
- **Ink** (oklch(0.18 0.025 40)): primary text (light theme).
- **Anthracite** (oklch(0.14 0.008 258)): app background (dark theme) — note the dark
  theme shifts to a cooler, near-neutral hue rather than a darkened version of the warm
  light palette; this is deliberate, not an oversight.

### Named Rules
**The One Accent Rule.** Exactly one accent color is active at a time (users can pick
from six presets — Blue, Indigo, Purple, Teal, Tomato, Amber — in Settings, but only one
renders at once). A screen never mixes two accent hues to indicate two different kinds of
action.

## 3. Typography

**Body/UI Font:** Inter (bundled as a local `@font-face`, not loaded from Google Fonts),
with `system-ui, -apple-system, 'Segoe UI', sans-serif` as fallback.
**Mono Font:** JetBrains Mono (log panel, file paths, timestamps only).

**Character:** A single, disciplined sans typeface used at every size — no serif or
display face anywhere. This is a deliberate anti-decoration choice for a utility app: the
type should never call attention to itself, only to the content and controls around it.

### Hierarchy
- **Page title** (700, 20px / `--fs-2xl`): one per view, top of each tab (`.view-title`).
- **Card title** (600, 16px / `--fs-lg`): video/card headline text.
- **Emphasized body** (500-600, 14px / `--fs-md`): empty-state titles, section labels.
- **Body** (400, 13px / `--fs-base`): default running text throughout the app.
- **Label / meta** (500, 12px / `--fs-sm` down to 400, 11px / `--fs-xs`): secondary
  labels, timestamps, badges, uppercase section headers.

### Named Rules
**The One Scale Rule.** Every font size in the app must trace back to one of the 8 steps
in the `--fs-*` scale (`--fs-2xs` 10px through `--fs-2xl` 20px). A one-off pixel value not
on this scale is a bug, not a design choice — it silently breaks the app's visual rhythm.

## 4. Elevation

Flat by default. Shadows exist but are deliberately subtle (`--shadow-sm`, `--shadow`) —
this is a flat-surface system with tonal layering (surface / surface-2 / surface-3)
doing most of the "depth" work, not drop shadows. Shadows are tinted toward the app's own
ink color rather than pure black, so they read as soft depth rather than a harsh cutout.

### Shadow Vocabulary
- **Ambient (`--shadow-sm`, `0 1px 3px oklch(0.18 0.025 40 / 0.07)`)**: default resting
  shadow on cards.
- **Raised (`--shadow`, `0 2px 10px oklch(0.18 0.025 40 / 0.10)`)**: hover / active states,
  popovers, modals.

### Named Rules
**The Tonal-First Rule.** Reach for a `surface-2`/`surface-3` background shift before
reaching for a shadow to indicate hierarchy. Shadows are the last resort, not the default.

## 5. Components

### Buttons
- **Shape:** 10px radius (`--radius`), matching cards and inputs — one radius scale for
  the whole app.
- **Primary:** accent background, white text, 600 weight, `10px 20px` padding
  (`.btn-primary`). Hover darkens to `--accent-hover`; active press scales to 0.97.
- **Ghost / Secondary:** transparent background, `--text-2` color, 1px `--input-border`
  border (`.btn-sm`, `.btn-clear`). Hover shifts border/text toward full-strength `--text`
  (or toward `--danger` for destructive ghost actions like Clear).
- **Download CTA:** a larger, full-width variant of the primary button (`.btn-download`,
  14px padding, 16px text) used for the single highest-priority action in a view.

### Cards
- **Corner style:** 10px radius, occasionally 14px (`--radius-lg`) for larger containers
  like the playlist card.
- **Background:** `--card`/`--surface` (near-white in light mode, dark anthracite surface
  in dark mode).
- **Border:** 1px `--card-border`, always present — cards are not shadow-only.
- **Shadow strategy:** ambient shadow at rest (see Elevation); no hover-lift on static
  content cards, since bWeb's cards are informational, not clickable navigation elements.

### Inputs / Fields
- **Style:** `--input-bg` background, 1px `--input-border`, same radius as buttons.
- **Focus:** currently inconsistent across the app (a known gap being fixed in this
  redesign pass) — target is a visible `--accent`-colored focus ring on every interactive
  element, respecting `:focus-visible` rather than `:focus`.

### Navigation (Sidebar)
- **Style:** icon + label rows (`.nav-item`), 13px/500 weight text, 8px radius, full width.
- **Default / hover / active states:** transparent → `--surface-2` on hover → `--accent-soft`
  background with `--accent` text and 600 weight when active.
- **Grouped sub-navigation** (new in this redesign): related tabs (Download's Fetch/Queue/
  History) are grouped under a small uppercase `--text-3` label (`.nav-group-label`) with
  slightly indented sub-items (`.nav-item-sub`), rather than each appearing as an unrelated
  flat top-level row.

## 6. Do's and Don'ts

### Do:
- **Do** keep exactly one accent color active on screen at any time — it is the app's one
  loud element, everything else stays quiet.
- **Do** use small, purposeful motion (button press scale, panel open/close, hover
  feedback) — a bit more motion than a strictly minimal/static product, per the product's
  "warm, accessible, reassuring" personality, but always tied to a real state change.
- **Do** respect `prefers-reduced-motion` for every animation added.
- **Do** trace every font-size and spacing value back to the existing `--fs-*`/`--space-*`
  scales rather than introducing one-off values.
- **Do** make every control understandable without documentation — plain-language labels
  over technical jargon (this is why "Error Correction" was removed from the QR Code tool
  in favor of an automatic, invisible default).

### Don't:
- **Don't** introduce a second saturated accent color anywhere in the UI.
- **Don't** reach for glassmorphism, gradient text, or gradient-on-dark hero treatments —
  this is a utility app, not a marketing surface.
- **Don't** use `transition: all` — list the exact properties being animated.
- **Don't** ship an interactive element with no visible `:focus-visible` state.
- **Don't** let a tab's design drift from the others — buttons, cards, and empty states
  must share one visual vocabulary across Download/Convert/Compress/Privacy/QR Code/
  Background Remover, not look like seven separately designed mini-apps.
- **Don't** make the interface feel like a "developer tool with no polish" — the audience
  explicitly does not touch code and expects a consumer-grade, near-finished experience.
