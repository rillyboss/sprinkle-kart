// Origin checks for the signal worker (NETWORKING.md §4.2 "What the Origin check is (and isn't)").
//
// ALLOWED_ORIGINS is a comma-separated list of exact origins, e.g. the production value
// "https://rillyboss.github.io,http://localhost:5173". For local development (.dev.vars) an entry may end in
// ':*' to allow any port, but ONLY for the hosts localhost and 127.0.0.1; any other wildcard is ignored.
// This stops other websites from using the worker through a visitor's browser. It is not abuse protection
// (non-browser clients can send any Origin): that is the unguessable room id plus the Durable Object limits.

const WILDCARD_HOSTS = new Set(['localhost', '127.0.0.1']);

function normalizeOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
    return { protocol: u.protocol, hostname: u.hostname.toLowerCase(), port: u.port, origin: u.origin };
  } catch {
    return null;
  }
}

/**
 * Parse ALLOWED_ORIGINS into rules.
 * @returns {Array<{ kind: 'exact', origin: string } | { kind: 'any-port', protocol: string, hostname: string }>}
 */
export function parseAllowedOrigins(value) {
  const rules = [];
  for (const raw of String(value ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const wild = /^(https?):\/\/([^/:*]+):\*$/i.exec(entry);
    if (wild) {
      const hostname = wild[2].toLowerCase();
      if (WILDCARD_HOSTS.has(hostname)) rules.push({ kind: 'any-port', protocol: `${wild[1].toLowerCase()}:`, hostname });
      continue; // a wildcard for any other host is ignored
    }
    if (entry.includes('*')) continue; // no other wildcard forms
    const n = normalizeOrigin(entry);
    if (n) rules.push({ kind: 'exact', origin: n.origin });
  }
  return rules;
}

/** Is this request Origin allowed by ALLOWED_ORIGINS? A missing or 'null' Origin never is. */
export function isOriginAllowed(origin, allowedValue) {
  if (!origin || origin === 'null') return false;
  const n = normalizeOrigin(origin);
  // Browsers send an exact serialized origin; anything else (paths, odd casing, default ports) is refused.
  if (!n || n.origin !== origin) return false;
  for (const rule of parseAllowedOrigins(allowedValue)) {
    if (rule.kind === 'exact' && rule.origin === n.origin) return true;
    if (rule.kind === 'any-port' && rule.protocol === n.protocol && rule.hostname === n.hostname) return true;
  }
  return false;
}

/** CORS headers for /health and /ice when the Origin is allowed; {} otherwise. */
export function corsHeaders(origin, allowedValue) {
  if (!isOriginAllowed(origin, allowedValue)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
