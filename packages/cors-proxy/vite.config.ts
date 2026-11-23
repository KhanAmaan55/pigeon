import { defineConfig } from 'vite';

/** One self-contained Node script (`dist/cli.js`): workspace packages bundled, Node built-ins not. */
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    // `tsc -b` keeps its declarations in dist/types.
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'cli.js' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
