/**
 * Requests ↔ cURL and code snippets (PIGN-050). `snippetRequest` builds what a snippet shows: the
 * request as written (`{{variables}}` kept) or resolved, with secrets masked unless revealed.
 * `requestFromCurl` turns a parsed cURL command into request fields.
 */

import type { FileRef } from '@pigeon/platform';
import type { CurlRequest, SnippetBody, SnippetRequest } from '@pigeon/formats';

import type { Body, KeyValue, Request, RequestSettings, Url } from '../model/request';
import type { Auth } from '../model/auth';
import { syncUrlFromRaw, buildRequestUrl } from '../model/url';
import { createUrl } from '../model/request';
import { EMPTY_SCOPES, VariableResolver } from '../variables/index';
import { applyAuth, resolveAuth } from './auth/index';
import { encodeBody } from './body/index';
import { maskSecrets, SECRET_MASK } from './mask';
import { resolveRequest } from './prepare';
import type { ExecutionContext } from './types';

export interface SnippetOptions {
  /** Replace `{{variables}}` with their current values. */
  resolve: boolean;
  /** Show secret values (secret variables and auth credentials) instead of `••••••`. */
  revealSecrets?: boolean;
}

export interface SnippetSource {
  request: SnippetRequest;
  /** Things the snippet cannot show (e.g. auth computed when sending). */
  warnings: string[];
  /** True when some value was replaced by the mask. */
  masked: boolean;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

const DEFERRED_LABELS: Record<string, string> = {
  digest: 'Digest auth',
  awsv4: 'AWS Signature',
  oauth2: 'OAuth 2.0',
};

function filePath(file: FileRef, fallback: string): string {
  return file.kind === 'picked' ? fallback : file.path;
}

function appendQuery(url: string, params: ReadonlyArray<readonly [string, string]>): string {
  if (params.length === 0) return url;
  const hashAt = url.indexOf('#');
  const [base, hash] = hashAt === -1 ? [url, ''] : [url.slice(0, hashAt), url.slice(hashAt)];
  const added = params.map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`);
  const separator = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';
  return `${base}${separator}${added.join('&')}${hash}`;
}

/**
 * The request a snippet shows. Includes the user's enabled headers, headers and query params from
 * auth, the body and its `Content-Type`; not the `User-Agent`/`Accept` Pigeon adds by default.
 */
export function snippetRequest(
  original: Request,
  ctx: Pick<ExecutionContext, 'scopes' | 'generators' | 'inheritedAuth'>,
  options: SnippetOptions,
): SnippetSource {
  const warnings: string[] = [];
  const resolver = options.resolve
    ? new VariableResolver(ctx.scopes ?? EMPTY_SCOPES, ctx.generators)
    : undefined;
  const request = resolver ? resolveRequest(original, resolver) : original;
  const definedAuth = original.auth ?? ctx.inheritedAuth;
  const auth = applyAuth(
    definedAuth &&
      (resolver ? resolveAuth(definedAuth, (text) => resolver.resolve(text)) : definedAuth),
  );
  if (auth.deferred) {
    warnings.push(
      `${DEFERRED_LABELS[auth.deferred.type] ?? auth.deferred.type} is computed when the request is sent and is not in the snippet.`,
    );
  }
  const secrets = options.revealSecrets
    ? []
    : [
        ...(resolver ? resolver.result('').secretValues : []),
        ...auth.credentials.filter((c) => c !== ''),
      ];
  const mask = (text: string) => maskSecrets(text, secrets);

  // As written: the raw URL (path variables substituted only when resolving).
  let url = resolver ? buildRequestUrl(request.url) : request.url.raw.trim();
  if (url !== '' && !HAS_SCHEME.test(url) && !url.startsWith('{{')) url = `http://${url}`;
  url = appendQuery(url, auth.query);

  const headers: Array<[string, string]> = request.headers
    .filter((h) => !h.disabled && h.key.trim() !== '')
    .map((h) => [h.key.trim(), h.value]);
  const has = (name: string) => headers.some(([n]) => n.toLowerCase() === name.toLowerCase());
  for (const [name, value] of auth.headers) if (!has(name)) headers.push([name, value]);

  const encoding = encodeBody(request.body);
  const encoded = encoding.encoded;
  if (encoded?.contentType !== undefined && !has('content-type')) {
    headers.push(['Content-Type', encoded.contentType]);
  }
  let body: SnippetBody | undefined;
  if (encoded?.body.kind === 'bytes') {
    body = { kind: 'text', text: mask(new TextDecoder().decode(encoded.body.bytes)) };
  } else if (encoded?.body.kind === 'file') {
    body = { kind: 'file', path: filePath(encoded.body.ref, 'file') };
  } else if (encoded?.body.kind === 'multipart') {
    body = {
      kind: 'multipart',
      parts: encoded.body.parts.map((part) =>
        part.kind === 'text'
          ? {
              name: part.name,
              kind: 'text',
              value: mask(part.value),
              ...(part.contentType ? { contentType: part.contentType } : {}),
            }
          : {
              name: part.name,
              kind: 'file',
              path: filePath(part.file, part.filename),
              ...(part.contentType ? { contentType: part.contentType } : {}),
            },
      ),
    };
  }
  const result: SnippetRequest = {
    method: request.method.trim().toUpperCase() || 'GET',
    url: mask(url),
    headers: headers.map(([n, v]) => [n, mask(v)]),
    ...(body ? { body } : {}),
  };
  const masked = secrets.length > 0 && JSON.stringify(result).includes(SECRET_MASK);
  return { request: result, warnings, masked };
}

/** Request fields from a parsed cURL command (PIGN-050), ready for `createRequest`/`updateRequest`. */
export function requestFromCurl(curl: CurlRequest): {
  method: string;
  url: Url;
  headers: KeyValue[];
  body: Body;
  auth?: Auth;
  settings: RequestSettings;
} {
  return {
    method: curl.method,
    url: syncUrlFromRaw(createUrl(), curl.url),
    headers: curl.headers.map((h) => ({ key: h.key, value: h.value })),
    body: curl.body as Body,
    ...(curl.auth ? { auth: curl.auth as Auth } : {}),
    settings: { ...curl.settings },
  };
}
