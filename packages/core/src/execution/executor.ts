/** Runs a request end to end: prepare → `Transport.send` → normalize (docs/api-execution.md §1). */

import type { FileRef, PickedFileStore, PreparedRequest, Transport } from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';

import type { Request } from '../model/request';
import { runPreRequestScripts } from '../scripting/prerequest';
import { EMPTY_SCOPES } from '../variables/scopes';
import { toExecutionError } from './errors';
import { hasShortSecret, maskHeaders, maskSecrets } from './mask';
import { prepareRequest } from './prepare';
import { resolveProjectFiles } from './project-files';
import { normalizeResponse } from './response';
import type { ExecutionContext, ExecutionResult } from './types';

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
      const raw = await this.#transport.send(resolved.request, { signal });
      const response = normalizeResponse(raw);
      const mask = (text: string) => maskSecrets(text, req.meta.secretValues);
      return {
        ...summary,
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
        warnings: [...prepareWarnings, ...(raw.warnings ?? [])],
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
