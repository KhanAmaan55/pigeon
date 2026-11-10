/**
 * Request model (docs/data-model.md §4): URL, headers, body (./body.ts) and settings. Auth,
 * scripts and examples arrive with their stories.
 */

import type { Body, KeyValue } from './body';
import { BodySchema, DescriptionSchema, KeyValueSchema } from './body';
import { z } from './zod';

export type { Body, Description, KeyValue } from './body';

export type Id = string;

const extraSchema = z.record(z.string(), z.unknown());

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
