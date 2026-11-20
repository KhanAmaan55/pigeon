import type { ProjectFieldRule } from '@pigeon/core';
import { validateRulePath } from '@pigeon/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

const FLAGS = [
  { flag: 'optional', label: 'Optional', title: 'A removed field is a warning, not a failure' },
  {
    flag: 'nullable',
    label: 'Nullable',
    title: 'null in place of a value (or the reverse) passes',
  },
  { flag: 'ignore', label: 'Ignore', title: 'Ignore this field and everything inside it' },
  { flag: 'dynamic', label: 'Dynamic', title: 'Its value may change (values mode)' },
] as const;

/**
 * Field rules (response-comparison.md §4.5): path, flags and a note per row. Paths are checked
 * as you type; an invalid one is not applied until fixed. Without `onChange` it is read-only.
 */
export function RulesTable({
  rules,
  onChange,
  testId,
}: {
  rules: readonly ProjectFieldRule[];
  onChange?: (rules: ProjectFieldRule[]) => void;
  testId: string;
}) {
  const readOnly = !onChange;
  const update = (index: number, rule: ProjectFieldRule) =>
    onChange?.(rules.map((r, i) => (i === index ? rule : r)));
  return (
    <div data-testid={testId} className="flex flex-col gap-1 text-xs">
      {rules.length === 0 && <p className="text-fg-muted">No rules.</p>}
      {rules.map((rule, index) => (
        <RuleRow
          // A rule's identity is its position; the path is being edited.
          key={index}
          rule={rule}
          readOnly={readOnly}
          onChange={(next) => update(index, next)}
          onDelete={() => onChange?.(rules.filter((_, i) => i !== index))}
        />
      ))}
      {!readOnly && <AddRule onAdd={(rule) => onChange([...rules, rule])} />}
    </div>
  );
}

function RuleRow({
  rule,
  readOnly,
  onChange,
  onDelete,
}: {
  rule: ProjectFieldRule;
  readOnly: boolean;
  onChange: (rule: ProjectFieldRule) => void;
  onDelete: () => void;
}) {
  const [path, setPath] = useState(rule.path);
  const error = path === rule.path ? undefined : validateRulePath(path);
  return (
    <div
      data-testid="rule-row"
      className="flex flex-wrap items-start gap-2 rounded border border-border p-1.5"
    >
      <div className="flex min-w-48 flex-1 flex-col">
        <input
          aria-label="Rule path"
          data-testid="rule-path"
          value={path}
          readOnly={readOnly}
          aria-invalid={error !== undefined}
          onChange={(event) => {
            const next = event.target.value;
            setPath(next);
            if (validateRulePath(next) === undefined) onChange({ ...rule, path: next });
          }}
          className="h-6 rounded border border-border bg-bg px-1.5 font-mono aria-invalid:border-fail"
        />
        {error && (
          <span role="alert" data-testid="rule-path-error" className="pt-0.5 text-fail">
            {error}
          </span>
        )}
      </div>
      {FLAGS.map(({ flag, label, title }) => (
        <label key={flag} title={title} className="flex items-center gap-1 pt-1">
          <input
            type="checkbox"
            data-testid={`rule-${flag}`}
            checked={rule[flag] === true}
            disabled={readOnly}
            onChange={(event) => {
              const { [flag]: _old, ...rest } = rule;
              onChange(event.target.checked ? { ...rest, [flag]: true } : rest);
            }}
          />
          {label}
        </label>
      ))}
      <input
        aria-label="Rule note"
        data-testid="rule-note"
        placeholder="Note"
        value={rule.note ?? ''}
        readOnly={readOnly}
        onChange={(event) => {
          const { note: _old, ...rest } = rule;
          onChange(event.target.value === '' ? rest : { ...rest, note: event.target.value });
        }}
        className="h-6 w-40 rounded border border-border bg-bg px-1.5"
      />
      {!readOnly && (
        <button
          type="button"
          data-testid="rule-delete"
          aria-label={`Delete the rule for ${rule.path}`}
          onClick={onDelete}
          className="mt-0.5 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

function AddRule({ onAdd }: { onAdd: (rule: ProjectFieldRule) => void }) {
  const [path, setPath] = useState('');
  const error = path === '' ? undefined : validateRulePath(path);
  const add = () => {
    if (path === '' || error) return;
    onAdd({ path, optional: true });
    setPath('');
  };
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <input
          aria-label="New rule path"
          data-testid="rule-new-path"
          placeholder="$.data[*].field"
          value={path}
          aria-invalid={error !== undefined}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
          className="h-6 flex-1 rounded border border-border bg-bg px-1.5 font-mono aria-invalid:border-fail"
        />
        <button
          type="button"
          data-testid="rule-add"
          disabled={path === '' || error !== undefined}
          onClick={add}
          className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 hover:bg-hover disabled:opacity-50"
        >
          <Plus size={12} aria-hidden />
          Add rule
        </button>
      </div>
      {error && (
        <span role="alert" data-testid="rule-new-path-error" className="pt-0.5 text-fail">
          {error}
        </span>
      )}
    </div>
  );
}
