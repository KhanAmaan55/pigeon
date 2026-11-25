# PIGN-059 — Pigeon brand, round look and type scale

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-059 | 9 — Later | Later | Done | PIGN-058 |

## Goal
Give Pigeon its own personality instead of a generic look: the new Pigeon icon everywhere, a round, friendly design inspired by Google's products (an inspiration, not a copy), and a real type scale so titles, labels and body text read differently.

## User story
As a user, I want Pigeon to feel like its own product — recognisable icon, friendly round shapes, clear hierarchy in the text — while staying dense enough for API work.

## Scope
**In scope**
- The new icon (indigo square, white pigeon, lavender wing) for the desktop app (macOS `.icns` on Apple's 824/1024 grid, Windows `.ico`, PNGs), the web favicon and Apple touch icon, and next to the "Pigeon" wordmark in the top bar.
- Palette from the icon: indigo accent, lavender containers, lavender-tinted neutrals, both themes, WCAG AA kept.
- Round shapes: pill buttons, tabs, chips, tree rows, URL bar and filter; rounder fields, cards, menus, panel and dialogs; a navigation rail with labelled pill indicators; a tonal button variant.
- Typography: Google Sans Flex (OFL, bundled, offline) with its roundness axis, a type scale (10–28 px) and title/label/body roles.

**Out of scope**
- Layout or behaviour changes beyond the navigation rail labels.

## Acceptance criteria
- [x] Desktop icons (`apps/desktop/src-tauri/icons`), web favicons (`apps/web/public`) and the top-bar logo use the new icon.
- [x] The top bar shows the icon and the "Pigeon" wordmark in the round display style.
- [x] Accent and containers come from the icon's indigo and lavender; contrast test and axe (light and dark) pass.
- [x] Buttons, tabs, chips, tree rows, the URL bar and the filter are pill-shaped; dialogs, panels, cards and menus use the larger radii.
- [x] Google Sans Flex is bundled (no runtime fetch), with a type scale that separates titles, section labels, body and captions.
- [x] All unit, UI, E2E and perf tests pass; desktop smoke passes; both themes reviewed in screenshots.

## Implementation notes
- **Icon**: made from the provided artwork with Pillow: a 1024 px full-bleed master for Windows/Linux and PNGs (`tauri icon`), and a macOS master with the shape at 824 px centred on a transparent 1024 canvas (Apple's icon grid), used only for `icon.icns`. Web: `favicon.png` (64 px), `apple-touch-icon.png` (180 px), `icon-512.png`. In-app: `packages/ui/src/assets/pigeon-icon.png` (128 px, shown at 26 px).
- **Font**: `@fontsource-variable/google-sans-flex` 5.3.2, `rond.css` (weight + roundness axes; Latin file 71 KB, other scripts load only when used). Body `ROND` 30, `font-round` utility `ROND` 100 for the wordmark and titles.
- **Tokens**: light accent #4b42e9 (white 6.4:1), lavender `selected` #e3e0fc; dark accent #5a51f0, `selected` #302c66, `accent-text` #b6b1ff. Light warn/info/head/GraphQL colours darkened slightly to stay at 4.5:1 on the tinted surfaces. Radii 6/10/14/20/28 px; chrome 48/44/28/72 px.
- **Components**: `Button` is round with a new `tonal` variant; tabs are round with the lavender active state; dialogs 28 px with 18 px titles; menus 14 px with 32 px rows; `EmptyState` shows its icon in a lavender tile with a 15 px title; `SectionLabel` is 12 px semibold in the text colour.
- **Shell**: the navigation rail replaces the icon-only activity bar (labels are `aria-hidden`; each button keeps its full title as the accessible name and test id); the URL bar is a 40 px pill with a matching Send button; explorer rows are 30 px pills.
