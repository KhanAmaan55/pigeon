/**
 * A cookie jar (RFC 6265, PIGN-045): stores `Set-Cookie` from responses and builds the `Cookie`
 * header for requests. Pure (no I/O); one per project, persisted in local state, never in
 * project files. A small implementation instead of `tough-cookie` (no Node built-ins, no
 * dependency). No public-suffix list: a `Domain` attribute without a dot (e.g. `com`) is refused.
 */

export interface StoredCookie {
  name: string;
  value: string;
  /** Lowercase, without a leading dot. */
  domain: string;
  /** Set without a `Domain` attribute: only this exact host. */
  hostOnly: boolean;
  path: string;
  /** Epoch ms; absent = session cookie (kept until the jar is cleared). */
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Epoch ms. */
  createdAt: number;
}

/** At most this many cookies per domain and in all (oldest go first). */
export const COOKIES_PER_DOMAIN = 50;
export const COOKIES_PER_JAR = 3000;

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** RFC 6265 §5.1.3. */
export function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  return !isIp(host) && host.endsWith(`.${domain}`);
}

/** RFC 6265 §5.1.4. */
export function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const last = pathname.lastIndexOf('/');
  return last <= 0 ? '/' : pathname.slice(0, last);
}

/** RFC 6265 §5.1.4. */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/**
 * Parses one `Set-Cookie` header for `url`. Returns `null` when it must be ignored (malformed,
 * or a `Domain` the host may not set); an `expires` in the past means "delete".
 */
export function parseSetCookie(header: string, url: URL, now: number): StoredCookie | null {
  const [pair = '', ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (name === '') return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const cookie: StoredCookie = {
    name,
    value,
    domain: host,
    hostOnly: true,
    path: defaultPath(url.pathname),
    secure: false,
    httpOnly: false,
    createdAt: now,
  };
  let maxAge: number | undefined;
  let expires: number | undefined;
  for (const attribute of attributes) {
    const at = attribute.indexOf('=');
    const key = (at === -1 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const raw = at === -1 ? '' : attribute.slice(at + 1).trim();
    if (key === 'domain' && raw !== '') {
      const domain = raw.replace(/^\./, '').toLowerCase();
      // A host may only set cookies for itself or a parent domain with a dot in it.
      if (!domainMatches(host, domain) || (!domain.includes('.') && domain !== host)) return null;
      cookie.domain = domain;
      cookie.hostOnly = domain === host && isIp(host) ? true : false;
    } else if (key === 'path') {
      cookie.path = raw.startsWith('/') ? raw : defaultPath(url.pathname);
    } else if (key === 'max-age' && /^-?\d+$/.test(raw)) {
      maxAge = Number(raw);
    } else if (key === 'expires') {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) expires = parsed;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite') {
      const v = raw.toLowerCase();
      if (v === 'strict' || v === 'lax' || v === 'none') {
        cookie.sameSite = (v[0]!.toUpperCase() + v.slice(1)) as StoredCookie['sameSite'];
      }
    }
  }
  // Max-Age wins over Expires (§5.3 step 3).
  if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  else if (expires !== undefined) cookie.expires = expires;
  // Secure cookies only from secure origins (localhost counts, like browsers).
  if (cookie.secure && url.protocol !== 'https:' && !isLocalhost(host)) return null;
  return cookie;
}

function isLocalhost(host: string): boolean {
  return (
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1'
  );
}

const sameCookie = (a: StoredCookie, b: Pick<StoredCookie, 'name' | 'domain' | 'path'>) =>
  a.name === b.name && a.domain === b.domain && a.path === b.path;

export class CookieJar {
  #cookies: StoredCookie[];

  constructor(cookies: readonly StoredCookie[] = []) {
    this.#cookies = [...cookies];
  }

  /** Every cookie (expired ones dropped), sorted by domain, path, name. */
  list(now = Date.now()): StoredCookie[] {
    this.#removeExpired(now);
    return [...this.#cookies].sort(
      (a, b) =>
        a.domain.localeCompare(b.domain) ||
        a.path.localeCompare(b.path) ||
        a.name.localeCompare(b.name),
    );
  }

  /** Adds or replaces a cookie (an expiry in the past deletes it). */
  set(cookie: StoredCookie, now = Date.now()): void {
    const index = this.#cookies.findIndex((c) => sameCookie(c, cookie));
    const existing = index === -1 ? undefined : this.#cookies[index];
    if (index !== -1) this.#cookies.splice(index, 1);
    if (cookie.expires !== undefined && cookie.expires <= now) return;
    // Replacing keeps the original creation time (§5.3 step 11.3).
    this.#cookies.push(existing ? { ...cookie, createdAt: existing.createdAt } : cookie);
    this.#enforceLimits(cookie.domain);
  }

  remove(cookie: Pick<StoredCookie, 'name' | 'domain' | 'path'>): void {
    this.#cookies = this.#cookies.filter((c) => !sameCookie(c, cookie));
  }

  clear(domain?: string): void {
    this.#cookies = domain === undefined ? [] : this.#cookies.filter((c) => c.domain !== domain);
  }

  /** Stores every `Set-Cookie` of a response from `url`; returns how many were accepted. */
  storeResponse(url: string, setCookies: readonly string[], now = Date.now()): number {
    if (!URL.canParse(url)) return 0;
    const parsed = new URL(url);
    let stored = 0;
    for (const header of setCookies) {
      const cookie = parseSetCookie(header, parsed, now);
      if (!cookie) continue;
      this.set(cookie, now);
      stored += 1;
    }
    return stored;
  }

  /** The cookies to send to `url`, most specific path first (§5.4). */
  matching(url: string, now = Date.now()): StoredCookie[] {
    if (!URL.canParse(url)) return [];
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const secure = parsed.protocol === 'https:' || isLocalhost(host);
    this.#removeExpired(now);
    return this.#cookies
      .filter(
        (c) =>
          (c.hostOnly ? host === c.domain : domainMatches(host, c.domain)) &&
          pathMatches(parsed.pathname || '/', c.path) &&
          (!c.secure || secure),
      )
      .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
  }

  /** The `Cookie` header for `url`, or `undefined` when nothing matches. */
  cookieHeader(url: string, now = Date.now()): string | undefined {
    const cookies = this.matching(url, now);
    return cookies.length === 0 ? undefined : cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  toJSON(): StoredCookie[] {
    return this.list();
  }

  #removeExpired(now: number): void {
    this.#cookies = this.#cookies.filter((c) => c.expires === undefined || c.expires > now);
  }

  #enforceLimits(domain: string): void {
    const byAge = (a: StoredCookie, b: StoredCookie) => a.createdAt - b.createdAt;
    const sameDomain = this.#cookies.filter((c) => c.domain === domain).sort(byAge);
    for (const cookie of sameDomain.slice(0, Math.max(0, sameDomain.length - COOKIES_PER_DOMAIN))) {
      this.remove(cookie);
    }
    if (this.#cookies.length > COOKIES_PER_JAR) {
      this.#cookies = [...this.#cookies].sort(byAge).slice(-COOKIES_PER_JAR);
    }
  }
}
