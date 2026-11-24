import { Input, Select } from '../../components/ui';
import type { ComparisonOverrides } from '../request-editor/scratch-store';

type Section = Record<string, unknown>;

/**
 * A request's own comparison settings (`compare.json`, PIGN-036): status mode, compared
 * headers and their mode, body mode and array matching. "Project default" removes the override.
 */
export function RequestOverrides({
  overrides,
  onChange,
}: {
  overrides: ComparisonOverrides;
  onChange: (patch: ComparisonOverrides) => void;
}) {
  const headers = (overrides.headers ?? {}) as Section;
  const body = (overrides.body ?? {}) as Section;
  const arrays = body['arrays'];
  const arraysValue =
    typeof arrays === 'string'
      ? arrays
      : typeof arrays === 'object' && arrays !== null
        ? 'matchBy'
        : '';
  const matchBy =
    typeof arrays === 'object' && arrays !== null
      ? String((arrays as Section)['matchBy'] ?? '')
      : '';
  const setSection = (key: 'headers' | 'body', section: Section, field: string, value: unknown) => {
    const next = { ...section };
    if (value === undefined || value === '') delete next[field];
    else next[field] = value;
    onChange({ [key]: Object.keys(next).length === 0 ? undefined : next });
  };
  const select = (
    label: string,
    testId: string,
    value: string,
    options: readonly string[],
    onSelect: (value: string) => void,
  ) => (
    <label className="flex items-center gap-1.5">
      <span className="text-fg-muted">{label}</span>
      <Select
        size="sm"
        data-testid={testId}
        value={value}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">project default</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <div
      data-testid="request-overrides"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
    >
      {select(
        'Status',
        'override-status',
        typeof overrides.status === 'string' ? overrides.status : '',
        ['exact', 'class', 'ignore'],
        (value) => onChange({ status: value === '' ? undefined : value }),
      )}
      {select(
        'Headers',
        'override-header-mode',
        String(headers['mode'] ?? ''),
        ['media-type', 'value', 'presence'],
        (value) => setSection('headers', headers, 'mode', value),
      )}
      <label className="flex items-center gap-1.5">
        <span className="text-fg-muted">Compared</span>
        {/* The input fills its fixed-width wrapper (Input is full width). */}
        <span className="w-44">
          <Input
            size="sm"
            mono
            data-testid="override-header-list"
            placeholder="project default"
            defaultValue={
              Array.isArray(headers['compare']) ? (headers['compare'] as string[]).join(', ') : ''
            }
            onBlur={(event) => {
              const names = event.target.value
                .split(',')
                .map((name) => name.trim().toLowerCase())
                .filter((name) => name !== '');
              setSection('headers', headers, 'compare', names.length === 0 ? undefined : names);
            }}
          />
        </span>
      </label>
      {select(
        'Body',
        'override-body-mode',
        String(body['mode'] ?? ''),
        ['schema', 'values', 'none'],
        (value) => setSection('body', body, 'mode', value),
      )}
      {select('Arrays', 'override-arrays', arraysValue, ['index', 'schema', 'matchBy'], (value) =>
        setSection(
          'body',
          body,
          'arrays',
          value === 'matchBy' ? { matchBy: matchBy || 'id' } : value,
        ),
      )}
      {arraysValue === 'matchBy' && (
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">by key</span>
          <span className="w-24">
            <Input
              size="sm"
              mono
              data-testid="override-match-by"
              defaultValue={matchBy}
              onBlur={(event) =>
                setSection('body', body, 'arrays', { matchBy: event.target.value.trim() || 'id' })
              }
            />
          </span>
        </label>
      )}
    </div>
  );
}
