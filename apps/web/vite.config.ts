import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/** docs/platform.md §6.1. `connect-src *` because users call arbitrary APIs. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  'connect-src *',
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
].join('; ');

/**
 * Injects the CSP meta tag into built HTML only. The dev server needs inline scripts
 * (React Fast Refresh preamble), which this policy would block.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'pigeon:content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // Never inline fonts as data: URIs — the CSP only allows same-origin fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  preview: { port: 4173, strictPort: true },
});
