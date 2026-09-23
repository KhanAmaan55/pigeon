# PIGN-001 — Monorepo scaffold & tooling

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-001 | 0 — Foundation | MVP | Todo | — |

## Goal
Create the pnpm/TypeScript monorepo with all packages as empty-but-buildable shells, shared tooling, boundary rules, and CI, so every later story plugs into a working pipeline.

## User story
As a Pigeon contributor, I want one command that lints, type-checks, tests, and builds everything, so I know the repo is healthy after each change.

## Context
- Layout and package names: [architecture.md §2](../architecture.md#2-repository-layout).
- Tooling decision D-02: [architecture.md §11](../architecture.md#11-technical-decisions).
- Test tooling & CI: [testing.md §1, §2, §5](../testing.md).

## Scope
**In scope**
- Root `package.json` (private, `packageManager: pnpm@<latest 9/10>`, `engines.node >= 22`), `pnpm-workspace.yaml`, `tsconfig.base.json` (strict, `moduleResolution: bundler`, `verbatimModuleSyntax`), `.editorconfig`, `.gitignore`, `.nvmrc`, `.gitattributes` (LF).
- Packages with `package.json`, `tsconfig.json`, `src/index.ts` (placeholder export), and one trivial test each: `core`, `formats`, `compare`, `platform`, `platform-web`, `platform-desktop`, `ui`, `fixtures`. (`test-server` in PIGN-005; `platform-node` in PIGN-019; `apps/*` in PIGN-002/003.)
- Pure packages (`core`, `formats`, `compare`, `platform`) use `"lib": ["ES2022"]` (no DOM) in tsconfig.
- ESLint flat config + Prettier; `no-restricted-imports` rules enforcing the dependency table (e.g. `core` cannot import `react`, `@tauri-apps/*`, `node:*`, `@pigeon/ui`).
- Vitest workspace config.
- Root scripts: `lint`, `format`, `typecheck`, `test`, `build`, `verify` (= lint + typecheck + test + build).
- GitHub Actions workflow `ci.yml` with the `verify` job (ubuntu) and a `cross-os` job (macOS/Windows/Linux running `pnpm test`).
- Root `README.md` (short: what Pigeon is, link to `docs/README.md`, how to run `pnpm verify`).

**Out of scope**
- Any app, UI, or domain code. Tauri/Rust (PIGN-003). Playwright (PIGN-002).

## Acceptance criteria
- [ ] `pnpm install && pnpm verify` succeeds on a clean clone on macOS, Windows, and Linux.
- [ ] Each package builds (`tsc -b` or `tsup`/Vite library mode — pick one and document it) and exports a placeholder.
- [ ] Adding `import React from 'react'` in `packages/core/src` fails `pnpm lint`; adding `document.title` in `packages/core/src` fails `pnpm typecheck`.
- [ ] CI runs `verify` on pull requests and pushes to `main`.
- [ ] Prettier and ESLint configs agree (no conflicting rules).

## Technical notes
- Prefer TypeScript project references (`tsc -b`) for type-checking and simple `tsc` emit for libraries; apps use Vite. Internal packages can point `exports` at `src/*.ts` for dev with a `build` that emits `dist/` — pick the simplest setup that keeps Vitest and Vite fast, and document it in `docs/architecture.md` §2.
- Use `workspace:*` for internal deps.
- `lib: ["ES2022"]` lacks types for the few web-standard globals pure packages may use. Add one shared ambient file (e.g. `packages/platform/src/globals.d.ts`) declaring only `TextEncoder`, `TextDecoder`, `URL`, `AbortSignal`/`AbortController`, `structuredClone`, `crypto.randomUUID`, `crypto.subtle.digest` — all available in browsers, Tauri webviews, and Node ≥ 22.
- Keep dependencies minimal; don't add React/zod yet (added by the stories that need them).

## Files / components likely affected
`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `vitest.workspace.ts`, `.github/workflows/ci.yml`, `packages/*/package.json`, `packages/*/tsconfig.json`, `packages/*/src/index.ts`, `packages/*/test/*.test.ts`, `README.md`.

## Tests required
- One placeholder unit test per package (proves Vitest wiring).
- A lint fixture test is not required; verify the boundary rule manually and describe it in the PR.

## Definition of done
Standard DoD ([stories/README.md](README.md#standard-definition-of-done-applies-to-every-story)) plus: CI green on all three OS runners.
