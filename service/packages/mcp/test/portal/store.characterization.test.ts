import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { portalFixture } from './fixtures.js';

/*
 * OPS-2 originally reproduced exhaustion on the 65th signed-record replacement. M01 now
 * reclaims obsolete PortalStore generations through byte-bound durable cleanup intents.
 * Bare AtomicFileStore callers still retain recovery material unless they explicitly prove
 * that a published successor makes it obsolete.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const schema = z.object({ value: z.number().int() }).strict();
const retainedNames = async (directory: string) =>
  (await readdir(directory)).filter(name => name.endsWith('.replace-retained'));

it('OPS-2 regression: the 65th signed PortalStore update succeeds with obsolete generations reclaimed', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await fixture.store.create('runs', 'ops-2', { value: 0 }, schema);
  for (let value = 1; value <= 64; value += 1)
    await fixture.store.update('runs', 'ops-2', schema, () => ({ value }));
  expect(await fixture.store.get('runs', 'ops-2', schema)).toEqual({ value: 64 });
  const directory = join(fixture.stateRoot, 'portal', 'runs');
  expect(await retainedNames(directory)).toHaveLength(0);

  await expect(
    fixture.store.update('runs', 'ops-2', schema, () => ({ value: 65 })),
  ).resolves.toEqual({ value: 65 });
  expect(await fixture.store.get('runs', 'ops-2', schema)).toEqual({ value: 65 });
  expect(await retainedNames(directory)).toHaveLength(0);
  await expect(
    fixture.store.update('runs', 'ops-2', schema, () => ({ value: 66 })),
  ).resolves.toEqual({ value: 66 });
}, 120_000);

it('retains the default AtomicFileStore recovery budget until a caller authorizes obsolete-generation reclamation', async () => {
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
