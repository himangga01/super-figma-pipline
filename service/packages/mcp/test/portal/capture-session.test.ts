import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  assets: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  snapshot: vi.fn<() => Promise<unknown>>(),
  close: vi.fn<() => Promise<void>>(async () => {}),
  sessionClose: vi.fn<() => Promise<void>>(async () => {}),
  open: vi.fn<() => Promise<unknown>>(),
  observe: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../../../cli/src/browser-session.js', () => ({
  ExistingChromeConnection: class {
    open = spies.open;
    close = spies.close;
    state() {
      return 'connected';
    }
  },
  observeFigmaPage: spies.observe,
}));
vi.mock('../../../cli/src/capture-assets.js', () => ({ captureBrowserAssets: spies.assets }));
vi.mock('../../../cli/src/snapshot-reader.js', () => ({ readScripterSnapshot: spies.snapshot }));

import {
  ExistingChromeDesignCapture,
  portalDesignFingerprint,
} from '../../src/portal/design-capture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  spies.sessionClose.mockResolvedValue();
  spies.snapshot.mockResolvedValue(snapshot());
  spies.open.mockResolvedValue({
    page: {},
    target: { nodeId: '0:1', fileKey: '4IBhv1d8hEclifZQrOYxHS' },
    close: spies.sessionClose,
  });
  spies.observe.mockResolvedValue({ status: 'ready' });
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.resetAllMocks();
});

it('does not start reads or publication when a session arrives after capture cancellation', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = new ExistingChromeDesignCapture(
    fixture.stateRoot,
    fixture.permissions,
    fixture.store,
  );
  cleanups.unshift(() => capture.close());
  const pending = deferred();
  spies.open.mockReturnValueOnce(pending.promise);
  const create = vi.spyOn(fixture.store, 'create');
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const result = capture
    .capture(
      'late',
      'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      controller.signal,
    )
    .catch(error => error);
  await vi.waitFor(() => expect(spies.open).toHaveBeenCalledOnce());
  controller.abort(reason);
  expect(
    await Promise.race([
      result,
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 100)),
    ]),
  ).toBe(reason);
  pending.resolve({ page: {}, target: { nodeId: '0:1' }, close: spies.sessionClose });
  await vi.waitFor(() => expect(spies.sessionClose).toHaveBeenCalledOnce());
  expect(spies.snapshot).not.toHaveBeenCalled();
  expect(spies.assets).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it.each([
  'connection',
  'readiness',
  'state-preparation',
  'checkpoint-read',
  'assets',
  'final-readiness',
  'schema',
  'checkpoint-publication',
  'cleanup',
] as const)('categorizes a %s failure at its exact boundary', async stage => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = new ExistingChromeDesignCapture(
    fixture.stateRoot,
    fixture.permissions,
    fixture.store,
  );
  cleanups.unshift(() => capture.close());
  const cause = new Error('private exception');
  spies.snapshot.mockResolvedValue(snapshot([]));
  spies.assets.mockResolvedValue([]);
  if (stage === 'connection') spies.open.mockRejectedValueOnce(cause);
  if (stage === 'readiness') spies.observe.mockRejectedValueOnce(cause);
  if (stage === 'state-preparation')
    vi.spyOn(fixture.permissions, 'verifySecure').mockRejectedValueOnce(cause);
  if (stage === 'checkpoint-read') vi.spyOn(fixture.store, 'get').mockRejectedValueOnce(cause);
  if (stage === 'assets') spies.assets.mockRejectedValueOnce(cause);
  if (stage === 'final-readiness')
    spies.observe.mockResolvedValueOnce({ status: 'ready' }).mockRejectedValueOnce(cause);
  if (stage === 'schema')
    spies.assets.mockResolvedValueOnce([
      { query: { kind: 'png', nodeId: '1:1' }, status: 'captured', path: '../private' },
    ]);
  if (stage === 'checkpoint-publication') {
    const create = fixture.store.create.bind(fixture.store);
    vi.spyOn(fixture.store, 'create').mockImplementation(async (...args) => {
      if (args[0] === 'capture-progress') throw cause;
      return create(...args);
    });
  }
  if (stage === 'cleanup') spies.sessionClose.mockRejectedValueOnce(cause);
  const result = await capture
    .capture(
      'stage',
      'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      new AbortController().signal,
    )
    .catch(error => error);
  expect(result.diagnostic).toMatchObject({ stage, code: 'DESIGN_CAPTURE_FAILED' });
  expect(result.cause).toBeInstanceOf(Error);
  expect(result.diagnostic).toMatchObject(
    stage === 'schema'
      ? {
          type: 'schema-error',
          schemaIssueCount: 1,
          schemaPaths: ['[].path'],
        }
      : { type: 'error' },
  );
  expect(JSON.stringify(result.diagnostic)).not.toContain('private');
});

