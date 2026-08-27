import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkspaceConfigStore,
  workspaceConfigPath,
} from '../../src/fs/workspace-config-store.js';

const temporaryRoots: string[] = [];
let stateRoot: string;
let workspaceRoot: string;

const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

beforeEach(async () => {
  const root = await temporaryRoot('sfp-task4-store-');
  stateRoot = join(root, 'state');
  workspaceRoot = join(root, 'workspace');
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

describe('checksummed atomic config', () => {
  it('persists normalized records without persisting the actor', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const workspace = await store.add('actor-secret', workspaceRoot);
    const raw = await readFile(workspaceConfigPath(stateRoot), 'utf8');
    const envelope = JSON.parse(raw) as {
      checksum: string;
      version: number;
      workspaces: unknown[];
    };
    const payload = JSON.stringify({ version: envelope.version, workspaces: envelope.workspaces });

    expect(envelope.version).toBe(1);
    expect(envelope.workspaces).toEqual([workspace]);
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

    expect((await stat(workspaceConfigPath(stateRoot))).mode & 0o777).toBe(0o600);
  });
});

describe('workspace removal', () => {
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
