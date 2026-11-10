/**
 * Body encoding (docs/api-execution.md §5): `Body` → `PreparedBody` plus the `Content-Type` Pigeon
 * adds when the user didn't set one. Pure; files are only referenced, the transport reads them.
 */

import type { PreparedBody } from '@pigeon/platform';

import type { Body, RawLanguage } from '../../model/body';
import { fileNameFromSrc, fileRefFromSrc, fileSources } from '../../model/body';
import { mediaTypeForFileName, OCTET_STREAM } from './media-types';
import { toMultipartParts } from './multipart';
import { encodeFormUrlencoded } from './urlencoded';

export { mediaTypeForFileName, OCTET_STREAM } from './media-types';
export { toMultipartParts } from './multipart';
export { encodeFormUrlencoded, formEncode } from './urlencoded';

export const RAW_CONTENT_TYPES: Readonly<Record<RawLanguage, string>> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
};

export const FORM_URLENCODED = 'application/x-www-form-urlencoded';

export interface EncodedBody {
  body: PreparedBody;
  /**
   * Default `Content-Type`. Unset for multipart: the transport sets
   * `multipart/form-data; boundary=…` because only it knows the boundary.
   */
  contentType?: string;
}

export interface BodyEncoding {
  /** Unset when nothing is sent: mode `none`, `disabled`, or an empty raw/form/file body. */
  encoded?: EncodedBody;
  warnings: string[];
}

const encoder = new TextEncoder();

export function encodeBody(body: Body): BodyEncoding {
  if (body.disabled) return { warnings: [] };
  switch (body.mode) {
    case 'none':
      return { warnings: [] };
    case 'raw':
      // Sent byte for byte as typed (UTF-8), never re-serialized.
      if (body.raw === '') return { warnings: [] };
      return {
        encoded: {
          body: { kind: 'bytes', bytes: encoder.encode(body.raw) },
          contentType: RAW_CONTENT_TYPES[body.language],
        },
        warnings: [],
      };
    case 'urlencoded': {
      const text = encodeFormUrlencoded(body.params);
      if (text === '') return { warnings: [] };
      return {
        encoded: {
          body: { kind: 'bytes', bytes: encoder.encode(text) },
          contentType: FORM_URLENCODED,
        },
        warnings: [],
      };
    }
    case 'formdata': {
      const { parts, warnings } = toMultipartParts(body.params);
      if (parts.length === 0) return { warnings };
      return { encoded: { body: { kind: 'multipart', parts } }, warnings };
    }
    case 'file': {
      const ref = body.src === undefined ? undefined : fileRefFromSrc(body.src);
      if (!ref || body.src === undefined) return { warnings: [] };
      return {
        encoded: {
          body: { kind: 'file', ref },
          contentType: mediaTypeForFileName(fileNameFromSrc(body.src)) ?? OCTET_STREAM,
        },
        warnings: [],
      };
    }
  }
}

/** Whether `encodeBody` would send a body, without encoding it. */
export function hasBody(body: Body): boolean {
  if (body.disabled) return false;
  switch (body.mode) {
    case 'none':
      return false;
    case 'raw':
      return body.raw !== '';
    case 'urlencoded':
      return body.params.some((p) => !p.disabled && (p.key !== '' || p.value !== ''));
    case 'formdata':
      return body.params.some((p) =>
        p.disabled
          ? false
          : p.kind === 'text'
            ? p.key !== '' || p.value !== ''
            : fileSources(p).length > 0,
      );
    case 'file':
      return body.src !== undefined && body.src !== '';
  }
}
