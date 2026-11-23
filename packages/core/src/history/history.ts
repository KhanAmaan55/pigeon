/**
 * Local request history (PIGN-051): every send of a project request, with its response, kept per
 * project on this machine (`HistoryStore`, never the project folder). Entries are masked like
 * results (secret values → `••••••`), bodies are bounded, and the oldest entries are evicted past
 * 1,000 entries or 100 MB. Writes are batched off the send path.
 */

import type { HistoryStore } from '@pigeon/platform';

import { encodeBase64 } from '@pigeon/formats';

import { maskHeaders, maskSecrets } from '../execution/mask';
import type { ExecutionResult } from '../execution/types';
import type { Request } from '../model/request';

export const HISTORY_LIMITS = {
  maxEntries: 1000,
  maxBytes: 100 * 1024 * 1024,
  /** Per stored response body. */
  maxBodyBytes: 256 * 1024,
} as const;

export type HistoryLimits = { -readonly [K in keyof typeof HISTORY_LIMITS]: number };

export type HistoryComparison = 'pass' | 'warn' | 'fail' | 'no-baseline';

/** What the History list shows and filters on. */
export interface HistorySummary {
  id: string;
  /** ISO time the request started. */
  at: string;
  method: string;
  /** As sent, secrets masked. */
  url: string;
  requestId?: string;
  requestName?: string;
  environment?: { id: string; name: string };
  status?: number;
  statusText?: string;
  /** Error message when there was no response. */
  error?: string;
  timeMs?: number;
  /** Response body size as received. */
  sizeBytes?: number;
  comparison?: HistoryComparison;
  /** Approximate stored size of the entry (for the 100 MB limit). */
  storedBytes: number;
}

export interface HistoryEntry extends HistorySummary {
  request: {
    method: string;
    url: string;
    headers: Array<[string, string]>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    url: string;
    httpVersion?: string;
    contentType?: string;
    /** UTF-8 text (masked), or base64 for binary bodies. */
    body: string;
    bodyEncoding: 'text' | 'base64';
    /** The body was cut at `maxBodyBytes`. */
    truncated: boolean;
    sizeBytes: number;
    timings: { totalMs: number; ttfbMs?: number };
    headersRestricted: boolean;
  };
  errorDetail?: { kind: string; message: string; detail?: string; hint?: string };
  warnings: string[];
  /**
   * The request as defined when it was sent (`{{variables}}` kept; literal secrets masked), for
   * "Restore into request" / "Open as new request". Absent when too large.
   */
  source?: Request;
}

/** A request definition larger than this is not kept with its history entry. */
const MAX_SOURCE_BYTES = 256 * 1024;

export interface HistoryEntryOptions {
  id?: string;
  /** Resolved secret values of the send (`PreparedRequest.meta.secretValues`). */
  secretValues: readonly string[];
  requestName?: string;
  environment?: { id: string; name: string };
  comparison?: HistoryComparison;
  maxBodyBytes?: number;
  /** The request definition that was sent (see `HistoryEntry.source`). */
  source?: Request;
}

function cutUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  // Decoding a cut that splits a character drops the partial one.
  return {
    text: new TextDecoder().decode(bytes.subarray(0, maxBytes)).replace(/�$/, ''),
    truncated: true,
  };
}

/**
 * The entry for an execution result, or `null` when it must not be stored: a secret too short to
 * be masked was sent (`containsUnmaskedSecrets`), or the send was cancelled.
 */
