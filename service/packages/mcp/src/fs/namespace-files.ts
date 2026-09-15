import { opendir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { WorkspacePolicy } from '@sfp/shared';

import {
  AtomicFileStore,
  readFileWithinLimit,
  withRetainedDirectoryChain,
  WorkspaceAtomicFileStore,
} from './atomic-file.js';

const allowed =
  /^\.sfp\/(?:snapshots|grounding-graphs)\/v1\/[0-9a-f]{64}(?:\/sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]\.json)?$/u;
const safePath = (value: string) => {
  if (!allowed.test(value)) throw new Error('SNAPSHOT_LOCATOR_INVALID');
  return value;
};
const missing = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  ['ENOENT', 'WORKSPACE_PATH_NOT_FOUND'].includes(String(error.code));

/** The filesystem owner retains directory authority for every snapshot/graph access. */
export class NamespaceFiles {
  constructor(
    private readonly policy: WorkspacePolicy,
    private readonly atomic = new AtomicFileStore({ maxReplaceBytes: 33_554_432 }),
  ) {}
  private async root(workspaceId: string): Promise<string> {
    const root = await this.policy.resolveRoot?.(workspaceId);
    if (root === undefined) throw new Error('WORKSPACE_ROOT_REQUIRED');
    return root;
  }
  async read(workspaceId: string, relativePath: string): Promise<Uint8Array | null> {
    safePath(relativePath);
    if (!relativePath.endsWith('.json')) throw new Error('SNAPSHOT_LOCATOR_INVALID');
    let path: string;
    try {
      path = await this.policy.resolveRead(workspaceId, relativePath);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    const root = await this.root(workspaceId);
    return withRetainedDirectoryChain(root, dirname(path), async authority => {
      const current = await this.policy.resolveRead(workspaceId, relativePath);
      if (current !== path) throw new Error('SNAPSHOT_PATH_CHANGED');
      return readFileWithinLimit(authority.child(basename(path)), 33_554_432);
    });
  }
  async create(workspaceId: string, relativePath: string, bytes: Uint8Array): Promise<void> {
    safePath(relativePath);
    if (!relativePath.endsWith('.json') || bytes.byteLength > 33_554_432)
      throw new Error('SNAPSHOT_STORAGE_LIMIT');
    await new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy: this.policy,
      atomicFiles: this.atomic,
    }).createNew(relativePath, bytes);
  }
  async replace(
    workspaceId: string,
    relativePath: string,
    bytes: Uint8Array,
    checksum: string,
  ): Promise<void> {
    safePath(relativePath);
    if (!/^sha256:[0-9a-f]{64}$/u.test(checksum)) throw new Error('SNAPSHOT_CHECKSUM_INVALID');
    await new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy: this.policy,
      atomicFiles: this.atomic,
    }).replace(relativePath, bytes, {
      destructiveApproved: true,
      expectedDigest64: checksum.slice(7),
    });
  }
  async list(workspaceId: string, relativeDirectory: string): Promise<string[]> {
    safePath(relativeDirectory);
    if (relativeDirectory.endsWith('.json')) throw new Error('SNAPSHOT_LOCATOR_INVALID');
    const root = await this.root(workspaceId);
    let directory: string;
    try {
      directory = await this.policy.resolveRead(workspaceId, relativeDirectory);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    return withRetainedDirectoryChain(root, directory, async authority => {
      const names: string[] = [];
      let count = 0;
      const stream = await opendir(authority.path);
      for await (const entry of stream) {
        if (++count > 4096) throw new Error('SNAPSHOT_DIRECTORY_LIMIT');
        if (!/^sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]\.json$/u.test(entry.name)) continue;
        if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('SNAPSHOT_PATH_CHANGED');
        // eslint-disable-next-line no-await-in-loop -- each selected entry is checked against workspace policy
        const resolved = await this.policy.resolveRead(
          workspaceId,
          `${relativeDirectory}/${entry.name}`,
        );
        if (resolved !== join(directory, entry.name)) throw new Error('SNAPSHOT_PATH_CHANGED');
        names.push(entry.name);
      }
      return names.toSorted();
    });
  }
}
