import '@pigeon/ui/styles.css';

import { createDesktopPlatform } from '@pigeon/platform-desktop';
import { PigeonApp } from '@pigeon/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Pigeon: missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <PigeonApp platform={createDesktopPlatform()} />
  </StrictMode>,
);
