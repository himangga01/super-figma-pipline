import { isAbsolute } from 'node:path';

/** Convert service-owned resource paths for Epic without reading or copying any .env. */
export function epicOwnedEnvironment(environment) {
  const value = { ...environment };
  for (const name of ['DATABASE_PATH', 'CACHE_DATABASE_PATH', 'LITEFS_DIR']) {
    if (!value[name] || !isAbsolute(value[name])) throw Error(`Admitted absolute ${name} required`);
  }
  if (!value.APPLICATION_ORIGIN || new URL(value.APPLICATION_ORIGIN).origin !== value.APPLICATION_ORIGIN) throw Error('Exact admitted APPLICATION_ORIGIN required');
  for (const name of ['SESSION_SECRET', 'INTERNAL_COMMAND_TOKEN', 'HONEYPOT_SECRET']) if (!value[name]) throw Error(`Fresh synthetic ${name} required`);
  value.DATABASE_URL = 'file:' + value.DATABASE_PATH.replaceAll('\\', '/');
  return value;
}
