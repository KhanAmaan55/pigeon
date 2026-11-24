# PIGN-058 — Clean and soft visual design, shared UI components

| Story ID | Phase | Tier | Status | Dependencies |
|---|---|---|---|---|
| PIGN-058 | 9 — Later | Later | In progress | PIGN-042 |

## Goal
Give Pigeon a calmer, softer look (in the spirit of Linear or Raycast: soft surfaces, rounded corners, subtle borders, more breathing room, one strong accent) on web and desktop, and make the look live in one place: design tokens plus a small set of shared components instead of class strings repeated in every feature.

## User story
As a developer, I want Pigeon to feel calm and modern to work in all day, and as a maintainer, I want to change its look in a dozen files rather than ninety.

## Context
- Visual spec: [ui-ux.md §1 and §9](../ui-ux.md). Behaviour, layout regions and shortcuts don't change ([ui-ux.md §2–§4](../ui-ux.md)).
- Before this story, buttons, inputs, dialogs and menus were styled in place (about 1,100 `className`s, 600 distinct, 30 dialogs each built by hand), and only `IconButton`, `Tooltip`, `Toast` and `KeyValueTable` were shared.

## Scope
**In scope**
- Tokens (`packages/ui/src/styles/index.css`): new light and dark palettes, a sunken surface for inputs, radii, shadows, focus ring, chrome sizes; method and status colours meeting WCAG AA (4.5:1) for small text on every surface they're used on.
- Shared components in `packages/ui/src/components/ui/`: `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Dialog` (content, title, description, footer), menu styles for dropdown and context menus, `TabsList`/`TabsTrigger`, `Badge`, `Callout`, `SectionLabel`, `Kbd`, `EmptyState`, and a `cx` class helper.
- Every feature moved onto them; the app shell restyled (top bar, activity bar, sidebar, main area as a soft panel, status bar, project and request tabs); the CodeMirror theme matched.

**Out of scope**
- Layout or workflow changes, new features, new fonts (system UI font and the bundled JetBrains Mono stay; no new downloads).

## Acceptance criteria
- [ ] Light and dark themes use the new palette, radii and shadows; no component uses raw palette colours (only tokens), except the dialog overlay.
- [ ] Buttons, inputs, selects, checkboxes, dialogs, menus, inner tabs and badges in every feature use the shared components.
- [ ] Method labels and status colours meet 4.5:1 contrast on their backgrounds in both themes (checked by a test).
- [ ] The axe accessibility checks in E2E report no new violations.
- [ ] All unit, UI and E2E tests pass on web and the desktop smoke run passes; screenshots of the main screens in both themes are reviewed.
- [ ] ui-ux.md describes the new visual language and the shared components.

## Technical notes
- `Button` and the inputs forward refs so they work as Radix `asChild` triggers. No `tailwind-merge`: components take `size`/`variant` props, and `className` is for layout only (flex, margins, widths).
- Tests keep finding elements by `data-testid` and role; the two class-name assertions in UI tests use status tokens that remain.

## Files / components likely affected
`packages/ui/src/styles/index.css`, `packages/ui/src/components/**`, `packages/ui/src/app/**`, `packages/ui/src/features/**`, `docs/ui-ux.md`.

## Tests required
- Contrast test over the token pairs.
- Existing UI, E2E and axe suites unchanged in behaviour.

## Definition of done
Standard DoD plus screenshots of the main screens (welcome, explorer with a request open, response, a dialog, settings) in light and dark reviewed before Done.
