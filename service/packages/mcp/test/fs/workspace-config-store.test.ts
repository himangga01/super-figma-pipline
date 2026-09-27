import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { WorkspaceUsageGuard } from '@sfp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkspaceConfigStore as createRawWorkspaceConfigStore,
  type WorkspaceConfigDurability,
  workspaceConfigPath,
} from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import { createWorkspaceRegistrationResolver } from '../../src/fs/workspace-registration-resolver.js';
import {
  type BoundStatePermissions,
  createStatePermissions,
  type StatePermissionOptions,
} from '../../src/security/state-permissions.js';

const temporaryRoots: string[] = [];
const execFile = promisify(execFileCallback);
let stateRoot: string;
let workspaceRoot: string;

const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const productStateRoot = async (): Promise<{
  options: StatePermissionOptions;
  stateRoot: string;
}> => {
  const base = await temporaryRoot('sfp-task4-product-state-');
  if (process.platform === 'win32') {
    return {
      options: {
        platform: 'win32',
        environment: { LOCALAPPDATA: base },
        homeDirectory: dirname(base),
      },
      stateRoot: join(base, 'SuperFigmaPipeline'),
    };
  }
  if (process.platform === 'darwin') {
    return {
      options: { platform: 'darwin', environment: {}, homeDirectory: base },
      stateRoot: join(base, 'Library', 'Application Support', 'SuperFigmaPipeline'),
    };
  }
  return {
    options: {
      platform: 'linux',
      environment: { XDG_STATE_HOME: base },
      homeDirectory: dirname(base),
    },
    stateRoot: join(base, 'super-figma-pipeline'),
  };
};

const verifiedTestPermissions = (root: string): BoundStatePermissions => ({
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

const createWorkspaceConfigStore = (
  root: string,
  guard: WorkspaceUsageGuard,
  permissions: BoundStatePermissions = verifiedTestPermissions(root),
  durability?: Partial<WorkspaceConfigDurability>,
) => createRawWorkspaceConfigStore(root, guard, permissions, durability);

beforeEach(async () => {
  const root = await temporaryRoot('sfp-task4-store-');
  stateRoot = join(root, 'state');
  workspaceRoot = join(root, 'workspace');
  await mkdir(stateRoot);
  await mkdir(workspaceRoot);
});

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('workspace registration', () => {
  it('requires an authenticated explicit action', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    await expect(store.add('', workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_AUTH_REQUIRED',
    });
    expect(await store.list()).toEqual([]);
  });

  it('registers only an existing directory and records its real path', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    const workspace = await store.add('actor', workspaceRoot);

    expect(workspace).toMatchObject({
      path: resolve(workspaceRoot),
      realPath: await realpath(workspaceRoot),
    });
    expect(workspace.workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Number.isNaN(Date.parse(workspace.addedAt))).toBe(false);
    expect(await store.list()).toEqual([workspace]);
  });

  it('rejects a missing path and a regular file', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const file = join(workspaceRoot, 'file.txt');
    await writeFile(file, 'not a directory');

    await expect(store.add('actor', join(workspaceRoot, 'missing'))).rejects.toMatchObject({
      code: 'WORKSPACE_DIRECTORY_REQUIRED',
    });
    await expect(store.add('actor', file)).rejects.toMatchObject({
      code: 'WORKSPACE_DIRECTORY_REQUIRED',
    });
  });

  it('deduplicates aliases by real path', async () => {
    const alias = join(workspaceRoot, 'alias');
    const target = join(workspaceRoot, 'target');
    await mkdir(target);
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    const added = await store.add('actor', alias);
    await expect(store.add('actor', target)).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_CONFIGURED',
    });

    expect(added.path).toBe(resolve(alias));
    expect(added.realPath).toBe(await realpath(target));
    expect(await store.list()).toHaveLength(1);
  });

  it('assigns a distinct workspaceId to each approved directory', async () => {
    const secondRoot = join(await temporaryRoot('sfp-task4-workspace-'), 'second');
    await mkdir(secondRoot);
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    const first = await store.add('actor', workspaceRoot);
    const second = await store.add('actor', secondRoot);

    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(await store.list()).toHaveLength(2);
  });

  it('rejects overlap between owner state and an approved workspace', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    await expect(store.add('actor', join(stateRoot, '..'))).rejects.toMatchObject({
      code: 'STATE_WORKSPACE_OVERLAP',
    });
  });

  it('serializes concurrent additions without losing either record', async () => {
    const secondRoot = join(await temporaryRoot('sfp-task4-concurrent-'), 'second');
    await mkdir(secondRoot);
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    await Promise.all([store.add('actor-1', workspaceRoot), store.add('actor-2', secondRoot)]);

    expect(await store.list()).toHaveLength(2);
  });

  it('serializes independent store instances that share one state root', async () => {
    const secondRoot = join(await temporaryRoot('sfp-task4-multi-store-'), 'second');
    await mkdir(secondRoot);
    const firstStore = createWorkspaceConfigStore(stateRoot, idleGuard);
    const secondStore = createWorkspaceConfigStore(stateRoot, idleGuard);

    await Promise.all([
      firstStore.add('actor-1', workspaceRoot),
      secondStore.add('actor-2', secondRoot),
    ]);

    expect(await firstStore.list()).toHaveLength(2);
  });
});

