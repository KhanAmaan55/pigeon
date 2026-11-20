# PIGN-039 — Web deployment & browser-limitation UX

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-039 | 8 — Hardening | MVP | Done | PIGN-015, PIGN-011 |

## Goal
Make the web version production-ready as a static site: deploy config, security headers, capability messaging, and a consolidated "Web limitations" help page linked from every limitation hint.

## User story
As a user opening Pigeon in a browser, I want it to load fast, be safe with my data, and explain clearly what the browser prevents, so I'm never confused by silent failures.

## Context
- Deployment & limitations: [platform.md §6](../platform.md#6-web).
- D-12 (hosting target) is **Open** — pick with the product owner; keep config host-agnostic.

## Scope
**In scope**
- Production build: hashed assets, code splitting (CodeMirror languages, compare worker, zip lib lazy), bundle budget (initial JS ≤ 500 KB gzip, documented), source maps not published by default.
- Security: CSP (meta + recommended HTTP headers file for common hosts, e.g. `_headers` for Netlify/Cloudflare Pages and a README snippet for nginx), `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, `Permissions-Policy`; no third-party scripts/fonts; bundle check script asserting no Tauri/Node references.
- In-app **Web limitations** help (static page/dialog) covering CORS, forbidden headers, cookies, redirects, TLS, mixed content, Private Network Access, storage/eviction, secrets, folders, Git — mirrors platform.md §6; every hint/tooltip links to its section.
- Status bar item "Browser mode — CORS applies"; first-run notice about secrets & storage persistence; "Get the desktop app" link (URL configurable at build time, hidden when unset).
- `apps/web/README.md` deploy instructions (static host, `vite preview` for local, running locally to avoid mixed content).
- GitHub Actions job producing the `dist/` artifact (deploy step left to D-12).

**Out of scope**
- PWA/offline web (future), CORS proxy (PIGN-052).

## Acceptance criteria
- [x] `pnpm --filter @pigeon/web build` output works when served from a sub-path (configurable `base`) and from root.
- [ ] Lighthouse (Chromium) performance ≥ 90 and best-practices ≥ 95 on the Welcome screen (local run, record in implementation notes). — not run, see notes
- [x] CSP blocks inline scripts (verified by a Playwright test that injected inline script doesn't run).
- [x] Every capability-disabled control and error hint links to the correct help section.
- [x] Bundle check fails the build if `@tauri-apps` or `node:` imports leak into the web bundle.

## Technical notes
- Use `import.meta.env` for build-time config (`PIGEON_DESKTOP_URL`, `base`).

## Files / components likely affected
`apps/web/{vite.config.ts,index.html,public/_headers,README.md}`, `packages/ui/src/features/help/WebLimitations.tsx`, status bar, `scripts/check-bundle.mjs`, CI.

## Tests required
- Playwright: help links, CSP, sub-path serving.
- Bundle check in CI.

## Definition of done
Standard DoD.

## Implementation notes
- **Build** (`apps/web/vite.config.ts`): `base` is relative (`./`) by default, so one build serves from the root and from any sub-path; `PIGEON_BASE` sets an absolute one. `PIGEON_DESKTOP_URL` is injected with `define` (only that value, not every `PIGEON_*` variable) and passed to `PigeonApp` as `config.desktopAppUrl` (new `AppConfig` context). Source maps only with `PIGEON_SOURCEMAP=true`. The zip library (fflate) is now loaded on first use (`readProjectZip` became async), next to the already lazy CodeMirror, response viewer and workers.
- **Security**: the CSP gained `object-src 'none'; base-uri 'self'; form-action 'none'`. The build writes `dist/_headers` (CSP + `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, COOP, a restrictive `Permissions-Policy`) from the same constant as the `<meta>`; the README has the nginx equivalent.
- **Bundle check** (`apps/web/scripts/check-bundle.ts`, run by `build`, so also in CI's verify and the new `web dist` job): fails on `@tauri-apps` imports, `__TAURI__`/`__TAURI_INTERNALS__` or `node:` imports in any emitted chunk, and when the first load's JavaScript (entry + modulepreloads in `index.html`) is over 500 KB gzip. Today: **265.6 KB** gzip in 3 files. Unit-tested (`apps/web/test`, now a Vitest project). The script lives in apps/web rather than a root `scripts/` folder, next to the build it checks.
- **Help**: `features/help/WebLimitations.tsx` — a dialog with sections mirroring platform.md §6 (CORS, forbidden headers, hidden response headers, cookies, redirects, body with GET/HEAD, mixed content, Private Network Access, TLS, proxies, timings, storage, secrets, folders, Git), opened at a section by `openHelp(section)` (app store) and `HelpLink`. Linked from: the status bar ("Browser mode — CORS applies"), disabled settings (redirects ×2, TLS, body with GET), the GET-body notice, the forbidden-header warning (now a button) and the headers note, hidden response headers, timeline (headers, redirects, timings), error cards on web (`cors-suspected` → CORS + Private Network Access, `mixed-content`, `tls`, `network` → Private Network Access), the secrets notice, the workspace storage badge (now a button), the Welcome folders note and the new first-run notice. No cookie or proxy controls exist yet, so those sections have no links.
- **First-run notice** (web, Welcome screen, until "Got it"; stored in app state): storage persistence and unencrypted secrets, with links. "Get the desktop app" shows in the status bar and help only when `PIGEON_DESKTOP_URL` is set (the E2E build sets one).
- **CI**: `web dist` job builds (with the bundle check) and uploads `apps/web/dist` as `pigeon-web-dist`; deploying waits for D-12.
- **Tests**: Playwright (3 browsers) — an injected inline script doesn't run and raises a `script-src` violation; the dist served under `/tools/pigeon/` by a plain static server loads, sends and renders the lazy body viewer; status bar, settings, forbidden header and CORS error links open the right sections; the first-run notice links and stays dismissed after a reload. UI: help-link sections of disabled settings (none on desktop) and of web error cards per kind. Unit: bundle check passes/fails as expected.
- **Lighthouse not run**: it isn't installed here and would need a download. As a proxy, the production build's Welcome screen in Playwright Chromium with 10 Mbit/s and 40 ms latency: FCP/LCP ≈ 0.40–0.55 s, load ≈ 0.35 s, CLS 0.017 (5 runs). Run Lighthouse in Chrome DevTools against `pnpm --filter @pigeon/web preview` to record the scores.
