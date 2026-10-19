/**
 * Minimal web-standard globals for the pure packages (core, formats, compare, platform, fixtures).
 *
 * Those packages compile with `lib: ["ES2022"]` and no DOM or Node types, so that platform APIs
 * (`document`, `window`, `fs`, ...) are type errors. The globals below exist in browsers, Tauri
 * webviews and Node >= 22 alike, so shared code may rely on them.
 *
 * Keep this list short and deliberate. Never include this file in a project that also loads
 * `lib.dom` or `@types/node` — the declarations would conflict.
 */

interface TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}
declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}
interface TextDecodeOptions {
  stream?: boolean;
}
interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBuffer | ArrayBufferView, options?: TextDecodeOptions): string;
}
declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};

interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?: string | Record<string, string> | Iterable<readonly [string, string]>,
  ): URLSearchParams;
};

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}
declare var URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  canParse(url: string | URL, base?: string | URL): boolean;
};

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
declare var AbortSignal: {
  prototype: AbortSignal;
  abort(reason?: unknown): AbortSignal;
  any(signals: Iterable<AbortSignal>): AbortSignal;
  timeout(milliseconds: number): AbortSignal;
};

interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

declare function structuredClone<T>(value: T): T;

type DigestAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

interface SubtleCrypto {
  digest(
    algorithm: DigestAlgorithm | { name: DigestAlgorithm },
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
}
interface Crypto {
  readonly subtle: SubtleCrypto;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}
declare var crypto: Crypto;
