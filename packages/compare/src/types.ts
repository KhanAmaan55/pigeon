/** Comparison types (docs/data-model.md §7). The package has no runtime dependencies. */

export type JsonType = 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object';

/** What a baseline value looked like (§7.1): derived, never committed. */
export interface SchemaNode {
  /** Sorted. */
  types: JsonType[];
  /** Object keys; `seen < of` ⇒ the key is implicitly optional (only some array elements had it). */
  properties?: Record<string, { node: SchemaNode; seen: number; of: number }>;
  /** Merged schema of every array element. */
  items?: SchemaNode;
  /** Every baseline array at this place was empty (no item information). */
  emptyArray?: boolean;
  /** Some baseline arrays here were empty and others not: an empty actual array is normal. */
  someEmpty?: boolean;
}

export type Severity = 'fail' | 'warn' | 'info' | 'ignored';

export type FindingKind =
  | 'status.changed'
  | 'header.missing'
  | 'header.changed'
  | 'header.added'
  | 'body.field.added'
  | 'body.field.removed'
  | 'body.type.changed'
  | 'body.value.changed'
  | 'body.array.length'
  | 'body.contentType.changed'
  | 'body.parse.failed';

export interface FieldRule {
  path: string;
  optional?: boolean;
  nullable?: boolean;
  ignore?: boolean;
  dynamic?: boolean;
  type?: JsonType | JsonType[] | 'any';
  note?: string;
}

export interface Finding {
  kind: FindingKind;
  /** Concrete path, e.g. `$.data.items[3].id`. */
  path?: string;
  /** Generalized path, e.g. `$.data.items[*].id` (what "mark as …" rules use). */
  schemaPath?: string;
  severity: Severity;
  baseline?: unknown;
  actual?: unknown;
  rule?: FieldRule;
  /** De-duplicated array findings: number of occurrences. */
  count?: number;
  /** The first 3 concrete paths when `count > 1`. */
  examplePaths?: string[];
  message: string;
  /** Values mode: the value looks generated (§5): the UI suggests "Mark as dynamic?". */
  hint?: DynamicHint;
}

/** Kinds of values that usually change on every call (§5). */
export type DynamicHint = 'uuid' | 'iso-date' | 'unix-timestamp' | 'jwt' | 'hex-token';

/** How arrays are compared in values mode (§4.4). */
export type ArrayMatching = 'index' | 'schema' | { matchBy: string };

export interface CompareOptions {
  /** Severity of keys the baseline didn't have (default `warn`). */
  additionalFields?: 'ignore' | 'warn' | 'fail';
  /** Split numbers into `integer` / `number` (default off). */
  distinguishIntegers?: boolean;
  /** Rules whose `type` overrides the baseline's types (other rules: `applyRules`). */
  rules?: readonly FieldRule[];
}

export interface ValueCompareOptions {
  /** Default `index`. */
  arrays?: ArrayMatching;
}

export type Outcome = 'pass' | 'warn' | 'fail';

export interface ComparisonSummary {
  outcome: Outcome;
  counts: { fail: number; warn: number; info: number; ignored: number };
}
