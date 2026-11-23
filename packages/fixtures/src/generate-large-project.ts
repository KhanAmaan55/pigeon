/**
 * A large generated project for performance tests (PIGN-042, ui-ux.md §7): by default 5,000
 * requests in 500 folders (one collection) and 1,000 examples, as project files
 * (path → text). Deterministic, so timings compare run to run.
 */

export interface LargeProjectOptions {
  requests?: number;
  folders?: number;
  examples?: number;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function generateLargeProject(options: LargeProjectOptions = {}): Record<string, string> {
  const requests = options.requests ?? 5000;
  const folders = options.folders ?? 500;
  const examples = options.examples ?? 1000;
  const perFolder = Math.ceil(requests / folders);
  const files: Record<string, string> = {};
  files['pigeon.json'] = json({
    pigeon: { formatVersion: 1 },
    id: 'project-large',
    name: 'Large project',
    collections: ['large'],
  });
  const folderKeys = Array.from({ length: folders }, (_, f) => `folder-${pad(f, 3)}`);
  files['collections/large/collection.json'] = json({
    info: {
      _postman_id: 'large-collection',
      name: 'Large API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    _pigeon: { order: folderKeys },
  });
  let examplesLeft = examples;
  for (let f = 0; f < folders; f++) {
    const folderKey = folderKeys[f]!;
    const keys: string[] = [];
    for (let r = f * perFolder; r < Math.min(requests, (f + 1) * perFolder); r++) {
      const key = `request-${pad(r, 5)}`;
      keys.push(key);
      const id = `large-r${r}`;
      const url = `{{baseUrl}}/resources/${r}?page=1`;
      files[`collections/large/${folderKey}/${key}.request.json`] = json({
        id,
        name: `Request ${r} ${['list', 'create', 'update', 'patch', 'delete'][r % 5]} resource`,
        request: {
          method: METHODS[r % METHODS.length],
          header: [{ key: 'Accept', value: 'application/json' }],
          url: { raw: url, query: [{ key: 'page', value: '1' }] },
        },
      });
      // Examples on the first requests of each folder until the budget is used.
      if (examplesLeft > 0 && r % perFolder < Math.ceil(examples / folders)) {
        examplesLeft -= 1;
        const dir = `examples/large/${folderKey}/${key}`;
        files[`${dir}/200-ok.example.json`] = json({
          id: `large-e${r}`,
          name: '200 OK',
          originalRequest: { method: METHODS[r % METHODS.length], header: [], url: { raw: url } },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          cookie: [],
          _pigeon: { requestId: id, bodyFile: '200-ok.body.json' },
        });
        files[`${dir}/200-ok.body.json`] = json({ id: r, name: `Resource ${r}`, active: true });
      }
    }
    files[`collections/large/${folderKey}/folder.json`] = json({
      id: `large-f${f}`,
      name: `Folder ${pad(f, 3)}`,
      _pigeon: { order: keys },
    });
  }
  return files;
}

/** A JSON document of about `megabytes` MB (an array of user-like records). */
export function generateLargeJson(megabytes = 5): string {
  const items: unknown[] = [];
  let size = 2;
  for (let i = 0; size < megabytes * 1024 * 1024; i++) {
    const item = {
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.test`,
      active: i % 3 !== 0,
      roles: ['reader', i % 7 === 0 ? 'admin' : 'writer'],
      address: { street: `${i} Main Street`, city: 'Springfield', zip: pad(i % 100000, 5) },
    };
    size += JSON.stringify(item).length + 1;
    items.push(item);
  }
  return JSON.stringify(items);
}
