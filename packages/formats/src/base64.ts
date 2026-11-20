/** Base64 without DOM APIs (formats targets plain ES2022). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out.push(
      ALPHABET[(n >> 18) & 63]!,
      ALPHABET[(n >> 12) & 63]!,
      b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!,
      c === undefined ? '=' : ALPHABET[n & 63]!,
    );
  }
  return out.join('');
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let length = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = [...clean.slice(i, i + 4)].map((char) => LOOKUP.get(char)!);
    const n =
      (chunk[0]! << 18) | ((chunk[1] ?? 0) << 12) | ((chunk[2] ?? 0) << 6) | (chunk[3] ?? 0);
    bytes[length++] = (n >> 16) & 255;
    if (chunk.length > 2) bytes[length++] = (n >> 8) & 255;
    if (chunk.length > 3) bytes[length++] = n & 255;
  }
  return bytes.slice(0, length);
}
