# Pigeon — Testing Strategy

Every story leaves the repo green: `pnpm verify` passes and the apps build. Tests are written in the same change as the code.

## 1. Tooling

| Layer | Tool |
|---|---|
| Unit / integration (TS) | **Vitest** (Node environment for core/formats/compare/platform; `jsdom` + Testing Library for ui components) |
| IndexedDB in unit tests | `fake-indexeddb` |
| Web E2E | **Playwright** — Chromium, Firefox, WebKit |
| Desktop E2E | **WebdriverIO + tauri-driver** on Windows and Linux (tauri-driver has no macOS support); macOS: build + launch smoke test + manual checklist |
| Rust | `cargo test` (http command against the test server) |
| Lint / types | ESLint (flat config, boundary rules), Prettier, `tsc -b` over all packages and their test projects, `cargo clippy` |

## 2. Commands

| Command | What it runs |
|---|---|
| `pnpm verify` | lint + typecheck + unit/integration tests + web build (required after every story) |
| `pnpm test` | Vitest across packages |
| `pnpm test:e2e` | Builds `apps/web`, then runs Playwright web E2E against `vite preview` (the test server is added by PIGN-005). First run locally: `pnpm exec playwright install chromium firefox webkit` |
| `pnpm test:e2e:desktop` | WebdriverIO desktop specs (Linux/Windows) |
| `pnpm --filter @pigeon/desktop build` | Tauri build for current OS (requires Rust) |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Rust tests |

## 3. Test layers

### 3.1 Unit tests (fast, pure)
- `formats`: canonical JSON (key order, omissions, unicode, final newline), slugs (reserved names, collisions, non-Latin fallback), project read/write, Postman importers/exporters, env importers, format detection.
- `compare`: inference, merge of array item schemas, every finding kind, every rule, path parser/matcher, de-duplication, severity outcome.
- `core`: variable resolver (precedence, nesting, cycles, dynamic vars, secrets masking), URL/query sync & encoding, auth handlers, body encoding, protocol handlers, commit planner, draft lifecycle, conflict detection, runner (with MockTransport).
- `ui`: component tests only for non-trivial logic (key/value table editing, URL↔params sync, findings actions). Prefer testing logic in core.

### 3.2 Integration tests
- `ProjectSession` on `MemoryFs` + `MemoryAppState`: open → edit → save → restart (new session over same stores) → commit → reload; external change simulation; conflict flows.
- Executor + `NodeTransport` against `@pigeon/test-server` (from PIGN-040; earlier stories use MockTransport plus Playwright for FetchTransport).
- Import → commit → export on MemoryFs using fixtures.

### 3.3 Golden-file tests (determinism)
- `packages/fixtures/projects/<name>/` hold committed Pigeon project folders. Tests: `read → serialize` equals fixture bytes exactly; Save for Commit with no drafts writes nothing.
- Updating goldens requires an explicit `UPDATE_GOLDEN=1` run and the diff is reviewed in the PR.

### 3.4 Import/export compatibility
Fixtures in `packages/fixtures/postman/`:
- `echo-basic.v2.1.json` (methods, params, headers), `bodies.v2.1.json` (all body modes), `auth.v2.1.json` (all auth types incl. unsupported), `nested-folders.v2.1.json` (depth ≥ 4, unicode names, duplicate names), `examples.v2.1.json` (multiple examples, binary-ish bodies), `scripts.v2.1.json`, `graphql.v2.1.json`, `unknown-fields.v2.1.json` (extra keys at every level), `legacy.v2.0.json`, `v1.json` (rejected), environments + globals files, a large generated collection (5,000 requests) for performance.
- Assertions: every export validates against the vendored v2.1 JSON Schema; `normalize(export(import(x))) == normalize(x)`; import reports list expected warnings.
- Real-world fixtures (sanitized) are added whenever a compatibility bug is found (regression test first).
- Apidog/Echo API fixtures only from real exports (PIGN-048/049).

