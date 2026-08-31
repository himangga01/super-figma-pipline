import { mkdtemp, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceRegistrationResolver } from '../../src/fs/workspace-registration-resolver.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('workspace registration resolver', () => {
  it('detects replacement at the same requested spelling before mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-registration-'));
    roots.push(root);
    const requested = join(root, 'workspace');
    await mkdir(requested);
    const resolver = createWorkspaceRegistrationResolver();
    const expected = await resolver.resolveForNonce(requested);
    await rename(requested, join(root, 'old'));
    await mkdir(requested);
    await expect(resolver.revalidateInsideMutation(expected)).rejects.toMatchObject({
      code: 'WORKSPACE_REGISTRATION_CHANGED',
    });
  });

  it('returns a stable real path and filesystem identity for an unchanged directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-registration-'));
    roots.push(root);
    const requested = join(root, '그래프');
    await mkdir(requested);
    const resolver = createWorkspaceRegistrationResolver();
    const expected = await resolver.resolveForNonce(requested);
    await expect(resolver.revalidateInsideMutation(expected)).resolves.toEqual(expected);
  });
});