describe('secure owner-state prerequisite', () => {
  it('serializes a canonical root and an alias by verified root identity', async () => {
    const product = await productStateRoot();
    await mkdir(product.stateRoot);
    const permissions = verifiedTestPermissions(product.stateRoot);
    const alias = join(await temporaryRoot('sfp-task4-state-alias-'), 'product-state-link');
    await symlink(product.stateRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const secondWorkspace = join(await temporaryRoot('sfp-task4-alias-workspace-'), 'workspace');
    await mkdir(secondWorkspace);
    const canonicalStore = createWorkspaceConfigStore(product.stateRoot, idleGuard, permissions);
    const aliasStore = createWorkspaceConfigStore(alias, idleGuard, permissions);

    await Promise.all([
      canonicalStore.add('actor-1', workspaceRoot),
      aliasStore.add('actor-2', secondWorkspace),
    ]);

    await expect(canonicalStore.list()).resolves.toHaveLength(2);
  });

  it('rejects replacement of the config pathname during secure inspection', async () => {
    const basePermissions = verifiedTestPermissions(stateRoot);
    const initialStore = createWorkspaceConfigStore(stateRoot, idleGuard, basePermissions);
    await initialStore.add('actor', workspaceRoot);
    const configPath = workspaceConfigPath(stateRoot);
    const replacedPath = `${configPath}.replaced`;
    const replacementPath = `${configPath}.replacement`;
    const payload = { version: 1, workspaces: [] };
    await writeFile(
      replacementPath,
      JSON.stringify({
        ...payload,
        checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      }),
    );
    let replaced = false;
    const adversarialPermissions: BoundStatePermissions = {
      ...basePermissions,
      inspectSecure: async path => {
        if (resolve(path) === resolve(configPath) && !replaced) {
          replaced = true;
          await rename(configPath, replacedPath);
          await rename(replacementPath, configPath);
        }
        return basePermissions.inspectSecure(path);
      },
      verifySecure: async path => {
        await adversarialPermissions.inspectSecure(path);
      },
    };
    const store = createWorkspaceConfigStore(stateRoot, idleGuard, adversarialPermissions);

    await expect(store.list()).rejects.toMatchObject({ code: 'STATE_IDENTITY_CHANGED' });
  });

  it.runIf(process.platform === 'win32')(
    'blocks an inherited broad state DACL until the bound authority explicitly hardens it',
    async () => {
      const product = await productStateRoot();
      await mkdir(product.stateRoot);
      const permissions = createStatePermissions(product.stateRoot, product.options);
      const store = createWorkspaceConfigStore(product.stateRoot, idleGuard, permissions);

      await expect(store.list()).rejects.toMatchObject({ code: 'STATE_ACL_INSECURE' });

      await permissions.ensureSecure(product.stateRoot);
      await expect(store.list()).resolves.toEqual([]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'blocks an existing 0755 state directory until the bound authority explicitly hardens it',
    async () => {
      const product = await productStateRoot();
      await mkdir(product.stateRoot, { recursive: true, mode: 0o755 });
      await chmod(product.stateRoot, 0o755);
      const permissions = createStatePermissions(product.stateRoot, product.options);
      const store = createWorkspaceConfigStore(product.stateRoot, idleGuard, permissions);

      await expect(store.list()).rejects.toMatchObject({ code: 'STATE_MODE_INSECURE' });

      await permissions.ensureSecure(product.stateRoot);
      await expect(store.list()).resolves.toEqual([]);
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects a configured file after an unexpected allow ACE is added',
    async () => {
      const product = await productStateRoot();
      const permissions = createStatePermissions(product.stateRoot, product.options);
      await permissions.ensureSecure(product.stateRoot);
      const store = createWorkspaceConfigStore(product.stateRoot, idleGuard, permissions);
      await store.add('actor', workspaceRoot);
      const configPath = workspaceConfigPath(product.stateRoot);
      await execFile('icacls.exe', [configPath, '/grant', '*S-1-1-0:(R)'], {
        windowsHide: true,
      });

      await expect(store.list()).rejects.toMatchObject({ code: 'STATE_ACL_INSECURE' });
    },
    30_000,
  );

  it.runIf(process.platform !== 'win32')(
    'rejects a configured file after its mode is widened to 0644',
    async () => {
      const product = await productStateRoot();
      const permissions = createStatePermissions(product.stateRoot, product.options);
      await permissions.ensureSecure(product.stateRoot);
      const store = createWorkspaceConfigStore(product.stateRoot, idleGuard, permissions);
      await store.add('actor', workspaceRoot);
      await chmod(workspaceConfigPath(product.stateRoot), 0o644);

      await expect(store.list()).rejects.toMatchObject({ code: 'STATE_MODE_INSECURE' });
    },
  );
});

describe('checksummed atomic config', () => {
  it('keeps a pre-rename private-mode failure distinct from an unknown commit outcome', async () => {
    const permissions = verifiedTestPermissions(stateRoot);
    const store = createWorkspaceConfigStore(stateRoot, idleGuard, permissions, {
      setPrivateFileMode: async () => {
        throw new Error('chmod failed');
      },
      syncDirectory: async () => undefined,
    });

    await expect(store.add('actor', workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_CONFIG_WRITE_FAILED',
    });
    await expect(store.list()).resolves.toEqual([]);
  });

  it('reports and reconciles a post-rename directory-sync failure', async () => {
    const permissions = verifiedTestPermissions(stateRoot);
    const store = createWorkspaceConfigStore(stateRoot, idleGuard, permissions, {
      setPrivateFileMode: async () => undefined,
      syncDirectory: async () => {
        throw new Error('directory fsync failed');
      },
    });

    await expect(store.add('actor', workspaceRoot)).rejects.toMatchObject({
      code: 'COMMIT_OUTCOME_UNKNOWN',
      committed: true,
    });
    const restarted = createWorkspaceConfigStore(stateRoot, idleGuard, permissions, {
      setPrivateFileMode: async () => undefined,
      syncDirectory: async () => undefined,
    });
    await expect(restarted.list()).resolves.toHaveLength(1);
  });

  it('does not reconcile corrupted records that retain the intended checksum string', async () => {
    const permissions = verifiedTestPermissions(stateRoot);
    const configPath = workspaceConfigPath(stateRoot);
    const store = createWorkspaceConfigStore(stateRoot, idleGuard, permissions, {
      setPrivateFileMode: async () => undefined,
      syncDirectory: async () => {
        const envelope = JSON.parse(await readFile(configPath, 'utf8')) as {
          checksum: string;
        };
        await writeFile(
          configPath,
          JSON.stringify({ version: 1, workspaces: [], checksum: envelope.checksum }),
        );
        throw new Error('directory fsync failed after corruption');
      },
    });

    await expect(store.add('actor', workspaceRoot)).rejects.toMatchObject({
      code: 'COMMIT_OUTCOME_UNKNOWN',
      committed: false,
    });
  });

  it('persists normalized records without persisting the actor', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await store.add('actor-secret', workspaceRoot);
    const raw = await readFile(workspaceConfigPath(stateRoot), 'utf8');
    const envelope = JSON.parse(raw) as {
      checksum: string;
      version: number;
      workspaces: unknown[];
      defaultWorkspaceId: string | null;
    };
    const payload = JSON.stringify({
      version: envelope.version,
      workspaces: envelope.workspaces,
      defaultWorkspaceId: envelope.defaultWorkspaceId,
    });

    expect(envelope.version).toBe(3);
    expect(envelope.workspaces).toEqual([
      {
        workspaceId: workspace.workspaceId,
        path: workspace.path,
        realPath: workspace.realPath,
        rootIdentityKey: workspace.rootIdentityKey,
        addedAt: workspace.addedAt,
        state: 'bound',
      },
    ]);
    expect(workspace.availability).toBe('available');
    expect(envelope.defaultWorkspaceId).toBeNull();
    expect(envelope.checksum).toBe(createHash('sha256').update(payload).digest('hex'));
    expect(raw).not.toContain('actor-secret');
  });

  it('round-trips through a fresh store instance', async () => {
    const firstStore = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await firstStore.add('actor', workspaceRoot);

    const restartedStore = createWorkspaceConfigStore(stateRoot, idleGuard);

    await expect(restartedStore.list()).resolves.toEqual([workspace]);
  });

  it('fails closed on checksum tampering instead of resetting approvals', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    await store.add('actor', workspaceRoot);
    const configPath = workspaceConfigPath(stateRoot);
    const envelope = JSON.parse(await readFile(configPath, 'utf8')) as { checksum: string };
    envelope.checksum = '0'.repeat(64);
    await writeFile(configPath, JSON.stringify(envelope));

    await expect(store.list()).rejects.toMatchObject({ code: 'WORKSPACE_CONFIG_INVALID' });
  });

  it('ignores an interrupted temporary write when the committed config is valid', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await store.add('actor', workspaceRoot);
    await writeFile(join(stateRoot, '.workspaces.v1.interrupted.tmp'), '{incomplete');

    await expect(createWorkspaceConfigStore(stateRoot, idleGuard).list()).resolves.toEqual([
      workspace,
    ]);
  });

  it.runIf(process.platform !== 'win32')('writes the config with Unix mode 0600', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    await store.add('actor', workspaceRoot);

    expect((await stat(workspaceConfigPath(stateRoot))).mode & 0o7777).toBe(0o600);
  });
});

