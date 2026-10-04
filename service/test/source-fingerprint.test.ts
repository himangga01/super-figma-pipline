import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { spawnHermeticGit } from '../scripts/hermetic-git.mjs';
import { sourceFingerprint } from '../scripts/source-fingerprint.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('distinguishes a missing tracked source from an existing empty file', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'sfp-source-fingerprint-'));
  roots.push(repository);
  const service = join(repository, 'service');
  await mkdir(service);
  const input = join(service, 'source.ts');
  await writeFile(input, '');
  spawnHermeticGit(repository, ['init']);
  spawnHermeticGit(repository, ['add', '.']);
  const empty = await sourceFingerprint(service);
  await unlink(input);
  const missing = await sourceFingerprint(service);
  expect(missing).not.toBe(empty);
  await writeFile(input, '');
  expect(await sourceFingerprint(service)).toBe(empty);
});
