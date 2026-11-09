import type { IncomingMessage } from 'node:http';

/** What a route handler returns; the server writes it (adding Content-Length and CORS headers). */
export interface Reply {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string | Uint8Array;
}

export interface RequestContext {
  req: IncomingMessage;
  method: string;
  /** Raw request path, without the query string (not normalised or decoded). */
  path: string;
  query: URLSearchParams;
  /** Capture groups of the route pattern. */
  params: string[];
  body: Buffer;
  /** Aborted when the client goes away (used by `/delay`). */
  signal: AbortSignal;
}

export type Handler = (ctx: RequestContext) => Reply | Promise<Reply>;

export const JSON_TYPE = 'application/json; charset=utf-8';

export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string | string[]> = {},
): Reply {
  return {
    status,
    headers: { 'Content-Type': JSON_TYPE, ...headers },
    body: `${JSON.stringify(value, null, 2)}\n`,
  };
}

export const error = (status: number, message: string) => json({ error: message }, status);

/** Parses a decimal path parameter, or returns `undefined` when it is outside `[min, max]`. */
export function intParam(raw: string | undefined, min: number, max: number): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}
