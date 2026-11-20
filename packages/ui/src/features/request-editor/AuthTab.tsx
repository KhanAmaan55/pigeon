import { AuthEditor } from '../auth/AuthEditor';
import { useProjectState } from '../../stores/AppStoreProvider';
import { useScratchRequest } from './ScratchRequestProvider';

/** The request's Auth tab (PIGN-026): its own auth, or what it inherits. */
export function AuthTab() {
  const auth = useScratchRequest((s) => s.request.auth);
  const setAuth = useScratchRequest((s) => s.setAuth);
  const inheritedAuth = useScratchRequest((s) => s.inheritedAuth);
  const moveToSecret = useScratchRequest((s) => s.moveToSecret);
  // Inherited auth follows edits of the folders and collection.
  useProjectState((s) => s.model, null);
  return (
    <AuthEditor
      auth={auth}
      onChange={setAuth}
      level={inheritedAuth ? 'request' : 'scratch'}
      {...(inheritedAuth ? { inherited: inheritedAuth() } : {})}
      moveToSecret={moveToSecret}
    />
  );
}
