import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Text colours meet WCAG AA (4.5:1 for small text) on every surface they're used on, in both
 * themes (PIGN-058, ui-ux.md §8). Reads the tokens from the stylesheet itself.
 */
const css = readFileSync(join(import.meta.dirname, '../src/styles/index.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/--pg-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const TEXT = [
  'fg',
  'fg-muted',
  'accent-text',
  'pass',
  'warn',
  'fail',
  'info',
  'method-get',
  'method-post',
  'method-put',
  'method-patch',
  'method-delete',
  'method-head',
  'method-options',
  'method-gql',
];
const SURFACES = ['bg', 'surface', 'surface-raised', 'sunken', 'hover', 'selected'];

describe.each([
  ['light', ':root'],
  ['dark', ":root[data-theme='dark']"],
])('%s theme contrast (PIGN-058)', (_name, selector) => {
  const theme = tokens(selector);

  it('defines every text colour and surface', () => {
    for (const name of [...TEXT, ...SURFACES, 'accent', 'accent-hover', 'accent-fg']) {
      expect(theme[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(TEXT)('%s is at least 4.5:1 on every surface', (text) => {
    for (const surface of SURFACES) {
      expect(
        contrast(theme[text]!, theme[surface]!),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('button text is at least 4.5:1 on the accent, also while hovered', () => {
    expect(contrast(theme['accent-fg']!, theme['accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['accent-fg']!, theme['accent-hover']!)).toBeGreaterThanOrEqual(4.5);
  });
});