it('abandons a queued capture before its predecessor resolves without letting later work overtake it', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = new ExistingChromeDesignCapture(
    fixture.stateRoot,
    fixture.permissions,
    fixture.store,
  );
  cleanups.unshift(() => capture.close());
  const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
  const pending = deferred();
  spies.snapshot.mockReturnValueOnce(pending.promise).mockResolvedValue(snapshot([]));
  spies.assets.mockResolvedValue([]);
  const first = capture.capture('first', url, new AbortController().signal);
  await vi.waitFor(() => expect(spies.snapshot).toHaveBeenCalledOnce());
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const second = capture.capture('cancelled', url, controller.signal).catch(error => error);
  controller.abort(reason);
  const outcome = await Promise.race([
    second,
    new Promise(resolve => setTimeout(() => resolve('still waiting'), 100)),
  ]);
  const third = capture.capture('third', url, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(spies.snapshot).toHaveBeenCalledOnce();
  pending.resolve(snapshot([]));
  await Promise.all([first, third]);
  expect(outcome).toBe(reason);
  expect(spies.snapshot).toHaveBeenCalledTimes(4);
  expect(spies.assets).toHaveBeenCalledTimes(2);
});

it('reports the first failing capture stage and retains its internal cause ahead of cleanup failure', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = new ExistingChromeDesignCapture(
    fixture.stateRoot,
    fixture.permissions,
    fixture.store,
  );
  cleanups.unshift(() => capture.close());
  const cause = new TypeError('private design value and bearer endpoint');
  spies.snapshot.mockRejectedValue(cause);
  spies.sessionClose.mockRejectedValue(new Error('cleanup private text'));
  const failure = await capture
    .capture(
      'failed',
      'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      new AbortController().signal,
    )
    .catch(error => error);
  expect(failure.cause).toBe(cause);
  expect(failure.diagnostic).toMatchObject({
    stage: 'snapshot',
    code: 'DESIGN_CAPTURE_FAILED',
    type: 'type-error',
  });
  expect(JSON.stringify(failure.diagnostic)).not.toMatch(/private|bearer|endpoint/u);
  expect(spies.assets).not.toHaveBeenCalled();
});

it('completes pending batches and exports all assets again in a fresh checkpoint attempt', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = new ExistingChromeDesignCapture(
    fixture.stateRoot,
    fixture.permissions,
    fixture.store,
  );
  cleanups.unshift(() => capture.close());
  spies.snapshot.mockResolvedValue({
    ...snapshot(),
    nodes: [
      {
        id: '1:1',
        name: 'Screen',
        type: 'FRAME',
        boundVariables: {},
        reactions: [],
        collectorCapabilities: {
          bindings: 'observed',
          interactions: 'observed',
          componentApis: 'not-applicable',
        },
        children: [
          {
            id: '1:2',
            name: 'Icon',
            type: 'VECTOR',
            boundVariables: {},
            reactions: [],
            collectorCapabilities: {
              bindings: 'observed',
              interactions: 'observed',
              componentApis: 'not-applicable',
            },
          },
        ],
      },
    ],
    nodeCount: 2,
    truncated: false,
  });
  const png = {
    query: { kind: 'png', nodeId: '1:1' },
    status: 'captured',
    path: 'frame.png',
    sha256: `sha256:${'a'.repeat(64)}`,
    bytes: 1,
  };
  const image = {
    query: { kind: 'image', imageHash: 'a'.repeat(40) },
    status: 'captured',
    path: 'image.png',
    sha256: `sha256:${'b'.repeat(64)}`,
    bytes: 1,
  };
  const svg = {
    query: { kind: 'svg', nodeId: '1:2' },
    status: 'captured',
    path: 'icon.svg',
    sha256: `sha256:${'c'.repeat(64)}`,
    bytes: 1,
  };
  spies.assets
    .mockResolvedValueOnce([png, image, { query: svg.query, status: 'pending' }])
    .mockResolvedValueOnce([png, image, svg]);
  const first = await capture.capture(
    'plan-first',
    'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
    new AbortController().signal,
  );
  expect(first.complete).toBe(true);
  expect(spies.assets.mock.calls[1]![4]).toMatchObject({
    retryUnavailable: false,
    previous: [png, image, { query: svg.query, status: 'pending' }],
  });
  spies.assets.mockResolvedValueOnce([{ ...png, sha256: `sha256:${'d'.repeat(64)}` }, image, svg]);
  const second = await capture.capture(
    'plan-later',
    'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
    new AbortController().signal,
  );
  expect((spies.assets.mock.calls[2]![4] as { previous?: unknown }).previous).toBeUndefined();
  expect(second.complete).toBe(true);
  expect(second.assetRoot).not.toBe(first.assetRoot);
  expect(portalDesignFingerprint(second)).not.toBe(portalDesignFingerprint(first));
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function snapshot(
  nodes: unknown[] = [
    {
      id: '1:1',
      name: 'Screen',
      type: 'FRAME',
      boundVariables: {},
      reactions: [],
      collectorCapabilities: {
        bindings: 'observed',
        interactions: 'observed',
        componentApis: 'not-applicable',
      },
    },
  ],
) {
  return {
    source: 'figma-plugin-api-via-scripter',
    nodes,
    tokens: [],
    collections: [],
    styles: { paints: [], texts: [], effects: [], grids: [] },
    pageId: '0:1',
    scopeNodeId: '0:1',
    nodeCount: nodes.length,
    truncated: false,
    observation: {
      readComplete: true,
      contentHash: 'stable',
      capabilities: [
        'variables',
        'collections',
        'paintStyles',
        'textStyles',
        'effectStyles',
        'gridStyles',
      ].map(name => ({ name, status: 'empty', count: 0 })),
    },
  };
}
