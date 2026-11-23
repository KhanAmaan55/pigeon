import type { Finding } from '@pigeon/core';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';

import type { JsonLines } from './json-lines';
import { indexJson, lineOf } from './json-lines';

const LINE_HEIGHT = 18;
const FALLBACK_RECT = { width: 400, height: 600 };
type Marker = '+' | '−' | '~';

/** Gutter markers per side: removed on the baseline, added on the actual, changed on both. */
export function diffMarkers(
  findings: readonly Finding[],
  baseline: JsonLines,
  actual: JsonLines,
): { baseline: Map<number, Marker>; actual: Map<number, Marker> } {
  const markers = { baseline: new Map<number, Marker>(), actual: new Map<number, Marker>() };
  for (const finding of findings) {
    if (finding.kind === 'body.field.removed') {
      const line = lineOf(baseline, finding.schemaPath, finding.schemaPath);
      if (line !== undefined) markers.baseline.set(line, '−');
    } else if (finding.kind === 'body.field.added') {
      const line = lineOf(actual, finding.path, finding.schemaPath);
      if (line !== undefined) markers.actual.set(line, '+');
    } else if (finding.kind === 'body.type.changed') {
      const left = lineOf(baseline, finding.schemaPath, finding.schemaPath);
      const right = lineOf(actual, finding.path, finding.schemaPath);
      if (left !== undefined) markers.baseline.set(left, '~');
      if (right !== undefined) markers.actual.set(right, '~');
    }
  }
  return markers;
}

const MARKER_CLASSES: Record<Marker, string> = {
  '+': 'bg-pass/15 text-pass',
  '−': 'bg-fail/15 text-fail',
  '~': 'bg-warn/15 text-warn',
};

/**
 * Baseline and actual JSON side by side (docs/ui-ux.md §3.7) with + / − / ~ markers and
 * synchronized scrolling; selecting a finding scrolls both sides to it. Virtualized, so
 * multi-megabyte bodies stay smooth.
 */
export function SideBySide({
  baselineText,
  actualIndex,
  findings,
  selected,
}: {
  baselineText: string;
  actualIndex: JsonLines;
  findings: readonly Finding[];
  selected: { finding: Finding; nonce: number } | null;
}) {
  const baselineIndex = useMemo(() => indexJson(baselineText), [baselineText]);
  const markers = useMemo(
    () => diffMarkers(findings, baselineIndex, actualIndex),
    [findings, baselineIndex, actualIndex],
  );
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    const range = from.scrollHeight - from.clientHeight;
    const ratio = range > 0 ? from.scrollTop / range : 0;
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => (syncing.current = false));
  };

  const targets = useMemo(() => {
    if (!selected) return {};
    const { finding } = selected;
    return {
      left: lineOf(baselineIndex, finding.schemaPath, finding.schemaPath),
      right: lineOf(actualIndex, finding.path, finding.schemaPath),
    };
  }, [selected, baselineIndex, actualIndex]);

  return (
    <div
      data-testid="compare-side-by-side"
      className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-border"
    >
      <Pane
        title="Baseline"
        testId="compare-baseline-pane"
        lines={baselineIndex.lines}
        markers={markers.baseline}
        scrollRef={left}
        onScroll={() => sync(left.current, right.current)}
        target={targets.left}
        nonce={selected?.nonce}
      />
      <Pane
        title="Actual"
        testId="compare-actual-pane"
        lines={actualIndex.lines}
        markers={markers.actual}
        scrollRef={right}
        onScroll={() => sync(right.current, left.current)}
        target={targets.right}
        nonce={selected?.nonce}
      />
    </div>
  );
}

function Pane({
  title,
  testId,
  lines,
  markers,
  scrollRef,
  onScroll,
  target,
  nonce,
}: {
  title: string;
  testId: string;
  lines: string[];
  markers: Map<number, Marker>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  target: number | undefined;
  nonce: number | undefined;
}) {
  // The virtualizer re-renders through its own state.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
    // Before layout (and in jsdom) the pane measures 0×0: render a screenful anyway.
    initialRect: FALLBACK_RECT,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => callback(rect.height === 0 ? FALLBACK_RECT : rect)),
  });
  useEffect(() => {
    if (target !== undefined) virtualizer.scrollToIndex(target, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by nonce
  }, [nonce, target]);

  return (
    <div className="flex min-h-0 flex-col bg-bg">
      <h2 className="shrink-0 border-b border-border px-2 py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h2>
      <div
        ref={scrollRef}
        data-testid={testId}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto font-mono text-xs"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const marker = markers.get(row.index);
            return (
              <div
                key={row.index}
                data-testid={marker ? 'compare-marked-line' : undefined}
                data-marker={marker}
                style={{
                  position: 'absolute',
                  top: row.start,
                  height: LINE_HEIGHT,
                  left: 0,
                  right: 0,
                }}
                className={`flex whitespace-pre ${marker ? MARKER_CLASSES[marker] : ''}`}
              >
                <span className="w-4 shrink-0 text-center select-none">{marker ?? ''}</span>
                <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">
                  {row.index + 1}
                </span>
                <span>{lines[row.index]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
