/** Returns the lowercase SHA-256 digest of bytes as hexadecimal text. */
/**
 * The hash Pigeon compares project files by (PIGN-040): line endings don't count in text files,
 * so a CRLF checkout (Git `core.autocrlf`, Windows editors) equals the LF files Pigeon writes and
 * is never rewritten just for its line endings. Binary example bodies (`*.bin`) hash as they are.
 */
export function contentHash(path: string, bytes: Uint8Array): Promise<string> {
  const binary = path.endsWith('.bin');
  // The same bytes are often hashed twice (snapshot prefetch, then the reader): reuse.
  let cached = hashes.get(bytes);
  if (!cached) hashes.set(bytes, (cached = {}));
  const key = binary ? 'binary' : 'text';
  return (cached[key] ??= sha256Hex(binary ? bytes : withoutCarriageReturns(bytes)));
}

const hashes = new WeakMap<Uint8Array, { binary?: Promise<string>; text?: Promise<string> }>();

/** `bytes` with every CR that precedes an LF removed. */
function withoutCarriageReturns(bytes: Uint8Array): Uint8Array {
  if (!bytes.includes(13)) return bytes;
  const out = new Uint8Array(bytes.byteLength);
  let length = 0;
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    out[length++] = bytes[i]!;
  }
  return out.subarray(0, length);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
