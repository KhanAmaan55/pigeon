# PIGN-001 — Monorepo scaffold & tooling

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-001 | 0 — Foundation | MVP | In review (CI pending) | — |

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
- [ ] `pnpm install && pnpm verify` succeeds on a clean clone on macOS, Windows, and Linux. *(Verified on a clean copy on macOS; Windows/Linux pending first CI run.)*
- [x] Each package builds (`tsc -b` or `tsup`/Vite library mode — pick one and document it) and exports a placeholder.
- [x] Adding `import React from 'react'` in `packages/core/src` fails `pnpm lint`; adding `document.title` in `packages/core/src` fails `pnpm typecheck`.
- [x] CI runs `verify` on pull requests and pushes to `main`.
- [x] Prettier and ESLint configs agree (no conflicting rules).

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

## Implementation notes

- **Versions** (D-02 updated to Accepted): TypeScript 6.0, pnpm 11.5.2 (`packageManager`), Node 24 in `.nvmrc` with `engines.node >= 22.12` (Vitest 5's floor), Vitest 5, ESLint 10 + typescript-eslint 8 + eslint-config-prettier, Prettier 3.9. TypeScript 7 is out because typescript-eslint 8 requires TS < 6.1.
- **Build choice:** `tsc -b` with project references; packages export `./src/index.ts`, and `dist/` is emitted only by `typecheck`/`build`. See [architecture.md §2.1](../architecture.md#21-build--type-check-setup-pign-001).
- **Deviations from "Files likely affected":**
  - `vitest.workspace.ts` → root `vitest.config.ts` with `test.projects`, because Vitest 5 uses projects instead of workspace files.
  - `.prettierrc` → `.prettierrc.json`.
  - The shared ambient file lives at `types/web-globals.d.ts`, not `packages/platform/src/globals.d.ts`, because every pure package includes it, not only `platform`.
  - Tests get their own composite `noEmit` tsconfig (`packages/*/test/tsconfig.json`) so they are type-checked without being emitted.
- **Prettier ignores `docs/`**, so the hand-formatted tables and diagrams aren't reflowed.
- **pnpm's minimum-release-age gate stays on.** When pnpm refused a just-published Prettier patch, the previous patch was pinned instead of adding an exclusion.
- **Boundary rules verified manually with probe files (not committed):** 14 cases.
  - Rejected as expected: `react`, `@pigeon/ui` and `node:fs/promises`/`path` in core; `@pigeon/core` in formats; `@pigeon/platform` in compare; `@tauri-apps/*` and `@pigeon/platform-web` in ui; `@pigeon/core` in platform-web.
  - Allowed as expected: `@pigeon/platform` in core, `@pigeon/core` in ui, `@tauri-apps/*` in platform-desktop, and `node:*` in tests.
  - Type-check: `document.title` in core and `document`/`process` in formats fail with TS2584/TS2591, while TextEncoder/URL/crypto compile.
- **Follow-up:** after the first CI run is green on all three OS runners, tick the first criterion and set Status to Done.

