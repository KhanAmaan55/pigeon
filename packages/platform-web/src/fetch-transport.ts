/** `Transport` over the browser's `fetch` (docs/api-execution.md §7.2). */

import type {
  FileRef,
  MultipartPart,
  PickedFileStore,
  PreparedRequest,
  RawResponse,
  Transport,
} from '@pigeon/platform';
import { isForbiddenHeader, isForbiddenMethod, TransportError } from '@pigeon/platform';

const CORS_HINT =
  'The browser blocked the request or could not reach the server, and does not say why. ' +
  'Likely causes: the server does not allow cross-origin requests (CORS), the network or ' +
  'server is down, the host name does not resolve, or the TLS certificate is not trusted. ' +
  'The desktop app is not subject to CORS.';

export interface FetchTransportOptions {
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Monotonic clock in ms; defaults to `performance.now()`. */
  now?: () => number;
  /** Where `picked` file refs are read from; without it, file bodies fail as `file-unavailable`. */
  pickedFiles?: PickedFileStore;
}

export class FetchTransport implements Transport {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #pickedFiles: PickedFileStore | undefined;

  constructor(opts: FetchTransportOptions = {}) {
    // Unbound `fetch` throws "Illegal invocation" in browsers.
    this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#now = opts.now ?? (() => performance.now());
    this.#pickedFiles = opts.pickedFiles;
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const warnings: string[] = [];
    const fail: Fail = (kind, message, opts = {}) =>
      new TransportError(kind, message, { ...opts, warnings });

    if (isForbiddenMethod(req.method)) {
      throw fail('invalid-request', `Browsers cannot send ${req.method} requests.`);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && req.body) {
      throw fail('invalid-request', `Browsers cannot send a body with ${req.method} requests.`);
    }

    const multipart = req.body?.kind === 'multipart';
    const headers = new Headers();
    for (const [name, value] of req.headers) {
      // The browser picks the boundary, so it must write the multipart Content-Type itself.
      if (multipart && name.toLowerCase() === 'content-type') {
        if (!/^\s*multipart\/form-data\s*$/i.test(value)) {
          warnings.push(
            `Header "${name}: ${value}" was replaced by multipart/form-data: browsers set the Content-Type of form-data bodies.`,
          );
        }
        continue;
      }
      if (isForbiddenHeader(name, value)) {
        warnings.push(`Header "${name}" was not sent: browsers do not allow setting it.`);
        continue;
      }
      try {
        headers.append(name, value);
      } catch (error) {
        throw fail('invalid-request', `Header "${name}" is not valid.`, {
          detail: String(error),
          cause: error,
        });
      }
    }

    let body: BodyInit | undefined;
    switch (req.body?.kind) {
      case undefined:
        break;
      case 'bytes':
        body = req.body.bytes as Uint8Array<ArrayBuffer>;
        break;
      case 'file':
        // No Blob type: core already set Content-Type (from the extension, or the user's).
        body = new Blob([this.#read(req.body.ref, undefined, fail) as Uint8Array<ArrayBuffer>]);
        break;
      case 'multipart':
        body = this.#formData(req.body.parts, warnings, fail);
        break;
    }

    const startedAt = Date.now();
    const start = this.#now();
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await this.#fetch(req.url, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
      });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // fetch reports every network-level failure as a bare TypeError (PIGN-011 refines this).
      if (error instanceof TypeError) {
        throw fail('cors-suspected', 'The request was blocked or could not reach the server.', {
          detail: error.message,
          hint: CORS_HINT,
          cause: error,
        });
      }
      throw fail('unknown', 'The request failed.', { detail: String(error), cause: error });
    }
    const totalMs = Math.max(0, this.#now() - start);

    const responseHeaders: Array<[string, string]> = [];
    response.headers.forEach((value, name) => responseHeaders.push([name, value]));

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bytes,
      url: response.url || req.url,
      redirects: [],
      timings: { startedAt, totalMs },
      headersRestricted: true,
      warnings,
    };
  }

  #formData(parts: MultipartPart[], warnings: string[], fail: Fail): FormData {
    const form = new FormData();
    for (const part of parts) {
      if (part.kind === 'text') {
        if (part.contentType !== undefined) {
          warnings.push(
            `The content type of form field "${part.name}" was not sent: browsers send text fields without one.`,
          );
        }
        form.append(part.name, part.value);
      } else {
        const bytes = this.#read(part.file, part.filename, fail) as Uint8Array<ArrayBuffer>;
        const type = part.contentType ?? 'application/octet-stream';
        form.append(part.name, new File([bytes], part.filename, { type }));
      }
    }
    return form;
  }

  /** The bytes behind a file reference; browsers can only read files picked this session. */
  #read(ref: FileRef, name: string | undefined, fail: Fail): Uint8Array {
    const label = name === undefined ? 'The file' : `The file "${name}"`;
    switch (ref.kind) {
      case 'picked': {
        const file = this.#pickedFiles?.get(ref.id);
        if (file) return file.bytes;
        throw fail('file-unavailable', `${label} is no longer available. Select it again.`);
      }
      case 'absolute':
        throw fail(
          'file-unavailable',
          `${label} cannot be read: browsers cannot open files by path.`,
          {
            detail: ref.path,
            hint: 'Select the file again, or use the desktop app.',
          },
        );
      case 'project':
        throw fail(
          'file-unavailable',
          `${label} cannot be read: project files are not supported yet.`,
          {
            detail: ref.path,
            hint: 'Select the file again.',
          },
        );
    }
  }
}

type Fail = (
  kind: TransportError['kind'],
  message: string,
  opts?: { detail?: string; hint?: string; cause?: unknown },
) => TransportError;
