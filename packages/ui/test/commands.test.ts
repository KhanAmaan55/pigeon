import { describe, expect, it } from 'vitest';

import {
  bindingLabel,
  COMMANDS,
  commandForEvent,
  fuzzyScore,
  matchesBinding,
} from '../src/features/command-palette/commands';
import { filterItems, quickOpenItems } from '../src/features/command-palette/CommandPalette';

const key = (
  code: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>> = {},
) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe('command registry (PIGN-042)', () => {
  it('maps every shortcut of ui-ux.md §4 to one command, with Cmd or Ctrl', () => {
    const cases: Array<[ReturnType<typeof key>, string]> = [
      [key('KeyS', { meta: true }), 'file.save'],
      [key('KeyS', { ctrl: true, shift: true }), 'file.saveForCommit'],
      [key('KeyK', { meta: true }), 'palette.open'],
      [key('KeyP', { ctrl: true, shift: true }), 'palette.open'],
      [key('KeyP', { meta: true }), 'quickOpen.open'],
      [key('KeyN', { ctrl: true }), 'request.new'],
      [key('KeyN', { alt: true }), 'request.new'],
      [key('KeyW', { meta: true }), 'tab.close'],
      [key('KeyW', { alt: true }), 'tab.close'],
      [key('Tab', { ctrl: true }), 'tab.next'],
      [key('Tab', { ctrl: true, shift: true }), 'tab.previous'],
      [key('BracketRight', { alt: true }), 'tab.next'],
      [key('KeyE', { meta: true }), 'environment.switch'],
      [key('KeyL', { ctrl: true }), 'url.focus'],
      [key('KeyO', { meta: true }), 'file.import'],
      [key('KeyL', { meta: true, alt: true }), 'view.toggleResponseLayout'],
      [key('ArrowRight', { ctrl: true, alt: true }), 'project.next'],
    ];
    for (const [event, id] of cases) expect(commandForEvent(event)?.id, id).toBe(id);
    // Local commands (Send, Cancel) are handled by the editor itself.
    expect(commandForEvent(key('Enter', { meta: true }))).toBeUndefined();
    expect(commandForEvent(key('KeyS'))).toBeUndefined();
    expect(commandForEvent(key('Tab', { meta: true }))).toBeUndefined();
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });

  it('matches modifiers exactly and labels bindings per platform', () => {
    const save = { key: 'KeyS', mod: true };
    expect(matchesBinding(key('KeyS', { ctrl: true, alt: true }), save)).toBe(false);
    expect(bindingLabel({ key: 'KeyS', mod: true, shift: true }, true)).toBe('⇧⌘S');
    expect(bindingLabel({ key: 'KeyS', mod: true, shift: true }, false)).toBe('Ctrl+Shift+S');
    expect(bindingLabel({ key: 'Enter', mod: true }, false)).toBe('Ctrl+Enter');
    expect(bindingLabel({ key: 'Tab', ctrl: true }, true)).toBe('⌃Tab');
  });

  it('fuzzy-scores word starts and runs above scattered letters', () => {
    expect(fuzzyScore('sfc', 'File: Save for Commit')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Save')).toBe(-1);
    expect(fuzzyScore('save', 'File: Save')).toBeGreaterThan(
      fuzzyScore('save', 'Search a variable env'),
    );
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('Quick open finds a request among 5,000 in under 100 ms', () => {
    const folders = Array.from({ length: 500 }, (_, f) => ({
      kind: 'folder' as const,
      id: `f${f}`,
      name: `Folder ${f}`,
      children: Array.from({ length: 10 }, (_, r) => ({
        kind: 'request' as const,
        id: `r${f}-${r}`,
        name: `Request ${f * 10 + r} get resource`,
        method: 'GET',
        examples: r < 2 ? [{ id: `e${f}-${r}`, name: '200 OK' }] : [],
      })),
    }));
    const model = {
      collections: [{ name: 'Large', children: folders as never }],
      environments: [{ id: 'env', name: 'Staging' }],
    };
    const items = quickOpenItems(model);
    expect(items.filter((i) => i.kind === 'request')).toHaveLength(5000);
    expect(items.filter((i) => i.kind === 'example')).toHaveLength(1000);
    let best = Infinity;
    let results: typeof items = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      results = filterItems(items, 'request 4321', (i) => i.search);
      best = Math.min(best, performance.now() - started);
    }
    expect(results[0]?.name).toBe('Request 4321 get resource');
    expect(best).toBeLessThan(100);
  });
});
