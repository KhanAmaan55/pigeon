import { NODE_CAPABILITIES, NodeTransport } from '@pigeon/platform-node';
import type { TestServer } from '@pigeon/test-server';
import { AWS_TEST_KEYS, startTestServer } from '@pigeon/test-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAwsV4 } from '../src/execution/auth/awsv4';
import { digestAuthorization, md5Hex, parseDigestChallenge } from '../src/execution/auth/digest';
import type { Auth } from '../src/index';
import { createExecutionContext, createRequest, RequestExecutor } from '../src/index';

const AWS = {
  type: 'awsv4' as const,
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  sessionToken: '',
  addAuthDataToQuery: false,
};
const NOW = new Date('2015-08-30T12:36:00Z');
const signature = (headers: Array<[string, string]>) =>
  /Signature=([0-9a-f]+)/.exec(headers.find(([n]) => n === 'Authorization')![1])![1];

describe('AWS SigV4 reference vectors (PIGN-046)', () => {
  it('get-vanilla (aws-sig-v4-test-suite)', async () => {
    const signed = await signAwsV4(AWS, {
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: [],
      body: new Uint8Array(),
      now: NOW,
    });
    expect(signature(signed.headers)).toBe(
      '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(signed.headers).toContainEqual(['X-Amz-Date', '20150830T123600Z']);
  });

  it('IAM ListUsers (AWS documentation example)', async () => {
    const signed = await signAwsV4(
      { ...AWS, service: 'iam' },
      {
        method: 'GET',
        url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
        headers: [['Content-Type', 'application/x-www-form-urlencoded; charset=utf-8']],
        body: new Uint8Array(),
        now: NOW,
      },
    );
    expect(signed.headers.find(([n]) => n === 'Authorization')![1]).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});

describe('Digest (PIGN-046)', () => {
  it('MD5 matches RFC 1321 test values', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    // Spans two 64-byte blocks.
    expect(md5Hex('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('answers the RFC 2617 §3.5 example', async () => {
    const challenge = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    )!;
    const header = await digestAuthorization(
      {
        type: 'digest',
        username: 'Mufasa',
        password: 'Circle Of Life',
        realm: '',
        nonce: '',
        algorithm: '',
        qop: '',
        nonceCount: '',
        clientNonce: '',
        opaque: '',
      },
      challenge,
      'GET',
      '/dir/index.html',
      '0a4f113b',
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('qop=auth, nc=00000001, cnonce="0a4f113b"');
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });
});

describe('Digest and AWS SigV4 against the test server (PIGN-046)', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server.close());

  const send = (path: string, auth: Auth, init: { method?: string; body?: string } = {}) =>
    new RequestExecutor(new NodeTransport()).execute(
      {
        ...createRequest({
          name: 'R',
          method: init.method ?? 'GET',
          url: { raw: `${server.url}${path}`, query: [], pathVariables: [], extra: {} },
          ...(init.body === undefined
            ? {}
            : { body: { mode: 'raw', raw: init.body, language: 'json' } }),
        }),
        auth,
      },
      createExecutionContext({ capabilities: NODE_CAPABILITIES }),
    );
  const digest = (password: string, extra: Partial<Auth> = {}): Auth =>
    ({
      type: 'digest',
      username: 'ada',
      password,
      realm: '',
      nonce: '',
      algorithm: '',
      qop: '',
      nonceCount: '',
      clientNonce: '',
      opaque: '',
      ...extra,
    }) as Auth;
  const aws = (extra: Partial<Auth> = {}): Auth =>
    ({
      type: 'awsv4',
      ...AWS_TEST_KEYS,
      sessionToken: '',
      addAuthDataToQuery: false,
      ...extra,
    }) as Auth;

  it('Digest answers the challenge (MD5 and SHA-256); a wrong password stays 401', async () => {
    const md5 = await send('/auth/digest?user=ada&pass=lovelace', digest('lovelace'));
    expect(md5.response?.status).toBe(200);
    const sha = await send(
      '/auth/digest?user=ada&pass=lovelace&algorithm=SHA-256',
      digest('lovelace'),
    );
    expect(sha.response?.status).toBe(200);
    expect(
      (await send('/auth/digest?user=ada&pass=lovelace', digest('wrong'))).response?.status,
    ).toBe(401);
    // The password is masked like every credential.
    expect(JSON.stringify(md5)).not.toContain('lovelace"');
  });

  it('AWS SigV4 signs headers, a body and a session token, or the query string', async () => {
    const plain = await send('/auth/awsv4?b=2&a=1', aws());
    expect(plain.response?.status).toBe(200);
    const posted = await send('/auth/awsv4', aws({ sessionToken: 'session-token' }), {
      method: 'POST',
      body: '{"name":"Ada"}',
    });
    expect(posted.response?.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(posted.response!.body)).signedHeaders).toContain(
      'x-amz-security-token',
    );
    const presigned = await send('/auth/awsv4', aws({ addAuthDataToQuery: true }));
    expect(presigned.response?.status).toBe(200);
    expect(presigned.request.url).toContain('X-Amz-Signature=');
    expect(presigned.request.url).not.toContain(AWS_TEST_KEYS.secretKey);
    const wrong = await send('/auth/awsv4', aws({ secretKey: 'nope' }));
    expect(wrong.response?.status).toBe(403);
  });
});
