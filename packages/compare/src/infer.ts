/**
 * Schema inference (docs/response-comparison.md §4.2): a baseline JSON value → `SchemaNode`.
 * Array elements are merged (union of types and keys; per key `seen` of `of` object elements).
 * Iterative (explicit stack), so deep JSON can't overflow the call stack; object key order
 * doesn't matter (properties come out sorted).
 */

import { jsonTypeOf } from './json-type';
import type { JsonType, SchemaNode } from './types';

interface Building {
  types: Set<JsonType>;
  properties?: Map<string, { node: Building; seen: number }>;
  items?: Building;
  /** Objects and arrays merged into this node, and array elements seen. */
  objects: number;
  arrays: number;
  elements: number;
  emptyArrays: number;
}

const building = (): Building => ({
  types: new Set(),
  objects: 0,
  arrays: 0,
  elements: 0,
  emptyArrays: 0,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inferSchema(
  value: unknown,
  options: { distinguishIntegers?: boolean } = {},
): SchemaNode {
  const root = building();
  const stack: Array<[Building, unknown]> = [[root, value]];
  while (stack.length > 0) {
    const [node, current] = stack.pop()!;
    node.types.add(jsonTypeOf(current, options.distinguishIntegers));
    if (Array.isArray(current)) {
      node.arrays += 1;
      node.elements += current.length;
      if (current.length === 0) node.emptyArrays += 1;
      if (current.length > 0) {
        node.items ??= building();
        for (let i = current.length - 1; i >= 0; i--) stack.push([node.items, current[i]]);
      }
    } else if (isPlainObject(current)) {
      node.objects += 1;
      node.properties ??= new Map();
      for (const key of Object.keys(current)) {
        let property = node.properties.get(key);
        if (!property) node.properties.set(key, (property = { node: building(), seen: 0 }));
        property.seen += 1;
        stack.push([property.node, current[key]]);
      }
    }
  }
  return finish(root);
}

/** Built nodes → `SchemaNode`s (iterative too). */
function finish(root: Building): SchemaNode {
  const out = new Map<Building, SchemaNode>();
  const order: Building[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.push(node);
    if (node.items) stack.push(node.items);
    for (const property of node.properties?.values() ?? []) stack.push(property.node);
  }
  // Children before parents.
  for (const node of order.reverse()) {
    const result: SchemaNode = { types: [...node.types].sort() };
    if (node.properties) {
      result.properties = Object.fromEntries(
        [...node.properties.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, property]) => [
            key,
            { node: out.get(property.node)!, seen: property.seen, of: node.objects },
          ]),
      );
    }
    if (node.items) {
      result.items = out.get(node.items)!;
      if (node.emptyArrays > 0) result.someEmpty = true;
    } else if (node.arrays > 0 && node.elements === 0) result.emptyArray = true;
    out.set(node, result);
  }
  return out.get(root)!;
}
