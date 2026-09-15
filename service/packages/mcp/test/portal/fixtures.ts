import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import { PortalStore } from '../../src/portal/store.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

/** Filesystem security is tested by the dedicated permission suite; these tests use actual I/O/CAS. */
export const fixturePermissions = (root: string): BoundStatePermissions => ({
  stateRoot: resolve(root),
  ensureSecure: async () => undefined,
  verifySecure: async () => undefined,
  inspectSecure: async path => {
    const metadata = await stat(path, { bigint: true });
    return {
      canonicalPath: await realpath(path),
      key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
      directory: metadata.isDirectory(),
      file: metadata.isFile(),
    };
  },
});
export const portalFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-portal-'));
  const stateRoot = join(root, 'state'),
    workspaceRoot = join(root, 'workspace');
  await mkdir(stateRoot);
  await mkdir(workspaceRoot);
  const permissions = fixturePermissions(stateRoot);
  const workspaces = createWorkspaceConfigStore(
    stateRoot,
    { hasUnsettled: async () => false },
    permissions,
  );
  const workspaceId = (await workspaces.add('actor', workspaceRoot)).workspaceId;
  const policy = createWorkspacePolicy(workspaces);
  const key = randomBytes(32);
  const store = new PortalStore(stateRoot, key, permissions);
  return {
    root,
    stateRoot,
    workspaceRoot,
    workspaceId,
    policy,
    store,
    permissions,
    key,
    workspaces,
    cleanup: async () => {
      const part = relative(tmpdir(), root);
      if (!part || isAbsolute(part) || part.startsWith('..'))
        throw Error('Invalid temporary cleanup root');
      await rm(root, { recursive: true, force: true });
    },
  };
};
