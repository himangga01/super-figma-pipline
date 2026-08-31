import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { AtomicFileStore, withCanonicalPathMutex } from '../../src/fs/atomic-file.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

describe('exclusive atomic file publication', () => {
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
      code: 'ATOMIC_FILE_EXISTS',
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
      code: 'ATOMIC_TARGET_ALIAS',
    });
    await expect(readFile(alias, 'utf8')).resolves.toBe('value');
  });

  it('serializes one canonical path across independent child processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-process-lock-'));
    roots.push(root);
    const target = join(root, 'authority.jsonl');
    const counter = join(root, 'counter.txt');
    await writeFile(counter, '0');
    const moduleUrl = pathToFileURL(
      resolve(import.meta.dirname, '../../src/fs/atomic-file.ts'),
    ).href;
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
      JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, createdAt: 0, token: 'a'.repeat(32) }),
    );
    let entered = false;
    await withCanonicalPathMutex(target, async () => {
      entered = true;
    });
    expect(entered).toBe(true);
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
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
      const moduleUrl = pathToFileURL(
        resolve(import.meta.dirname, '../../src/fs/atomic-file.ts'),
      ).href;
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
    const moduleUrl = pathToFileURL(
      resolve(import.meta.dirname, '../../src/fs/atomic-file.ts'),
    ).href;
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
