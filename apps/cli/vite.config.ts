import { defineConfig } from 'vite';

/**
 * One Node script (`dist/cli.js`): workspace packages bundled. QuickJS stays external — its
 * WebAssembly file is loaded from the package at run time.
 */
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
  ssr: {
    noExternal: true,
    external: ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync'],
    target: 'node',
  },
});
