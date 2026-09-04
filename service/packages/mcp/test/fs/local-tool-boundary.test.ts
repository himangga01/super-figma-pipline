import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AtomicFileStore, WorkspaceAtomicFileStore } from '../../src/fs/atomic-file.js';
import { RepoReader } from '../../src/fs/repo-walk.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const workspaceAuthority = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-local-boundary-'));
  roots.push(root);
  const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
  const canonical = await realpath(root);
  const workspacePolicy = createWorkspacePolicy(
    {
      list: async () => [
        {
          workspaceId,
          path: canonical,
          realPath: canonical,
          addedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
    { boundaryInspector: { assertSafe: async () => undefined } },
  );
  return { root, workspaceId, workspacePolicy };
};

describe('sandboxed local tool filesystem boundary', () => {
  it('rejects a symlinked source file returned by repo walking', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-local-boundary-outside-'));
    roots.push(outside);
    const outsideFile = join(outside, 'foreign.ts');
    const linked = join(root, 'src', 'escape.ts');
    await mkdir(dirname(linked), { recursive: true });
    await writeFile(outsideFile, 'foreign');
    try {
      await symlink(outsideFile, linked, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    const reader = new RepoReader({ rootDir: root, workspaceId, workspacePolicy });

    await expect(reader.readText('src/escape.ts')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('foreign');
  });

  it('rejects traversal and absolute aliases before reading any bytes', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const reader = new RepoReader({ rootDir: root, workspaceId, workspacePolicy });

    await expect(reader.readText('../outside.txt')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(reader.readText(join(root, 'absolute.txt'))).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
  });

  it('publishes create-new only through the exclusive link primitive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-create-new-race-'));
    roots.push(root);
    const target = join(root, 'result.json');
    const foreign = Buffer.from('foreign');
    const store = new AtomicFileStore({
      beforeLink: async (path: string) => {
        await writeFile(path, foreign, { flag: 'wx' });
      },
    } as never);

    await expect(store.createNew(target, Buffer.from('owned'))).rejects.toMatchObject({
      code: 'TARGET_ALREADY_EXISTS',
    });
    await expect(readFile(target)).resolves.toEqual(foreign);
    expect((await lstat(target)).nlink).toBe(1);
  });

  it('CAS replace preserves both the expected old inode and a racing foreign winner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-cas-replace-race-'));
    roots.push(root);
    const target = join(root, 'snapshot.json');
    const displaced = join(root, 'snapshot-owned-before-race.json');
    const oldBytes = Buffer.from('old-owned');
    const foreign = Buffer.from('foreign-winner');
    await writeFile(target, oldBytes);
    const store = new AtomicFileStore({
      beforeReplaceCommit: async (path: string) => {
        await rename(path, displaced);
        await writeFile(path, foreign, { flag: 'wx' });
      },
    } as never);

    await expect(
      store.replace(target, Buffer.from('new-owned'), {
        destructiveApproved: true,
        expectedDigest64: createHash('sha256').update(oldBytes).digest('hex'),
      }),
    ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
    await expect(Promise.all([readFile(displaced), readFile(target)])).resolves.toEqual([
      oldBytes,
      foreign,
    ]);
  });

  it('resolves every output through WorkspacePolicy before creating parent directories', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const files = new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy,
      atomicFiles: new AtomicFileStore(),
    });
    const outside = join(dirname(root), 'outside-created-by-tool.txt');

    await expect(
      files.createNew(join('..', 'outside-created-by-tool.txt'), Buffer.from('no')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
    await expect(readFile(outside)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates no missing parent segment before retaining the registered workspace root', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const firstParent = join(root, 'generated');
    let existedBeforeAuthority = true;
    const files = new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy,
      atomicFiles: new AtomicFileStore(),
      beforeParentUse: async () => {
        existedBeforeAuthority = await lstat(firstParent).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        );
        throw Object.assign(new Error('stop after authority observation'), {
          code: 'TEST_AUTHORITY_OBSERVED',
        });
      },
    });

    await expect(
      files.createNew('generated/deep/result.json', Buffer.from('owned')),
    ).rejects.toMatchObject({ code: 'TEST_AUTHORITY_OBSERVED' });
    expect(existedBeforeAuthority).toBe(false);
    await expect(lstat(firstParent)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a registered-workspace prefix when RepoReader is rooted at a subproject', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const packageRoot = join(root, 'packages', 'ui');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), '{"name":"ui"}');

    const reader = new RepoReader({ rootDir: packageRoot, workspaceId, workspacePolicy });
    await expect(reader.readText('package.json')).resolves.toBe('{"name":"ui"}');
  });

  it('rejects an ancestor swap after validation but before opening a repo file', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-reader-swap-outside-'));
    roots.push(outside);
    const source = join(root, 'src');
    const displaced = join(root, 'src-owned');
    await mkdir(source);
    await writeFile(join(source, 'entry.ts'), 'owned');
    await writeFile(join(outside, 'entry.ts'), 'foreign');
    const reader = new RepoReader({
      rootDir: root,
      workspaceId,
      workspacePolicy,
      beforeFileOpen: async () => {
        await rename(source, displaced);
        await symlink(outside, source, process.platform === 'win32' ? 'junction' : 'dir');
      },
    } as never);

    await expect(reader.readText('src/entry.ts')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(readFile(join(outside, 'entry.ts'), 'utf8')).resolves.toBe('foreign');
  });

  it('rejects an ancestor swap after validation but before opening a walked directory', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-walk-swap-outside-'));
    roots.push(outside);
    const source = join(root, 'src');
    const displaced = join(root, 'src-owned');
    await mkdir(source);
    await writeFile(join(source, 'owned.ts'), 'owned');
    await writeFile(join(outside, 'foreign.ts'), 'foreign');
    const reader = new RepoReader({
      rootDir: root,
      workspaceId,
      workspacePolicy,
      beforeDirectoryOpen: async (relativePath: string) => {
        if (relativePath !== 'src') return;
        await rename(source, displaced);
        await symlink(outside, source, process.platform === 'win32' ? 'junction' : 'dir');
      },
    } as never);

    await expect(reader.walk({ extensions: ['.ts'] })).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
  });

  it('compares the actual opened walk descriptor and rejects swap-opendir-restore ABA', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-walk-aba-outside-'));
    roots.push(outside);
    const source = join(root, 'src');
    const displaced = join(root, 'src-owned');
    await mkdir(source);
    await writeFile(join(source, 'owned.ts'), 'owned');
    await writeFile(join(outside, 'foreign.ts'), 'foreign');
    let restored = false;
    const reader = new RepoReader({
      rootDir: root,
      workspaceId,
      workspacePolicy,
      beforeDirectoryOpen: async (relativePath: string) => {
        if (relativePath !== 'src') return;
        await rename(source, displaced);
        await symlink(outside, source, process.platform === 'win32' ? 'junction' : 'dir');
      },
      afterDirectoryOpen: async (relativePath: string) => {
        if (relativePath !== 'src') return;
        await rm(source, { recursive: true, force: true });
        await rename(displaced, source);
        restored = true;
      },
    } as never);

    await expect(reader.walk({ extensions: ['.ts'] })).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    expect(restored).toBe(true);
    await expect(readFile(join(outside, 'foreign.ts'), 'utf8')).resolves.toBe('foreign');
  });

  it('does not create an output through an ancestor swapped after policy validation', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-writer-swap-outside-'));
    roots.push(outside);
    const output = join(root, 'out');
    const displaced = join(root, 'out-owned');
    await mkdir(output);
    const files = new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy,
      atomicFiles: new AtomicFileStore(),
      beforeParentUse: async () => {
        await rename(output, displaced);
        await symlink(outside, output, process.platform === 'win32' ? 'junction' : 'dir');
      },
    } as never);

    await expect(
      files.createNew(join('out', 'result.json'), Buffer.from('owned')),
    ).rejects.toMatchObject({ code: expect.stringMatching(/PATH|TARGET|WORKSPACE/u) });
    await expect(readFile(join(outside, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('acquires retained parent authority after final resolve and before any create-new open/link', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-writer-final-swap-outside-'));
    roots.push(outside);
    const output = join(root, 'out');
    const displaced = join(root, 'out-owned');
    await mkdir(output);
    let temporaryOpened = false;
    const files = new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy,
      atomicFiles: new AtomicFileStore({
        afterTemporaryOpen: async () => {
          temporaryOpened = true;
        },
      } as never),
      afterFinalResolveBeforeUse: async () => {
        await rename(output, displaced);
        await symlink(outside, output, process.platform === 'win32' ? 'junction' : 'dir');
      },
    } as never);

    await expect(
      files.createNew(join('out', 'result.json'), Buffer.from('owned')),
    ).rejects.toMatchObject({ code: expect.stringMatching(/PATH|TARGET|WORKSPACE/u) });
    expect(temporaryOpened).toBe(false);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('keeps an external-process parent swap outside every retained create-new filesystem use', async () => {
    const { root, workspaceId, workspacePolicy } = await workspaceAuthority();
    const outside = await mkdtemp(join(tmpdir(), 'sfp-writer-process-swap-outside-'));
    roots.push(outside);
    const output = join(root, 'out');
    const displaced = join(root, 'out-owned');
    await mkdir(output);
    let externalSwapWon = false;
    const atomicFiles = new AtomicFileStore({
      afterTemporaryOpen: async () => {
        const script = String.raw`
          const fs = require('node:fs');
          try {
            fs.renameSync(process.argv[1], process.argv[2]);
            fs.symlinkSync(process.argv[3], process.argv[1], process.platform === 'win32' ? 'junction' : 'dir');
          } catch { process.exitCode = 2; }
        `;
        const child = spawn(process.execPath, ['-e', script, output, displaced, outside], {
          stdio: 'ignore',
          windowsHide: true,
        });
        const code = await new Promise<number | null>(resolveExit =>
          child.once('exit', resolveExit),
        );
        externalSwapWon = code === 0;
      },
    });
    const files = new WorkspaceAtomicFileStore({
      workspaceId,
      workspacePolicy,
      atomicFiles,
    });

    await files.createNew('out/result.json', Buffer.from('owned'));

    await expect(readdir(outside)).resolves.toEqual([]);
    await expect(
      readFile(join(externalSwapWon ? displaced : output, 'result.json'), 'utf8'),
    ).resolves.toBe('owned');
  });

  it.each(['after-quarantine', 'after-publication'] as const)(
    'recovers a replace crash at %s without losing the old or published generation',
    async crashPoint => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-replace-recovery-'));
      roots.push(root);
      const target = join(root, 'snapshot.json');
      const oldBytes = Buffer.from('old-generation');
      const newBytes = Buffer.from('new-generation');
      await writeFile(target, oldBytes);
      let armed = true;
      const crashing = new AtomicFileStore({
        afterReplaceQuarantineFsync:
          crashPoint === 'after-quarantine'
            ? async () => {
                if (!armed) return;
                armed = false;
                throw Object.assign(new Error('injected replace quarantine crash'), {
                  code: 'TEST_REPLACE_QUARANTINE_CRASH',
                });
              }
            : undefined,
        afterReplacePublishFsync:
          crashPoint === 'after-publication'
            ? async () => {
                if (!armed) return;
                armed = false;
                throw Object.assign(new Error('injected replace publication crash'), {
                  code: 'TEST_REPLACE_PUBLICATION_CRASH',
                });
              }
            : undefined,
      } as never);
      const options = {
        destructiveApproved: true,
        expectedDigest64: createHash('sha256').update(oldBytes).digest('hex'),
      };

      await expect(crashing.replace(target, newBytes, options)).rejects.toMatchObject({
        code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
        committed: true,
        cause: {
          code:
            crashPoint === 'after-quarantine'
              ? 'TEST_REPLACE_QUARANTINE_CRASH'
              : 'TEST_REPLACE_PUBLICATION_CRASH',
        },
      });
      await expect(new AtomicFileStore().replace(target, newBytes, options)).resolves.toMatchObject(
        {
          path: target,
          bytes: newBytes.byteLength,
        },
      );
      await expect(readFile(target)).resolves.toEqual(newBytes);
      const retained = (await readdir(root)).filter(name => name.endsWith('.replace-retained'));
      expect(retained).toHaveLength(1);
      await expect(readFile(join(root, retained[0] as string))).resolves.toEqual(oldBytes);
    },
  );
});