export function historyEntryFromResult(
  result: ExecutionResult,
  options: HistoryEntryOptions,
): HistoryEntry | null {
  if (result.containsUnmaskedSecrets || result.error?.kind === 'aborted') return null;
  const secrets = options.secretValues;
  const mask = (text: string) => maskSecrets(text, secrets);
  const maxBody = options.maxBodyBytes ?? HISTORY_LIMITS.maxBodyBytes;
  const response = result.response;
  let stored: HistoryEntry['response'];
  if (response) {
    const textual = response.bodyText !== undefined;
    const cut = textual
      ? cutUtf8(mask(response.bodyText!), maxBody)
      : {
          text: encodeBase64(response.body.subarray(0, maxBody)),
          truncated: response.body.byteLength > maxBody,
        };
    stored = {
      status: response.status,
      statusText: response.statusText,
      headers: maskHeaders(response.headers, secrets),
      url: mask(response.url),
      ...(response.httpVersion ? { httpVersion: response.httpVersion } : {}),
      ...(response.contentType ? { contentType: response.contentType } : {}),
      body: cut.text,
      bodyEncoding: textual ? 'text' : 'base64',
      truncated: cut.truncated,
      sizeBytes: response.sizeBytes,
      timings: {
        totalMs: response.timings.totalMs,
        ...(response.timings.ttfbMs === undefined ? {} : { ttfbMs: response.timings.ttfbMs }),
      },
      headersRestricted: response.headersRestricted,
    };
  }
  const entry: HistoryEntry = {
    id: options.id ?? crypto.randomUUID(),
    at: result.startedAt,
    method: result.request.method,
    url: result.request.url,
    ...(result.requestId ? { requestId: result.requestId } : {}),
    ...(options.requestName ? { requestName: options.requestName } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(stored
      ? {
          status: stored.status,
          statusText: stored.statusText,
          timeMs: stored.timings.totalMs,
          sizeBytes: stored.sizeBytes,
        }
      : {}),
    ...(result.error ? { error: mask(result.error.message) } : {}),
    ...(options.comparison ? { comparison: options.comparison } : {}),
    storedBytes: 0,
    request: {
      method: result.request.method,
      url: result.request.url,
      headers: result.request.headers,
      ...(result.request.bodyPreview === undefined ? {} : { body: result.request.bodyPreview }),
    },
    ...(stored ? { response: stored } : {}),
    ...(result.error
      ? {
          errorDetail: {
            kind: result.error.kind,
            message: mask(result.error.message),
            ...(result.error.detail ? { detail: mask(result.error.detail) } : {}),
            ...(result.error.hint ? { hint: result.error.hint } : {}),
          },
        }
      : {}),
    warnings: result.warnings.map(mask),
  };
  if (options.source) {
    const json = mask(JSON.stringify(options.source));
    if (json.length <= MAX_SOURCE_BYTES) entry.source = JSON.parse(json) as Request;
  }
  entry.storedBytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
  return entry;
}

/** The summary part of an entry (what the list keeps in memory). */
export function historySummary(entry: HistoryEntry): HistorySummary {
  const {
    request: _request,
    response: _response,
    warnings: _warnings,
    errorDetail: _errorDetail,
    source: _source,
    ...summary
  } = entry;
  return summary;
}

function isSummary(value: unknown): value is HistorySummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['at'] === 'string' &&
    typeof v['method'] === 'string' &&
    typeof v['url'] === 'string'
  );
}

/**
 * One project's history. `record` returns at once: entries are written in batches (`flush`),
 * then the oldest are evicted past the limits.
 */
export class ProjectHistory {
  readonly #store: HistoryStore;
  readonly #key: string;
  readonly #limits: HistoryLimits;
  /** Oldest first; loaded on first use. */
  #summaries: HistorySummary[] | null = null;
  #loading: Promise<HistorySummary[]> | null = null;
  readonly #pending = new Map<string, HistoryEntry>();
  #flushing: Promise<void> = Promise.resolve();
  #scheduled = false;
  readonly #listeners = new Set<() => void>();

  constructor(store: HistoryStore, projectKey: string, limits: Partial<HistoryLimits> = {}) {
    this.#store = store;
    this.#key = projectKey;
    this.#limits = { ...HISTORY_LIMITS, ...limits };
  }

