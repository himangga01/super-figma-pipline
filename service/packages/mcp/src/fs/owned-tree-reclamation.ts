/* eslint-disable no-await-in-loop -- each deletion has a durable per-entry intent */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { contentHash } from '@sfp/ir';
import { z } from 'zod';

import { withRetainedDirectoryChain } from './atomic-file.js';

const fail = (code: string) => Object.assign(new Error(code), { code });
const identity = (stat: { dev: bigint; ino: bigint }) => `${stat.dev}:${stat.ino}`;
const EntrySchema = z
  .object({
    relativePath: z.string().max(4096),
    identity: z.string().min(1).max(128),
    kind: z.enum(['file', 'directory']),
    bytes: z.number().int().nonnegative().max(8_589_934_592),
    hash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    state: z.enum(['pending', 'deleting', 'removed']),
  })
  .strict();
export const OwnedTreeReclamationSchema = z
  .object({
    protocol: z.literal('sfp-owned-tree-reclamation-v1'),
    parentPath: z.string().max(4096),
    parentIdentity: z.string().min(1).max(128),
    rootPath: z.string().max(4096),
    entries: z.array(EntrySchema).min(1).max(200_000),
    bytes: z.number().int().nonnegative().max(8_589_934_592),
    parentSync: z.enum(['succeeded', 'eperm-limited']).nullable(),
  })
  .strict();
export type OwnedTreeReclamation = z.infer<typeof OwnedTreeReclamationSchema>;
export const ownedTreeReviewHash = (tree: OwnedTreeReclamation) =>
  contentHash('sfp-owned-tree-review-v1', {
    ...tree,
    parentSync: null,
    entries: tree.entries.map(({ state: _state, ...value }) => value),
  });
