/** File extension → media type, for binary bodies and form-data files (docs/api-execution.md §5). */

export const OCTET_STREAM = 'application/octet-stream';

const BY_EXTENSION: Record<string, string> = {
  // text
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  xml: 'application/xml',
  json: 'application/json',
  geojson: 'application/geo+json',
  jsonld: 'application/ld+json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  graphql: 'application/graphql',
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  // audio / video
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  // fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  // documents and archives
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  wasm: 'application/wasm',
  bin: OCTET_STREAM,
};

/** The media type for `fileName`'s extension (case-insensitive), or `undefined` if unknown. */
export function mediaTypeForFileName(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
}
