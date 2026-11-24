/**
 * Joins class names, skipping falsy ones: `cx('a', on && 'b')`. A later class replaces an earlier
 * one that sets the same thing (same variants, same utility group), so a component's defaults can
 * be overridden from `className`: `cx('w-full h-8', 'w-32')` → `h-8 w-32`. A small subset of
 * tailwind-merge for the utilities the shared components set; other classes are kept as they are.
 */
export function cx(...classes: Array<string | false | null | undefined | 0>): string {
  const out: string[] = [];
  const index = new Map<string, number>();
  for (const value of classes) {
    if (!value) continue;
    for (const cls of value.split(/\s+/)) {
      if (cls === '') continue;
      const key = groupKey(cls);
      const previous = key === null ? undefined : index.get(key);
      if (previous !== undefined) out[previous] = '';
      if (key !== null) index.set(key, out.length);
      out.push(cls);
    }
  }
  return out.filter(Boolean).join(' ');
}

const TEXT_SIZES = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d[^\]]*(px|rem|em)\])$/;
const FONT_WEIGHTS = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const SHADOWS = /^shadow(-(none|xs|sm|md|lg|xl|2xl))?$/;
const ROUNDED = /^rounded(-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(-.+)?$/;

/** `variants:group` for the utilities whose conflicts matter here, else `null`. */
function groupKey(cls: string): string | null {
  const important = cls.startsWith('!') || cls.endsWith('!');
  const bare = cls.replace(/^!|!$/g, '');
  // The variants end at the last `:` outside brackets (arbitrary values may contain `:`).
  let split = -1;
  let depth = 0;
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ':' && depth === 0) split = i;
  }
  const variants = split === -1 ? '' : bare.slice(0, split + 1);
  const utility = (split === -1 ? bare : bare.slice(split + 1)).replace(/^-/, '');
  const group = utilityGroup(utility);
  return group === null ? null : `${important ? '!' : ''}${variants}${group}`;
}

function utilityGroup(u: string): string | null {
  if (TEXT_SIZES.test(u)) return 'text-size';
  if (FONT_WEIGHTS.test(u)) return 'font-weight';
  if (SHADOWS.test(u)) return 'shadow';
  const rounded = ROUNDED.exec(u);
  if (rounded) return `rounded${rounded[1] ?? ''}`;
  const prefix =
    /^(min-w|min-h|max-w|max-h|size|w|h|px|py|pt|pr|pb|pl|p|mx|my|mt|mr|mb|ml|m|gap-x|gap-y|gap|inset-x|inset-y|inset|top|right|bottom|left|translate-x|translate-y|leading|z|justify|items|self|grow|shrink)-/.exec(
      u,
    );
  if (prefix) return prefix[1]!;
  if (/^(flex|inline-flex|block|inline-block|inline|grid|hidden|contents)$/.test(u))
    return 'display';
  if (/^(static|fixed|absolute|relative|sticky)$/.test(u)) return 'position';
  if (
    /^bg-/.test(u) &&
    !/^bg-(linear|radial|conic|none|clip|origin|repeat|no-repeat|fixed|local|scroll|cover|contain|auto|center|top|bottom|left|right)/.test(
      u,
    )
  )
    return 'bg';
  if (
    /^text-/.test(u) &&
    !/^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(u)
  )
    return 'text-color';
  return null;
}
