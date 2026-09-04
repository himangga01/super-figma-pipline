import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RepoReader, walkRepoFiles, type WalkOptions } from '../../src/fs/repo-walk.js';

const sandboxes: string[] = [];

const repository = async (members: Readonly<Record<string, string>>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-repo-reader-'));
  sandboxes.push(root);
  for (const [relativePath, bytes] of Object.entries(members)) {
    await mkdir(join(root, relativePath, '..'), { recursive: true });
    await writeFile(join(root, relativePath), bytes);
  }
  return root;
};

const filesFromGenerator = async (root: string, options?: WalkOptions): Promise<string[]> => {
  const files: string[] = [];
  for await (const relativePath of walkRepoFiles(root, options)) files.push(relativePath);
  return files;
};

afterEach(async () =>
  Promise.all(sandboxes.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('RepoReader bounded traversal', () => {
  it('prunes baseline dependency/vendor directories without relying on gitignore', async () => {
    const root = await repository({
      'src/Button.tsx': 'owned',
      'node_modules/pkg/Dependency.tsx': 'foreign',
      'vendor/pkg/Vendored.tsx': 'foreign',
    });
    const result = await new RepoReader({ rootDir: root }).walk({ extensions: ['tsx'] });
    expect(result.files).toEqual(['src/Button.tsx']);
    expect(result.skipped).toBe(2);
  });

  it('applies gitignore directory/glob rules and their explicit negation', async () => {
    const root = await repository({
      '.gitignore': 'generated/\n*.draft.tsx\n!Keep.draft.tsx\n',
      'src/Card.tsx': 'owned',
      'generated/Generated.tsx': 'foreign',
      'src/Drop.draft.tsx': 'foreign',
      'src/Keep.draft.tsx': 'owned',
    });
    await expect(
      new RepoReader({ rootDir: root }).walk({ extensions: ['.tsx'] }),
    ).resolves.toMatchObject({ files: ['src/Card.tsx', 'src/Keep.draft.tsx'] });
  });

  it('never returns dotfiles or descends dot-directories', async () => {
    const root = await repository({
      'src/Keep.ts': 'owned',
      '.root-secret.ts': 'foreign',
      'src/.child-secret.ts': 'foreign',
      '.storybook/Preview.ts': 'foreign',
      'src/.nested/Deep.ts': 'foreign',
    });
    const result = await new RepoReader({ rootDir: root }).walk({ extensions: ['.ts'] });
    expect(result.files).toEqual(['src/Keep.ts']);
    expect(result.skipped).toBeGreaterThanOrEqual(3);
  });

  it('returns regular files only and accepts an omitted extension filter', async () => {
    const root = await repository({
      'src/a.ts': 'a',
      'src/nested/b.css': 'b',
    });
    expect((await new RepoReader({ rootDir: root }).walk()).files).toEqual([
      'src/a.ts',
      'src/nested/b.css',
    ]);
  });

  it('walks a non-baseline generated directory when no ignore rule excludes it', async () => {
    const root = await repository({ 'src/A.tsx': 'a', 'generated/B.tsx': 'b' });
    expect((await new RepoReader({ rootDir: root }).walk({ extensions: ['.tsx'] })).files).toEqual([
      'generated/B.tsx',
      'src/A.tsx',
    ]);
  });

  it('caps returned files and reports bounded scan evidence', async () => {
    const members: Record<string, string> = { 'src/0-skip.css': 'skip' };
    for (let index = 0; index < 10; index += 1) members[`src/F${index}.tsx`] = 'owned';
    const root = await repository(members);
    const result = await new RepoReader({ rootDir: root }).walk({
      extensions: ['.tsx'],
      cap: 3,
    });
    expect(result).toMatchObject({
      files: ['src/F0.tsx', 'src/F1.tsx', 'src/F2.tsx'],
      truncated: true,
    });
    expect(result.scanned).toBeGreaterThanOrEqual(5);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('stops root/child enumeration at maxScanEntries without materializing the rest', async () => {
    const members: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) members[`src/F${index}.ts`] = 'owned';
    const root = await repository(members);
    const result = await new RepoReader({ rootDir: root }).walk({ maxScanEntries: 4 });
    expect(result).toMatchObject({ scanned: 4, truncated: true });
    expect(result.files.length).toBeLessThanOrEqual(3);
  });

  it('orders shallow paths first and ties by UTF-8/code-unit path order', async () => {
    const root = await repository({
      'src/a/b/deep.css': 'x',
      'src/index.css': 'x',
      'zz/later.css': 'x',
      'root.css': 'x',
      'B.css': 'x',
      'a.css': 'x',
      'é.css': 'x',
    });
    expect((await new RepoReader({ rootDir: root }).walk({ extensions: ['css'] })).files).toEqual([
      'B.css',
      'a.css',
      'root.css',
      'é.css',
      'src/index.css',
      'zz/later.css',
      'src/a/b/deep.css',
    ]);
  });

  it('returns the same sequence for repeated reads of an unchanged tree', async () => {
    const members: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) {
      members[`pkg${index}/a.css`] = 'a';
      members[`pkg${index}/nested/b.css`] = 'b';
    }
    const root = await repository(members);
    const reader = new RepoReader({ rootDir: root });
    const runs = await Promise.all(
      Array.from({ length: 5 }, async () => (await reader.walk({ extensions: ['css'] })).files),
    );
    expect(new Set(runs.map(files => files.join('\n'))).size).toBe(1);
  });

  it('rejects a junction/reparse directory instead of reading through it', async () => {
    const root = await repository({ 'owned/Secret.ts': 'owned' });
    await mkdir(join(root, 'src'), { recursive: true });
    try {
      await symlink(
        join(root, 'owned'),
        join(root, 'src', 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(
      new RepoReader({ rootDir: root }).readText('src/linked/Secret.ts'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
  });

  it('enforces one operation-wide total-byte budget across multiple bounded reads', async () => {
    const root = await repository({ 'a.ts': 'aaa', 'b.ts': 'bbb' });
    const reader = new RepoReader({ rootDir: root, maxTotalBytes: 5 } as never);

    await expect(reader.readText('a.ts')).resolves.toBe('aaa');
    await expect(reader.readText('b.ts')).rejects.toMatchObject({
      code: 'REPO_TOTAL_BYTES_EXCEEDED',
      beforeRead: true,
    });
  });

  it('honors AbortSignal before file IO and during bounded traversal', async () => {
    const root = await repository({ 'src/a.ts': 'a' });
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));
    const reader = new RepoReader({ rootDir: root, signal: controller.signal } as never);

    await expect(reader.readText('src/a.ts')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(reader.walk({ extensions: ['.ts'] })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('preserves ABORT_ERR when cancellation arrives after the file descriptor opens', async () => {
    const root = await repository({ 'large.ts': 'abcdef' });
    const controller = new AbortController();
    const reader = new RepoReader({
      rootDir: root,
      signal: controller.signal,
      afterFileOpen: async () => controller.abort(new Error('cancelled mid-read')),
    } as never);

    await expect(reader.readText('large.ts')).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    });
  });

  it('charges actual growth against the global byte budget before max-plus-one is read', async () => {
    const root = await repository({ 'growing.ts': 'a' });
    const reader = new RepoReader({
      rootDir: root,
      maxFileBytes: 100,
      maxTotalBytes: 5,
      afterFileOpen: async () => writeFile(join(root, 'growing.ts'), 'abcdef'),
    } as never);

    await expect(reader.readText('growing.ts')).rejects.toMatchObject({
      code: 'REPO_TOTAL_BYTES_EXCEEDED',
    });
  });
});

describe('walkRepoFiles compatibility generator', () => {
  it('delegates to the same sandbox, extension filter, and deterministic ordering', async () => {
    const root = await repository({ 'b.css': 'b', 'a.css': 'a', 'c.ts': 'c' });
    expect(await filesFromGenerator(root, { extensions: ['.css'] })).toEqual(['a.css', 'b.css']);
  });
});
