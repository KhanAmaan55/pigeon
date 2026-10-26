# Pigeon

Pigeon is a lightweight, local-first API client — a Postman alternative focused on collections, environments, response examples, and API regression / schema comparison. No sign-in, no cloud: a Pigeon project is a folder of Git-friendly, Postman-compatible files. It runs as a desktop app (macOS, Windows, Linux) and as a static web app.

**Start with [docs/README.md](docs/README.md)** — product, architecture, platforms, and the story-by-story implementation plan.

## Development

Requirements: Node.js ≥ 22.12 (see `.nvmrc`) and pnpm (version pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm verify      # lint + typecheck + test + build — must pass after every change
pnpm --filter @pigeon/web dev    # web app at http://localhost:5173
pnpm --filter @pigeon/desktop dev    # desktop app (needs Rust + Tauri OS deps)
```

E2E tests need Playwright's browsers once: `pnpm exec playwright install chromium firefox webkit`.

The desktop app (`apps/desktop`, Tauri 2) also needs the Rust stable toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (on Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`). `pnpm --filter @pigeon/desktop build` writes unsigned bundles to `apps/desktop/src-tauri/target/release/bundle/`; the built binary accepts `--smoke` (render the UI, print `smoke-ok`, exit 0). `pnpm verify` does not build the desktop app; CI's `desktop-build` job does.

| Script           | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm lint`      | ESLint (incl. package boundary rules) + Prettier check |
| `pnpm format`    | Prettier write                                         |
| `pnpm typecheck` | `tsc -b` over all packages and their tests             |
| `pnpm test`      | Vitest across all packages                             |
| `pnpm build`     | Build every package / app                              |
| `pnpm test:e2e`  | Build the web app and run Playwright in 3 browsers     |

Packages live in `packages/*` (`@pigeon/core`, `formats`, `compare`, `platform`, `platform-web`, `platform-desktop`, `ui`, `fixtures`); apps live in `apps/*` (`@pigeon/web`, `@pigeon/desktop`). Dependency rules between them are described in [docs/architecture.md §2](docs/architecture.md#2-repository-layout).
