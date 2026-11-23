/**
 * "Export JSON Schema" of an example (PIGN-056): the schema Pigeon infers from the example's
 * JSON body, with the request's effective comparison rules applied (`compare/src/json-schema.ts`,
 * docs/response-comparison.md §4.7).
 */

import type { JsonSchema } from '@pigeon/compare';
import { inferSchema, toJsonSchema } from '@pigeon/compare';

import type { ProjectExample, ProjectModel, ProjectRequest } from '../model/project';
import { effectiveComparison } from './comparison-service';

export type ExampleJsonSchema =
  { ok: true; schema: JsonSchema; text: string; fileName: string } | { ok: false; message: string };

function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'response'
  );
}

/** The JSON Schema of an example's body, or why there is none (not JSON). */
export function exampleJsonSchema(
  model: Pick<ProjectModel, 'comparison'>,
  request: Pick<ProjectRequest, 'name' | 'comparison'>,
  example: Pick<ProjectExample, 'name' | 'response'>,
): ExampleJsonSchema {
  const body = example.response.body;
  if (body.kind !== 'text' || body.format !== 'json') {
    return { ok: false, message: 'Only JSON bodies have a schema.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(body.text);
  } catch {
    return { ok: false, message: 'The example body is not valid JSON.' };
  }
  const effective = effectiveComparison(model, request);
  const schema = toJsonSchema(
    inferSchema(value, { distinguishIntegers: effective.body.distinguishIntegers }),
    {
      rules: effective.rules,
      additionalFields: effective.body.additionalFields,
      title: `${request.name} — ${example.name}`,
      description: `Response shape inferred by Pigeon from the example "${example.name}" (${example.response.code}), with the request's comparison rules applied.`,
    },
  );
  return {
    ok: true,
    schema,
    text: `${JSON.stringify(schema, null, 2)}\n`,
    fileName: `${slug(request.name)}-${slug(example.name)}.schema.json`,
  };
}
