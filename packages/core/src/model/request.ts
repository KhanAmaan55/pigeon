/**
 * Request model (docs/data-model.md §4). This is the first slice: URL, headers and the `none` and
 * `raw` body modes. Auth, scripts, examples and the other body modes arrive with their stories.
 */

import { z } from './zod';

export type Id = string;

const extraSchema = z.record(z.string(), z.unknown());

/** Postman description: plain string or `{ content, type }`. */
export const DescriptionSchema = z.union([
  z.string(),
  z.object({ content: z.string(), type: z.string().optional() }),
]);
export type Description = z.infer<typeof DescriptionSchema>;

export const KeyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  disabled: z.boolean().optional(),
  description: DescriptionSchema.optional(),
  /** Preserved Postman `type` when present. */
  type: z.string().optional(),
  extra: extraSchema.optional(),
});
export type KeyValue = z.infer<typeof KeyValueSchema>;
export type QueryParam = KeyValue;

export const UrlSchema = z.object({
  /** Source of truth for host and path, e.g. `{{baseUrl}}/users/:id?x=1`. */
  raw: z.string(),
  /** Kept in sync with `raw` by the editor (PIGN-008). */
  query: z.array(KeyValueSchema),
  /** `:id` → `{ key: 'id', value: '42' }` (PIGN-008). */
  pathVariables: z.array(KeyValueSchema),
  extra: extraSchema,
});
export type Url = z.infer<typeof UrlSchema>;

export const RAW_LANGUAGES = ['json', 'text', 'xml', 'html', 'javascript'] as const;
export type RawLanguage = (typeof RAW_LANGUAGES)[number];

export const BodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none'), disabled: z.boolean().optional() }),
  z.object({
    mode: z.literal('raw'),
    raw: z.string(),
    language: z.enum(RAW_LANGUAGES),
    disabled: z.boolean().optional(),
    extra: extraSchema.optional(),
  }),
]);
export type Body = z.infer<typeof BodySchema>;

/** Maps to Postman `protocolProfileBehavior` + Pigeon settings; unset = preference default. */
export const RequestSettingsSchema = z.object({
  followRedirects: z.boolean().optional(),
  maxRedirects: z.number().int().nonnegative().optional(),
  strictSSL: z.boolean().optional(),
  disableBodyPruning: z.boolean().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
});
export type RequestSettings = z.infer<typeof RequestSettingsSchema>;

export const RequestSchema = z.object({
  kind: z.literal('request'),
  id: z.string().min(1),
  /** File slug; empty until the request is saved into a project (PIGN-012/013). */
  fileKey: z.string(),
  name: z.string(),
  description: DescriptionSchema.optional(),
  /** Uppercase; custom methods allowed. */
  method: z.string().min(1),
  url: UrlSchema,
  headers: z.array(KeyValueSchema),
  body: BodySchema,
  settings: RequestSettingsSchema,
  extra: extraSchema,
});
export type Request = z.infer<typeof RequestSchema>;

export interface RequestInit {
  id?: Id;
  fileKey?: string;
  name?: string;
  method?: string;
  /** A raw URL string, or a full `Url`. */
  url?: string | Url;
  headers?: KeyValue[];
  body?: Body;
  settings?: RequestSettings;
}

export function createUrl(raw = ''): Url {
  return { raw, query: [], pathVariables: [], extra: {} };
}

/** A new request with sensible defaults (`GET`, no body); validated against `RequestSchema`. */
export function createRequest(init: RequestInit = {}): Request {
  return RequestSchema.parse({
    kind: 'request',
    id: init.id ?? crypto.randomUUID(),
    fileKey: init.fileKey ?? '',
    name: init.name ?? 'New Request',
    method: (init.method ?? 'GET').toUpperCase(),
    url: typeof init.url === 'object' ? init.url : createUrl(init.url),
    headers: init.headers ?? [],
    body: init.body ?? { mode: 'none' },
    settings: init.settings ?? {},
    extra: {},
  });
}
