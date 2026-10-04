import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { AtomicFileStore } from '../../src/fs/atomic-file.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-replace-remediation-'));
  roots.push(root);
  const target = join(root, 'record.json');
  await writeFile(target, 'old');
  return { root, target };
};

it('preserves an in-place edit at its visible path before replacement commit', async () => {
  const { target } = await fixture();
  const store = new AtomicFileStore({
    beforeReplaceCommit: async () => {
      await writeFile(target, 'user edit');
    },
  });
  await expect(
    store.replace(target, Buffer.from('new'), {
      destructiveApproved: true,
      expectedDigest64: digest('old'),
    }),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(await readFile(target, 'utf8')).toBe('user edit');
});

it.each([false, true])(
  'restores a moved edited generation only into an absent visible path (successor=%s)',
  async successor => {
    const { root, target } = await fixture();
    const retained = join(root, `.record.json.${digest('old')}.${digest('new')}.replace-retained`);
    const store = new AtomicFileStore({
      afterReplaceQuarantineRenameBeforeFsync: async () => {
        await writeFile(retained, 'user edit');
        if (successor) await writeFile(target, 'newer target', { flag: 'wx' });
      },
    });
    await expect(
      store.replace(target, Buffer.from('new'), {
        destructiveApproved: true,
        expectedDigest64: digest('old'),
      }),
    ).rejects.toMatchObject({
      code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
      committed: true,
      cause: { code: 'TARGET_CHANGED' },
    });
    expect(await readFile(target, 'utf8')).toBe(successor ? 'newer target' : 'user edit');
    const recovered = await readFile(retained, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    expect(recovered).toBe(successor ? 'user edit' : null);
  },
);

it('reclaims obsolete owned generations under a one-row budget across more than 64 replacements', async () => {
  const { root, target } = await fixture();
  const store = new AtomicFileStore({
    reclaimRetainedAfterPublish: true,
    retainedReplaceLimits: { maxRows: 1, maxBytes: 64, maxScanEntries: 12 },
  });
  let current = 'old';
  for (let count = 0; count < 70; count += 1) {
    const next = `generation-${count}`;
    await store.replace(target, Buffer.from(next), {
      destructiveApproved: true,
      expectedDigest64: digest(current),
    });
    current = next;
  }
  expect(await readFile(target, 'utf8')).toBe('generation-69');
  expect(await readdir(root)).toEqual(['record.json']);
}, 60_000);

it.each(['afterReplaceCleanupIntentFsync', 'afterReplaceRetainedUnlinkFsync'] as const)(
  'resumes reclamation after interruption at %s',
  async hook => {
    const { root, target } = await fixture();
    const store = new AtomicFileStore({
      reclaimRetainedAfterPublish: true,
      [hook]: async () => {
        throw new Error('interrupted cleanup');
      },
    });
    await expect(
      store.replace(target, Buffer.from('new'), {
        destructiveApproved: true,
        expectedDigest64: digest('old'),
      }),
    ).rejects.toMatchObject({ committed: true });
    expect((await readdir(root)).some(name => name.endsWith('.replace-cleanup'))).toBe(true);
    await new AtomicFileStore({ reclaimRetainedAfterPublish: true }).replace(
      target,
      Buffer.from('newer'),
      { destructiveApproved: true, expectedDigest64: digest('new') },
    );
    expect(await readFile(target, 'utf8')).toBe('newer');
    expect(await readdir(root)).toEqual(['record.json']);
  },
);

it('preserves retained bytes edited after the durable cleanup intent', async () => {
  const { root, target } = await fixture();
  const retained = join(root, `.record.json.${digest('old')}.${digest('new')}.replace-retained`);
  const store = new AtomicFileStore({
    reclaimRetainedAfterPublish: true,
    afterReplaceCleanupIntentFsync: async () => {
      await writeFile(retained, 'user edit');
    },
  });
  await expect(
    store.replace(target, Buffer.from('new'), {
      destructiveApproved: true,
      expectedDigest64: digest('old'),
    }),
  ).rejects.toMatchObject({
    code: 'ATOMIC_COMMIT_OUTCOME_UNKNOWN',
    committed: true,
    cause: { code: 'TARGET_CHANGED' },
  });
  expect(await readFile(retained, 'utf8')).toBe('user edit');
  expect(await readFile(target, 'utf8')).toBe('new');
});

it('reclaims a previously published generation when migrating to the bounded policy', async () => {
  const { root, target } = await fixture();
  await new AtomicFileStore().replace(target, Buffer.from('current'), {
    destructiveApproved: true,
    expectedDigest64: digest('old'),
  });
  await new AtomicFileStore({
    reclaimRetainedAfterPublish: true,
    verifyRetainedForReclamation: async bytes => {
      if (Buffer.from(bytes).toString('utf8') !== 'old') throw new Error('unowned old metadata');
    },
    retainedReplaceLimits: { maxRows: 1, maxBytes: 64, maxScanEntries: 12 },
  }).replace(target, Buffer.from('next'), {
    destructiveApproved: true,
    expectedDigest64: digest('current'),
  });
  expect(await readFile(target, 'utf8')).toBe('next');
  expect(await readdir(root)).toEqual(['record.json']);
});

it('retries the exact interrupted replacement after cleanup intent recovery', async () => {
  const { root, target } = await fixture();
  const store = new AtomicFileStore({
    reclaimRetainedAfterPublish: true,
    afterReplaceCleanupIntentFsync: async () => {
      throw new Error('interrupted cleanup');
    },
  });
  await expect(
    store.replace(target, Buffer.from('new'), {
      destructiveApproved: true,
      expectedDigest64: digest('old'),
    }),
  ).rejects.toMatchObject({ committed: true });
  await expect(
    new AtomicFileStore({ reclaimRetainedAfterPublish: true }).replace(target, Buffer.from('new'), {
      destructiveApproved: true,
      expectedDigest64: digest('old'),
    }),
  ).resolves.toMatchObject({ bytes: 3 });
  expect(await readdir(root)).toEqual(['record.json']);
});

it.each(['bytes', 'scan'] as const)(
  'keeps the %s capacity boundary fail-closed before replacement',
  async boundary => {
    const { root, target } = await fixture();
    const store = new AtomicFileStore({
      reclaimRetainedAfterPublish: true,
      retainedReplaceLimits: {
        maxRows: 1,
        maxBytes: boundary === 'bytes' ? 2 : 64,
        maxScanEntries: boundary === 'scan' ? 1 : 12,
      },
    });
    await expect(
      store.replace(target, Buffer.from('new'), {
        destructiveApproved: true,
        expectedDigest64: digest('old'),
      }),
    ).rejects.toMatchObject({ code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED' });
    expect(await readFile(target, 'utf8')).toBe('old');
    expect(await readdir(root)).toEqual(['record.json']);
  },
);

it.each(['afterReplaceCleanupIntentFsync', 'afterReplaceRetainedUnlinkFsync'] as const)(
  'recovers a real child crash at %s from the durable intent',
  async hook => {
    const { root, target } = await fixture();
    const sourceRoot = resolve(import.meta.dirname, '../../src/fs');
    const moduleRoot = await mkdtemp(join(tmpdir(), 'sfp-replace-cleanup-child-'));
    roots.push(moduleRoot);
    const modulePath = join(moduleRoot, 'atomic-file.ts');
    await writeFile(
      modulePath,
      (await readFile(join(sourceRoot, 'atomic-file.ts'), 'utf8')).replace(
        "from './windows-directory-lease-broker.js';",
        "from './windows-directory-lease-broker.ts';",
      ),
    );
    await copyFile(
      join(sourceRoot, 'windows-directory-lease-broker.ts'),
      join(moduleRoot, 'windows-directory-lease-broker.ts'),
    );
    const script = `const { AtomicFileStore } = await import(${JSON.stringify(pathToFileURL(modulePath).href)}); await new AtomicFileStore({ reclaimRetainedAfterPublish: true, ${hook}: async () => process.exit(41) }).replace(process.env.SFP_CLEANUP_TARGET, Buffer.from('new'), { destructiveApproved: true, expectedDigest64: '${digest('old')}' });`;
    const child = spawn(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '-e', script],
      { env: { ...process.env, SFP_CLEANUP_TARGET: target }, stdio: 'ignore', windowsHide: true },
    );
    expect((await once(child, 'exit'))[0]).toBe(41);
    expect(await readFile(target, 'utf8')).toBe('new');
    await new Promise(done => setTimeout(done, 1_100));
    await new AtomicFileStore({ reclaimRetainedAfterPublish: true }).replace(
      target,
      Buffer.from('new'),
      { destructiveApproved: true, expectedDigest64: digest('old') },
    );
    expect(await readdir(root)).toEqual(['record.json']);
  },
);
