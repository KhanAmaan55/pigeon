/**
 * Project domain types (docs/data-model.md §3–4) as read from and written to project files.
 *
 * They live in `formats` (not `core/model`) because `formats` may not depend on `core`; core's
 * zod model is structurally compatible with them and re-uses them for project entities.
 */

import type { ProjectPath } from '@pigeon/platform';

export type ExtraFields = Record<string, unknown>;
export type Description = string | { content: string; type?: string };

export interface ProjectKeyValue {
  key: string;
  value: string;
  disabled?: boolean;
  description?: Description;
  /** Preserved Postman `type` when present. */
  type?: string;
  /** Unknown keys; `valueNull: true` marks a Postman `null` value (`?flag`). */
  extra?: ExtraFields;
}

export interface ProjectFormDataParam extends ProjectKeyValue {
  kind: 'text' | 'file';
  src?: string | string[];
  contentType?: string;
}

export type RawLanguage = 'json' | 'text' | 'xml' | 'html' | 'javascript';

interface BodyCommon {
  disabled?: boolean;
  extra?: ExtraFields;
}

export type ProjectBody =
  | ({ mode: 'none' } & BodyCommon)
  | ({ mode: 'raw'; raw: string; language: RawLanguage } & BodyCommon)
  | ({ mode: 'urlencoded'; params: ProjectKeyValue[] } & BodyCommon)
  | ({ mode: 'formdata'; params: ProjectFormDataParam[] } & BodyCommon)
  | ({ mode: 'file'; src?: string } & BodyCommon);

export interface ProjectUrl {
  raw: string;
  query: ProjectKeyValue[];
  pathVariables: ProjectKeyValue[];
  extra: ExtraFields;
}

export interface ProjectRequestSettings {
  followRedirects?: boolean;
  maxRedirects?: number;
  strictSSL?: boolean;
  disableBodyPruning?: boolean;
  /** Pigeon-only; stored as `_pigeon.timeoutMs`. */
  timeoutMs?: number;
}

/**
 * Auth (data-model.md §4.1, PIGN-026). `undefined` on a folder or request means "inherit from
 * parent"; on a collection, no auth. `source` is the Postman object as read: unchanged auth is
 * written back verbatim and edits keep its other params (and their order). Types Pigeon can't send
 * yet are `unsupported`, preserved as read.
 */
export type ProjectAuth =
  | { type: 'noauth'; source?: ExtraFields }
  | { type: 'basic'; username: string; password: string; source?: ExtraFields }
  | { type: 'bearer'; token: string; source?: ExtraFields }
  | {
      type: 'apikey';
      key: string;
      value: string;
      in: 'header' | 'query';
      source?: ExtraFields;
    }
  | {
      type: 'unsupported';
      /** The Postman type: `oauth2`, `digest`, `awsv4`, … */
      authType: string;
      source?: unknown;
    };
export type AuthType = ProjectAuth['type'];
/** Postman `event` entries, preserved verbatim (PIGN-031 edits them). */
export type ProjectEvent = unknown;
/** Collection / folder variables (PIGN-024): `type` is `''` when the file has none. */
export type ProjectVariable = ProjectEnvVariable;

interface BrokenFlag {
  /** The entity's file failed to parse or validate; it is read-only and never written. */
  broken?: true;
}

export interface ProjectRequest extends BrokenFlag {
  kind: 'request';
  id: string;
  fileKey: string;
  name: string;
  description?: Description;
  method: string;
  url: ProjectUrl;
  headers: ProjectKeyValue[];
  body: ProjectBody;
  auth?: ProjectAuth;
  events: ProjectEvent[];
  settings: ProjectRequestSettings;
  /** Unknown item keys; unknown `request` / `protocolProfileBehavior` / `_pigeon` keys nested under those names. */
  extra: ExtraFields;
}

export interface Folder extends BrokenFlag {
  kind: 'folder';
  id: string;
  fileKey: string;
  name: string;
  description?: Description;
  auth?: ProjectAuth;
  events: ProjectEvent[];
  variables: ProjectVariable[];
  children: ProjectItem[];
  extra: ExtraFields;
}

export type ProjectItem = Folder | ProjectRequest;

export interface Collection extends BrokenFlag {
  kind: 'collection';
  id: string;
  fileKey: string;
  name: string;
  description?: Description;
  version?: string;
  auth?: ProjectAuth;
  events: ProjectEvent[];
  variables: ProjectVariable[];
  children: ProjectItem[];
  /** Unknown root keys; unknown `info` / `_pigeon` keys nested under those names. */
  extra: ExtraFields;
}

/** A variable as environments store it (data-model.md §5). `value` is the shared value. */
export interface ProjectEnvVariable {
  key: string;
  value: string;
  /** `default` | `secret` (Postman environment types). */
  type: string;
  enabled: boolean;
  description?: Description;
  extra?: ExtraFields;
}

export interface ProjectEnvironment extends BrokenFlag {
  id: string;
  fileKey: string;
  name: string;
  /** In file order. */
  values: ProjectEnvVariable[];
  extra: ExtraFields;
}

/** Project globals (`environments/globals.postman_globals.json`), absent until first used. */
export interface ProjectGlobals {
  id: string;
  values: ProjectEnvVariable[];
  extra: ExtraFields;
}

export interface ProjectModel {
  id: string;
  name: string;
  formatVersion: number;
  collections: Collection[];
  /** `environments/*.postman_environment.json`, ordered by file key (PIGN-022). */
  environments: ProjectEnvironment[];
  /** `undefined` while the project has no globals file. */
  globals?: ProjectGlobals;
  /** `pigeon.json` `comparison`, preserved until PIGN-035 models it. */
  comparison?: unknown;
  extra: ExtraFields;
}

export interface Problem {
  path: ProjectPath;
  /** missing: required file absent; parse: invalid JSON; schema: wrong shape; order: stale order entry. */
  kind: 'missing' | 'parse' | 'schema' | 'order';
  severity: 'error' | 'warning';
  message: string;
}

export interface ProjectReadResult {
  model: ProjectModel;
  /** sha-256 of every managed file read, including broken ones (conflict detection). */
  files: Map<ProjectPath, { hash: string }>;
  problems: Problem[];
  /** The project was written by a newer Pigeon (or `pigeon.json` is unusable). */
  readOnly: boolean;
}

export interface EmptyProject {
  model: ProjectModel;
  files: Map<ProjectPath, Uint8Array>;
}
