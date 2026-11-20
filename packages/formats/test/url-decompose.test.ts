import { describe, expect, it } from 'vitest';

import { decomposeUrl } from '../src/postman/url';

describe('decomposeUrl (Postman URL parts)', () => {
  it.each([
    ['{{baseUrl}}/users', { host: ['{{baseUrl}}'], path: ['users'] }],
    ['{{baseUrl}}/users/:id?x=1#top', { host: ['{{baseUrl}}'], path: ['users', ':id'] }],
    [
      'https://api.example.com/v1/users',
      { protocol: 'https', host: ['api', 'example', 'com'], path: ['v1', 'users'] },
    ],
    [
      'http://localhost:4010/echo',
      { protocol: 'http', host: ['localhost'], port: '4010', path: ['echo'] },
    ],
    [
      'http://127.0.0.1:{{port}}/a/',
      { protocol: 'http', host: ['127', '0', '0', '1'], port: '{{port}}', path: ['a', ''] },
    ],
    ['api.{{env}}.example.com', { host: ['api', '{{env}}', 'example', 'com'] }],
    ['{{base.url}}/x', { host: ['{{base.url}}'], path: ['x'] }],
    [
      '{{scheme}}://{{host}}/{{path}}',
      { host: ['{{scheme}}:'], path: ['', '{{host}}', '{{path}}'] },
    ],
    ['', {}],
  ])('%s', (raw, parts) => {
    expect(decomposeUrl(raw)).toEqual(parts);
  });
});
