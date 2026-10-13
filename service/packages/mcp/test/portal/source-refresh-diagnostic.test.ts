import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { Diagnostics, withDiagnostics } from '../../src/diagnostics.js';
import { PortalCaptureError } from '../../src/portal/capture-failure.js';
import { diagnosePortalLiveRefreshFailure } from '../../src/portal/native-work.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

it('writes the original safe capture failure stage/type/code/elapsed projection without private messages', async () => {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, 'sfp-refresh-log-'));
  const original = await lstat(root, { bigint: true }),
    originalParent = await lstat(parent, { bigint: true });
  const pathKey = (value: string) =>
    process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  cleanup.push(async () => {
    const stat = await lstat(root, { bigint: true }),
      parentStat = await lstat(parent, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== original.dev ||
      stat.ino !== original.ino ||
      parentStat.dev !== originalParent.dev ||
      parentStat.ino !== originalParent.ino ||
      pathKey(await realpath(root)) !== pathKey(root) ||
      pathKey(dirname(root)) !== pathKey(parent) ||
      !basename(root).startsWith('sfp-refresh-log-')
    )
      throw Error('TEST_CLEANUP_TARGET_CHANGED');
    await rm(root, { recursive: true, force: true });
  });
  const logger = new Diagnostics(root, 'daemon', { signal: () => {} }),
    runId = randomUUID();
  const cause = Object.assign(
    new TypeError('https://private.invalid/?token=synthetic-private-value'),
    { code: 'FIGMA_PAGE_IDENTITY_CHANGED' },
  );
  const error = new PortalCaptureError('snapshot', cause, Date.now() - 100);
  withDiagnostics(logger, {}, () => diagnosePortalLiveRefreshFailure(error, runId));
  expect(await logger.flush()).toBe(true);
  const rows = (await readFile(join(logger.directory, 'daemon.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const hash = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
  expect(rows).toContainEqual(
    expect.objectContaining({
      event: 'portal.native.live-refresh-failed',
      runId,
      errorCode: 'FIGMA_PAGE_IDENTITY_CHANGED',
      phaseHash: hash('snapshot'),
      functionNameHash: hash('type-error'),
      durationMs: error.diagnostic.elapsedMs,
    }),
  );
  expect(JSON.stringify(rows)).not.toContain('synthetic-private-value');
  expect(JSON.stringify(rows)).not.toContain('private.invalid');
  expect(rows.at(-1).error).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'FIGMA_PAGE_IDENTITY_CHANGED' })]),
  );
});
