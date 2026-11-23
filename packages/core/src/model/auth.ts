/**
 * Auth model (docs/data-model.md §4.1, PIGN-026). The type is `ProjectAuth` from `@pigeon/formats`
 * (which maps it to Postman's auth objects); this schema lets the editor `Request` carry it.
 */

import type { ProjectAuth } from '@pigeon/formats';

import { z } from './zod';

const source = z.record(z.string(), z.unknown()).optional();

export const AuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noauth'), source }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string(), source }),
  z.object({ type: z.literal('bearer'), token: z.string(), source }),
  z.object({
    type: z.literal('apikey'),
    key: z.string(),
    value: z.string(),
    in: z.enum(['header', 'query']),
    source,
  }),
  z.object({
    type: z.literal('digest'),
    username: z.string(),
    password: z.string(),
    realm: z.string(),
    nonce: z.string(),
    algorithm: z.string(),
    qop: z.string(),
    nonceCount: z.string(),
    clientNonce: z.string(),
    opaque: z.string(),
    source,
  }),
  z.object({
    type: z.literal('awsv4'),
    accessKey: z.string(),
    secretKey: z.string(),
    region: z.string(),
    service: z.string(),
    sessionToken: z.string(),
    addAuthDataToQuery: z.boolean(),
    source,
  }),
  z.object({
    type: z.literal('unsupported'),
    authType: z.string(),
    source: z.unknown().optional(),
  }),
]);

export type Auth = ProjectAuth;
export type { AuthType } from '@pigeon/formats';
