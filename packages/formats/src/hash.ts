/** Returns the lowercase SHA-256 digest of bytes as hexadecimal text. */
/**
 * The hash Pigeon compares project files by (PIGN-040): line endings don't count in text files,
 * so a CRLF checkout (Git `core.autocrlf`, Windows editors) equals the LF files Pigeon writes and
 * is never rewritten just for its line endings. Binary example bodies (`*.bin`) hash as they are.
 */
export async function contentHash(path: string, bytes: Uint8Array): Promise<string> {
  return sha256Hex(path.endsWith('.bin') ? bytes : withoutCarriageReturns(bytes));
}

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
