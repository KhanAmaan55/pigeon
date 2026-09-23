# PIGN-002 — Web app shell & layout

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-002 | 0 — Foundation | MVP | Todo | PIGN-001 |

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
- [ ] `pnpm --filter @pigeon/web dev` shows the layout; `build` produces a static `dist/`.
- [ ] Layout matches the regions in ui-ux.md §2; sidebar and response split are resizable.
- [ ] Theme toggle switches light/dark; default follows OS.
- [ ] `pnpm test:e2e` passes in Chromium, Firefox, WebKit (smoke: shell regions visible via `data-testid`).
- [ ] `packages/ui` has no imports from `@tauri-apps/*` or `node:*`.

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
