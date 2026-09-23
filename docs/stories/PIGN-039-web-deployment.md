# PIGN-039 — Web deployment & browser-limitation UX

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-039 | 8 — Hardening | MVP | Todo | PIGN-015, PIGN-011 |

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
- [ ] `pnpm --filter @pigeon/web build` output works when served from a sub-path (configurable `base`) and from root.
- [ ] Lighthouse (Chromium) performance ≥ 90 and best-practices ≥ 95 on the Welcome screen (local run, record in implementation notes).
- [ ] CSP blocks inline scripts (verified by a Playwright test that injected inline script doesn't run).
- [ ] Every capability-disabled control and error hint links to the correct help section.
- [ ] Bundle check fails the build if `@tauri-apps` or `node:` imports leak into the web bundle.

## Technical notes
- Use `import.meta.env` for build-time config (`PIGEON_DESKTOP_URL`, `base`).

## Files / components likely affected
`apps/web/{vite.config.ts,index.html,public/_headers,README.md}`, `packages/ui/src/features/help/WebLimitations.tsx`, status bar, `scripts/check-bundle.mjs`, CI.

## Tests required
- Playwright: help links, CSP, sub-path serving.
- Bundle check in CI.

## Definition of done
Standard DoD.
