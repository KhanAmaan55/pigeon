/** @pigeon/compare: response comparison (docs/response-comparison.md). No runtime dependencies. */

export const PACKAGE_NAME = '@pigeon/compare';

export { compareJson } from './diff';
export { inferSchema } from './infer';
export { describeTypes, jsonTypeOf } from './json-type';
export type { PathSegment } from './path';
export { formatPath, keySegment, matchPath, parsePath, toSchemaPath } from './path';
export { summarize } from './result';
export type {
  CompareOptions,
  ComparisonSummary,
  FieldRule,
  Finding,
  FindingKind,
  JsonType,
  Outcome,
  SchemaNode,
  Severity,
} from './types';
