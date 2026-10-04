import { mkdir, readFile, writeFile, lstat, link, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import {
  reclaimOwnedTree,
  reviewOwnedTree,
  ownedTreeReviewHash,
  type OwnedTreeReclamation,
} from '../../src/fs/owned-tree-reclamation.js';
import { directoryIdentity } from '../../src/portal/native-resources.js';
import { portalFixture } from '../portal/fixtures.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});
const fixture = async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const root = join(f.stateRoot, 'owned-tree');
  await mkdir(join(root, 'home', 'cache'), { recursive: true });
  await writeFile(join(root, 'home', 'cache', 'bytes'), 'reviewed bytes');
  return { ...f, root, path: join(root, 'home', 'cache', 'bytes') };
};
it('resumes a durable deletion intent after unlink while preserving the exact review identity', async () => {
  const f = await fixture();
  const tree = await reviewOwnedTree(f.stateRoot, f.root, await directoryIdentity(f.root));
  let durable = structuredClone(tree),
    crashed = false;
  await expect(
    reclaimOwnedTree(tree, {
      persist: async next => {
        durable = structuredClone(next);
      },
      afterUnlink: async path => {
        if (path && !crashed) {
          crashed = true;
          throw Error('interrupted child');
        }
      },
    }),
  ).rejects.toThrow('interrupted child');
  expect(durable.entries.find(row => row.kind === 'file')?.state).toBe('deleting');
  expect(ownedTreeReviewHash(durable)).toBe(ownedTreeReviewHash(tree));
  const complete = await reclaimOwnedTree(durable, {
    persist: async next => {
      durable = structuredClone(next);
    },
  });
  expect(complete.entries.every(row => row.state === 'removed')).toBe(true);
  await expect(lstat(f.root)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('preserves same-inode bytes edited during durable intent persistence', async () => {
  const f = await fixture();
  const tree = await reviewOwnedTree(f.stateRoot, f.root, await directoryIdentity(f.root));
  let edited = false;
  await expect(
    reclaimOwnedTree(tree, {
      persist: async next => {
        if (!edited && next.entries.some(row => row.kind === 'file' && row.state === 'deleting')) {
          edited = true;
          await writeFile(f.path, 'owner changed bytes');
        }
      },
    }),
  ).rejects.toThrow('OWNED_TREE_FILE_CHANGED');
  expect(await readFile(f.path, 'utf8')).toBe('owner changed bytes');
});
it('preserves a foreign replacement at an already removed name after interruption', async () => {
  const f = await fixture();
  const tree = await reviewOwnedTree(f.stateRoot, f.root, await directoryIdentity(f.root));
  let durable: OwnedTreeReclamation = structuredClone(tree);
  await expect(
    reclaimOwnedTree(tree, {
      persist: async next => {
        durable = structuredClone(next);
      },
      afterUnlink: async () => {
        throw Error('interrupted');
      },
    }),
  ).rejects.toThrow('interrupted');
  await writeFile(f.path, 'foreign replacement');
  await expect(reclaimOwnedTree(durable, { persist: async () => {} })).rejects.toThrow(
    'OWNED_TREE_ENTRY_CHANGED',
  );
  expect(await readFile(f.path, 'utf8')).toBe('foreign replacement');
});
it('rejects hardlinked files and identity-replaced ancestors before deletion', async () => {
  const f = await fixture();
  await link(f.path, join(f.root, 'alias'));
  await expect(
    reviewOwnedTree(f.stateRoot, f.root, await directoryIdentity(f.root)),
  ).rejects.toThrow('OWNED_TREE_FILE_INVALID');
  const g = await fixture(),
    tree = await reviewOwnedTree(g.stateRoot, g.root, await directoryIdentity(g.root));
  await rename(join(g.root, 'home'), join(g.root, 'original-home'));
  await mkdir(join(g.root, 'home', 'cache'), { recursive: true });
  await writeFile(g.path, 'foreign ancestor');
  await expect(reclaimOwnedTree(tree, { persist: async () => {} })).rejects.toThrow(
    'OWNED_TREE_DIRECTORY_CHANGED',
  );
  expect(await readFile(g.path, 'utf8')).toBe('foreign ancestor');
});
