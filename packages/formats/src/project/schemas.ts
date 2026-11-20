import { z } from 'zod';

export const COLLECTION_SCHEMA =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const object = z.object({}).passthrough();

export const ProjectFileSchema = z
  .object({
    pigeon: z.object({ formatVersion: z.number().int() }).passthrough(),
    id: z.string().min(1),
    name: z.string(),
    collections: z.array(z.string()),
    comparison: z.unknown().optional(),
  })
  .passthrough();

export const CollectionFileSchema = z
  .object({
    info: z
      .object({
        _postman_id: z.string().min(1),
        name: z.string(),
        description: z.unknown().optional(),
        version: z.string().optional(),
      })
      .passthrough(),
    auth: z.unknown().optional(),
    event: z.array(z.unknown()).optional(),
    variable: z.array(z.unknown()).optional(),
    _pigeon: object.optional(),
  })
  .passthrough();

export const FolderFileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.unknown().optional(),
    auth: z.unknown().optional(),
    event: z.array(z.unknown()).optional(),
    variable: z.array(z.unknown()).optional(),
    _pigeon: object.optional(),
  })
  .passthrough();

export const RequestFileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.unknown().optional(),
    request: z
      .object({
        method: z.string().min(1),
        url: z.union([z.string(), object]),
        header: z.array(z.unknown()).optional(),
        body: object.optional(),
        auth: z.unknown().optional(),
      })
      .passthrough(),
    event: z.array(z.unknown()).optional(),
    protocolProfileBehavior: object.optional(),
  })
  .passthrough();
