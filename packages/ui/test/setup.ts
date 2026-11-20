/**
 * jsdom has no layout: `Range` lacks `getClientRects` / `getBoundingClientRect`, which
 * CodeMirror calls when it measures text (e.g. scrolling to a line). Empty rects are enough.
 */

const emptyRects = (): DOMRectList =>
  Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}
