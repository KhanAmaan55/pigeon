/** Runs a request end to end: prepare → `Transport.send` → normalize (docs/api-execution.md §1). */

import type { FileRef, PickedFileStore, PreparedRequest, Transport } from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';

import type { Request } from '../model/request';
import { runPreRequestScripts } from '../scripting/prerequest';
import { signAwsV4 } from './auth/awsv4';
import { digestAuthorization, parseDigestChallenge } from './auth/digest';
import type { TestRun } from '../scripting/tests';
import { runTestScripts } from '../scripting/tests';
import { EMPTY_SCOPES } from '../variables/scopes';
import { toExecutionError } from './errors';
import { hasShortSecret, maskHeaders, maskSecrets } from './mask';
import { deferredAuthOf, prepareRequest } from './prepare';
import { resolveProjectFiles } from './project-files';
import { normalizeResponse } from './response';
import type { ExecutionContext, ExecutionResult, NormalizedResponse } from './types';

const BODY_PREVIEW_CHARS = 10_000;

export class RequestExecutor {
  readonly #transport: Transport;
  readonly #pickedFiles: PickedFileStore | undefined;

  /** `pickedFiles` must be the store the transport reads; project files pass through it. */
  constructor(transport: Transport, opts: { pickedFiles?: PickedFileStore } = {}) {
    this.#transport = transport;
    this.#pickedFiles = opts.pickedFiles;
  }

  /** Never rejects: failures are returned as `result.error`. */
  async execute(
    request: Request,
    ctx: ExecutionContext,
    opts: {
      signal?: AbortSignal;
      /**
       * Called with the prepared request before it is sent. In-memory consumers (e.g. "Save as
       * example") take the secret values to mask from it; results never carry them.
       */
      onPrepared?: (request: PreparedRequest) => void;
    } = {},
  ): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const base = {
      requestId: request.id,
      environmentId: ctx.environmentId,
      startedAt,
      transport: ctx.capabilities.transport,
    };

    // Pre-request scripts (PIGN-043): their changes apply to this send; a failure stops it.
    if (ctx.preRequest && ctx.preRequest.scripts.length > 0) {
      const scripted = await runPreRequestScripts(ctx.preRequest.runner, ctx.preRequest.scripts, {
        request,
        scopes: ctx.scopes ?? EMPTY_SCOPES,
        requestName: ctx.preRequest.requestName,
      });
      // Console output and errors never show secret values (as everywhere else).
      const secrets = [...(ctx.scopes?.layers ?? [])].flatMap((layer) =>
        [...layer.values.values()].filter((v) => v.secret).map((v) => v.value),
      );
      ctx.preRequest.onLogs?.(
        scripted.logs.map((entry) => ({ ...entry, message: maskSecrets(entry.message, secrets) })),
      );
      if (!scripted.ok) {
        return {
          ...base,
          id: crypto.randomUUID(),
          request: { method: request.method, url: request.url.raw, headers: [] },
          error: {
            kind: 'script',
            message: maskSecrets(
              `Pre-request script error in ${scripted.place}: ${scripted.message}`,
              secrets,
            ),
            hint: 'Fix the script in the Scripts tab, or turn off script execution for this project in Settings.',
          },
          warnings: [],
        };
      }
      ctx.preRequest.onWrites?.(scripted.writes);
      request = scripted.request;
      ctx = { ...ctx, scopes: scripted.scopes };
    }

    const prepared = await prepareRequest(request, ctx);
    if (!prepared.ok) {
      return {
        ...base,
        id: crypto.randomUUID(),
        request: { method: request.method, url: request.url.raw, headers: [] },
        error: prepared.error,
        warnings: [],
      };
    }

