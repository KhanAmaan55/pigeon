import { KeyValueTable } from '../../components/KeyValueTable';
import { useScratchRequest } from './ScratchRequestProvider';

/** Query table synced both ways with the URL, plus a path variable table for `:name` segments. */
export function ParamsTab() {
  const query = useScratchRequest((s) => s.request.url.query);
  const pathVariables = useScratchRequest((s) => s.request.url.pathVariables);
  const setQuery = useScratchRequest((s) => s.setQuery);
  const setPathVariables = useScratchRequest((s) => s.setPathVariables);

  return (
    <div className="flex flex-col gap-4 p-2">
      <section aria-label="Query parameters">
        <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Query parameters
        </h3>
        <KeyValueTable
          label="Query parameters"
          testId="query-table"
          rows={query}
          onChange={setQuery}
          bulkSeparator="="
          keyPlaceholder="Add parameter"
        />
      </section>
      {pathVariables.length > 0 && (
        <section aria-label="Path variables">
          <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Path variables
          </h3>
          <KeyValueTable
            label="Path variables"
            testId="path-variables-table"
            rows={pathVariables}
            onChange={setPathVariables}
            fixedKeys
          />
        </section>
      )}
    </div>
  );
}
