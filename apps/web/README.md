# Pigeon web

The browser build of Pigeon: a static single-page app (no server, no account). What the browser
prevents (CORS, forbidden headers, mixed content, storage, …) is explained in the app's
**Web limitations** help and in [docs/platform.md §6](../../docs/platform.md#6-web).

## Build

```bash
pnpm install
pnpm --filter @pigeon/web build      # → apps/web/dist
```

`build` runs `vite build`, then the bundle check (`scripts/check-bundle.ts`), which fails when
Tauri (`@tauri-apps`, `__TAURI__`) or Node (`node:` imports) code reaches the bundle, or when the
JavaScript of the first page load (entry and module preloads) is over **500 KB gzip**.

Build-time configuration (environment variables or `apps/web/.env.production`):

| Variable             | Default | Effect                                                                                                                                                             |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PIGEON_BASE`        | `./`    | Public base path. The default (relative URLs) works from the site root and from any sub-path; set an absolute path (e.g. `/tools/pigeon/`) if your host needs one. |
| `PIGEON_DESKTOP_URL` | unset   | Where to get the desktop app: shows **Get the desktop app** in the status bar and the help. Hidden when unset.                                                     |
| `PIGEON_SOURCEMAP`   | `false` | `true` emits source maps. They are not built (so not published) by default.                                                                                        |

The output is hashed assets plus `index.html` (with a CSP `<meta>`) and `_headers`. CodeMirror
languages, the response viewer, the comparison/import/format workers and the zip library load on
demand.

## Run locally

```bash
pnpm --filter @pigeon/web preview    # http://localhost:4173
```

Running Pigeon web from `http://localhost` avoids mixed-content blocking: a page served over
`https://` can't call `http://` APIs (except `localhost`). For development with hot reload use
`pnpm --filter @pigeon/web dev` (no CSP there: the dev server needs an inline script).

## Deploy

Upload `apps/web/dist/` to any static host (CI publishes it as the `pigeon-web-dist` artifact).
Serve `index.html` for the base path; no rewrites are needed (the app has no client-side routes).

### Security headers

The CSP is also in `index.html`, but some protections only work as HTTP headers
(`frame-ancestors`, `X-Frame-Options`). `dist/_headers` holds them for hosts that read it
(Netlify, Cloudflare Pages):

```text
Content-Security-Policy: default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()
```

`connect-src *` is intended: Pigeon calls whatever APIs you point it at. Pigeon loads no
third-party scripts or fonts.

nginx:

```nginx
location /pigeon/ {
  alias /var/www/pigeon/;
  add_header Content-Security-Policy "default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()" always;
  # Hashed assets never change.
  location /pigeon/assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
}
```

Serve over HTTPS in production. Browser workspaces and secrets live in IndexedDB for the site's
origin: moving Pigeon to another origin starts with empty storage (export projects as zips first).
