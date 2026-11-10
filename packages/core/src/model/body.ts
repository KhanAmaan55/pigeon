/**
 * Request body model (docs/data-model.md §4): every Postman body mode except GraphQL (PIGN-032).
 * The request stores only the active mode, like Postman; the editor keeps the other modes'
 * content in its own state while the user switches between them.
 */

import type { FileRef } from '@pigeon/platform';

import { z } from './zod';

const extraSchema = z.record(z.string(), z.unknown());

/** Postman description: plain string or `{ content, type }`. */
export const DescriptionSchema = z.union([
  z.string(),
  z.object({ content: z.string(), type: z.string().optional() }),
]);
export type Description = z.infer<typeof DescriptionSchema>;

export const KeyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  disabled: z.boolean().optional(),
  description: DescriptionSchema.optional(),
  /** Preserved Postman `type` when present. */
  type: z.string().optional(),
  extra: extraSchema.optional(),
});
export type KeyValue = z.infer<typeof KeyValueSchema>;

export const RAW_LANGUAGES = ['json', 'text', 'xml', 'html', 'javascript'] as const;
export type RawLanguage = (typeof RAW_LANGUAGES)[number];

export const BODY_MODES = ['none', 'raw', 'urlencoded', 'formdata', 'file'] as const;
export type BodyMode = (typeof BODY_MODES)[number];

/** A form-data row: a text field, or one or more files (`src`, see `fileRefFromSrc`). */
export const FormDataParamSchema = KeyValueSchema.extend({
  kind: z.enum(['text', 'file']),
  /** File source(s) of a `file` row; unused for text rows. */
  src: z.union([z.string(), z.array(z.string())]).optional(),
  /** Part `Content-Type`; unset = from the file name (files) or none (text). */
  contentType: z.string().optional(),
});
export type FormDataParam = z.infer<typeof FormDataParamSchema>;

const common = { disabled: z.boolean().optional(), extra: extraSchema.optional() };

export const BodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none'), ...common }),
  z.object({
    mode: z.literal('raw'),
    raw: z.string(),
    language: z.enum(RAW_LANGUAGES),
    ...common,
  }),
  z.object({ mode: z.literal('urlencoded'), params: z.array(KeyValueSchema), ...common }),
  z.object({ mode: z.literal('formdata'), params: z.array(FormDataParamSchema), ...common }),
  /** Binary body; `src` is unset until a file is chosen. */
  z.object({ mode: z.literal('file'), src: z.string().optional(), ...common }),
]);
export type Body = z.infer<typeof BodySchema>;
export type BodyOf<M extends BodyMode> = Extract<Body, { mode: M }>;

/** An empty body of `mode`, as the editor creates it. */
export function emptyBody(mode: BodyMode): Body {
  switch (mode) {
    case 'none':
      return { mode: 'none' };
    case 'raw':
      return { mode: 'raw', raw: '', language: 'json' };
    case 'urlencoded':
      return { mode: 'urlencoded', params: [] };
    case 'formdata':
      return { mode: 'formdata', params: [] };
    case 'file':
      return { mode: 'file' };
  }
}

// --- File sources ---------------------------------------------------------------------------
//
// `src` is a string, as in Postman: an absolute path (desktop), a project-relative path (PIGN-014)
// or `picked:<id>/<file name>`, a file picked in this session and held in memory by
// `Platform.pickedFiles`. Picked sources are only meaningful until the app is closed.

const PICKED_PREFIX = 'picked:';
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/** The `src` of a file picked this session (`PickedFileStore.add` returned `id`). */
export function pickedFileSrc(id: string, name: string): string {
  return `${PICKED_PREFIX}${id}/${name}`;
}

export function isPickedFileSrc(src: string): boolean {
  return src.startsWith(PICKED_PREFIX);
}

/** Where a `src` is read from at send time; `undefined` for an empty source. */
export function fileRefFromSrc(src: string): FileRef | undefined {
  if (src === '') return undefined;
  if (src.startsWith(PICKED_PREFIX)) {
    const rest = src.slice(PICKED_PREFIX.length);
    const slash = rest.indexOf('/');
    return { kind: 'picked', id: slash === -1 ? rest : rest.slice(0, slash) };
  }
  if (src.startsWith('/') || WINDOWS_ABSOLUTE.test(src)) return { kind: 'absolute', path: src };
  return { kind: 'project', path: src.replace(/^\.\//, '') };
}

/** The file name a `src` stands for: what follows the last `/` (or `\`). */
export function fileNameFromSrc(src: string): string {
  if (src.startsWith(PICKED_PREFIX)) {
    const rest = src.slice(PICKED_PREFIX.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '' : rest.slice(slash + 1);
  }
  return src.split(/[\\/]/).pop() ?? '';
}

/** A file row's sources as a list (`src` may be a string, a list, or unset). */
export function fileSources(param: Pick<FormDataParam, 'src'>): string[] {
  const { src } = param;
  if (src === undefined) return [];
  return (typeof src === 'string' ? [src] : src).filter((s) => s !== '');
}
