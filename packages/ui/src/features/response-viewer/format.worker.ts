/** Formats response bodies off the main thread (see ./formatting.ts `formatBody`). */

import type { FormatRequest } from './formatters';
import { formatSync } from './formatters';

self.addEventListener('message', (event: MessageEvent<FormatRequest & { id: number }>) => {
  const { id, ...request } = event.data;
  self.postMessage({ id, text: formatSync(request) });
});
