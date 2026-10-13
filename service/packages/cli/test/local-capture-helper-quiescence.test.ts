import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from 'playwright';
import { expect, it, vi } from 'vitest';

import { ChromeSessionOwner } from '../src/browser-session.js';
import { parseFigmaTarget } from '../src/figma-url.js';
import { copyFigmaWebAsset } from '../src/figma-web-copy.js';
import { exportFigmaWebDocument } from '../src/figma-web-export.js';
import { readScripterAsset } from '../src/scripter-bridge.js';

const target = parseFigmaTarget('https://www.figma.com/design/ownedHelperQuiescence?node-id=0-1');
it.each([false, true])(
  'tracks a cancelled copy restore beyond its logical producer, cleanup fails=%s',
  async fails => {
    const folder = await mkdtemp(join(tmpdir(), 'sfp-helper-copy-'));
    const owner = new ChromeSessionOwner();
    const abort = new AbortController();
    let observe!: (value: unknown[]) => void;
    let restore!: () => void;
    let rejectRestore!: (error: Error) => void;
    const observing = new Promise<unknown[]>(resolve => {
      observe = resolve;
    });
    const restoring = new Promise<void>((resolve, reject) => {
      restore = resolve;
      rejectRestore = reject;
    });
    const selection = vi.fn<() => Promise<unknown[]>>(() => observing);
    const restorePage = vi.fn<() => Promise<void>>(() => restoring);
    const locator = { getByRole: () => locator, evaluateAll: selection };
    const page = {
      url: () => target.url,
      getByRole: () => locator,
      evaluate: restorePage,
      locator: () => ({ ariaSnapshot: async () => '' }),
    } as unknown as Page;
    try {
      const copying = copyFigmaWebAsset(page, target, 'svg', folder, {
        deadlineAt: Date.now() + 5000,
        signal: abort.signal,
        sourceWork: (pending, cleanup) => owner.trackCaptureWork(pending, cleanup),
      });
      await vi.waitFor(() => expect(selection).toHaveBeenCalledOnce());
      abort.abort(Error('owner cancelled'));
      await expect(copying).rejects.toThrow('owner cancelled');
      expect(restorePage).toHaveBeenCalledOnce();
      expect(owner.captureQuiescence()).toBe('unconfirmed');
      await owner.close();
      expect(owner.captureQuiescence()).toBe('unconfirmed');
      observe([]);
      await Promise.resolve();
      if (fails) rejectRestore(Error('owned restore failure'));
      else restore();
      await vi.waitFor(() =>
        expect(owner.captureQuiescence()).toBe(fails ? 'unconfirmed' : 'quiescent'),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it('retains a suppressed export restore failure as unconfirmed source cleanup', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sfp-helper-export-'));
  const owner = new ChromeSessionOwner();
  let rejectRestore!: (error: Error) => void;
  const restoring = new Promise<void>((_resolve, reject) => {
    rejectRestore = reject;
  });
  const restorePage = vi.fn<() => Promise<void>>(() => restoring);
  const known = { count: async () => 0, getByRole: () => known, filter: () => known };
  const page = {
    url: () => target.url,
    getByRole: (role: string, options?: unknown) =>
      options ? known : { filter: () => ({ count: async () => (role === 'dialog' ? 1 : 0) }) },
    evaluate: restorePage,
    locator: () => ({ ariaSnapshot: async () => 'Owned unsupported dialog' }),
  } as unknown as Page;
  try {
    const exporting = exportFigmaWebDocument(page, target, folder, {
      deadlineAt: Date.now() + 5000,
      sourceWork: (pending, cleanup) => owner.trackCaptureWork(pending, cleanup),
    });
    const outcome = exporting.catch(error => error);
    await vi.waitFor(() => expect(restorePage).toHaveBeenCalledOnce());
    expect(owner.captureQuiescence()).toBe('unconfirmed');
    rejectRestore(Error('owned export restore failure'));
    expect((await outcome).message).toBe('FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED');
    expect(owner.captureQuiescence()).toBe('unconfirmed');
    await owner.close();
    expect(owner.captureQuiescence()).toBe('unconfirmed');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it.each([false, true])(
  'tracks cancelled Scripter asset evaluation and its real cancel RPC, cancel fails=%s',
  async fails => {
    const owner = new ChromeSessionOwner();
    const abort = new AbortController();
    let finishEvaluation!: () => void;
    let finishCancel!: () => void;
    let failCancel!: (error: Error) => void;
    const evaluation = new Promise<string>(resolve => {
      finishEvaluation = () => resolve('{}');
    });
    const cancellation = new Promise<void>((resolve, reject) => {
      finishCancel = resolve;
      failCancel = reject;
    });
    const evaluate = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => evaluation)
      .mockImplementationOnce(() => cancellation);
    const frame = { url: () => 'https://scripter.rsms.me', evaluate };
    const page = { url: () => target.url, frames: () => [frame] } as unknown as Page;
    const reading = readScripterAsset(
      page,
      target,
      { kind: 'png', nodeId: '0:1' },
      {
        signal: abort.signal,
        deadlineAt: Date.now() + 5000,
        sourceWork: (pending, cleanup) => owner.trackCaptureWork(pending, cleanup),
        sourceUnconfirmed: () => owner.markCaptureUnconfirmed(),
      },
    );
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce());
    abort.abort(Error('owner cancelled asset'));
    await expect(reading).rejects.toThrow('owner cancelled asset');
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(owner.captureQuiescence()).toBe('unconfirmed');
    await owner.close();
    finishEvaluation();
    await Promise.resolve();
    expect(owner.captureQuiescence()).toBe('unconfirmed');
    if (fails) failCancel(Error('owned cancel RPC failure'));
    else finishCancel();
    await vi.waitFor(() => expect(owner.captureQuiescence()).toBe('unconfirmed'));
  },
);
