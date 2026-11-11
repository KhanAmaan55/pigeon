import { PickedFileStore } from '@pigeon/platform';
import { transportConformanceCases } from '@pigeon/platform/conformance/transport-cases';
import { detectWebCapabilities, FetchTransport } from '@pigeon/platform-web';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * The shared transport cases (docs/platform.md §8) against FetchTransport, with every `fetch`
 * made by the real browser from the app's origin, so CORS, forbidden headers and redirects
 * behave exactly as in Pigeon web. The cases and FetchTransport run in Node; only `fetch`
 * crosses into the page.
 */

/** Case id → story that makes it pass. They run as expected failures (`test.fail`). */
const EXPECTED_FAILURES: Record<string, string> = {};

// Transport capabilities don't depend on the browser's feature set (only folder access does).
const cases = transportConformanceCases(detectWebCapabilities({}));

test.describe('FetchTransport conformance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  for (const testCase of cases) {
    test(testCase.title, async ({ page }) => {
      test.skip(testCase.skip !== undefined, testCase.skip);
      const story = EXPECTED_FAILURES[testCase.id];
      test.fail(story !== undefined, `until ${story}`);
      const pickedFiles = new PickedFileStore();
      const transport = new FetchTransport({ fetch: browserFetch(page), pickedFiles });
      await testCase.run({ transport, pickedFiles, baseUrl: TEST_SERVER_URL });
    });
  }
});

type PageFetchResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      url: string;
      headers: Array<[string, string]>;
      body: string;
    }
  | { ok: false; name: string; message: string };

/** A fetch body as it crosses into the page: bytes, or `FormData` entries. */
type PageBody =
  | { kind: 'bytes'; data: number[] }
  | {
      kind: 'form';
      entries: Array<
        | { name: string; value: string }
        | { name: string; filename: string; type: string; data: number[] }
      >;
    };

interface PageFetchInit {
  id: string;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: PageBody | null;
  redirect: RequestRedirect;
  cache: RequestCache;
  credentials: RequestCredentials;
}

/** A `fetch` that runs in `page`; aborting `init.signal` aborts the browser's request. */
function browserFetch(page: Page): typeof fetch {
  return async (input, init = {}) => {
    const id = crypto.randomUUID();
    const signal = init.signal ?? undefined;
    const abortInPage = () => {
      void page
        .evaluate((requestId) => {
          const scope = globalThis as unknown as { pigeonAborts?: Map<string, AbortController> };
          scope.pigeonAborts?.get(requestId)?.abort();
        }, id)
        .catch(() => undefined);
    };
    signal?.addEventListener('abort', abortInPage, { once: true });
    try {
      const pageInit: PageFetchInit = {
        id,
        url: String(input),
        method: init.method ?? 'GET',
        headers: [...new Headers(init.headers)],
        body: await toPageBody(init.body),
        redirect: init.redirect ?? 'follow',
        cache: init.cache ?? 'default',
        credentials: init.credentials ?? 'same-origin',
      };
      const result = await page.evaluate(async (req): Promise<PageFetchResult> => {
        const scope = globalThis as unknown as { pigeonAborts?: Map<string, AbortController> };
        const aborts = (scope.pigeonAborts ??= new Map());
        const controller = new AbortController();
        aborts.set(req.id, controller);
        let body: BodyInit | undefined;
        if (req.body?.kind === 'bytes') body = new Uint8Array(req.body.data);
        if (req.body?.kind === 'form') {
          const form = new FormData();
          for (const entry of req.body.entries) {
            if ('value' in entry) form.append(entry.name, entry.value);
            else {
              const file = new File([new Uint8Array(entry.data)], entry.filename, {
                type: entry.type,
              });
              form.append(entry.name, file);
            }
          }
          body = form;
        }
        try {
          const response = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            ...(body === undefined ? {} : { body }),
            redirect: req.redirect,
            cache: req.cache,
            credentials: req.credentials,
            signal: controller.signal,
          });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          return {
            ok: true,
            status: response.status,
            statusText: response.statusText,
            url: response.url,
            headers: [...response.headers],
            body: btoa(binary),
          };
        } catch (error) {
          const { name, message } = error as Error;
          return { ok: false, name, message };
        } finally {
          aborts.delete(req.id);
        }
      }, pageInit);

      if (!result.ok) {
        if (result.name === 'AbortError') throw new DOMException(result.message, 'AbortError');
        if (result.name === 'TypeError') throw new TypeError(result.message);
        throw new Error(`${result.name}: ${result.message}`);
      }
      const body = Buffer.from(result.body, 'base64');
      const nullBody = [101, 103, 204, 205, 304].includes(result.status);
      const response = new Response(nullBody ? null : body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
      // `Response.url` is read-only and empty for constructed responses.
      Object.defineProperty(response, 'url', { value: result.url });
      return response;
    } finally {
      signal?.removeEventListener('abort', abortInPage);
    }
  };
}

async function toPageBody(body: BodyInit | null | undefined): Promise<PageBody | null> {
  if (body === null || body === undefined) return null;
  if (body instanceof Uint8Array) return { kind: 'bytes', data: [...body] };
  if (body instanceof Blob) {
    return { kind: 'bytes', data: [...new Uint8Array(await body.arrayBuffer())] };
  }
  if (body instanceof FormData) {
    const entries: Extract<PageBody, { kind: 'form' }>['entries'] = [];
    for (const [name, value] of body) {
      if (typeof value === 'string') entries.push({ name, value });
      else {
        const data = [...new Uint8Array(await value.arrayBuffer())];
        entries.push({ name, filename: value.name, type: value.type, data });
      }
    }
    return { kind: 'form', entries };
  }
  throw new Error(`browserFetch: unsupported body ${Object.prototype.toString.call(body)}`);
}
