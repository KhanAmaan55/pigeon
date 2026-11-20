/** Line diff (LCS) for the Pending Changes file view: small, exact, no dependencies. */

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
  /** 1-based line numbers in the old / new text. */
  oldLine?: number;
  newLine?: number;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  // Trim the common head and tail; project files usually change in a few lines.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  // LCS table over the changed middle only.
  const table: number[][] = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i]![j] =
        midA[i] === midB[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  const same = (text: string) =>
    out.push({ kind: 'same', text, oldLine: oldLine++, newLine: newLine++ });
  for (const line of a.slice(0, start)) same(line);
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      same(midA[i]!);
      i++;
      j++;
    } else if (j < midB.length && (i === midA.length || table[i]![j + 1]! > table[i + 1]![j]!)) {
      out.push({ kind: 'add', text: midB[j++]!, newLine: newLine++ });
    } else {
      out.push({ kind: 'remove', text: midA[i++]!, oldLine: oldLine++ });
    }
  }
  for (const line of a.slice(endA)) same(line);
  return out;
}

/** Changed lines with `context` unchanged lines around them; `null` marks skipped stretches. */
export function withContext(lines: readonly DiffLine[], context = 3): Array<DiffLine | null> {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      keep[k] = true;
  });
  const out: Array<DiffLine | null> = [];
  lines.forEach((line, index) => {
    if (keep[index]) out.push(line);
    else if (out.at(-1) !== null) out.push(null);
  });
  if (out.at(-1) === null) out.pop();
  return out;
}
