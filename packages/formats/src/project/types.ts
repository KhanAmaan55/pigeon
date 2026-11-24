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
  | ({ mode: 'file'; src?: string } & BodyCommon)
  /**
   * Postman `graphql` mode (PIGN-032): `variables` is JSON text, as Postman stores it.
   * `schemaFile` (PIGN-055): a project-relative SDL or introspection JSON file, kept in
   * `_pigeon.graphql.schemaFile` (committed, so a team shares it).
   */
  | ({
      mode: 'graphql';
      query: string;
      variables: string;
      operationName?: string;
      schemaFile?: string;
    } & BodyCommon);

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
  /** Postman `protocolProfileBehavior.disableCookies`: no cookie jar for this request. */
  disableCookies?: boolean;
  /** Pigeon-only; stored as `_pigeon.timeoutMs`. */
  timeoutMs?: number;
  /** Web: send the browser's cookies (`credentials: 'include'`); `_pigeon.includeCredentials`. */
  includeCredentials?: boolean;
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
      /** HTTP Digest (RFC 7616, PIGN-046); Postman's params, as strings. */
      type: 'digest';
      username: string;
      password: string;
      /** Empty: taken from the server's challenge. */
      realm: string;
      nonce: string;
      /** `MD5` (default), `MD5-sess`, `SHA-256`, `SHA-256-sess`. */
      algorithm: string;
      qop: string;
      nonceCount: string;
      clientNonce: string;
      opaque: string;
      source?: ExtraFields;
    }
  | {
      /** AWS Signature Version 4 (PIGN-046). */
      type: 'awsv4';
      accessKey: string;
      secretKey: string;
      region: string;
      service: string;
      sessionToken: string;
      /** Sign with query parameters instead of headers. */
      addAuthDataToQuery: boolean;
      source?: ExtraFields;
    }
  | {
      /** OAuth 2.0 (PIGN-047). Tokens are never stored here: they live in the secret store. */
      type: 'oauth2';
      /** Postman `grant_type`: `client_credentials`, `password_credentials`,
       * `authorization_code`, `authorization_code_with_pkce`, `implicit` (not run). */
      grantType: string;
      authUrl: string;
      accessTokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope: string;
      state: string;
      redirectUri: string;
      username: string;
      password: string;
      /** PKCE: `S256` (default) or `plain`. */
      challengeAlgorithm: string;
      codeVerifier: string;
      /** Client credentials as Basic auth (`header`, default) or in the body. */
      clientAuthentication: string;
      /** `header` (default) or `queryParams`. */
      addTokenTo: string;
      /** Default `Bearer`. */
      headerPrefix: string;
      /** A token saved in the file by Postman (used when Pigeon has none of its own). */
      accessToken: string;
      tokenName: string;
      source?: ExtraFields;
    }
  | {
      type: 'unsupported';
      /** The Postman type: `ntlm`, `hawk`, … */
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
  /** Saved responses (`examples/…/<request fileKey>/`, PIGN-027), in file-key order. */
  examples: ProjectExample[];
  /** `examples/…/<request fileKey>/compare.json` (PIGN-035); absent = project defaults only. */
  comparison?: ProjectComparisonConfig;
  /** Unknown item keys; unknown `request` / `protocolProfileBehavior` / `_pigeon` keys nested under those names. */
  extra: ExtraFields;
}

/** Sidecar formats of a text example body (`.body.json`, `.body.xml`, …). */
export type ExampleBodyFormat = 'json' | 'xml' | 'html' | 'text' | 'javascript';

/**
 * An example's response body, kept in a sidecar file (data-model.md §6). Binary bodies are held
 * as base64 so drafts in local state stay plain JSON.
 */
export type ExampleBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; format: ExampleBodyFormat }
  | { kind: 'binary'; base64: string };

/** Postman `originalRequest`: the request *definition* (variables unresolved). */
export interface RequestExample {
  method: string;
  url: ProjectUrl;
  headers: ProjectKeyValue[];
  body: ProjectBody;
  auth?: ProjectAuth;
  description?: Description;
  extra: ExtraFields;
}

export interface ResponseExample {
  code: number;
  /** Status text, e.g. `OK`. */
  status: string;
  headers: ProjectKeyValue[];
  /** Postman `cookie` array, preserved. */
  cookies: unknown[];
  body: ExampleBody;
  /** `_postman_previewlanguage`. */
  previewLanguage?: string;
  /** Not written for saved responses (volatile); kept when a file has it. */
  responseTimeMs?: number | null;
}

export interface ProjectExample extends BrokenFlag {
  id: string;
  /** File name stem: `<fileKey>.example.json` + `<fileKey>.body.<ext>`. */
  fileKey: string;
  requestId: string;
  name: string;
  /** `undefined` when the file has no `originalRequest`. */
  request?: RequestExample;
  response: ResponseExample;
  /** Unknown keys; unknown `_pigeon` keys nested under `_pigeon`. */
  extra: ExtraFields;
}

/** A field rule (response-comparison.md §4.5); unknown keys kept in `extra`. */
export interface ProjectFieldRule {
  path: string;
  optional?: boolean;
  nullable?: boolean;
  ignore?: boolean;
  dynamic?: boolean;
  type?: string | string[];
  note?: string;
  extra?: ExtraFields;
}

/**
 * A request's comparison config (`compare.json`, file-format.md §2.7): only what overrides the
 * project defaults. `headers` / `body` keep the keys as written (typed by the comparison code).
 */
export interface ProjectComparisonConfig {
  baseline?: { mode: 'auto' } | { mode: 'example'; exampleId: string } | { mode: 'none' };
  status?: string;
  headers?: ExtraFields;
  body?: ExtraFields;
  rules: ProjectFieldRule[];
  /** Unknown top-level keys. */
  extra: ExtraFields;
}

/** A `compare.json` whose request is not in the project: kept where it is. */
export interface OrphanComparison {
  directory: string;
  requestId: string;
  config: ProjectComparisonConfig;
}

/** An example whose request is not in the project: kept where it is, never deleted. */
export interface OrphanExample extends ProjectExample {
  /** Its directory, e.g. `examples/users-api/old-request`. */
  directory: string;
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
  /** Examples whose `requestId` matches no request (reported as problems). */
  orphanExamples: OrphanExample[];
  /** `compare.json` files whose request is not in the project. */
  orphanComparisons?: OrphanComparison[];
  /** `pigeon.json` `comparison`: project comparison defaults (PIGN-035), read by core. */
  comparison?: unknown;
  extra: ExtraFields;
}

export interface Problem {
  path: ProjectPath;
  /**
   * missing: required file absent; parse: invalid JSON; schema: wrong shape; order: stale order
   * entry; orphan: an example whose request is not in the project.
   */
  kind: 'missing' | 'parse' | 'schema' | 'order' | 'orphan';
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