    const req = prepared.value;
    // The project's cookies (PIGN-045), unless the request sets its own Cookie header.
    const jar = ctx.cookies && !request.settings.disableCookies ? ctx.cookies.jar : undefined;
    if (jar && ctx.capabilities.canSetAnyHeader) {
      const hasCookie = req.headers.some(([name]) => name.toLowerCase() === 'cookie');
      const header = hasCookie ? undefined : jar.cookieHeader(req.url);
      if (header) req.headers.push(['Cookie', header]);
    }
    // Digest / AWS SigV4 (PIGN-046) need the final request.
    const deferred = deferredAuthOf(req);
    if (deferred?.type === 'awsv4') {
      const body =
        req.body === undefined
          ? new Uint8Array()
          : req.body.kind === 'bytes'
            ? req.body.bytes
            : null;
      const signed = await signAwsV4(deferred, {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        now: new Date(),
      });
      req.url = signed.url;
      req.headers = signed.headers;
      req.meta.secretValues = [...new Set([...req.meta.secretValues, ...signed.credentials])];
    } else if (deferred?.type === 'digest' && deferred.realm && deferred.nonce) {
      // Realm and nonce given: sign the first request (Postman's preemptive digest).
      req.headers.push([
        'Authorization',
        await digestAuthorization(
          deferred,
          { realm: deferred.realm, nonce: deferred.nonce },
          req.method,
          requestUri(req.url),
        ),
      ]);
    }
    opts.onPrepared?.(req);
    const signal = opts.signal ?? new AbortController().signal;
    const summary = {
      ...base,
      id: req.id,
      request: summarize(req),
      // Short secrets can't be masked in free text: such results must never be stored.
      ...(hasShortSecret(req.meta.secretValues) ? { containsUnmaskedSecrets: true } : {}),
    };
    const prepareWarnings = req.meta.warnings ?? [];
    let release = (): void => undefined;
    try {
      const resolved = await resolveProjectFiles(req, ctx.projectFs, this.#pickedFiles);
      release = resolved.release;
      let raw = await this.#transport.send(resolved.request, { signal });
      const digestWarnings: string[] = [];
      if (
        deferred?.type === 'digest' &&
        !(deferred.realm && deferred.nonce) &&
        raw.status === 401
      ) {
        // Answer the server's challenge and send again (RFC 7616).
        const challenge = raw.headers
          .filter(([name]) => name.toLowerCase() === 'www-authenticate')
          .map(([, value]) => parseDigestChallenge(value))
          .find((c) => c !== null);
        if (challenge) {
          const authorization = await digestAuthorization(
            deferred,
            challenge,
            req.method,
            requestUri(raw.url || req.url),
          );
          raw = await this.#transport.send(
            {
              ...resolved.request,
              id: crypto.randomUUID(),
              headers: [...resolved.request.headers, ['Authorization', authorization]],
            },
            { signal },
          );
        } else {
          digestWarnings.push(
            raw.headersRestricted
              ? 'Digest auth: the browser hides the WWW-Authenticate challenge unless the server exposes it with CORS (Access-Control-Expose-Headers); the desktop app can always read it.'
              : 'Digest auth: the 401 response has no Digest challenge to answer.',
          );
        }
      }
      const response = normalizeResponse(raw);
      if (jar && ctx.capabilities.canReadAllResponseHeaders) {
        const setCookies = raw.headers
          .filter(([name]) => name.toLowerCase() === 'set-cookie')
          .map(([, value]) => value);
        if (jar.storeResponse(raw.url || req.url, setCookies) > 0) ctx.cookies?.onChange?.();
      }
      const mask = (text: string) => maskSecrets(text, req.meta.secretValues);
      const tests = await runTests(request, response, ctx, req.meta.secretValues);
      return {
        ...summary,
        ...(tests ? { tests } : {}),
        // The final URL and redirect hops echo the request URL: mask them like the request.
        response: {
          ...response,
          url: mask(response.url),
          redirects: response.redirects.map((hop) => ({
            ...hop,
            url: mask(hop.url),
            location: mask(hop.location),
          })),
        },
        warnings: [...prepareWarnings, ...(raw.warnings ?? []), ...digestWarnings],
      };
    } catch (error) {
      const failure = toExecutionError(error, signal, {
        url: req.url,
        timeoutMs: req.settings.timeoutMs,
        ...(ctx.pageOrigin === undefined ? {} : { pageOrigin: ctx.pageOrigin }),
      });
      const mask = (text: string) => maskSecrets(text, req.meta.secretValues);
      return {
        ...summary,
        error: {
          ...failure,
          message: mask(failure.message),
          ...(failure.detail === undefined ? {} : { detail: mask(failure.detail) }),
        },
        warnings: [...prepareWarnings, ...(error instanceof TransportError ? error.warnings : [])],
      };
    } finally {
      release();
    }
  }
}

/** Path and query of `url`, as Digest's `uri` parameter wants it. */
function requestUri(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** Runs the test scripts of `ctx.tests` on a response (PIGN-044); `undefined` when none. */
async function runTests(
  request: Request,
  response: NormalizedResponse,
  ctx: ExecutionContext,
  secrets: readonly string[],
): Promise<TestRun | undefined> {
  if (!ctx.tests || ctx.tests.scripts.length === 0) return undefined;
  const mask = (text: string) => maskSecrets(text, secrets);
  const { run, writes, logs } = await runTestScripts(ctx.tests.runner, ctx.tests.scripts, {
    request,
    response,
    scopes: ctx.scopes ?? EMPTY_SCOPES,
    requestName: ctx.tests.requestName,
  });
  ctx.tests.onWrites?.(writes);
  ctx.tests.onLogs?.(logs.map((entry) => ({ ...entry, message: mask(entry.message) })));
  return {
    counts: run.counts,
    results: run.results.map((result) => ({
      ...result,
      name: mask(result.name),
      ...(result.message === undefined ? {} : { message: mask(result.message) }),
    })),
  };
}

/** The request as shown in results: secret values masked, body truncated. */
function summarize(req: PreparedRequest): ExecutionResult['request'] {
  const mask = (text: string) => maskSecrets(text, req.meta.secretValues);
  const summary: ExecutionResult['request'] = {
    method: req.method,
    url: mask(req.url),
    headers: maskHeaders(req.headers, req.meta.secretValues),
  };
  const preview = bodyPreview(req.body);
  if (preview !== undefined) {
    summary.bodyPreview = mask(
      preview.length > BODY_PREVIEW_CHARS ? `${preview.slice(0, BODY_PREVIEW_CHARS)}…` : preview,
    );
  }
  return summary;
}

/** Text bodies as sent; form-data as `name: value` lines; files by name. */
function bodyPreview(body: PreparedRequest['body']): string | undefined {
  switch (body?.kind) {
    case undefined:
      return undefined;
    case 'bytes':
      return new TextDecoder().decode(body.bytes);
    case 'multipart':
      return body.parts
        .map((part) =>
          part.kind === 'text' ? `${part.name}: ${part.value}` : `${part.name}: <${part.filename}>`,
        )
        .join('\n');
    case 'file':
      return `<${fileRefLabel(body.ref)}>`;
  }
}

function fileRefLabel(ref: FileRef): string {
  return ref.kind === 'picked' ? 'picked file' : ref.path;
}
