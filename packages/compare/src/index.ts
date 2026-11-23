/** @pigeon/compare: response comparison (docs/response-comparison.md). No runtime dependencies. */

export const PACKAGE_NAME = '@pigeon/compare';

export { compareJson } from './diff';
export { inferSchema } from './infer';
export type { JsonSchema, JsonSchemaOptions } from './json-schema';
export { JSON_SCHEMA_DIALECT, toJsonSchema } from './json-schema';
export { describeTypes, jsonTypeOf } from './json-type';
export type { PathSegment } from './path';
export { formatPath, keySegment, matchPath, parsePath, toSchemaPath } from './path';
export { summarize } from './result';
export type { HeaderCompareOptions, HeaderMode } from './headers';
export { compareHeaders, mediaTypeOf } from './headers';
export { dynamicHint } from './hints';
export type { StatusMode } from './status';
export { compareStatus } from './status';
export { compareBinary, compareText } from './text';
export { compareValues } from './values';
export { applyRules, typeOverride, validateRulePath } from './rules';
export type {
  ArrayMatching,
  DynamicHint,
  ValueCompareOptions,
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