const present = (path: string) =>
  lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const sync = async (path: string) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
    return 'succeeded' as const;
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM')
      return 'eperm-limited' as const;
    throw error;
  } finally {
    await handle.close();
  }
};
const fileProof = async (path: string) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > 8_589_934_592n)
      throw fail('OWNED_TREE_FILE_INVALID');
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(524_288);
    let position = 0;
    while (position < Number(before.size)) {
      const read = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position,
      );
      if (!read.bytesRead) throw fail('OWNED_TREE_FILE_CHANGED');
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true }),
      pathname = await present(path);
    if (
      !pathname ||
      pathname.isSymbolicLink() ||
      !pathname.isFile() ||
      pathname.nlink !== 1n ||
      identity(before) !== identity(after) ||
      identity(before) !== identity(pathname) ||
      before.size !== after.size ||
      before.size !== pathname.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.mtimeNs !== pathname.mtimeNs
    )
      throw fail('OWNED_TREE_FILE_CHANGED');
    return {
      identity: identity(before),
      bytes: Number(before.size),
      hash: `sha256:${hash.digest('hex')}`,
    };
  } finally {
    await handle.close();
  }
};
const validate = (input: OwnedTreeReclamation) => {
  const tree = OwnedTreeReclamationSchema.parse(input);
  if (
    !isAbsolute(tree.parentPath) ||
    resolve(tree.parentPath) !== tree.parentPath ||
    dirname(tree.rootPath) !== tree.parentPath ||
    new Set(tree.entries.map(row => row.relativePath)).size !== tree.entries.length ||
    tree.entries.filter(row => row.relativePath === '').length !== 1 ||
    tree.entries.find(row => row.relativePath === '')?.kind !== 'directory' ||
    tree.entries.some(
      row =>
        row.relativePath &&
        (isAbsolute(row.relativePath) ||
          row.relativePath.split(/[\\/]/u).some(part => !part || part === '.' || part === '..')),
    ) ||
    tree.entries.some(row => (row.kind === 'file') !== (row.hash !== null)) ||
    tree.entries.some(row => row.kind === 'directory' && row.bytes !== 0) ||
    tree.bytes !== tree.entries.reduce((total, row) => total + row.bytes, 0)
  )
    throw fail('OWNED_TREE_INTENT_INVALID');
  return tree;
};
/** Read-only inventory. No caller declaration supplies the identity or digest authority. */
export const reviewOwnedTree = async (
  parentPath: string,
  rootPath: string,
  rootIdentity: string,
): Promise<OwnedTreeReclamation> => {
  const parent = await lstat(parentPath, { bigint: true });
  const tree: OwnedTreeReclamation = {
    protocol: 'sfp-owned-tree-reclamation-v1',
    parentPath,
    parentIdentity: identity(parent),
    rootPath,
    entries: [],
    bytes: 0,
    parentSync: null,
  };
  if (dirname(rootPath) !== parentPath || parent.isSymbolicLink() || !parent.isDirectory())
    throw fail('OWNED_TREE_PARENT_CHANGED');
  await withRetainedDirectoryChain(parentPath, rootPath, async authority => {
    const walk = async (path: string) => {
      const stat = await lstat(path, { bigint: true });
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw fail('OWNED_TREE_ENTRY_INVALID');
      if (tree.entries.length >= 200_000) throw fail('OWNED_TREE_CAPACITY');
      if (stat.isDirectory()) {
        tree.entries.push({
          relativePath: relative(rootPath, path),
          identity: identity(stat),
          kind: 'directory',
          bytes: 0,
          hash: null,
          state: 'pending',
        });
        for (const name of (await readdir(path)).toSorted()) await walk(join(path, name));
      } else {
        const proof = await fileProof(path);
        tree.bytes += proof.bytes;
        if (tree.bytes > 8_589_934_592) throw fail('OWNED_TREE_CAPACITY');
        tree.entries.push({
          relativePath: relative(rootPath, path),
          kind: 'file',
          ...proof,
          state: 'pending',
        });
      }
    };
    await walk(rootPath);
    await authority.verify();
  });
  if (tree.entries[0]?.identity !== rootIdentity) throw fail('OWNED_TREE_ROOT_CHANGED');
  return validate(tree);
};
/** Caller persists the signed initial inventory before entry. Unknown paths are never adopted. */
export const reclaimOwnedTree = async (
  input: OwnedTreeReclamation,
  options: {
    persist(tree: OwnedTreeReclamation): Promise<void>;
    afterIntent?: () => Promise<void>;
    afterUnlink?: (relativePath: string) => Promise<void>;
  },
): Promise<OwnedTreeReclamation> => {
  const tree = validate(input);
  await options.afterIntent?.();
  await withRetainedDirectoryChain(tree.parentPath, tree.parentPath, async parentAuthority => {
    const parent = await lstat(tree.parentPath, { bigint: true });
    if (identity(parent) !== tree.parentIdentity) throw fail('OWNED_TREE_PARENT_CHANGED');
    const rows = tree.entries.toSorted((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'file' ? -1 : 1;
      return (
        right.relativePath.split(sep).length - left.relativePath.split(sep).length ||
        right.relativePath.localeCompare(left.relativePath)
      );
    });
    for (const row of rows) {
      const path = join(tree.rootPath, row.relativePath),
        stat = await present(path);
      if (!stat) {
        if (row.state === 'pending') throw fail('OWNED_TREE_ENTRY_MISSING');
        if (row.state !== 'removed') {
          tree.parentSync = await sync(dirname(path));
          row.state = 'removed';
          await options.persist(tree);
        }
        continue;
      }
      for (const ancestor of tree.entries.filter(
        entry =>
          entry.kind === 'directory' &&
          entry.relativePath !== row.relativePath &&
          (!entry.relativePath || row.relativePath.startsWith(entry.relativePath + sep)),
      )) {
        const current = await present(join(tree.rootPath, ancestor.relativePath));
        if (
          !current ||
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          identity(current) !== ancestor.identity
        )
          throw fail('OWNED_TREE_DIRECTORY_CHANGED');
      }
      if (
        row.state === 'removed' ||
        stat.isSymbolicLink() ||
        identity(stat) !== row.identity ||
        (row.kind === 'file' ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
      )
        throw fail('OWNED_TREE_ENTRY_CHANGED');
      const remove = async () => {
        if (row.kind === 'file') {
          const proof = await fileProof(path);
          if (
            proof.identity !== row.identity ||
            proof.bytes !== row.bytes ||
            proof.hash !== row.hash
          )
            throw fail('OWNED_TREE_FILE_CHANGED');
        } else if ((await readdir(path)).length) throw fail('OWNED_TREE_DIRECTORY_CHANGED');
        row.state = 'deleting';
        await options.persist(tree);
        if (row.kind === 'file') {
          const proof = await fileProof(path);
          if (
            proof.identity !== row.identity ||
            proof.bytes !== row.bytes ||
            proof.hash !== row.hash
          )
            throw fail('OWNED_TREE_FILE_CHANGED');
        }
        // The retained ancestor narrows pathname replacement races. Same-owner processes can
        // still mutate a checked inode between the proof and unlink; this is not an OS sandbox.
        const current = await lstat(path, { bigint: true });
        if (
          identity(current) !== row.identity ||
          current.isSymbolicLink() ||
          (row.kind === 'file' && current.nlink !== 1n)
        )
          throw fail('OWNED_TREE_ENTRY_CHANGED');
        if (row.kind === 'file') await unlink(path);
        else await rmdir(path);
        await options.afterUnlink?.(row.relativePath);
        tree.parentSync = await sync(dirname(path));
        row.state = 'removed';
        await options.persist(tree);
      };
      // Keep every remaining ancestor bound while deleting a leaf. The root itself is deleted
      // under its retained parent, after all exact inventoried descendants have been removed.
      await withRetainedDirectoryChain(tree.parentPath, dirname(path), remove);
    }
    await parentAuthority.verify();
  });
  return tree;
};