  get limits(): Readonly<HistoryLimits> {
    return this.#limits;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  async #load(): Promise<HistorySummary[]> {
    if (this.#summaries) return this.#summaries;
    this.#loading ??= this.#store.list(this.#key).then((rows) => {
      this.#summaries ??= rows.filter(isSummary);
      return this.#summaries;
    });
    return this.#loading;
  }

  /** Queues `entry`; it is listed immediately and written with the next batch. */
  record(entry: HistoryEntry): void {
    this.#pending.set(entry.id, entry);
    if (this.#summaries) this.#summaries.push(historySummary(entry));
    this.#emit();
    if (this.#scheduled) return;
    this.#scheduled = true;
    setTimeout(() => {
      this.#scheduled = false;
      void this.flush().catch(() => undefined);
    }, 0);
  }

  /** Writes queued entries and evicts past the limits. */
  flush(): Promise<void> {
    this.#flushing = this.#flushing
      .catch(() => undefined)
      .then(async () => {
        if (this.#pending.size === 0) return;
        const batch = [...this.#pending.values()];
        const summaries = await this.#load();
        await this.#store.append(
          this.#key,
          batch.map((entry) => ({ id: entry.id, summary: historySummary(entry), entry })),
        );
        for (const entry of batch) this.#pending.delete(entry.id);
        for (const entry of batch) {
          if (!summaries.some((s) => s.id === entry.id)) summaries.push(historySummary(entry));
        }
        await this.#evict(summaries);
      });
    return this.#flushing;
  }

  async #evict(summaries: HistorySummary[]): Promise<void> {
    let bytes = summaries.reduce((total, s) => total + (s.storedBytes || 0), 0);
    let count = summaries.length;
    const evicted: string[] = [];
    for (const summary of summaries) {
      if (count <= this.#limits.maxEntries && bytes <= this.#limits.maxBytes) break;
      evicted.push(summary.id);
      count -= 1;
      bytes -= summary.storedBytes || 0;
    }
    if (evicted.length === 0) return;
    await this.#store.remove(this.#key, evicted);
    const gone = new Set(evicted);
    this.#summaries = summaries.filter((s) => !gone.has(s.id));
    this.#emit();
  }

  /** Newest first. */
  async list(): Promise<HistorySummary[]> {
    const summaries = await this.#load();
    const listed = new Set(summaries.map((s) => s.id));
    const pending = [...this.#pending.values()]
      .filter((entry) => !listed.has(entry.id))
      .map(historySummary);
    return [...summaries, ...pending].reverse();
  }

  async get(id: string): Promise<HistoryEntry | undefined> {
    const pending = this.#pending.get(id);
    if (pending) return pending;
    const entry = await this.#store.get(this.#key, id);
    return isSummary(entry) ? (entry as HistoryEntry) : undefined;
  }

  async remove(ids: readonly string[]): Promise<void> {
    await this.flush();
    await this.#store.remove(this.#key, ids);
    const gone = new Set(ids);
    if (this.#summaries) this.#summaries = this.#summaries.filter((s) => !gone.has(s.id));
    this.#emit();
  }

  async clear(): Promise<void> {
    await this.flush();
    this.#pending.clear();
    await this.#store.clear(this.#key);
    this.#summaries = [];
    this.#emit();
  }
}

export interface HistoryFilter {
  /** Case-insensitive, in the URL or request name. */
  text?: string;
  method?: string;
  /** `2xx` … `5xx`, or `error` (no response). */
  status?: '2xx' | '3xx' | '4xx' | '5xx' | 'error';
}

export function filterHistory(
  summaries: readonly HistorySummary[],
  filter: HistoryFilter,
): HistorySummary[] {
  const text = filter.text?.trim().toLowerCase() ?? '';
  return summaries.filter((s) => {
    if (filter.method && s.method !== filter.method) return false;
    if (filter.status) {
      if (filter.status === 'error') {
        if (s.status !== undefined) return false;
      } else if (s.status === undefined || `${Math.floor(s.status / 100)}xx` !== filter.status) {
        return false;
      }
    }
    if (text !== '') {
      const haystack = `${s.url} ${s.requestName ?? ''}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

/** Summaries grouped by local calendar day (newest first), with a heading key `YYYY-MM-DD`. */
export function groupHistoryByDay(
  summaries: readonly HistorySummary[],
): Array<{ day: string; entries: HistorySummary[] }> {
  const groups: Array<{ day: string; entries: HistorySummary[] }> = [];
  for (const summary of summaries) {
    const date = new Date(summary.at);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(summary);
    else groups.push({ day, entries: [summary] });
  }
  return groups;
}
