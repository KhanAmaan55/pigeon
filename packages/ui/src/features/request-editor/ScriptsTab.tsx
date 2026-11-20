import { useProjectState } from '../../stores/AppStoreProvider';
import { ScriptsEditor } from '../scripts/ScriptsEditor';
import { useScratchRequest } from './ScratchRequestProvider';

/** The request's Scripts tab (PIGN-031); project requests only. */
export function ScriptsTab() {
  const scripts = useScratchRequest((s) => s.scripts);
  const readOnly = useProjectState((s) => s.readOnly, false);
  // Follows edits (and reloads) of the request.
  useProjectState((s) => s.model, null);
  if (!scripts) return null;
  return <ScriptsEditor events={scripts.read()} onChange={scripts.write} readOnly={readOnly} />;
}
