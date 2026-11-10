import type { MultipartPart } from '@pigeon/platform';

import type { FormDataParam } from '../../model/body';
import { fileNameFromSrc, fileRefFromSrc, fileSources } from '../../model/body';
import { mediaTypeForFileName, OCTET_STREAM } from './media-types';

/**
 * Enabled form-data rows → multipart parts, in order. A file row becomes one part per file; a
 * file row with no file is skipped with a warning. The boundary is the transport's job.
 */
export function toMultipartParts(params: readonly FormDataParam[]): {
  parts: MultipartPart[];
  warnings: string[];
} {
  const parts: MultipartPart[] = [];
  const warnings: string[] = [];
  for (const param of params) {
    if (param.disabled) continue;
    const contentType = param.contentType?.trim() || undefined;
    if (param.kind === 'text') {
      if (param.key === '' && param.value === '') continue;
      parts.push({
        name: param.key,
        kind: 'text',
        value: param.value,
        ...(contentType ? { contentType } : {}),
      });
      continue;
    }
    const sources = fileSources(param);
    if (sources.length === 0) {
      if (param.key !== '') {
        warnings.push(`Form field "${param.key}" has no file selected; it was not sent.`);
      }
      continue;
    }
    for (const src of sources) {
      const file = fileRefFromSrc(src);
      if (!file) continue;
      const filename = fileNameFromSrc(src);
      parts.push({
        name: param.key,
        kind: 'file',
        file,
        filename,
        contentType: contentType ?? mediaTypeForFileName(filename) ?? OCTET_STREAM,
      });
    }
  }
  return { parts, warnings };
}
