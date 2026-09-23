# PIGN-042 — Shortcuts, command palette & performance budget

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-042 | 8 — Hardening | MVP | Todo | PIGN-038 |

## Goal
Finish the keyboard-first experience (central command registry, palette, quick open, platform-specific bindings) and enforce the performance budgets with automated checks.

## User story
As a power user, I want to do everything from the keyboard and have Pigeon stay fast with huge projects, so it feels like a native developer tool.

## Context
- Shortcuts table: [ui-ux.md §4](../ui-ux.md#4-keyboard-shortcuts-defaults).
- Budgets: [ui-ux.md §7](../ui-ux.md#7-performance-budgets-tested-in-pign-042), [product.md §7](../product.md#7-success-criteria-for-mvp).

## Scope
**In scope**
- `commands.ts` registry: id, title, category, handler, per-platform bindings (mac/win/linux/web alternatives for browser-reserved keys), enabled predicate. Migrate all existing shortcuts to it.
- Command palette (`Cmd/Ctrl+K`, `Cmd/Ctrl+Shift+P`) with fuzzy search via cmdk; **Quick open** (`Cmd/Ctrl+P`) for requests/examples/environments across the active project.
- Settings → Keyboard: list of bindings (read-only in MVP) with platform labels.
- Performance harness: generated fixture project (5,000 requests, 500 folders, 1,000 examples) and 5 MB JSON response; Playwright performance tests measuring open-project time, explorer scroll (no long tasks > 50 ms), tab switch, keystroke latency; desktop cold-start measurement via `--smoke --timing`.
- Fix regressions found (virtualization, memoization, worker offloading).
- Accessibility pass: focus order, visible focus, ARIA on explorer tree/tabs, reduced motion.

**Out of scope**
- Custom keybinding editing (later).

## Acceptance criteria
- [ ] Every action in ui-ux.md §4 works on macOS, Windows/Linux, and web (with documented web alternatives).
- [ ] Palette lists all registered commands; Quick open finds a request among 5,000 in < 100 ms.
- [ ] Budgets in ui-ux.md §7 met in CI perf job (thresholds with 20 % tolerance) and recorded.
- [ ] axe-core scan on main screens reports no critical violations.

## Technical notes
- Perf tests run in a separate CI job (`pnpm test:perf`) to avoid flakiness in PR gating; failures block release, not PRs (decide and document).

## Files / components likely affected
`packages/ui/src/features/command-palette/*`, `packages/ui/src/features/settings/Keyboard.tsx`, `e2e/web/perf.spec.ts`, `packages/fixtures/generate-large-project.ts`, various UI components.

## Tests required
Perf suite, axe checks, shortcut E2E per platform class.

## Definition of done
Standard DoD. Milestone **M6 — MVP release** reached.
