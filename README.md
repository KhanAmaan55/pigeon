# Pigeon

Pigeon is a lightweight, local-first API client — a Postman alternative focused on collections, environments, response examples, and API regression / schema comparison. No sign-in, no cloud: a Pigeon project is a folder of Git-friendly, Postman-compatible files. It runs as a desktop app (macOS, Windows, Linux) and as a static web app.

**Start with [docs/README.md](docs/README.md)** — product, architecture, platforms, and the story-by-story implementation plan.

## Development

Requirements: Node.js ≥ 22.12 (see `.nvmrc`) and pnpm (version pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm verify      # lint + typecheck + test + build — must pass after every change
```

| Script           | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm lint`      | ESLint (incl. package boundary rules) + Prettier check |
| `pnpm format`    | Prettier write                                         |
| `pnpm typecheck` | `tsc -b` over all packages and their tests             |
| `pnpm test`      | Vitest across all packages                             |
| `pnpm build`     | Build every package / app                              |

Packages live in `packages/*` (`@pigeon/core`, `formats`, `compare`, `platform`, `platform-web`, `platform-desktop`, `ui`, `fixtures`); apps will live in `apps/*`. Dependency rules between them are described in [docs/architecture.md §2](docs/architecture.md#2-repository-layout).
