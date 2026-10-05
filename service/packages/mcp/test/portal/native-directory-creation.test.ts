/* eslint-disable vitest/no-conditional-expect -- each collision kind requires its actual filesystem invariant */
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { publishWindowsDirectory } from '../../src/fs/windows-directory-publication.js';
import {
  prepareNativeDirectoryCreation,
  publishNativeDirectoryCreation,
  inspectNativeDirectoryCreation,
  type NativeDirectoryCreation,
} from '../../src/portal/native-directory-creation.js';
import { directoryIdentity } from '../../src/portal/native-resources.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const fixture = async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  let saved = await prepareNativeDirectoryCreation(
    f.workspaceRoot,
    join(f.workspaceRoot, '한국어-target'),
  );
  const options = {
    persist: async (next: NativeDirectoryCreation) => {
      saved = next;
    },
  };
  return { ...f, intent: saved, options, saved: () => saved };
};
it.runIf(process.platform === 'win32').each(['file', 'empty-directory'])(
  'the Windows handle publication refuses an existing foreign %s',
  async kind => {
    const f = await fixture();
    await mkdir(f.intent.stagingPath);
    const identity = await directoryIdentity(f.intent.stagingPath);
    if (kind === 'file') await writeFile(f.intent.path, 'foreign bytes');
    else await mkdir(f.intent.path);
    const outcome = await publishWindowsDirectory(
      f.intent.stagingPath,
      f.intent.path,
      identity,
    ).catch(error => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(
      await lstat(f.intent.stagingPath).then(
        () => directoryIdentity(f.intent.stagingPath),
        () => 'missing',
      ),
    ).toBe(identity);
    if (kind === 'file') expect(await readFile(f.intent.path, 'utf8')).toBe('foreign bytes');
    else expect((await lstat(f.intent.path)).isDirectory()).toBe(true);
  },
);
it.runIf(process.platform === 'win32')(
  'binds identity and parent sync before final publication',
  async () => {
    const f = await fixture();
    await expect(lstat(f.intent.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await inspectNativeDirectoryCreation(f.intent)).toEqual({
      state: 'pending-safe',
      identity: null,
    });
    await publishNativeDirectoryCreation(f.intent, {
      ...f.options,
      hooks: {
        afterIdentityPersist: async intent => {
          expect(f.saved().identity).toBe(await directoryIdentity(intent.stagingPath));
          expect(['succeeded', 'eperm-limited']).toContain(f.saved().parentSync);
          expect(await inspectNativeDirectoryCreation(f.saved())).toEqual({
            state: 'bound-stage',
            identity: intent.identity,
          });
          await expect(lstat(intent.path)).rejects.toMatchObject({ code: 'ENOENT' });
        },
      },
    });
    expect(f.saved().phase).toBe('published');
    expect(await directoryIdentity(f.intent.path)).toBe(f.saved().identity);
    expect(await inspectNativeDirectoryCreation(f.saved())).toEqual({
      state: 'bound-final',
      identity: f.saved().identity,
    });
    await expect(lstat(f.intent.stagingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it.runIf(process.platform === 'win32').each(['file', 'empty-directory', 'directory'] as const)(
  'preserves a foreign %s created after durable identity binding',
  async kind => {
    const f = await fixture();
    await expect(
      publishNativeDirectoryCreation(f.intent, {
        ...f.options,
        hooks: {
          afterIdentityPersist: async intent => {
            if (kind === 'file') await writeFile(intent.path, 'foreign bytes');
            else {
              await mkdir(intent.path);
              if (kind === 'directory')
                await writeFile(join(intent.path, 'foreign.txt'), 'foreign bytes');
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PORTAL_DIRECTORY_CREATION_CONFLICT', committed: true });
    expect(await directoryIdentity(f.intent.stagingPath)).toBe(f.saved().identity);
    if (kind === 'file') expect(await readFile(f.intent.path, 'utf8')).toBe('foreign bytes');
    else if (kind === 'directory')
      expect(await readFile(join(f.intent.path, 'foreign.txt'), 'utf8')).toBe('foreign bytes');
    else expect((await lstat(f.intent.path)).isDirectory()).toBe(true);
  },
);
it.runIf(process.platform === 'win32')(
  'quarantines an unbound existing stage without adopting it',
  async () => {
    const f = await fixture();
    await mkdir(f.intent.stagingPath);
    await writeFile(join(f.intent.stagingPath, 'foreign.txt'), 'preserve');
    expect(await inspectNativeDirectoryCreation(f.intent)).toEqual({
      state: 'quarantined',
      identity: null,
    });
    await expect(publishNativeDirectoryCreation(f.intent, f.options)).rejects.toMatchObject({
      code: 'PORTAL_DIRECTORY_CREATION_QUARANTINED',
      recoveryPath: f.intent.stagingPath,
      effectDisposition: 'outcome-unknown',
    });
    expect(f.saved().identity).toBeNull();
    expect(await readFile(join(f.intent.stagingPath, 'foreign.txt'), 'utf8')).toBe('preserve');
    await expect(lstat(f.intent.path)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it.runIf(process.platform === 'win32')(
  'rejects identity replacement while recovery waits',
  async () => {
    const f = await fixture();
    await expect(
      publishNativeDirectoryCreation(f.intent, {
        ...f.options,
        hooks: {
          afterIdentityPersist: async () => {
            throw Error('interrupted');
          },
        },
      }),
    ).rejects.toThrow('interrupted');
    await rename(f.intent.stagingPath, f.intent.stagingPath + '-owned');
    await mkdir(f.intent.stagingPath);
    await writeFile(join(f.intent.stagingPath, 'foreign.txt'), 'foreign bytes');
    expect(await inspectNativeDirectoryCreation(f.saved())).toEqual({
      state: 'conflict',
      identity: null,
    });
    await expect(publishNativeDirectoryCreation(f.saved(), f.options)).rejects.toMatchObject({
      code: 'PORTAL_DIRECTORY_CREATION_CONFLICT',
    });
    expect(await readFile(join(f.intent.stagingPath, 'foreign.txt'), 'utf8')).toBe('foreign bytes');
    expect(await directoryIdentity(f.intent.stagingPath + '-owned')).toBe(f.saved().identity);
  },
);
it.runIf(process.platform === 'win32')(
  'recovers a moved final inode after its published record write fails',
  async () => {
    const f = await fixture();
    await expect(
      publishNativeDirectoryCreation(f.intent, {
        ...f.options,
        hooks: {
          afterPublish: async () => {
            throw Error('after-publish');
          },
        },
      }),
    ).rejects.toMatchObject({ effectDisposition: 'partial-application', committed: true });
    expect(f.saved().phase).toBe('identity-bound');
    const identity = await directoryIdentity(f.intent.path);
    expect(await inspectNativeDirectoryCreation(f.saved())).toEqual({
      state: 'bound-final',
      identity,
    });
    const recovered = await publishNativeDirectoryCreation(f.saved(), f.options);
    expect(recovered.phase).toBe('published');
    expect(recovered.identity).toBe(identity);
  },
);
it.runIf(process.platform === 'win32')(
  'classifies an existing target prepare failure as proved no effect',
  async () => {
    const f = await fixture();
    await mkdir(f.intent.path);
    const identity = await directoryIdentity(f.intent.path);
    await expect(
      prepareNativeDirectoryCreation(f.workspaceRoot, f.intent.path),
    ).rejects.toMatchObject({
      code: 'PORTAL_DIRECTORY_CREATION_CONFLICT',
      effectDisposition: 'pre-effect-rejection',
      committed: false,
    });
    expect(await directoryIdentity(f.intent.path)).toBe(identity);
  },
);
it.runIf(process.platform === 'win32')(
  'publishes through an actual long Korean parent path',
  async () => {
    const f = await fixture();
    const parent = join(
      f.workspaceRoot,
      ...Array.from({ length: 5 }, (_, index) => `한국어-${index}-${'x'.repeat(45)}`),
    );
    expect(parent.length).toBeGreaterThan(260);
    await mkdir(parent, { recursive: true });
    const intent = await prepareNativeDirectoryCreation(parent, join(parent, 'new-root'));
    const published = await publishNativeDirectoryCreation(intent, {
      persist: async () => undefined,
    });
    expect(published.phase).toBe('published');
    expect(await directoryIdentity(intent.path)).toBe(published.identity);
  },
);
it.runIf(process.platform === 'win32')(
  'reads historical identity proof without granting an old program new effects',
  async () => {
    const f = await fixture();
    const published = await publishNativeDirectoryCreation(f.intent, f.options);
    const historical = { ...published, publicationProgramHash: `sha256:${'0'.repeat(64)}` };
    expect(await inspectNativeDirectoryCreation(historical)).toEqual({
      state: 'bound-final',
      identity: published.identity,
    });
    await expect(publishNativeDirectoryCreation(historical, f.options)).rejects.toMatchObject({
      code: 'PORTAL_DIRECTORY_CREATION_PROGRAM_CHANGED',
    });
    expect(await directoryIdentity(published.path)).toBe(published.identity);
  },
);
