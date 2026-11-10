/**
 * `Transport` over the Rust `http_send` / `http_cancel` commands (docs/api-execution.md §7.1;
 * apps/desktop/src-tauri/src/http.rs). Requests leave from the native side, so CORS and
 * forbidden-header rules don't apply.
 *
 * Both directions use one binary frame, `[u32 LE JSON length][JSON][body bytes]`: Tauri passes
 * `Uint8Array` arguments and `tauri::ipc::Response` results as raw bytes, so bodies never go
 * through base64 or JSON number arrays.
 */

import type { PreparedRequest, RawResponse, Transport, TransportErrorKind } from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type Invoke = <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => Promise<T>;

export interface NativeTransportOptions {
  /** Defaults to Tauri's `invoke`; tests pass a fake. */
  invoke?: Invoke;
}

/** What `http_send` rejects with (Rust `TransportFailure`). */
interface TransportFailure {
  kind: TransportErrorKind;
  message: string;
  detail?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array();

export class NativeTransport implements Transport {
  readonly #invoke: Invoke;

  constructor(opts: NativeTransportOptions = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const frame = encodeRequestFrame(req);

    return await new Promise<RawResponse>((resolve, reject) => {
      // Settle at once on abort; the Rust side drops the request when the cancel arrives.
      const onAbort = () => {
        reject(signal.reason);
        this.#invoke('http_cancel', { id: req.id }).catch(() => undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#invoke<ArrayBuffer>('http_send', frame).then(
        (buffer) => {
          signal.removeEventListener('abort', onAbort);
          try {
            resolve(decodeResponseFrame(buffer));
          } catch (error) {
            reject(
              new TransportError('unknown', 'The response could not be read.', {
                detail: String(error),
                cause: error,
              }),
            );
          }
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(toTransportError(error));
        },
      );
    });
  }
}

/** `PreparedRequest` → IPC frame. Field names stay identical to the TS types (serde reads them). */
export function encodeRequestFrame(req: PreparedRequest): Uint8Array {
  if (req.body && req.body.kind !== 'bytes') {
    throw new TransportError('invalid-request', 'This body type is not supported yet.');
  }
  const { body, ...rest } = req;
  const json = encoder.encode(JSON.stringify(body ? { ...rest, body: { kind: 'bytes' } } : rest));
  const bytes = body?.bytes ?? EMPTY;
  const frame = new Uint8Array(4 + json.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, json.byteLength, true);
  frame.set(json, 4);
  frame.set(bytes, 4 + json.byteLength);
  return frame;
}

/** IPC frame → `RawResponse`. The body is a view into the received buffer, not a copy. */
export function decodeResponseFrame(buffer: ArrayBuffer): RawResponse {
  const length = new DataView(buffer).getUint32(0, true);
  const meta = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, length))) as Omit<
    RawResponse,
    'body'
  >;
  return { ...meta, body: new Uint8Array(buffer, 4 + length) };
}

function toTransportError(error: unknown): TransportError {
  if (typeof error === 'object' && error !== null && 'kind' in error && 'message' in error) {
    const { kind, message, detail } = error as TransportFailure;
    return new TransportError(kind, message, detail === undefined ? {} : { detail });
  }
  // IPC-level failures (missing permission, unknown command) reject with a plain string.
  return new TransportError('unknown', 'The request failed.', { detail: String(error) });
}
