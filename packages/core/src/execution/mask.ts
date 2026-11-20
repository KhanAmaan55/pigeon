/**
 * Secret masking for anything shown or stored about a sent request (results, timeline, error
 * details, history): `PreparedRequest.meta.secretValues` holds the resolved values of secret
 * variables (PIGN-025).
 *
 * Values shorter than {@link MIN_MASKED_LENGTH} are not masked in free text (they would match
 * everywhere); a result that used one is flagged so it is never stored (`hasShortSecret`).
 */

export const SECRET_MASK = '••••••';
export const MIN_MASKED_LENGTH = 4;

/** `text` with every secret value (longest first) replaced by {@link SECRET_MASK}. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((secret) => secret.length >= MIN_MASKED_LENGTH)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, secret) => masked.split(secret).join(SECRET_MASK), text);
}

/** True when some secret is too short to be masked in free text. */
export function hasShortSecret(secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret.length > 0 && secret.length < MIN_MASKED_LENGTH);
}

/** Headers with secret values masked; names are never secret. */
export function maskHeaders(
  headers: ReadonlyArray<readonly [string, string]>,
  secrets: readonly string[],
): Array<[string, string]> {
  return headers.map(([name, value]) => [name, maskSecrets(value, secrets)]);
}
