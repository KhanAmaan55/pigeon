/**
 * Everything that needs the `graphql` package (PIGN-055), in one module that is only ever
 * imported dynamically (`loadGraphqlRuntime`), so graphql, graphql-language-service and
 * cm6-graphql stay out of the initial bundle: building schemas (introspection or SDL / JSON
 * schema files), the editor extension (autocomplete, validation diagnostics, hover docs), checking
 * the variables against the operation, and the plain model the docs panel shows.
 */

import { autocompletion } from '@codemirror/autocomplete';
import { lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { graphql as graphqlExtension, offsetToPos } from 'cm6-graphql';
import type {
  GraphQLField,
  GraphQLInputField,
  GraphQLNamedType,
  GraphQLSchema,
  GraphQLType,
  IntrospectionQuery,
} from 'graphql';
import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  getNamedType,
  getVariableValues,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isUnionType,
  Kind,
  parse,
} from 'graphql';
import { getHoverInformation } from 'graphql-language-service';

export const INTROSPECTION_QUERY = getIntrospectionQuery({ descriptions: true });

export type BuiltSchema = { ok: true; schema: GraphQLSchema } | { ok: false; message: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function schemaFromIntrospection(introspection: { __schema: unknown }): BuiltSchema {
  try {
    return { ok: true, schema: buildClientSchema(introspection as unknown as IntrospectionQuery) };
  } catch (error) {
    return {
      ok: false,
      message: `The introspection result is not a valid schema: ${errorText(error)}`,
    };
  }
}

/** A schema file: SDL (`.graphql`, `.gql`, anything else) or introspection JSON (`.json`). */
export function schemaFromFile(text: string, path: string): BuiltSchema {
  const trimmed = text.trimStart();
  if (path.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return { ok: false, message: `${path} is not valid JSON: ${errorText(error)}` };
    }
    const object = (json ?? {}) as { __schema?: unknown; data?: { __schema?: unknown } };
    const schema = object.__schema ?? object.data?.__schema;
    if (typeof schema !== 'object' || schema === null) {
      return { ok: false, message: `${path} has no "__schema" (an introspection result).` };
    }
    return schemaFromIntrospection({ __schema: schema });
  }
  try {
    return { ok: true, schema: buildSchema(text) };
  } catch (error) {
    return { ok: false, message: `${path} is not valid GraphQL SDL: ${errorText(error)}` };
  }
}

export function schemaSummary(schema: GraphQLSchema): { types: number; queryFields: number } {
  const types = Object.keys(schema.getTypeMap()).filter((name) => !name.startsWith('__')).length;
  return { types, queryFields: Object.keys(schema.getQueryType()?.getFields() ?? {}).length };
}

/**
 * The variables JSON checked against the operation's variable definitions (types, required
 * values). Empty when they fit, the query doesn't parse, or the JSON is invalid (shown elsewhere).
 */
export function variableProblems(
  schema: GraphQLSchema,
  query: string,
  operationName: string | undefined,
  variablesText: string,
): string[] {
  let document;
  try {
    document = parse(query);
  } catch {
    return [];
  }
  let inputs: Record<string, unknown> = {};
  if (variablesText.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(variablesText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
      inputs = parsed as Record<string, unknown>;
    } catch {
      return [];
    }
  }
  const operations = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  const operation =
    operations.length === 1 && !operationName
      ? operations[0]
      : operations.find((o) => o.name?.value === operationName);
  if (!operation) return [];
  const result = getVariableValues(schema, operation.variableDefinitions ?? [], inputs);
  return 'errors' in result && result.errors ? result.errors.map((e) => e.message) : [];
}

