/**
 * `Transport` over the Rust `http_send` / `http_cancel` commands (docs/api-execution.md §7.1;
 * apps/desktop/src-tauri/src/http.rs). Requests leave from the native side, so CORS and
 * forbidden-header rules don't apply.
 *
 * Both directions use one binary frame, `[u32 LE JSON length][JSON][body bytes]`: Tauri passes
 * `Uint8Array` arguments and `tauri::ipc::Response` results as raw bytes, so bodies never go
 * through base64 or JSON number arrays.
 */

import type {
  FileRef,
  PickedFileStore,
  PreparedRequest,
  RawResponse,
  Transport,
  TransportErrorKind,
} from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type Invoke = <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => Promise<T>;

export interface NativeTransportOptions {
  /** Defaults to Tauri's `invoke`; tests pass a fake. */
  invoke?: Invoke;
  /** Where `picked` file refs are read from; their bytes travel in the frame. */
  pickedFiles?: PickedFileStore;
}

/**
 * A file as http.rs reads it: from disk, or from the frame's body bytes (`offset`/`length` into
 * them), which is how files picked this session travel.
 */
export type WireFileRef =
  { kind: 'absolute'; path: string } | { kind: 'inline'; offset: number; length: number };

/** The request body in the frame's JSON; `bytes` means the frame's body bytes are the body. */
export type WireBody =
  | { kind: 'bytes' }
  | { kind: 'file'; ref: WireFileRef }
  | {
      kind: 'multipart';
      parts: Array<
        | { name: string; kind: 'text'; value: string; contentType?: string }
        | { name: string; kind: 'file'; file: WireFileRef; filename: string; contentType?: string }
      >;
    };

/** What `http_send` rejects with (Rust `TransportFailure`). */
interface TransportFailure {
  kind: TransportErrorKind;
  message: string;
  detail?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class NativeTransport implements Transport {
  readonly #invoke: Invoke;
  readonly #pickedFiles: PickedFileStore | undefined;

  constructor(opts: NativeTransportOptions = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
    this.#pickedFiles = opts.pickedFiles;
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const frame = encodeRequestFrame(req, this.#pickedFiles);

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

/**
 * `PreparedRequest` → IPC frame. Field names stay identical to the TS types (serde reads them);
 * file refs become `WireFileRef`s, with picked files' bytes appended after the JSON.
 */
export function encodeRequestFrame(
  req: PreparedRequest,
  pickedFiles?: PickedFileStore,
): Uint8Array {
  const { body, ...rest } = req;
  const chunks: Uint8Array[] = [];
  let tailLength = 0;
  const inline = (bytes: Uint8Array): WireFileRef => {
    chunks.push(bytes);
    tailLength += bytes.byteLength;
    return { kind: 'inline', offset: tailLength - bytes.byteLength, length: bytes.byteLength };
  };
  const wireRef = (ref: FileRef, name?: string): WireFileRef => {
    if (ref.kind === 'absolute') return { kind: 'absolute', path: ref.path };
    return inline(readFile(ref, name, pickedFiles));
  };

  let wire: WireBody | undefined;
  switch (body?.kind) {
    case undefined:
      break;
    case 'bytes':
      wire = { kind: 'bytes' };
      inline(body.bytes);
      break;
    case 'file':
      if (body.ref.kind === 'absolute') {
        wire = { kind: 'file', ref: { kind: 'absolute', path: body.ref.path } };
      } else {
        wire = { kind: 'bytes' };
        inline(readFile(body.ref, undefined, pickedFiles));
      }
      break;
    case 'multipart':
      wire = {
        kind: 'multipart',
        parts: body.parts.map((part) =>
          part.kind === 'text' ? part : { ...part, file: wireRef(part.file, part.filename) },
        ),
      };
      break;
  }

  const json = encoder.encode(JSON.stringify(wire ? { ...rest, body: wire } : rest));
  const frame = new Uint8Array(4 + json.byteLength + tailLength);
  new DataView(frame.buffer).setUint32(0, json.byteLength, true);
  frame.set(json, 4);
  let offset = 4 + json.byteLength;
  for (const chunk of chunks) {
    frame.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return frame;
}

/** Bytes of a file picked this session; project files arrive with PIGN-014. */
function readFile(
  ref: FileRef,
  name: string | undefined,
  pickedFiles?: PickedFileStore,
): Uint8Array {
  const label = name === undefined ? 'The file' : `The file "${name}"`;
  if (ref.kind === 'picked') {
    const file = pickedFiles?.get(ref.id);
    if (file) return file.bytes;
    throw new TransportError(
      'file-unavailable',
      `${label} is no longer available. Select it again.`,
    );
  }
  throw new TransportError(
    'file-unavailable',
    `${label} cannot be read: project files are not supported yet.`,
    { detail: ref.path, hint: 'Select the file again.' },
  );
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
