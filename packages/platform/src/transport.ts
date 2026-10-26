/** Wire-level request/response types (docs/api-execution.md §2) and the `Transport` contract. */

import type { ProjectPath } from './fs';

/** Entity / execution identifier. */
export type Id = string;

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  strictSSL: boolean;
}

export interface PreparedRequest {
  /** Execution id (used for cancel). */
  id: Id;
  method: string;
  /** Fully resolved, encoded. */
  url: string;
  /** Ordered, duplicates allowed. */
  headers: Array<[string, string]>;
  body?: PreparedBody;
  settings: RequestSettings;
  meta: {
    requestId?: Id;
    protocol: 'http' | 'graphql';
    unresolved: string[];
    secretValues: string[];
  };
}

export type PreparedBody =
  | { kind: 'bytes'; bytes: Uint8Array } // json/text/xml/urlencoded/graphql
  | { kind: 'multipart'; parts: MultipartPart[] } // transport builds boundary (browser: FormData)
  | { kind: 'file'; ref: FileRef }; // binary body from a file

export type MultipartPart =
  | { name: string; kind: 'text'; value: string; contentType?: string }
  | { name: string; kind: 'file'; file: FileRef; filename: string; contentType?: string };

export type FileRef =
  | { kind: 'project'; path: ProjectPath } // read through ProjectFileSystem
  | { kind: 'absolute'; path: string } // desktop only
  | { kind: 'picked'; id: string }; // web: in-memory File picked this session

export interface RawResponse {
  status: number;
  statusText: string;
  /** Raw order, duplicates kept (Set-Cookie). */
  headers: Array<[string, string]>;
  /** Decoded (content-encoding removed). */
  body: Uint8Array;
  /** Final URL after redirects. */
  url: string;
  /** Empty on web. */
  redirects: Array<{ status: number; url: string; location: string }>;
  httpVersion?: string;
  timings: { startedAt: number; totalMs: number; ttfbMs?: number };
  /** True on web: some headers are invisible to the page. */
  headersRestricted: boolean;
}

export interface Transport {
  /** Rejects with `signal.reason` when aborted. */
  send(req: PreparedRequest, opts: { signal: AbortSignal }): Promise<RawResponse>;
}
