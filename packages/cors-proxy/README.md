# @pigeon/cors-proxy

Optional, **self-hosted** CORS proxy for the Pigeon web app (PIGN-052). Run it on your own
machine when an API you test has no CORS headers; Pigeon never offers a hosted proxy.

```bash
pnpm --filter @pigeon/cors-proxy start
# Pigeon CORS proxy listening on http://127.0.0.1:8787
# Token: <random>
```

Then in Pigeon: **Settings → CORS proxy** → enter the URL and token → turn it on for the project.

Options (or `PIGEON_PROXY_PORT` / `_HOST` / `_ORIGINS` / `_TOKEN`):

| Option                 | Default                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `--port <n>`           | `8787`                                                                                              |
| `--host <addr>`        | `127.0.0.1` (keep it local)                                                                         |
| `--allow-origin <url>` | local dev/preview origins; repeat for each origin that may use the proxy, e.g. your deployed Pigeon |
| `--token <t>`          | random, printed on start                                                                            |
| `--quiet`              | log one line per request (never bodies or headers)                                                  |

**Security**: the proxy can reach anything your machine can (intranet, `localhost` services,
cloud metadata). It only answers allow-listed origins that present the token, binds to
`127.0.0.1` by default, and logs no bodies. Don't expose it to a network without your own access
control. Details: [docs/platform.md §6.2.1](../../docs/platform.md#621-optional-self-hosted-cors-proxy-pign-052).
