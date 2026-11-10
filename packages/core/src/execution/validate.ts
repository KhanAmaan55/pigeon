/** Capability checks on a prepared body (docs/api-execution.md §1 step 4). */

import type { Capabilities } from '@pigeon/platform';

import type { RequestSettings } from '../model/request';
import type { EncodedBody } from './body';
import type { ExecutionError, Result } from './types';

/** The warning when a GET/HEAD body is dropped. */
export function bodyDroppedWarning(method: string): string {
  return `The body was not sent: ${method} requests are sent without a body unless "Send body with GET" is on in the request settings.`;
}

/** Methods whose body Pigeon prunes (Postman: `protocolProfileBehavior.disableBodyPruning`). */
export function prunesBody(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * GET/HEAD with a body: an error where the transport can't send one (browsers); elsewhere the
 * body is dropped with a warning unless `settings.disableBodyPruning` (Postman behaviour).
 */
export function validateBody(
  method: string,
  encoded: EncodedBody | undefined,
  settings: Pick<RequestSettings, 'disableBodyPruning'>,
  capabilities: Pick<Capabilities, 'canSendBodyWithGet'>,
): Result<{ encoded?: EncodedBody; warnings: string[] }, ExecutionError> {
  if (!encoded || !prunesBody(method)) {
    return { ok: true, value: { ...(encoded ? { encoded } : {}), warnings: [] } };
  }
  if (!capabilities.canSendBodyWithGet) {
    return {
      ok: false,
      error: {
        kind: 'invalid-request',
        message: `${method} requests cannot have a body here.`,
        hint: 'Remove the body (body type "none") or use another method, e.g. POST. The desktop app can send it.',
      },
    };
  }
  if (settings.disableBodyPruning) return { ok: true, value: { encoded, warnings: [] } };
  return { ok: true, value: { warnings: [bodyDroppedWarning(method)] } };
}