/** The query editor's schema support: completion, diagnostics, hover docs, "show in docs". */
export function graphqlEditorExtension(
  schema: GraphQLSchema | null,
  opts: { onShowInDocs?: (type: string) => void } = {},
): Extension {
  if (!schema) return graphqlExtension();
  return [
    graphqlExtension(schema, {
      onShowInDocs: (field, type, parentType) => {
        const name = parentType ?? type ?? field;
        if (name) opts.onShowInDocs?.(name);
      },
    }),
    autocompletion({ activateOnTyping: true }),
    lintGutter(),
    hoverTooltip((view, pos) => {
      const text = view.state.doc.toString();
      let contents;
      try {
        contents = getHoverInformation(schema, text, offsetToPos(view.state.doc, pos));
      } catch {
        return null;
      }
      const markdown = Array.isArray(contents)
        ? contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n\n')
        : typeof contents === 'string'
          ? contents
          : contents.value;
      if (!markdown.trim()) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-graphql-hover';
          dom.dataset['testid'] = 'graphql-hover';
          dom.style.cssText =
            'max-width: 28rem; padding: 4px 8px; white-space: pre-wrap; font-size: 12px;';
          // Markdown code fences and emphasis, shown as plain text.
          dom.textContent = markdown.replace(/```\w*\n?/g, '').replace(/\*\*/g, '');
          return { dom };
        },
      };
    }),
  ];
}

// --- Docs panel model (plain data; the panel never touches graphql) ---------------------------

export interface DocsField {
  name: string;
  /** e.g. `[User!]!` */
  type: string;
  /** The named type, for navigation. */
  typeName: string;
  description?: string;
  args: Array<{ name: string; type: string; typeName: string; description?: string }>;
  deprecated?: string;
}

export interface DocsType {
  name: string;
  kind: 'object' | 'interface' | 'union' | 'enum' | 'input' | 'scalar';
  description?: string;
  fields: DocsField[];
  /** Enum values, union members, implemented interfaces. */
  values: string[];
}

export interface DocsModel {
  roots: Array<{ label: 'Query' | 'Mutation' | 'Subscription'; type: string }>;
  types: DocsType[];
}

const describe = (text: string | null | undefined) =>
  text ? { description: text } : ({} as Record<string, never>);

function field(f: GraphQLField<unknown, unknown> | GraphQLInputField): DocsField {
  const type: GraphQLType = f.type;
  return {
    name: f.name,
    type: String(type),
    typeName: getNamedType(type).name,
    ...describe(f.description),
    args:
      'args' in f
        ? f.args.map((a) => ({
            name: a.name,
            type: String(a.type),
            typeName: getNamedType(a.type).name,
            ...describe(a.description),
          }))
        : [],
    ...(f.deprecationReason ? { deprecated: f.deprecationReason } : {}),
  };
}

function docsType(type: GraphQLNamedType): DocsType {
  const base = { name: type.name, ...describe(type.description) };
  if (isObjectType(type) || isInterfaceType(type)) {
    return {
      ...base,
      kind: isObjectType(type) ? 'object' : 'interface',
      fields: Object.values(type.getFields()).map(field),
      values: type.getInterfaces().map((i) => i.name),
    };
  }
  if (isInputObjectType(type)) {
    return {
      ...base,
      kind: 'input',
      fields: Object.values(type.getFields()).map(field),
      values: [],
    };
  }
  if (isUnionType(type)) {
    return { ...base, kind: 'union', fields: [], values: type.getTypes().map((t) => t.name) };
  }
  if (isEnumType(type)) {
    return { ...base, kind: 'enum', fields: [], values: type.getValues().map((v) => v.name) };
  }
  return { ...base, kind: 'scalar', fields: [], values: [] };
}

export function docsModel(schema: GraphQLSchema): DocsModel {
  const roots: DocsModel['roots'] = [];
  const query = schema.getQueryType();
  const mutation = schema.getMutationType();
  const subscription = schema.getSubscriptionType();
  if (query) roots.push({ label: 'Query', type: query.name });
  if (mutation) roots.push({ label: 'Mutation', type: mutation.name });
  if (subscription) roots.push({ label: 'Subscription', type: subscription.name });
  const types = Object.values(schema.getTypeMap())
    .filter((t) => !t.name.startsWith('__'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(docsType);
  return { roots, types };
}
