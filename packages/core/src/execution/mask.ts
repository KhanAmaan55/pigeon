/**
 * Secret masking for anything shown or stored about a sent request (results, timeline, history).
 * A stub until secret variables land (PIGN-025): it masks the values it is given, and
 * `PreparedRequest.meta.secretValues` stays empty until then.
 */

export const SECRET_MASK = '••••••';

/** `text` with every non-empty secret value replaced by {@link SECRET_MASK}. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (masked, secret) => (secret === '' ? masked : masked.split(secret).join(SECRET_MASK)),
    text,
  );
}

/** Headers with secret values masked; names are never secret. */
export function maskHeaders(
  headers: ReadonlyArray<readonly [string, string]>,
  secrets: readonly string[],
): Array<[string, string]> {
  return headers.map(([name, value]) => [name, maskSecrets(value, secrets)]);
}
