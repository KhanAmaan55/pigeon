/** Full class names so Tailwind's scanner sees them. */
const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-options',
};

export function methodColorClass(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? 'text-fg';
}
