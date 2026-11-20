import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';

/**
 * docs/platform.md §6.1. `connect-src *` because users call arbitrary APIs; no inline scripts,
 * no third-party origins.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  'connect-src *',
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * HTTP response headers for static hosts that read a `_headers` file (Netlify, Cloudflare
 * Pages); apps/web/README.md has the nginx equivalent. `frame-ancestors` only works as a header.
 */
const SECURITY_HEADERS: ReadonlyArray<[string, string]> = [
  ['Content-Security-Policy', `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  [
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  ],
];

/**
 * Injects the CSP meta tag into built HTML only, and writes `_headers`. The dev server needs
 * inline scripts (React Fast Refresh preamble), which this policy would block.
 */
function securityHeaders(): Plugin {
  return {
    name: 'pigeon:security-headers',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n${SECURITY_HEADERS.map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Build-time configuration (apps/web/README.md): `PIGEON_*` from the environment or .env files.
  const env = { ...loadEnv(mode, process.cwd(), 'PIGEON_'), ...process.env };
  return {
    // Relative by default, so the same build works from the site root and from any sub-path.
    base: env['PIGEON_BASE'] || './',
    plugins: [react(), tailwindcss(), securityHeaders()],
    define: {
      // Only this value reaches the bundle (not every PIGEON_* variable).
      'import.meta.env.PIGEON_DESKTOP_URL': JSON.stringify(env['PIGEON_DESKTOP_URL'] ?? ''),
    },
    build: {
      // Source maps are not published unless asked for (`PIGEON_SOURCEMAP=true`).
      sourcemap: env['PIGEON_SOURCEMAP'] === 'true',
      // Never inline fonts as data: URIs — the CSP only allows same-origin fonts.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    },
    preview: { port: 4173, strictPort: true },
  };
});
