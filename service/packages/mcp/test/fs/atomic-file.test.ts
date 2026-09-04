import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AtomicFileStore,
  resolveWindowsPowerShellExecutable,
  withCanonicalPathMutex,
} from '../../src/fs/atomic-file.js';
import { withEvidenceRetentionMutex } from '../../src/fs/evidence-retention-authority.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const childAtomicModuleUrl = async (): Promise<string> => {
  const childModuleRoot = await mkdtemp(join(tmpdir(), 'sfp-atomic-child-module-'));
  roots.push(childModuleRoot);
  const sourceRoot = resolve(import.meta.dirname, '../../src/fs');
  const atomicSource = await readFile(join(sourceRoot, 'atomic-file.ts'), 'utf8');
  const childAtomicPath = join(childModuleRoot, 'atomic-file.ts');
  await writeFile(
    childAtomicPath,
    atomicSource.replace(
      "from './windows-directory-lease-broker.js';",
      "from './windows-directory-lease-broker.ts';",
    ),
  );
  await copyFile(
    join(sourceRoot, 'windows-directory-lease-broker.ts'),
    join(childModuleRoot, 'windows-directory-lease-broker.ts'),
  );
  return pathToFileURL(childAtomicPath).href;
};

describe('exclusive atomic file publication', () => {
  it('publishes the first evidence mutex through the retained evidence-root capability', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'sfp-evidence-mutex-authority-'));
    roots.push(sandbox);
    const workspaceRoot = join(sandbox, 'workspace');
    const evidenceRoot = join(workspaceRoot, '.sfp', 'operation-evidence');
    const displacedEvidenceRoot = join(sandbox, 'owned-evidence-root');
    const outside = join(sandbox, 'outside');
    await mkdir(workspaceRoot);
    await mkdir(outside);
    let replacementAttempted = false;
    let outsideWhileLocked: readonly string[] = [];

    await withEvidenceRetentionMutex(
      workspaceRoot,
      evidenceRoot,
      async authority => {
        outsideWhileLocked = await readdir(outside);
        await writeFile(authority.child('owned.txt'), 'owned');
      },
      {
        createMissing: true,
        beforeMutexAcquire: async () => {
          replacementAttempted = true;
          const script = String.raw`
            const fs = require('node:fs');
            try {
              fs.renameSync(process.argv[1], process.argv[2]);
              fs.symlinkSync(process.argv[3], process.argv[1], process.platform === 'win32' ? 'junction' : 'dir');
            } catch { process.exitCode = 2; }
          `;
          const child = spawn(
            process.execPath,
            ['-e', script, evidenceRoot, displacedEvidenceRoot, outside],
            { stdio: 'ignore', windowsHide: true },
          );
          await once(child, 'exit');
        },
      },
    ).catch(() => undefined);

    expect(replacementAttempted).toBe(true);
    expect(outsideWhileLocked).toEqual([]);
    expect(await readdir(outside)).toEqual([]);
    const ownedCopies = await Promise.all(
      [join(displacedEvidenceRoot, 'owned.txt'), join(evidenceRoot, 'owned.txt')].map(path =>
        readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }),
      ),
    );
    expect(ownedCopies.filter(value => value === 'owned').length).toBeLessThanOrEqual(1);
  });

  it('derives the directory-lease PowerShell executable from one validated absolute SystemRoot', () => {
    const executable = resolveWindowsPowerShellExecutable({ SystemRoot: 'C:\\Windows' });
    expect(executable).toBe(
      win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(isAbsolute(executable)).toBe(true);
    expect(() => resolveWindowsPowerShellExecutable({ SystemRoot: '.\\Windows' })).toThrowError(
      expect.objectContaining({ code: 'DIRECTORY_LEASE_EXECUTABLE_INVALID' }),
    );
  });

  it('publishes exactly one concurrent create without overwriting either payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-atomic-'));
    roots.push(root);
    const target = join(root, 'result.json');
    const store = new AtomicFileStore();
    const attempts = await Promise.allSettled([
      store.createNew(target, Buffer.from('first')),
      store.createNew(target, Buffer.from('second')),
    ]);

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await readFile(target, 'utf8')).toMatch(/^(?:first|second)$/u);
    await expect(store.createNew(target, Buffer.from('replacement'))).rejects.toMatchObject({
      code: 'TARGET_ALREADY_EXISTS',
    });
    expect(await readFile(target, 'utf8')).not.toBe('replacement');
  });

  it('rejects a hardlink alias created at publication instead of accepting nlink greater than two', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-atomic-alias-'));
    roots.push(root);
    const target = join(root, 'result.json');
    const alias = join(root, 'alias.json');
    const store = new AtomicFileStore({
      afterLink: async path => {
        await link(path, alias);
      },
    });

    await expect(store.createNew(target, Buffer.from('value'))).rejects.toMatchObject({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      cause: { code: 'ATOMIC_TARGET_ALIAS' },
    });
    await expect(readFile(alias, 'utf8')).resolves.toBe('value');
  });

  it.each(['afterLink', 'afterDirectoryFsync'] as const)(
    'marks a %s create-new failure as a typed committed outcome',
    async hook => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-create-committed-'));
      roots.push(root);
      const target = join(root, 'result.json');
      const store = new AtomicFileStore({
        [hook]: async () => {
          throw Object.assign(new Error('injected post-commit failure'), {
            code: 'TEST_POST_COMMIT_FAILURE',
          });
        },
      });

      await expect(store.createNew(target, Buffer.from('committed'))).rejects.toMatchObject({
        code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
        committed: true,
        path: target,
      });
      await expect(readFile(target, 'utf8')).resolves.toBe('committed');
    },
  );

  it('does not let temporary cleanup override the typed committed create-new failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-create-finally-override-'));
    roots.push(root);
    const target = join(root, 'result.json');
    const store = new AtomicFileStore({
      afterLink: async () => {
        const temporary = (await readdir(root)).find(name => name.endsWith('.sfp-tmp'))!;
        await rm(join(root, temporary));
        await mkdir(join(root, temporary));
      },
    });

    await expect(store.createNew(target, Buffer.from('committed'))).rejects.toMatchObject({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      path: target,
    });
    await expect(readFile(target, 'utf8')).resolves.toBe('committed');
  });

  it('verifies a published create-new target through its retained descriptor, never a swapped pathname', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-create-descriptor-proof-'));
    roots.push(root);
    const target = join(root, 'result.json');
    const displaced = join(root, 'owned.json');
    const outside = join(root, 'outside.bin');
    await writeFile(outside, Buffer.alloc(9 * 1_024 * 1_024, 0x66));
    const store = new AtomicFileStore({
      beforeCreateVerificationRead: async () => {
        await rename(target, displaced);
        await link(outside, target);
      },
    });

    const failure = await store.createNew(target, Buffer.from('owned')).then(
      () => null,
      error => error as Error & { code?: string; cause?: { code?: string } },
    );
    expect({ code: failure?.code, causeCode: failure?.cause?.code }).toEqual({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      causeCode: 'ATOMIC_TARGET_ALIAS',
    });
    await expect(readFile(displaced, 'utf8')).resolves.toBe('owned');
  });

  it('wraps a replace failure after quarantine mutation as committed outcome-unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replace-quarantine-truth-'));
    roots.push(root);
    const target = join(root, 'snapshot.json');
    const oldBytes = Buffer.from('old-generation');
    await writeFile(target, oldBytes);
    const store = new AtomicFileStore({
      afterReplaceQuarantineRenameBeforeFsync: async () => {
        throw Object.assign(new Error('injected quarantine boundary failure'), {
          code: 'TEST_QUARANTINE_BOUNDARY_FAILED',
        });
      },
    });

    await expect(
      store.replace(target, Buffer.from('next-generation'), {
        destructiveApproved: true,
        expectedDigest64: createHash('sha256').update(oldBytes).digest('hex'),
      }),
    ).rejects.toMatchObject({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      path: target,
    });
  });

  it('wraps replace verification/temp cleanup failure after publication as committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replace-published-cleanup-'));
    roots.push(root);
    const target = join(root, 'snapshot.json');
    const oldBytes = Buffer.from('old-generation');
    const nextBytes = Buffer.from('next-generation');
    const nextDigest = createHash('sha256').update(nextBytes).digest('hex');
    await writeFile(target, oldBytes);
    const temporary = join(root, `.snapshot.json.${nextDigest}.replace-new`);
    const store = new AtomicFileStore({
      afterReplacePublishFsync: async () => {
        await rm(temporary);
        await mkdir(temporary);
      },
    });

    await expect(
      store.replace(target, nextBytes, {
        destructiveApproved: true,
        expectedDigest64: createHash('sha256').update(oldBytes).digest('hex'),
      }),
    ).rejects.toMatchObject({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      path: target,
    });
    await expect(readFile(target)).resolves.toEqual(nextBytes);
  });

  it.each([
    ['prepared-temp-fsync', 'afterReplaceTemporaryFsync', 73],
    ['quarantine-rename-before-dir-fsync', 'afterReplaceQuarantineRenameBeforeFsync', 74],
  ] as const)(
    'recovers an actual child crash at replace %s idempotently',
    async (_label, hook, expectedExit) => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-replace-child-crash-'));
      roots.push(root);
      const target = join(root, 'snapshot.json');
      const oldBytes = Buffer.from('old-generation');
      const nextBytes = Buffer.from('new-generation');
      await writeFile(target, oldBytes);
      const moduleUrl = await childAtomicModuleUrl();
      const expectedDigest64 = createHash('sha256').update(oldBytes).digest('hex');
      const script = `
        const { AtomicFileStore } = await import(${JSON.stringify(moduleUrl)});
        await new AtomicFileStore({
          ${hook}: async () => process.exit(${expectedExit})
        }).replace(
          process.env.SFP_REPLACE_TARGET,
          Buffer.from('new-generation'),
          { destructiveApproved: true, expectedDigest64: process.env.SFP_REPLACE_OLD_DIGEST }
        );
      `;
      const child = spawn(
        process.execPath,
        ['--experimental-transform-types', '--input-type=module', '-e', script],
        {
          env: {
            ...process.env,
            SFP_REPLACE_TARGET: target,
            SFP_REPLACE_OLD_DIGEST: expectedDigest64,
          },
          stdio: 'ignore',
        },
      );
      expect((await once(child, 'exit'))[0]).toBe(expectedExit);

      const store = new AtomicFileStore();
      await expect(
        store.replace(target, nextBytes, { destructiveApproved: true, expectedDigest64 }),
      ).resolves.toMatchObject({ path: target, bytes: nextBytes.byteLength });
      await expect(
        store.replace(target, nextBytes, { destructiveApproved: true, expectedDigest64 }),
      ).resolves.toMatchObject({ path: target, bytes: nextBytes.byteLength });
      await expect(readFile(target)).resolves.toEqual(nextBytes);
      const rows = (await readdir(root)).filter(name => name.endsWith('.replace-retained'));
      expect(rows).toHaveLength(1);
    },
  );

  it('rejects retained replace capacity prospectively before creating one more generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replace-retained-cap-'));
    roots.push(root);
    const target = join(root, 'snapshot.json');
    const oldBytes = Buffer.from('old');
    const nextBytes = Buffer.from('next');
    const oldDigest = createHash('sha256').update(oldBytes).digest('hex');
    const previousNext = createHash('sha256').update('previous').digest('hex');
    await writeFile(target, oldBytes);
    await writeFile(
      join(root, `.snapshot.json.${oldDigest}.${previousNext}.replace-retained`),
      oldBytes,
    );
    const store = new AtomicFileStore({
      retainedReplaceLimits: { maxRows: 1, maxBytes: oldBytes.byteLength, maxScanEntries: 10 },
    } as never);

    await expect(
      store.replace(target, nextBytes, {
        destructiveApproved: true,
        expectedDigest64: oldDigest,
      }),
    ).rejects.toMatchObject({
      code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED',
      scannedEntries: 3,
      retainedRows: 1,
      retainedBytes: oldBytes.byteLength,
    });
    expect((await readdir(root)).some(name => name.endsWith('.replace-new'))).toBe(false);
    await expect(readFile(target)).resolves.toEqual(oldBytes);
  });

  it('rejects an oversized CAS source by descriptor metadata before body allocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replace-source-size-'));
    roots.push(root);
    const target = join(root, 'snapshot.json');
    await writeFile(target, '');
    await truncate(target, 8_388_609);
    let bodyReads = 0;
    const store = new AtomicFileStore({
      maxReplaceBytes: 8_388_608,
      beforeReplaceBodyRead: async () => {
        bodyReads += 1;
      },
    } as never);

    await expect(
      store.replace(target, Buffer.from('next'), {
        destructiveApproved: true,
        expectedDigest64: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'REPLACE_SOURCE_SIZE_LIMIT_EXCEEDED',
      beforeRead: true,
      bytesRead: 0,
    });
    expect(bodyReads).toBe(0);
  });

  it.each(['symlink', 'directory'] as const)(
    'rejects a CAS recovery %s before following or reading the target body',
    async targetKind => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-replace-recovery-nofollow-'));
      roots.push(root);
      const target = join(root, 'snapshot.json');
      const outside = join(root, 'outside.bin');
      const oldBytes = Buffer.from('old');
      const nextBytes = Buffer.from('next');
      const oldDigest = createHash('sha256').update(oldBytes).digest('hex');
      const nextDigest = createHash('sha256').update(nextBytes).digest('hex');
      await writeFile(
        join(root, `.snapshot.json.${oldDigest}.${nextDigest}.replace-retained`),
        oldBytes,
      );
      await writeFile(join(root, `.snapshot.json.${nextDigest}.replace-new`), nextBytes);
      if (targetKind === 'symlink') {
        await writeFile(outside, 'foreign');
        try {
          await symlink(outside, target, 'file');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }
      } else {
        await mkdir(target);
      }
      let bodyReads = 0;
      const store = new AtomicFileStore({
        maxReplaceBytes: 8_388_608,
        beforeReplaceBodyRead: async (path: string) => {
          if (path === target) bodyReads += 1;
        },
      } as never);

      await expect(
        store.replace(target, nextBytes, {
          destructiveApproved: true,
          expectedDigest64: oldDigest,
        }),
      ).rejects.toMatchObject({
        code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
        cause: { code: 'TARGET_CHANGED', beforeRead: true, bytesRead: 0 },
      });
      expect(bodyReads).toBe(0);
      const outsideContent = targetKind === 'symlink' ? await readFile(outside, 'utf8') : null;
      expect(outsideContent).toBe(targetKind === 'symlink' ? 'foreign' : null);
    },
  );

  it('serializes one canonical path across independent child processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-process-lock-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const counter = join(root, 'counter.txt');
    await writeFile(counter, '0');
    const moduleUrl = await childAtomicModuleUrl();
    const script = `
      import { readFile, writeFile } from 'node:fs/promises';
      const { withCanonicalPathMutex } = await import(${JSON.stringify(moduleUrl)});
      await withCanonicalPathMutex(process.env.SFP_LOCK_TARGET, async () => {
        const value = Number(await readFile(process.env.SFP_LOCK_COUNTER, 'utf8'));
        await new Promise(resolve => setTimeout(resolve, 100));
        await writeFile(process.env.SFP_LOCK_COUNTER, String(value + 1));
      });
    `;
    const children = Array.from({ length: 2 }, () =>
      spawn(
        process.execPath,
        ['--experimental-transform-types', '--input-type=module', '-e', script],
        {
          env: { ...process.env, SFP_LOCK_TARGET: target, SFP_LOCK_COUNTER: counter },
          stdio: 'ignore',
        },
      ),
    );
    const exits = await Promise.all(children.map(async child => (await once(child, 'exit'))[0]));
    expect(exits).toEqual([0, 0]);
    await expect(readFile(counter, 'utf8')).resolves.toBe('2');
  });

  it('recovers a dead stale filesystem lock before entering the authority section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-stale-lock-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const lockPath = `${target}.sfp-lock`;
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: 2,
        pid: 2_147_483_647,
        processStartIdentity: 'dead-process-start',
        createdAt: 0,
        token: 'a'.repeat(32),
      }),
    );
    let entered = false;
    await withCanonicalPathMutex(target, async () => {
      entered = true;
    });
    expect(entered).toBe(true);
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims a stale lock when a live PID has a different process-start identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-reused-pid-lock-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const lockPath = `${target}.sfp-lock`;
    await writeFile(
      lockPath,
      `${JSON.stringify({
        schemaVersion: 2,
        pid: process.pid,
        processStartIdentity: 'old-process-start',
        createdAt: 0,
        token: 'b'.repeat(32),
      })}\n`,
    );
    let entered = false;

    await withCanonicalPathMutex(
      target,
      async () => {
        entered = true;
      },
      { processStartIdentity: async () => 'current-process-start' },
    );

    expect(entered).toBe(true);
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when a live lock owner process-start identity cannot be proven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-unproven-pid-lock-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const lockPath = `${target}.sfp-lock`;
    const ownerBytes = `${JSON.stringify({
      schemaVersion: 2,
      pid: process.pid,
      processStartIdentity: 'other-process-start',
      createdAt: 0,
      token: 'c'.repeat(32),
    })}\n`;
    await writeFile(lockPath, ownerBytes);
    let probes = 0;

    await expect(
      withCanonicalPathMutex(target, async () => 'must-not-enter', {
        timeoutMs: 30,
        processStartIdentity: async () => {
          probes += 1;
          return probes === 1 ? 'current-process-start' : null;
        },
      }),
    ).rejects.toMatchObject({ code: 'PATH_LOCK_TIMEOUT' });
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(ownerBytes);
  });

  it.each([
    ['prepared-before-publish', 'afterOwnerSyncBeforePublish', 71, false],
    ['published-before-owner-entry', 'afterPublishBeforeTempUnlink', 72, true],
  ] as const)(
    'recovers a child crash at the %s lock publication boundary without exposing partial owner bytes',
    async (_label, hook, expectedExit, published) => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-lock-publication-crash-'));
      roots.push(root);
      const target = join(root, 'authority.jsonl');
      const lockPath = `${target}.sfp-lock`;
      const moduleUrl = await childAtomicModuleUrl();
      const script = `
        const { withCanonicalPathMutex } = await import(${JSON.stringify(moduleUrl)});
        await withCanonicalPathMutex(process.env.SFP_LOCK_TARGET, async () => undefined, {
          ${hook}: async () => process.exit(${expectedExit})
        });
      `;
      const child = spawn(
        process.execPath,
        ['--experimental-transform-types', '--input-type=module', '-e', script],
        { env: { ...process.env, SFP_LOCK_TARGET: target }, stdio: 'ignore' },
      );
      const exit = (await once(child, 'exit'))[0];

      expect(exit).toBe(expectedExit);
      const ownerBytes = await readFile(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      let validOwner = false;
      if (ownerBytes !== null) {
        try {
          JSON.parse(ownerBytes.toString('utf8'));
          validOwner = ownerBytes.byteLength > 0;
        } catch {
          validOwner = false;
        }
      }
      expect(ownerBytes !== null).toBe(published);
      expect(validOwner).toBe(published);
      await new Promise(done => setTimeout(done, published ? 1_100 : 0));
      await expect(withCanonicalPathMutex(target, async () => 'recovered')).resolves.toBe(
        'recovered',
      );
      await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('never steals a live child owner while waiting on the same canonical path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-live-lock-owner-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const lockPath = `${target}.sfp-lock`;
    const moduleUrl = await childAtomicModuleUrl();
    const script = `
      const { withCanonicalPathMutex } = await import(${JSON.stringify(moduleUrl)});
      await withCanonicalPathMutex(process.env.SFP_LOCK_TARGET, async () => {
        process.stdout.write('entered\\n');
        await new Promise(resolve => setTimeout(resolve, 300));
      });
    `;
    const child = spawn(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '-e', script],
      { env: { ...process.env, SFP_LOCK_TARGET: target }, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await once(child.stdout!, 'data');
    const liveOwner = await readFile(lockPath);
    await expect(
      withCanonicalPathMutex(target, async () => 'stolen', { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: 'PATH_LOCK_TIMEOUT' });
    await expect(readFile(lockPath)).resolves.toEqual(liveOwner);
    expect((await once(child, 'exit'))[0]).toBe(0);
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