### 3.5 Request execution
- `@pigeon/test-server` endpoints: `/echo` (reflects method, headers, query, body, multipart parts), `/json/:shape`, `/status/:code`, `/delay/:ms`, `/redirect/:n`, `/redirect-to?url=&status=`, `/cookies/set`, `/cookies`, `/gzip`, `/bytes/:n`, `/large/:mb`, `/graphql` (tiny schema), `/cors/*` variants (no CORS headers, allow-all, preflight-required, expose-headers), `/auth/basic`, `/auth/bearer`, `/unicode`.
- `transportConformance` suite (capability-aware) runs against MockTransport, NodeTransport, FetchTransport (Playwright page), and mirrored Rust `cargo test` cases.
- Web-specific: CORS failure classified as `cors-suspected`; forbidden headers dropped with warnings; GET+body rejected; mixed-content classification (unit-tested with injected page origin).

### 3.6 Filesystem / Git workflows
- `fsConformance` suite against MemoryFs, IdbFs, NodeFs (macOS, Windows, Linux CI runners), FsAccessFs (Playwright Chromium via OPFS).
- Git scenario tests (NodeFs + real `git` binary in CI, integration only): init repo → create project → commit; change in Pigeon → Save for Commit → `git diff` shows only expected lines; `git checkout` other branch → reload → working model matches; merge conflict markers in a request file → entity marked broken, not overwritten; `_pigeon.order` conflict resolved by deleting lines → loads.
- Cross-OS (PIGN-040): CRLF files on disk load correctly and are rewritten as LF only when changed; case-only renames; reserved names; long paths; unicode NFC/NFD names from macOS; read-only files; locked files (Windows) retry.

### 3.7 Response comparison
- Table-driven tests: `(baseline, actual, config) → expected findings` in `compare/test/cases/*.json` so cases are easy to add.
- Property tests (fast-check): `compare(x, x)` is always pass; adding an `ignore` rule never increases severity; inference is order-independent for object keys.
- Performance test: 5 MB body under budget (skipped in debug CI, run in `pnpm test:perf`).

### 3.8 Desktop platforms
- CI matrix `macos-latest`, `windows-latest`, `ubuntu-22.04`: unit tests, NodeFs conformance, `cargo test`, `tauri build` (unsigned).
- Desktop E2E (Linux, Windows): open project fixture, send request to test server, Save for Commit writes expected files, external file change reloads.
- macOS: smoke test launches the built app with `--smoke` flag that opens a fixture project, sends one request, writes a result file, exits 0.
- Manual release checklist per OS in PIGN-041 (installer, first launch, open folder permissions, shortcuts, menu, dark mode).

### 3.9 Web-specific behaviour
- Playwright across Chromium/Firefox/WebKit: welcome flows, browser workspace create/import/export zip, request to CORS-enabled test endpoint succeeds, CORS-blocked endpoint shows CORS error card, capability-disabled controls show tooltips.
- Chromium only: fs-access folder flow using OPFS-backed handle injection (test hook `window.__pigeonTest.openHandle(handle)` compiled only in test builds), permission-reconnect flow simulated.
- Build test: production bundle has no references to Tauri or Node built-ins (bundle analysis script), CSP header present in `index.html` meta.

## 4. E2E conventions
- Specs in `e2e/web/*.spec.ts`, `e2e/desktop/*.spec.ts`; use `data-testid` attributes with feature prefixes (`explorer-item`, `url-input`, `send-button`, `pending-changes-item`, `finding-row`).
- Each E2E test starts from a fresh fixture project and fresh local state.
- Keep E2E to critical journeys (~1–3 per story that adds UI); detailed logic belongs in unit tests.

## 5. CI pipeline (GitHub Actions)
1. `verify` (matrix macOS/Windows/Linux): install, then `pnpm verify` (lint, typecheck, unit/integration, build). Later stories add NodeFs conformance and `cargo test` to this matrix.
2. `e2e-web` (ubuntu): Playwright 3 browsers.
3. `desktop-build` (matrix macOS/Windows/Ubuntu 22.04): `cargo test`, `tauri build` (unsigned), `--smoke` launch (under `xvfb-run` on Linux), upload bundles; desktop E2E on Linux/Windows (later).
4. `release` (tags only, PIGN-041).

## 6. Definition of "tested" for a story
- New logic has unit tests; new cross-layer flows have an integration test; new user-visible workflow has at least one E2E path (web; desktop too when it touches desktop adapters).
- Tests fail before the change (where practical) and pass after.
- No skipped/only tests committed; no network access to the public internet in tests (test server only).
