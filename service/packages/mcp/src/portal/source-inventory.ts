import { createHash } from 'node:crypto';

import { storedChecksum } from '@sfp/ir';
import { PortalSourceInventorySchema, type PortalSourceInventory } from '@sfp/shared';

import type { RepoReader } from '../fs/repo-walk.js';
import { isPortableSourcePath } from './source-path-policy.js';

const DEFAULT_LIMITS = {
  maxFiles: 5000,
  maxFileBytes: 16_777_216,
  maxTotalBytes: 134_217_728,
  maxScanEntries: 20000,
} as const;

export const classifyPortalSourceBytes = (bytes: Buffer): 'text' | 'binary' => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Only ordinary text whitespace is allowed among control code points.
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159))
        return 'binary';
    }
    return 'text';
  } catch {
    return 'binary';
  }
};

/** Byte identity only: text classification is not a claim of semantic parse coverage. */
export const collectPortalSourceInventory = async (
  reader: RepoReader,
  requestedLimits: Partial<PortalSourceInventory['limits']> = {},
): Promise<PortalSourceInventory> => {
  const limits = { ...DEFAULT_LIMITS, ...requestedLimits };
  PortalSourceInventorySchema.shape.limits.parse(limits);
  const files: PortalSourceInventory['files'] = [];
  const exclusions: PortalSourceInventory['exclusions'] = [];
  const issues: PortalSourceInventory['issues'] = [];
  let scannedEntries = 0;
  let totalBytes = 0;
  let currentPath: string | undefined;
  try {
    const sourceReader = await reader.withByteBudget(limits);
    Object.assign(limits, sourceReader.byteLimits);
    const walk = await sourceReader.walk({
      mode: 'portal-source-authority',
      cap: limits.maxFiles,
      maxScanEntries: limits.maxScanEntries,
    });
    scannedEntries = walk.scanned;
    exclusions.push(...(walk.exclusions ?? []));
    issues.push(...(walk.issues ?? []));
    if (walk.truncated) issues.push({ code: 'SOURCE_INVENTORY_DISCOVERY_LIMIT' });
    for (const path of walk.files.toSorted()) {
      currentPath = path;
      // eslint-disable-next-line no-await-in-loop -- bounded, retained-authority raw-byte reads
      const bytes = await sourceReader.readBytes(path);
      totalBytes += bytes.length;
      const classification = classifyPortalSourceBytes(bytes);
      files.push({ path, bytes: bytes.length, hash: storedChecksum(bytes), classification });
    }
  } catch (cause) {
    const error = cause as { code?: unknown; path?: unknown };
    if (error.code === 'ABORT_ERR') throw cause;
    const path = typeof error.path === 'string' ? error.path : currentPath;
    issues.push({
      code:
        typeof error.code === 'string' ? error.code.slice(0, 128) : 'SOURCE_INVENTORY_READ_FAILED',
      ...(path !== undefined && isPortableSourcePath(path) ? { path } : {}),
    });
  }
  exclusions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const body = {
    schemaVersion: 1 as const,
    policyVersion: 'portal-source-v1' as const,
    files,
    exclusions,
    limits,
    scannedEntries,
    totalBytes,
    complete: issues.length === 0,
    issues,
  };
  // Explicit arrays and JSON length/escaping frame every field, including exclusion decisions.
  const canonical = JSON.stringify([
    'sfp-portal-source-inventory-v1',
    body.schemaVersion,
    body.policyVersion,
    [limits.maxFiles, limits.maxFileBytes, limits.maxTotalBytes, limits.maxScanEntries],
    files.map(file => [file.path, file.bytes, file.hash, file.classification]),
    exclusions.map(exclusion => [exclusion.path, exclusion.kind, exclusion.reason]),
    scannedEntries,
    totalBytes,
    body.complete,
    issues.map(issue => [issue.code, issue.path ?? null]),
  ]);
  return PortalSourceInventorySchema.parse({
    ...body,
    hash: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
};
