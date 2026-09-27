import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { portalFixture } from './fixtures.js';

/*
 * T06a characterization of finding OPS-2 (remediation plan section 3.1). The fix is task T07.
 *
 * OPS-2: AtomicFileStore.replace keeps every previous generation of a file as a
 * `.replace-retained` sibling and never collects it (mcp/src/fs/atomic-file.ts:1825-1968). The
 * default capacity is 64 retained generations per directory scan (maxRows 64), and PortalStore
 * uses that default for every kind except `recipe-holds` and `environment-*`
 * (mcp/src/portal/store.ts:118-139). The 65th replacement of one record therefore fails. After
 * T07 gives PortalStore the `discard` retention mode, the 65th update must succeed, and these
 * tests must be flipped.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const schema = z.object({ value: z.number().int() }).strict();
const retainedNames = async (directory: string) =>
  (await readdir(directory)).filter(name => name.endsWith('.replace-retained'));

it('OPS-2 characterization: the 65th PortalStore update of one run record fails with REPLACE_RETAINED_CAPACITY_EXCEEDED (flip in T07)', async () => {
  // OPS-2, fixed by T07. Seam: the real signed PortalStore on a temporary state root; `runs` is
  // the kind that holds portal runs, and it uses the default retained-generation limits.
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await fixture.store.create('runs', 'ops-2', { value: 0 }, schema);
  for (let value = 1; value <= 64; value += 1)
    await fixture.store.update('runs', 'ops-2', schema, () => ({ value }));
  expect(await fixture.store.get('runs', 'ops-2', schema)).toEqual({ value: 64 });
  const directory = join(fixture.stateRoot, 'portal', 'runs');
  // Every successful update left its previous generation behind.
  expect(await retainedNames(directory)).toHaveLength(64);

  // Current behavior: the 65th update fails before publishing anything.
  await expect(
    fixture.store.update('runs', 'ops-2', schema, () => ({ value: 65 })),
  ).rejects.toMatchObject({
    code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED',
    retainedRows: 64,
  });
  expect(await fixture.store.get('runs', 'ops-2', schema)).toEqual({ value: 64 });
  expect(await retainedNames(directory)).toHaveLength(64);
  // The record stays wedged: later updates fail the same way.
  await expect(
    fixture.store.update('runs', 'ops-2', schema, () => ({ value: 66 })),
  ).rejects.toMatchObject({ code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED' });
}, 120_000);

it('OPS-2 characterization: a default AtomicFileStore replaces one file 64 times and fails the 65th with REPLACE_RETAINED_CAPACITY_EXCEEDED (flip in T07)', async () => {
  // OPS-2, fixed by T07. Seam: the bare AtomicFileStore that PortalStore delegates to, with its
  // default options. The control store differs only in allowing 65 retained generations.
  const root = await mkdtemp(join(tmpdir(), 'sfp-ops2-characterization-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const generation = (index: number) => Buffer.from(`generation ${index}\n`);
  const digest64 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const replaceSequence = async (store: AtomicFileStore, target: string) => {
    await writeFile(target, generation(0));
    for (let index = 1; index <= 64; index += 1)
      await store.replace(target, generation(index), {
        destructiveApproved: true,
        expectedDigest64: digest64(generation(index - 1)),
      });
    return store.replace(target, generation(65), {
      destructiveApproved: true,
      expectedDigest64: digest64(generation(64)),
    });
  };

  const defaultTarget = join(await mkdtemp(join(root, 'default-')), 'record.json');
  await expect(replaceSequence(new AtomicFileStore(), defaultTarget)).rejects.toMatchObject({
    code: 'REPLACE_RETAINED_CAPACITY_EXCEEDED',
    retainedRows: 64,
  });
  await expect(readFile(defaultTarget)).resolves.toEqual(generation(64));

  // Control: the failure is the retained-generation cap, not the replacement itself.
  const controlTarget = join(await mkdtemp(join(root, 'control-')), 'record.json');
  await expect(
    replaceSequence(
      new AtomicFileStore({
        retainedReplaceLimits: { maxRows: 65, maxBytes: 67_108_864, maxScanEntries: 10_000 },
      }),
      controlTarget,
    ),
  ).resolves.toMatchObject({ path: controlTarget });
  await expect(readFile(controlTarget)).resolves.toEqual(generation(65));
}, 120_000);
