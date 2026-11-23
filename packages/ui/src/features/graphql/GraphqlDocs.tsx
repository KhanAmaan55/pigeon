/**
 * Schema docs side panel (PIGN-055): the root operation types, a search over type and field
 * names, and one type at a time with its fields, arguments, values and descriptions. Type names
 * are links. Works on the plain `DocsModel` (no graphql import here).
 */

import { ArrowLeft, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { DocsField, DocsModel, DocsType } from './runtime';

const SCALARS_LAST = (a: DocsType, b: DocsType) =>
  Number(a.kind === 'scalar') - Number(b.kind === 'scalar') || a.name.localeCompare(b.name);

export function GraphqlDocs({
  docs,
  focus,
  onFocus,
  onClose,
}: {
  docs: DocsModel;
  focus: string | null;
  onFocus: (type: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const byName = useMemo(() => new Map(docs.types.map((t) => [t.name, t])), [docs]);
  const type = focus ? byName.get(focus) : undefined;
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    const types = docs.types
      .filter((t) => t.name.toLowerCase().includes(needle))
      .sort(SCALARS_LAST);
    const fields = docs.types.flatMap((t) =>
      t.fields
        .filter((f) => f.name.toLowerCase().includes(needle))
        .map((f) => ({ type: t, field: f })),
    );
    return { types, fields: fields.slice(0, 50) };
  }, [docs, needle]);

  const link = (name: string, label = name) => (
    <button
      type="button"
      data-testid="graphql-docs-link"
      onClick={() => {
        setQuery('');
        onFocus(name);
      }}
      className="font-mono text-accent hover:underline"
    >
      {label}
    </button>
  );
  const typeRef = (text: string, name: string) => {
    const at = text.indexOf(name);
    return at === -1 ? (
      link(name)
    ) : (
      <span className="font-mono">
        {text.slice(0, at)}
        {link(name)}
        {text.slice(at + name.length)}
      </span>
    );
  };
  const fieldRow = (f: DocsField) => (
    <li key={f.name} data-testid="graphql-docs-field" className="py-1">
      <span className="font-mono">
        <span className="text-fg">{f.name}</span>
        {f.args.length > 0 && (
          <span className="text-fg-muted">
            (
            {f.args.map((a, i) => (
              <span key={a.name}>
                {i > 0 && ', '}
                {a.name}: {typeRef(a.type, a.typeName)}
              </span>
            ))}
            )
          </span>
        )}
        : {typeRef(f.type, f.typeName)}
      </span>
      {f.description && <p className="text-fg-muted">{f.description}</p>}
      {f.deprecated && <p className="text-warn">Deprecated: {f.deprecated}</p>}
    </li>
  );

  return (
    <aside
      aria-label="Schema docs"
      data-testid="graphql-docs"
      className="flex min-h-0 flex-col rounded border border-border text-xs"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border p-1">
        {focus && (
          <button
            type="button"
            aria-label="Back to the root types"
            data-testid="graphql-docs-back"
            onClick={() => onFocus(null)}
            className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ArrowLeft size={12} aria-hidden />
          </button>
        )}
        <Search size={12} aria-hidden className="ml-1 shrink-0 text-fg-muted" />
        <input
          type="search"
          aria-label="Search the schema"
          data-testid="graphql-docs-search"
          placeholder="Search types and fields"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-6 min-w-0 flex-1 bg-transparent px-1 text-xs text-fg placeholder:text-fg-muted focus:outline-none"
        />
        <button
          type="button"
          aria-label="Close the schema docs"
          onClick={onClose}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={12} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {results ? (
          <>
            {results.types.length + results.fields.length === 0 && (
              <p className="text-fg-muted">Nothing matches “{query}”.</p>
            )}
            {results.types.length > 0 && (
              <ul data-testid="graphql-docs-results">
                {results.types.map((t) => (
                  <li key={t.name}>
                    {link(t.name)} <span className="text-fg-muted">{t.kind}</span>
                  </li>
                ))}
              </ul>
            )}
            {results.fields.length > 0 && (
              <ul className="mt-2">
                {results.fields.map(({ type: owner, field }) => (
                  <li key={`${owner.name}.${field.name}`}>
                    {link(owner.name)}.<span className="font-mono">{field.name}</span>
                    <span className="text-fg-muted">: {field.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : type ? (
          <section data-testid="graphql-docs-type" aria-label={`Type ${type.name}`}>
            <h3 className="font-mono text-sm font-semibold">
              {type.name} <span className="text-xs font-normal text-fg-muted">{type.kind}</span>
            </h3>
            {type.description && <p className="mt-1 text-fg-muted">{type.description}</p>}
            {type.values.length > 0 && (
              <p className="mt-2">
                <span className="text-fg-muted">
                  {type.kind === 'enum'
                    ? 'Values: '
                    : type.kind === 'union'
                      ? 'One of: '
                      : 'Implements: '}
                </span>
                {type.kind === 'enum'
                  ? type.values.join(', ')
                  : type.values.map((v, i) => (
                      <span key={v}>
                        {i > 0 && ', '}
                        {link(v)}
                      </span>
                    ))}
              </p>
            )}
            {type.fields.length > 0 && (
              <ul className="mt-2 divide-y divide-border">{type.fields.map(fieldRow)}</ul>
            )}
          </section>
        ) : (
          <section aria-label="Root types">
            <ul>
              {docs.roots.map((root) => (
                <li key={root.label} className="py-0.5">
                  <span className="text-fg-muted">{root.label}: </span>
                  {link(root.type)}
                </li>
              ))}
            </ul>
            <h3 className="mt-3 mb-1 font-semibold text-fg-muted">All types</h3>
            <ul>
              {[...docs.types].sort(SCALARS_LAST).map((t) => (
                <li key={t.name}>{link(t.name)}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
