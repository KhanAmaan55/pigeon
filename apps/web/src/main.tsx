import '@pigeon/ui/styles.css';

import { createWebPlatform } from '@pigeon/platform-web';
import { PigeonApp } from '@pigeon/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Pigeon: missing #root element in index.html');
const root = container;

const platform = createWebPlatform();
const start = () =>
  createRoot(root).render(
    <StrictMode>
      <PigeonApp platform={platform} />
    </StrictMode>,
  );

// E2E builds only (`vite build --mode e2e`); the condition is a constant, so production
// bundles drop the hooks entirely.
if (import.meta.env.VITE_PIGEON_TEST_HOOKS === 'true') {
  void import('./test-hooks').then(({ installTestHooks }) => {
    installTestHooks(platform);
    start();
  });
} else {
  start();
}
