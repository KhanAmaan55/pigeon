import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fsConformance } from '@pigeon/platform/conformance';

import { NodeFs } from '../src/index';

fsConformance('NodeFs', async () => new NodeFs(await mkdtemp(join(tmpdir(), 'pigeon-nodefs-'))), {
  cleanup: async (fs) => {
    if (fs.root.kind === 'native') await rm(fs.root.absolutePath, { recursive: true, force: true });
  },
});
