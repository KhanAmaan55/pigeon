# PIGN-002 — Web app shell & layout

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-002 | 0 — Foundation | MVP | In review (CI pending) | PIGN-001 |

## Goal
A running web app (`apps/web`) rendering the Pigeon layout from `packages/ui` with placeholder panels, themes, and a Playwright smoke test.

## User story
As a developer, I want to open Pigeon in my browser and see the app layout, so the UI foundation exists for every feature.

## Context
- UI stack D-04 and layout: [architecture.md §8](../architecture.md#8-ui--state-management), [ui-ux.md §1–2](../ui-ux.md#2-layout).
- E2E conventions: [testing.md §4](../testing.md#4-e2e-conventions).

## Scope
**In scope**
- `packages/ui`: React 19 + Tailwind + Radix setup; `AppShell` with top bar (project tabs placeholder, environment selector placeholder), activity bar, sidebar, main area (request tabs placeholder), status bar. Light/dark theme following `prefers-color-scheme` + manual toggle (in-memory for now).
- Design tokens (CSS variables) for colours, spacing, fonts; method badge colours; pass/warn/fail/info colours.
- Resizable sidebar and response panel split (library such as `react-resizable-panels`).
- `apps/web`: Vite app that renders `<PigeonApp />` from `@pigeon/ui`; `index.html` with CSP meta per [platform.md §6.1](../platform.md#61-deployment).
- Playwright setup (`e2e/web`, config running `vite preview`), Chromium/Firefox/WebKit projects; root script `test:e2e`.

**Out of scope**
- Platform adapters (PIGN-004), any feature behaviour, persistence of theme/layout (PIGN-018).

## Acceptance criteria
- [x] `pnpm --filter @pigeon/web dev` shows the layout; `build` produces a static `dist/`.
- [x] Layout matches the regions in ui-ux.md §2; sidebar and response split are resizable.
- [x] Theme toggle switches light/dark; default follows OS.
- [x] `pnpm test:e2e` passes in Chromium, Firefox, WebKit (smoke: shell regions visible via `data-testid`). *(Locally on macOS; CI `e2e-web` on Ubuntu pending.)*
- [x] `packages/ui` has no imports from `@tauri-apps/*` or `node:*`.

## Technical notes
- `PigeonApp` takes a `platform` prop later (PIGN-004); for now, no props.
- Use system font stack + bundled monospace (e.g. JetBrains Mono via `@fontsource`) so desktop works offline.
- Keep components small; place primitives in `ui/src/components/`.

## Files / components likely affected
`packages/ui/src/app/AppShell.tsx`, `packages/ui/src/app/PigeonApp.tsx`, `packages/ui/src/components/*`, `packages/ui/src/styles/*`, `apps/web/*`, `e2e/web/smoke.spec.ts`, `playwright.config.ts`.

## Tests required
- Playwright smoke test (3 browsers).
- Component test for theme toggle.

## Definition of done
Standard DoD plus: CI job `e2e-web` added and green.

## Implementation notes

- **Stack** (D-04 → Accepted): React 19.3, Tailwind v4 (`@tailwindcss/vite`), `radix-ui` (Tooltip), `react-resizable-panels` v4 (`Group`/`Panel`/`Separator`), `lucide-react` icons, Vite 8, Playwright 1.64. Zustand isn't added yet: the only state (theme preference, active sidebar view) is component-local until the app store arrives.
- **Layout** (`packages/ui/src/app/`): `AppShell` contains `TopBar` (project tabs placeholder, disabled environment selector, theme toggle), `ActivityBar` (Collections, Environments, Pending Changes, Runner, Settings, with tooltips and an accent bar on the active view), a resizable `Sidebar`, `MainArea` (request tabs placeholder plus a resizable request/response split), and `StatusBar` (empty until PIGN-004 provides platform info). The sidebar keeps its pixel width when the window resizes.
- **Theme**: `ThemeProvider` resolves `system | light | dark`, follows OS changes while on `system`, and sets `data-theme` on `<html>`. The toggle makes an explicit choice. It lives in memory only until PIGN-018. A `prefers-color-scheme` fallback in CSS avoids a white flash before the app mounts.
- **Tokens**: `packages/ui/src/styles/index.css` holds the colours, method and status colours, fonts, a 13px density type scale, and chrome sizes (`h-topbar`, `w-activitybar`, …). The app imports it as `@pigeon/ui/styles.css`. JetBrains Mono (400/600) is bundled, so desktop works offline.
- **CSP**: injected into the built `index.html` only. The dev server needs the inline React Fast Refresh preamble, which `script-src 'self'` would block. Fonts are never inlined as `data:` URIs, so they load under `default-src 'self'`. The E2E suite asserts the meta tag is present, there are no console errors, and the font loads.
- **Tests**:
  - **Unit:** `packages/ui/test/theme.test.tsx` (jsdom) covers following the OS, tracking OS changes, and the toggle overriding the OS.
  - **E2E:** `e2e/web/smoke.spec.ts` covers shell regions, CSP/console/font, theme toggle, activity bar view switching, and dragging both resize handles. 5 tests × 3 browsers.
- **CI**: new `e2e-web` job (Ubuntu) that installs Playwright browsers with OS deps, runs `pnpm test:e2e`, and uploads the HTML report on failure.
- **Gotchas**:
  - `react-resizable-panels` copies a `Panel`'s `id` into `data-testid`, so panel ids (`*-pane`) must differ from content test ids (`*-panel`).
  - pnpm's release-age gate rejected `react-resizable-panels@4.14.6` (published under 24 h earlier), so 4.14.5 is pinned through the lockfile. No exclusion was added.
- **Follow-up:** once CI `e2e-web` is green, set Status to Done.

