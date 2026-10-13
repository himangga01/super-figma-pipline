import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { publicError } from '../../portal/src/contract.js';
import type { ChromeSessionOwner } from '../src/browser-session.js';
import type { ControlClient } from '../src/control-client.js';
import { isLocalCapturePreEffectFailure } from '../src/library.js';
import { localCaptureExecution } from '../src/local-capture-execution.js';
import { executeServiceFeature } from '../src/service-functions.js';

const url = 'https://www.figma.com/design/ownedCaptureProofFixture?node-id=0-1';
it.each(['connection', 'open-intent', 'selection-intent', 'focus-dispatched', 'tabs-read'])(
  'brands only prospective pre-effect failure through the public library: %s',
  async mode => {
    const phases: string[] = [];
    const owner = {
      open: async (options: { beforeSourceEffect?(): void }) => {
        if (mode === 'focus-dispatched') options.beforeSourceEffect?.();
        throw Error('CHROME_CONNECTION_REQUIRED');
      },
    } as unknown as ChromeSessionOwner;
    const error = await executeServiceFeature(
      {} as ControlClient,
      mode === 'selection-intent'
        ? 'chrome.copy.svg'
        : mode === 'tabs-read'
          ? 'chrome.tabs'
          : 'chrome.export',
      {
        url,
        ...(mode === 'tabs-read' ? {} : { out: 'C:/owned-unused-output' }),
        ...(mode === 'open-intent' ? { open: true } : {}),
      },
      {
        workspaceId: null,
        targetSelector: { kind: 'none' },
        signal: new AbortController().signal,
        emit: () => {},
        chromeSessionOwner: owner,
        executionId: 'owned-invocation',
        progress: phase => phases.push(phase),
      },
    ).then(
      () => null,
      value => value,
    );
    expect(phases).toEqual(['connecting']);
    expect(isLocalCapturePreEffectFailure(error, 'owned-invocation')).toBe(mode === 'connection');
    expect(publicError(error).code).toBe(
      mode === 'connection' ? 'CHROME_CONNECTION_REQUIRED' : 'SERVICE_UNAVAILABLE',
    );
    expect(isLocalCapturePreEffectFailure(error, 'different-invocation')).toBe(false);
  },
);

it('does not accept proof spoofing or replay a genuine brand after a later effect', () => {
  const capture = localCaptureExecution('owned-invocation');
  const genuine = capture.failure(Error('CHROME_CONNECTION_REQUIRED'));
  expect(isLocalCapturePreEffectFailure(genuine, 'owned-invocation')).toBe(true);
  for (const spoof of [
    Error('LOCAL_CAPTURE_PRE_EFFECT_FAILURE'),
    { code: 'LOCAL_CAPTURE_PRE_EFFECT_FAILURE' },
    Object.create(genuine as object),
    new Proxy(
      {},
      {
        get: () => {
          throw Error('private getter');
        },
      },
    ),
  ])
    expect(isLocalCapturePreEffectFailure(spoof, 'owned-invocation')).toBe(false);
  capture.beforeEffect();
  expect(isLocalCapturePreEffectFailure(genuine, 'owned-invocation')).toBe(false);
  expect(isLocalCapturePreEffectFailure(capture.failure(genuine), 'owned-invocation')).toBe(false);
});

it('marks output creation before the real capture folder and failed viewport write', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sfp-capture-proof-'));
  const page = {
    url: () => url,
    title: async () => 'Owned fixture',
    screenshot: async () => {
      throw Error('owned viewport failure');
    },
    getByRole: (role: string) => ({
      count: async () => (role === 'application' ? 1 : 0),
      allTextContents: async () => [],
    }),
    getByText: () => ({ count: async () => 0 }),
    locator: () => ({ filter: () => ({ count: async () => 1 }) }),
    evaluate: async () => ({ application: true, canvas: true }),
  };
  const owner = {
    open: async () => ({
      page,
      target: { url, fileKey: 'ownedCaptureProofFixture', nodeId: '0:1' },
      cdpEndpoint: 'chrome',
      close: async () => {},
    }),
  } as unknown as ChromeSessionOwner;
  try {
    const error = await executeServiceFeature(
      {} as ControlClient,
      'chrome.export',
      { url, out: folder, wait: 1 },
      {
        workspaceId: null,
        targetSelector: { kind: 'none' },
        signal: new AbortController().signal,
        emit: () => {},
        chromeSessionOwner: owner,
        executionId: 'owned-output-invocation',
      },
    ).then(
      () => null,
      value => value,
    );
    expect(isLocalCapturePreEffectFailure(error, 'owned-output-invocation')).toBe(false);
    expect(await readdir(folder)).toHaveLength(1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
