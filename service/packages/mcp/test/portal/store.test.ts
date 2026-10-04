import { createHash, createHmac } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalJson } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { PortalStore } from '../../src/portal/store.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const schema = z.object({ value: z.number().int() }).strict();
it('migrates authentic historical signed generations at their previous capacity limit', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await fixture.store.create('runs', 'migration', { value: 0 }, schema);
  const path = join(fixture.stateRoot, 'portal', 'runs', 'migration.json');
  const oldWriter = new AtomicFileStore();
  for (let value = 1; value <= 64; value += 1) {
    const payload = { version: 1, kind: 'runs', id: 'migration', payload: { value } };
    const mac = createHmac('sha256', fixture.key)
      .update('sfp-portal-state-v1\0')
      .update(canonicalJson(payload))
      .digest('hex');
    const expectedDigest64 = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    await oldWriter.replace(path, Buffer.from(`${canonicalJson({ ...payload, mac })}\n`), {
      destructiveApproved: true,
      expectedDigest64,
    });
  }
  expect(
    (await readdir(join(path, '..'))).filter(name => name.endsWith('.replace-retained')),
  ).toHaveLength(64);
  await fixture.store.update('runs', 'migration', schema, () => ({ value: 65 }));
  expect(await fixture.store.get('runs', 'migration', schema)).toEqual({ value: 65 });
  expect(await readdir(join(path, '..'))).toEqual(['migration.json']);
}, 120_000);
it('updates signed owner state beyond 64 generations without retaining obsolete records', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await fixture.store.create('runs', 'long-lived', { value: 0 }, schema);
  for (let value = 1; value <= 70; value += 1) {
    await fixture.store.update('runs', 'long-lived', schema, () => ({ value }));
  }
  expect(await fixture.store.get('runs', 'long-lived', schema)).toEqual({ value: 70 });
  expect(await readdir(join(fixture.stateRoot, 'portal', 'runs'))).toEqual(['long-lived.json']);
}, 120_000);
it('fences writes from a closed leader while preserving read-only recovery access', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  let active = true;
  const store = new PortalStore(fixture.stateRoot, fixture.key, fixture.permissions, () => {
    if (!active) throw Object.assign(new Error('closed'), { code: 'LEADER_GENERATION_CLOSED' });
  });
  await store.create('runs', 'fenced', { value: 1 }, schema);
  active = false;
  await expect(store.update('runs', 'fenced', schema, () => ({ value: 2 }))).rejects.toMatchObject({
    code: 'LEADER_GENERATION_CLOSED',
  });
  expect(await store.get('runs', 'fenced', schema)).toEqual({ value: 1 });
});
it('serializes durable CAS updates and rejects tampered owner state', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await fixture.store.create('runs', 'test', { value: 0 }, schema);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      fixture.store.update('runs', 'test', schema, value => ({ value: value.value + 1 })),
    ),
  );
  expect(await fixture.store.get('runs', 'test', schema)).toEqual({ value: 4 });
  const path = join(fixture.stateRoot, 'portal/runs/test.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.payload.value = 100;
  await writeFile(path, JSON.stringify(record));
  await expect(fixture.store.get('runs', 'test', schema)).rejects.toMatchObject({
    code: 'PORTAL_RECORD_TAMPERED',
  });
});
it('rejects record path aliases and does not overwrite a signed record on create', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  await expect(
    fixture.store.create('runs', '../outside', { value: 0 }, schema),
  ).rejects.toMatchObject({ code: 'PORTAL_RECORD_ID_INVALID' });
  await fixture.store.create('runs', 'existing', { value: 1 }, schema);
  await expect(
    fixture.store.create('runs', 'existing', { value: 2 }, schema),
  ).rejects.toMatchObject({ code: 'TARGET_ALREADY_EXISTS' });
  expect(await fixture.store.get('runs', 'existing', schema)).toEqual({ value: 1 });
});
