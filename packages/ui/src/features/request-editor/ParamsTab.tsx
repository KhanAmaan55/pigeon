import { KeyValueTable } from '../../components/KeyValueTable';
import { SectionLabel } from '../../components/ui';
import { useScratchRequest } from './ScratchRequestProvider';

/** Query table synced both ways with the URL, plus a path variable table for `:name` segments. */
export function ParamsTab() {
  const query = useScratchRequest((s) => s.request.url.query);
  const pathVariables = useScratchRequest((s) => s.request.url.pathVariables);
  const setQuery = useScratchRequest((s) => s.setQuery);
  const setPathVariables = useScratchRequest((s) => s.setPathVariables);

  return (
    <div className="flex flex-col gap-5 px-3 pt-2 pb-3">
      <section aria-label="Query parameters">
        <SectionLabel role="heading" aria-level={2} className="mb-1.5">
          Query parameters
        </SectionLabel>
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
          <SectionLabel role="heading" aria-level={2} className="mb-1.5">
            Path variables
          </SectionLabel>
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