describe('workspace removal', () => {
  it('validates default and usage guards before authorized nonce consumption', async () => {
    let consumed = 0;
    const defaultStore = createWorkspaceConfigStore(stateRoot, idleGuard);
    const defaultWorkspace = await defaultStore.add('actor', workspaceRoot);
    await defaultStore.setDefault('actor', defaultWorkspace.workspaceId);
    await expect(
      defaultStore.removeAuthorized('actor', defaultWorkspace.workspaceId, async () => {
        consumed += 1;
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DEFAULT_IN_USE' });
    await expect(
      defaultStore.removeAuthorized('actor', '123e4567-e89b-42d3-a456-426614174099', async () => {
        consumed += 1;
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CONFIGURED' });

    const inUseRoot = await temporaryRoot('sfp-task7b-in-use-');
    const inUseState = join(inUseRoot, 'state');
    const inUseWorkspace = join(inUseRoot, 'workspace');
    await Promise.all([mkdir(inUseState), mkdir(inUseWorkspace)]);
    const inUseStore = createWorkspaceConfigStore(inUseState, {
      hasUnsettled: async () => true,
    });
    const configured = await inUseStore.add('actor', inUseWorkspace);
    await expect(
      inUseStore.removeAuthorized('actor', configured.workspaceId, async () => {
        consumed += 1;
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
    expect(consumed).toBe(0);
  });

  it('validates an authorized default target before nonce consumption', async () => {
    let consumed = 0;
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    await expect(
      store.setDefaultAuthorized('actor', '123e4567-e89b-42d3-a456-426614174000', async () => {
        consumed += 1;
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DEFAULT_INVALID' });
    expect(consumed).toBe(0);
  });

  it('requires an authenticated explicit action', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await store.add('actor', workspaceRoot);

    await expect(store.remove('', workspace.workspaceId)).rejects.toMatchObject({
      code: 'WORKSPACE_AUTH_REQUIRED',
    });
    expect(await store.list()).toEqual([workspace]);
  });

  it('removes a configured workspace when it has no unsettled use', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await store.add('actor', workspaceRoot);

    await store.remove('actor', workspace.workspaceId);

    expect(await store.list()).toEqual([]);
  });

  it('rejects removal of an unknown workspace', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);

    await expect(store.remove('actor', 'missing-workspace')).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_CONFIGURED',
    });
  });
});

describe('v2 identity-bound registration and default selection', () => {
  it('revalidates then consumes the nonce before committing the bound registration', async () => {
    const resolver = createWorkspaceRegistrationResolver();
    const expected = await resolver.resolveForNonce(workspaceRoot);
    const events: string[] = [];
    const store = createRawWorkspaceConfigStore(
      stateRoot,
      idleGuard,
      verifiedTestPermissions(stateRoot),
      {},
      resolver,
    );

    const workspace = await store.addResolved('actor', expected, async () => {
      events.push('nonce-consumed');
    });

    expect(events).toEqual(['nonce-consumed']);
    expect(workspace).toMatchObject({
      path: expected.requestedPath,
      realPath: expected.realPath,
      rootIdentityKey: expected.identityKey,
    });
    const persisted = JSON.parse(await readFile(workspaceConfigPath(stateRoot), 'utf8')) as {
      version: number;
      defaultWorkspaceId: string | null;
      workspaces: Array<{ rootIdentityKey?: string; state?: string }>;
    };
    expect(persisted).toMatchObject({ version: 3, defaultWorkspaceId: null });
    expect(persisted.workspaces[0]?.rootIdentityKey).toBe(expected.identityKey);
    expect(persisted.workspaces[0]?.state).toBe('bound');
  });

  it('preserves the default across restart and guards current-default removal', async () => {
    const resolver = createWorkspaceRegistrationResolver();
    const store = createRawWorkspaceConfigStore(
      stateRoot,
      idleGuard,
      verifiedTestPermissions(stateRoot),
      {},
      resolver,
    );
    const expected = await resolver.resolveForNonce(workspaceRoot);
    const workspace = await store.addResolved('actor', expected, async () => {});
    await store.setDefault('actor', workspace.workspaceId);

    const restarted = createRawWorkspaceConfigStore(
      stateRoot,
      idleGuard,
      verifiedTestPermissions(stateRoot),
      {},
      resolver,
    );
    await expect(restarted.getDefault()).resolves.toBe(workspace.workspaceId);
    await expect(restarted.remove('actor', workspace.workspaceId)).rejects.toMatchObject({
      code: 'WORKSPACE_DEFAULT_IN_USE',
    });
    await restarted.setDefault('actor', null);
    await restarted.remove('actor', workspace.workspaceId);
    await expect(restarted.list()).resolves.toEqual([]);
  });

  it('lists a registered root replaced at the same spelling as unavailable instead of failing reads', async () => {
    const resolver = createWorkspaceRegistrationResolver();
    const store = createRawWorkspaceConfigStore(
      stateRoot,
      idleGuard,
      verifiedTestPermissions(stateRoot),
      {},
      resolver,
    );
    const expected = await resolver.resolveForNonce(workspaceRoot);
    const workspace = await store.addResolved('actor', expected, async () => {});
    const moved = `${workspaceRoot}-old`;
    await rename(workspaceRoot, moved);
    await mkdir(workspaceRoot);

    await expect(store.list()).resolves.toEqual([
      {
        ...workspace,
        availability: 'unavailable',
        unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED',
      },
    ]);
  });
});

const noBoundaryProbe = { boundaryInspector: { assertSafe: async () => undefined } };
const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
const writeEnvelope = async (payload: Record<string, unknown>): Promise<string> => {
  const raw = `${JSON.stringify({ ...payload, checksum: sha256Hex(JSON.stringify(payload)) })}\n`;
  await writeFile(workspaceConfigPath(stateRoot), raw);
  return raw;
};
const readEnvelope = async (): Promise<{
  version: number;
  workspaces: Array<Record<string, unknown>>;
  defaultWorkspaceId: string | null;
}> => JSON.parse(await readFile(workspaceConfigPath(stateRoot), 'utf8'));
const resolverStore = (guard: WorkspaceUsageGuard = idleGuard) => {
  const resolver = createWorkspaceRegistrationResolver();
  return {
    resolver,
    store: createRawWorkspaceConfigStore(
      stateRoot,
      guard,
      verifiedTestPermissions(stateRoot),
      {},
      resolver,
    ),
  };
};
const extraWorkspace = async (name: string): Promise<string> => {
  const path = join(await temporaryRoot(`sfp-t08-${name}-`), name);
  await mkdir(path);
  return path;
};

describe('per-row workspace availability (LC-2, T08)', () => {
  it('keeps an unavailable row byte-for-byte, including its identity, through unrelated mutations', async () => {
    const [second, third] = await Promise.all([extraWorkspace('second'), extraWorkspace('third')]);
    const { store } = resolverStore();
    const a = await store.add('actor', workspaceRoot);
    const b = await store.add('actor', second);
    const before = await readEnvelope();
    const rowA = JSON.stringify(before.workspaces[0]);
    expect(before.workspaces[0]).toEqual({
      workspaceId: a.workspaceId,
      path: a.path,
      realPath: a.realPath,
      rootIdentityKey: a.rootIdentityKey,
      addedAt: a.addedAt,
      state: 'bound',
    });

    await rm(workspaceRoot, { recursive: true });
    const c = await store.add('actor', third);
    expect(await readFile(workspaceConfigPath(stateRoot), 'utf8')).toContain(rowA);
    expect((await readEnvelope()).workspaces).toHaveLength(3);
    await store.setDefault('actor', c.workspaceId);
    await store.setDefault('actor', null);
    await store.remove('actor', b.workspaceId);

    const after = await readEnvelope();
    expect(after.version).toBe(3);
    expect(await readFile(workspaceConfigPath(stateRoot), 'utf8')).toContain(rowA);
    expect(JSON.stringify(after.workspaces[0])).toBe(rowA);
    expect(after.workspaces[0]?.rootIdentityKey).toBe(a.rootIdentityKey);
    await expect(store.list()).resolves.toEqual([
      { ...a, availability: 'unavailable', unavailableReason: 'WORKSPACE_ROOT_MISSING' },
      { ...c, availability: 'available' },
    ]);
  });

  it('keeps a different directory recreated at a registered path unavailable until an explicit rebind', async () => {
    const { resolver, store } = resolverStore();
    const a = await store.add('actor', workspaceRoot);
    const policy = createWorkspacePolicy(store, noBoundaryProbe);
    await expect(policy.resolveRoot!(a.workspaceId)).resolves.toBe(await realpath(workspaceRoot));

    await rename(workspaceRoot, `${workspaceRoot}-original`);
    await mkdir(workspaceRoot);

    const unavailable = {
      ...a,
      availability: 'unavailable',
      unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED',
    };
    await expect(store.list()).resolves.toEqual([unavailable]);
    await expect(policy.resolveRoot!(a.workspaceId)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
      cause: { code: 'WORKSPACE_ROOT_IDENTITY_CHANGED' },
    });
    // Neither re-adding the path nor an unrelated mutation adopts the new directory's identity.
    await expect(store.add('actor', workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_CONFIGURED',
    });
    await store.setDefault('actor', a.workspaceId);
    await store.setDefault('actor', null);
    expect((await readEnvelope()).workspaces[0]?.rootIdentityKey).toBe(a.rootIdentityKey);
    await expect(resolverStore().store.list()).resolves.toEqual([unavailable]);

    // Only an explicit rebind records the replacement identity.
    const replacement = await resolver.resolveForNonce(workspaceRoot);
    expect(replacement.identityKey).not.toBe(a.rootIdentityKey);
    const events: string[] = [];
    const rebound = await store.rebindResolved(
      'actor',
      a.workspaceId,
      replacement,
      async revalidate => {
        await revalidate();
        events.push('nonce-consumed');
      },
    );
    expect(events).toEqual(['nonce-consumed']);
    expect(rebound).toEqual({
      ...a,
      rootIdentityKey: replacement.identityKey,
      availability: 'available',
    });
    await expect(store.list()).resolves.toEqual([rebound]);
    // The same long-lived policy accepts the rebound root.
    await expect(policy.resolveRoot!(a.workspaceId)).resolves.toBe(await realpath(workspaceRoot));
  });

  it('rebinds a moved workspace to its new path while keeping its ID and default', async () => {
    const { resolver, store } = resolverStore();
    const a = await store.add('actor', workspaceRoot);
    await store.setDefault('actor', a.workspaceId);
    const moved = join(await temporaryRoot('sfp-t08-moved-'), 'moved');
    await rename(workspaceRoot, moved);
    await expect(store.list()).resolves.toEqual([
      { ...a, availability: 'unavailable', unavailableReason: 'WORKSPACE_ROOT_MISSING' },
    ]);

    const registration = await resolver.resolveForNonce(moved);
    const rebound = await store.rebindResolved('actor', a.workspaceId, registration, async r =>
      r(),
    );

    expect(rebound).toEqual({
      workspaceId: a.workspaceId,
      path: registration.requestedPath,
      realPath: registration.realPath,
      rootIdentityKey: registration.identityKey,
      addedAt: a.addedAt,
      availability: 'available',
    });
    await expect(store.getDefault()).resolves.toBe(a.workspaceId);
    await expect(store.list()).resolves.toEqual([rebound]);
  });

  it('refuses a rebind that conflicts, overlaps owner state or has unsettled operations', async () => {
    const second = await extraWorkspace('second');
    let unsettled = false;
    const { resolver, store } = resolverStore({ hasUnsettled: async () => unsettled });
    const a = await store.add('actor', workspaceRoot);
    const b = await store.add('actor', second);
    let consumed = 0;
    const consume = async (revalidate: () => Promise<void>): Promise<void> => {
      await revalidate();
      consumed += 1;
    };

    await expect(
      store.rebindResolved('actor', a.workspaceId, await resolver.resolveForNonce(second), consume),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_CONFIGURED' });
    await expect(
      store.rebindResolved(
        'actor',
        a.workspaceId,
        await resolver.resolveForNonce(join(stateRoot, '..')),
        consume,
      ),
    ).rejects.toMatchObject({ code: 'STATE_WORKSPACE_OVERLAP' });
    await expect(
      store.rebindResolved(
        'actor',
        '123e4567-e89b-42d3-a456-426614174099',
        await resolver.resolveForNonce(workspaceRoot),
        consume,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CONFIGURED' });
    await expect(
      store.rebindResolved(
        '',
        a.workspaceId,
        await resolver.resolveForNonce(workspaceRoot),
        consume,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_AUTH_REQUIRED' });
    unsettled = true;
    await expect(
      store.rebindResolved(
        'actor',
        a.workspaceId,
        await resolver.resolveForNonce(workspaceRoot),
        consume,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
    expect(consumed).toBe(0);
    await expect(store.list()).resolves.toEqual([
      { ...a, availability: 'available' },
      { ...b, availability: 'available' },
    ]);
  });

  it('keeps the nonce unconsumed and the row unchanged when the rebind target changes before commit', async () => {
    const { resolver, store } = resolverStore();
    const a = await store.add('actor', workspaceRoot);
    await rm(workspaceRoot, { recursive: true });
    const target = await extraWorkspace('target');
    const registration = await resolver.resolveForNonce(target);
    await rename(target, `${target}-swapped`);
    await mkdir(target);
    let consumed = 0;

    await expect(
      store.rebindResolved('actor', a.workspaceId, registration, async revalidate => {
        await revalidate();
        consumed += 1;
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REGISTRATION_CHANGED' });
    expect(consumed).toBe(0);
    expect((await readEnvelope()).workspaces[0]?.rootIdentityKey).toBe(a.rootIdentityKey);
  });

  it('loads a v1 config as legacy-unbound rows without adopting the current identity', async () => {
    const legacy = {
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
      path: resolve(workspaceRoot),
      realPath: await realpath(workspaceRoot),
      addedAt: '2026-08-28T00:00:00.000Z',
    };
    const raw = await writeEnvelope({ version: 1, workspaces: [legacy] });
    const { resolver, store } = resolverStore();

    await expect(store.list()).resolves.toEqual([{ ...legacy, availability: 'legacy-unbound' }]);
    await expect(store.getDefault()).resolves.toBeNull();
    // Reads never rewrite the file.
    expect(await readFile(workspaceConfigPath(stateRoot), 'utf8')).toBe(raw);
    const policy = createWorkspacePolicy(store, noBoundaryProbe);
    await expect(policy.resolveRoot!(legacy.workspaceId)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
      cause: { code: 'WORKSPACE_ROOT_UNBOUND' },
    });

    // An explicit, unrelated mutation writes v3 and keeps the legacy row unbound.
    const second = await store.add('actor', await extraWorkspace('second'));
    const migrated = await readEnvelope();
    expect(migrated.version).toBe(3);
    expect(migrated.workspaces[0]).toEqual({ ...legacy, state: 'legacy-unbound' });
    await expect(store.list()).resolves.toEqual([
      { ...legacy, availability: 'legacy-unbound' },
      { ...second, availability: 'available' },
    ]);

    // Only an explicit rebind binds an identity to the legacy registration.
    const registration = await resolver.resolveForNonce(workspaceRoot);
    const rebound = await store.rebindResolved('actor', legacy.workspaceId, registration, async r =>
      r(),
    );
    expect(rebound).toEqual({
      ...legacy,
      rootIdentityKey: registration.identityKey,
      availability: 'available',
    });
    expect((await readEnvelope()).workspaces[0]).toEqual({
      ...legacy,
      rootIdentityKey: registration.identityKey,
      state: 'bound',
    });
    await expect(policy.resolveRoot!(legacy.workspaceId)).resolves.toBe(
      await realpath(workspaceRoot),
    );
  });

  it('loads a v2 config unchanged and migrates it to v3 only through an explicit mutation', async () => {
    const { resolver, store } = resolverStore();
    const registration = await resolver.resolveForNonce(workspaceRoot);
    const bound = {
      workspaceId: '123e4567-e89b-42d3-a456-426614174001',
      path: registration.requestedPath,
      realPath: registration.realPath,
      rootIdentityKey: registration.identityKey,
      addedAt: '2026-08-31T00:00:00.000Z',
    };
    const raw = await writeEnvelope({
      version: 2,
      workspaces: [bound],
      defaultWorkspaceId: bound.workspaceId,
    });

    await expect(store.list()).resolves.toEqual([{ ...bound, availability: 'available' }]);
    await expect(store.getDefault()).resolves.toBe(bound.workspaceId);
    expect(await readFile(workspaceConfigPath(stateRoot), 'utf8')).toBe(raw);

    await store.setDefault('actor', null);
    const migrated = await readEnvelope();
    expect(migrated).toMatchObject({ version: 3, defaultWorkspaceId: null });
    // A v3 bound row is the v2 row followed by its state.
    expect(JSON.stringify(migrated.workspaces[0])).toBe(
      JSON.stringify({ ...bound, state: 'bound' }),
    );
    await expect(store.list()).resolves.toEqual([{ ...bound, availability: 'available' }]);
  });

  it.each([
    ['a bound row without an identity', { state: 'bound' }],
    ['a legacy row with an identity', { state: 'legacy-unbound', rootIdentityKey: '1:2:3' }],
    ['an unknown state', { state: 'unavailable', rootIdentityKey: '1:2:3' }],
    ['a row without a state', { rootIdentityKey: '1:2:3' }],
    ['a persisted availability', { state: 'bound', rootIdentityKey: '1:2:3', availability: 'x' }],
  ])('rejects a v3 config with %s', async (_name, fields) => {
    await writeEnvelope({
      version: 3,
      workspaces: [
        {
          workspaceId: '123e4567-e89b-42d3-a456-426614174002',
          path: resolve(workspaceRoot),
          realPath: await realpath(workspaceRoot),
          addedAt: '2026-09-27T00:00:00.000Z',
          ...fields,
        },
      ],
      defaultWorkspaceId: null,
    });

    await expect(resolverStore().store.list()).rejects.toMatchObject({
      code: 'WORKSPACE_CONFIG_INVALID',
    });
  });
});
