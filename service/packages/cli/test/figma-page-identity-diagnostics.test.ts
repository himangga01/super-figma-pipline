import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import type { Page } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';

import { Diagnostics, withDiagnostics } from '../../mcp/src/diagnostics.js';
import { readFigmaPageSnapshot } from '../src/figma-page-reader.js';
import { parseFigmaTarget } from '../src/figma-url.js';

const target = parseFigmaTarget('https://www.figma.com/design/DiagnosticFixture0001?node-id=1-1');
const cleanup: Array<{
  root: string;
  parent: string;
  dev: bigint;
  ino: bigint;
  parentDev: bigint;
  parentIno: bigint;
}> = [];
const pathKey = (value: string) =>
  process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const entry of cleanup.splice(0)) {
    const stat = await lstat(entry.root, { bigint: true }),
      parentStat = await lstat(entry.parent, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      parentStat.dev !== entry.parentDev ||
      parentStat.ino !== entry.parentIno ||
      pathKey(await realpath(entry.root)) !== pathKey(entry.root) ||
      pathKey(dirname(entry.root)) !== pathKey(entry.parent) ||
      !basename(entry.root).startsWith('sfp-source-identity-log-')
    )
      throw Error('TEST_CLEANUP_TARGET_CHANGED');
    await rm(entry.root, { recursive: true, force: true });
  }
});
async function logFixture() {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(join(parent, 'sfp-source-identity-log-'));
  const stat = await lstat(root, { bigint: true }),
    parentStat = await lstat(parent, { bigint: true });
  cleanup.push({
    root,
    parent,
    dev: stat.dev,
    ino: stat.ino,
    parentDev: parentStat.dev,
    parentIno: parentStat.ino,
  });
  return new Diagnostics(root, 'daemon', { signal: () => {} });
}
async function written(logger: Diagnostics) {
  expect(await logger.flush()).toBe(true);
  return (await readFile(join(logger.directory, 'daemon.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
}
it('records a synthetic URL binding failure before any page API lookup without exposing the URL', async () => {
  const logger = await logFixture(),
    evaluateHandle = vi.fn<() => void>();
  const page = {
    url: () => 'https://www.figma.com/design/OtherDiagnostic0001?node-id=1-1',
    evaluateHandle,
  } as unknown as Page;
  await expect(
    withDiagnostics(logger, {}, () => readFigmaPageSnapshot(page, target)),
  ).rejects.toMatchObject({
    code: 'FIGMA_PAGE_IDENTITY_CHANGED',
    message: 'FIGMA_PAGE_IDENTITY_CHANGED',
  });
  expect(evaluateHandle).not.toHaveBeenCalled();
  const rows = await written(logger);
  expect(rows).toContainEqual(
    expect.objectContaining({
      event: 'chrome.page-api.identity.url-before-open.file-key',
      phase: 'chrome.page-api.identity.url-before-open.file-key',
      errorCode: 'FIGMA_PAGE_IDENTITY_CHANGED',
    }),
  );
  expect(JSON.stringify(rows)).not.toContain('OtherDiagnostic0001');
});
it('records synthetic API-file and page-reference failure phases while preserving identity guards', async () => {
  for (const change of ['file', 'page'] as const) {
    const logger = await logFixture(),
      selected = { type: 'PAGE', id: '1:1', parent: null };
    const lookup = vi.fn<() => Promise<typeof selected>>(async () => {
      if (change === 'page') api.currentPage = { ...selected };
      return selected;
    });
    const api = {
      fileKey: change === 'file' ? 'WrongRuntimeKey0001' : target.fileKey,
      currentPage: selected,
      getNodeByIdAsync: lookup,
    };
    vi.stubGlobal('figma', api);
    const page = {
      url: () => target.url,
      evaluateHandle: async (fn: Function, args: unknown) => fn(args),
    } as unknown as Page;
    await expect(
      withDiagnostics(logger, {}, () => readFigmaPageSnapshot(page, target)),
    ).rejects.toMatchObject({
      code: 'FIGMA_PAGE_IDENTITY_CHANGED',
      message: 'FIGMA_PAGE_IDENTITY_CHANGED',
    });
    const phase = change === 'file' ? 'open-file-key' : 'open-page-reference';
    const rows = await written(logger);
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: `chrome.page-api.identity.${phase}`,
        phase: `chrome.page-api.identity.${phase}`,
        errorCode: 'FIGMA_PAGE_IDENTITY_CHANGED',
      }),
    );
    expect(lookup).toHaveBeenCalledTimes(change === 'file' ? 0 : 1);
    expect(JSON.stringify(rows)).not.toContain('WrongRuntimeKey0001');
    vi.unstubAllGlobals();
  }
});
