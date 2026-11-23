/**
 * Schema snapshot → JSON Schema (draft 2020-12), PIGN-056, docs/response-comparison.md §4.7.
 *
 * The schema accepts what schema-mode comparison does not fail: fields the baseline always had
 * are `required` (unless a rule makes them optional or ignores them), types are the baseline's
 * plus what `type` and `nullable` rules allow, and objects stay open (`additionalProperties` is
 * only `false` with `additionalFields: 'fail'`) because added fields are a warning. Warnings
 * (integer → number, an added field) therefore pass, as they do in a run.
 *
 * Output is deterministic: keys in a fixed order, properties and `required` sorted. Iterative,
 * like inference, so deep JSON can't overflow the call stack.
 */

import { keySegment, matchPath, parsePath } from './path';
import type { FieldRule, JsonType, SchemaNode } from './types';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export interface JsonSchemaOptions {
  /** Field rules (project rules first, then the request's), as in a comparison. */
  rules?: readonly FieldRule[];
  /** The comparison's `additionalFields`: only `fail` closes objects. */
  additionalFields?: 'ignore' | 'warn' | 'fail';
  title?: string;
  description?: string;
}

export type JsonSchema = { [key: string]: unknown };

type SchemaType = Exclude<JsonType, 'integer'>;

interface Pending {
  node: SchemaNode;
  schemaPath: string;
  /** Set once the node is built. */
  out?: JsonSchema;
  children: Array<{ key: string | null; entry: Pending; required: boolean }>;
}

function validRule(rule: FieldRule): boolean {
  try {
    parsePath(rule.path);
    return true;
  } catch {
    return false;
  }
}

/** Whether a rule with `flag` applies at `schemaPath` (`orBelow`: or at an ancestor). */
function ruled(
  rules: readonly FieldRule[],
  schemaPath: string,
  flag: (rule: FieldRule) => boolean,
  orBelow = false,
): FieldRule[] {
  return rules.filter((rule) => flag(rule) && matchPath(rule.path, schemaPath, { orBelow }));
}

/** The types a value may have at this place, or `null` for "anything". */
function allowedTypes(
  node: SchemaNode,
  schemaPath: string,
  rules: readonly FieldRule[],
): SchemaType[] | null {
  // A baseline that was only null says nothing about the type: anything is a warning at most.
  if (node.types.length === 1 && node.types[0] === 'null') return null;
  const types = new Set<SchemaType>();
  // Integer → number is a warning (widened), so numbers are accepted either way.
  for (const type of node.types) types.add(type === 'integer' ? 'number' : type);
  let override: JsonType[] | 'any' | undefined;
  for (const rule of ruled(rules, schemaPath, (r) => r.type !== undefined)) {
    override = rule.type === 'any' ? 'any' : Array.isArray(rule.type) ? rule.type : [rule.type!];
  }
  if (override === 'any') return null;
  for (const type of override ?? []) types.add(type === 'integer' ? 'number' : type);
  if (ruled(rules, schemaPath, (r) => r.nullable === true).length > 0) types.add('null');
  return [...types].sort();
}

export function toJsonSchema(root: SchemaNode, options: JsonSchemaOptions = {}): JsonSchema {
  const rules = (options.rules ?? []).filter(validRule);
  const closed = options.additionalFields === 'fail';
  const top: Pending = { node: root, schemaPath: '$', children: [] };
  // Pre-order walk; then build children before parents.
  const order: Pending[] = [];
  const stack: Pending[] = [top];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    order.push(entry);
    if (ruled(rules, entry.schemaPath, (r) => r.ignore === true, true).length > 0) continue;
    if (allowedTypes(entry.node, entry.schemaPath, rules) === null) continue;
    for (const [key, property] of Object.entries(entry.node.properties ?? {})) {
      const schemaPath = entry.schemaPath + keySegment(key);
      const child: Pending = { node: property.node, schemaPath, children: [] };
      const optional =
        property.seen < property.of ||
        ruled(rules, schemaPath, (r) => r.optional === true).length > 0 ||
        ruled(rules, schemaPath, (r) => r.ignore === true, true).length > 0;
      entry.children.push({ key, entry: child, required: !optional });
      stack.push(child);
    }
    if (entry.node.items) {
      const child: Pending = {
        node: entry.node.items,
        schemaPath: `${entry.schemaPath}[*]`,
        children: [],
      };
      entry.children.push({ key: null, entry: child, required: false });
      stack.push(child);
    }
  }

  for (const entry of order.reverse()) {
    const out: JsonSchema = {};
    const ignored = ruled(rules, entry.schemaPath, (r) => r.ignore === true, true).length > 0;
    const types = ignored ? null : allowedTypes(entry.node, entry.schemaPath, rules);
    if (types !== null) {
      out['type'] = types.length === 1 ? types[0] : types;
      const properties = entry.children.filter((c) => c.key !== null);
      if (entry.node.types.includes('object') && entry.node.properties) {
        const sorted = [...properties].sort((a, b) =>
          a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0,
        );
        out['properties'] = Object.fromEntries(sorted.map((c) => [c.key!, c.entry.out!]));
        const required = sorted.filter((c) => c.required).map((c) => c.key!);
        if (required.length > 0) out['required'] = required;
        if (closed) out['additionalProperties'] = false;
      } else if (entry.node.types.includes('object') && closed) {
        out['additionalProperties'] = false;
      }
      const items = entry.children.find((c) => c.key === null);
      if (items) out['items'] = items.entry.out!;
    }
    entry.out = out;
  }

  const body = top.out!;
  return {
    $schema: JSON_SCHEMA_DIALECT,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...body,
  };
}
