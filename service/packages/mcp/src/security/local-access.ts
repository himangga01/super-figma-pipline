/** Exact browser Origins from which the Figma plugin UI may reach the loopback service. */
export const PLUGIN_ORIGINS = Object.freeze([
  'null',
  'https://www.figma.com',
  'https://figma.com',
] as const);

const PLUGIN_ORIGIN_SET = new Set<string>(PLUGIN_ORIGINS);

const validPort = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  if (!/^\d{1,5}$/.test(value)) return false;
  const port = Number(value);
  return port >= 1 && port <= 65_535;
};

/** Strict Host allowlist used before any endpoint-specific response can become an oracle. */
export const isAllowedHost = (host: string | undefined): boolean => {
  if (host === undefined || host === '' || host !== host.trim() || host.includes(',')) return false;
  const normalized = host.toLowerCase();
  if (normalized.startsWith('[::1]')) {
    const suffix = normalized.slice('[::1]'.length);
    return suffix === '' || (suffix.startsWith(':') && validPort(suffix.slice(1)));
  }
  const match = /^(localhost|127\.0\.0\.1)(?::([^:]+))?$/.exec(normalized);
  return match !== null && validPort(match[2]);
};

/** Origin is a transport gate only. A successful match never authenticates the caller. */
export const isAllowedPluginOrigin = (origin: string | undefined): origin is string =>
  origin !== undefined && PLUGIN_ORIGIN_SET.has(origin);

export const isAllowedWsOrigin = (origin: string | undefined): boolean =>
  isAllowedPluginOrigin(origin);

/** Follower/control requests are owner-local Node traffic and therefore never carry Origin. */
export const isAllowedHttpOrigin = (origin: string | undefined): boolean =>
  origin === undefined || origin === '';

export const hasContentType = (header: string | undefined, expected: string): boolean => {
  if (header === undefined) return false;
  const [type] = header.split(';');
  return type?.trim().toLowerCase() === expected.toLowerCase();
};
