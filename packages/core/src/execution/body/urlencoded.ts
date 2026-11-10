import type { KeyValue } from '../../model/body';

const encoder = new TextEncoder();
const HEX = '0123456789ABCDEF';

/**
 * `application/x-www-form-urlencoded` serialization (WHATWG URL §5.2, what browsers and
 * `URLSearchParams` produce): UTF-8, `*-._` and alphanumerics kept, space → `+`, the rest `%XX`.
 * Disabled rows and empty rows are skipped; values are encoded as typed, never pre-decoded.
 */
export function encodeFormUrlencoded(params: readonly KeyValue[]): string {
  return params
    .filter((param) => !param.disabled && (param.key !== '' || param.value !== ''))
    .map((param) => `${formEncode(param.key)}=${formEncode(param.value)}`)
    .join('&');
}

export function formEncode(text: string): string {
  let out = '';
  for (const byte of encoder.encode(text)) {
    if (
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      byte === 0x2a || // *
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f // _
    ) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      out += '+';
    } else {
      out += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`;
    }
  }
  return out;
}
