import '@pigeon/ui/styles.css';

import { createDesktopPlatform, onMenuCommand } from '@pigeon/platform-desktop';
import type { AppCommand } from '@pigeon/ui';
import { PigeonApp, runAppCommand } from '@pigeon/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Pigeon: missing #root element in index.html');

// Native menu commands (src-tauri/src/menu.rs) run in the UI.
void onMenuCommand((command) => runAppCommand(command as AppCommand));

createRoot(container).render(
  <StrictMode>
    <PigeonApp platform={createDesktopPlatform()} />
  </StrictMode>,
);
