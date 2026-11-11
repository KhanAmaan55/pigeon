/** Runs a request end to end: prepare → `Transport.send` → normalize (docs/api-execution.md §1). */

import type { FileRef, PreparedRequest, Transport } from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';

import type { Request } from '../model/request';
import { toExecutionError } from './errors';
import { maskHeaders, maskSecrets } from './mask';
import { prepareRequest } from './prepare';
import { normalizeResponse } from './response';
import type { ExecutionContext, ExecutionResult } from './types';

const BODY_PREVIEW_CHARS = 10_000;

export class RequestExecutor {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Never rejects: failures are returned as `result.error`. */
  async execute(
    request: Request,
    ctx: ExecutionContext,
    opts: { signal?: AbortSignal } = {},
  ): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const base = {
      requestId: request.id,
      environmentId: ctx.environmentId,
      startedAt,
      transport: ctx.capabilities.transport,
    };

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
    const signal = opts.signal ?? new AbortController().signal;
    const summary = { ...base, id: req.id, request: summarize(req) };
    const prepareWarnings = req.meta.warnings ?? [];
    try {
      const raw = await this.#transport.send(req, { signal });
      return {
        ...summary,
        response: normalizeResponse(raw),
        warnings: [...prepareWarnings, ...(raw.warnings ?? [])],
      };
    } catch (error) {
      return {
        ...summary,
        error: toExecutionError(error, signal, {
          url: req.url,
          timeoutMs: req.settings.timeoutMs,
          ...(ctx.pageOrigin === undefined ? {} : { pageOrigin: ctx.pageOrigin }),
        }),
        warnings: [...prepareWarnings, ...(error instanceof TransportError ? error.warnings : [])],
      };
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
