import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  assets: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  close: vi.fn<() => Promise<void>>(async () => {}),
  sessionClose: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('../../../cli/src/browser-session.js', () => ({
  ExistingChromeConnection: class {
    open = spies.open;
    close = spies.close;
    state() {
      return 'connected';
    }
  },
  observeFigmaPage: async () => ({ status: 'ready' }),
}));
vi.mock('../../../cli/src/capture-assets.js', () => ({ captureBrowserAssets: spies.assets }));
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import {
  ExistingChromeDesignCapture,
  PortalCaptureAttemptSchema,
  PortalCapturedDesignSchema,
  portalDesignFingerprint,
  requireCurrentPortalCapture,
} from '../../src/portal/design-capture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
beforeEach(() => {
  spies.close.mockResolvedValue(undefined);
  spies.sessionClose.mockResolvedValue(undefined);
});
const png = {
  query: { kind: 'png', nodeId: '1:1' },
  status: 'captured',
  path: 'assets/screen.png',
  sha256: 'sha256:' + 'a'.repeat(64),
  bytes: 1,
};
async function fixture() {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const target = parseFigmaTarget(
    'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
  );
  const node = {
    id: '1:1',
    name: 'Root',
    type: 'FRAME',
    width: 100,
    boundVariables: {},
    reactions: [],
  };
  const pageNode = { id: '0:1', name: 'Page', type: 'PAGE', selection: [], children: [node] };
  const figma = {
    root: { name: 'Fixture' },
    currentPage: pageNode,
    getNodeByIdAsync: async (id: string) => (id === '0:1' ? pageNode : node),
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
  const frame = {
    url: () => 'https://scripter.rsms.me/',
    evaluate: (_: unknown, args: { program: string }) => runInNewContext(args.program, { figma }),
  };
  const page = { url: () => target.url, frames: () => [frame] };
  spies.open.mockResolvedValue({ page, target, close: spies.sessionClose });
  spies.assets.mockResolvedValue([png]);
  const port = new ExistingChromeDesignCapture(f.stateRoot, f.permissions, f.store);
  cleanups.unshift(() => port.close());
  return {
    ...f,
    node,
    figma,
    port,
    target,
    capture: () => port.capture('coherence', target.url, new AbortController().signal),
  };
}
it.each(['property', 'style', 'variable', 'reaction'])(
  'retries the whole attempt when a same-ID %s changes during export',
  async kind => {
    const f = await fixture();
    const style = {
      id: 'style',
      name: 'Paint',
      paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    };
    const variable = {
      id: 'variable',
      name: 'Width',
      resolvedType: 'FLOAT',
      variableCollectionId: 'collection',
      valuesByMode: { mode: 1 },
    };
    Object.assign(f.figma, { getLocalPaintStylesAsync: async () => [style] });
    Object.assign(f.figma.variables, {
      getLocalVariablesAsync: async () => [variable],
      getLocalVariableCollectionsAsync: async () => [
        {
          id: 'collection',
          name: 'Collection',
          modes: [{ modeId: 'mode', name: 'Mode' }],
          defaultModeId: 'mode',
        },
      ],
    });
    spies.assets.mockImplementationOnce(async () => {
      if (kind === 'property') f.node.width = 200;
      if (kind === 'style') style.paints[0]!.color.r = 1;
      if (kind === 'variable') variable.valuesByMode.mode = 2;
      if (kind === 'reaction')
        Object.assign(f.node, {
          reactions: [
            {
              trigger: { type: 'ON_CLICK' },
              actions: [{ type: 'URL', url: 'https://example.com' }],
            },
          ],
        });
      return [png];
    });
    const result = await f.capture();
    expect(result.complete).toBe(true);
    requireCurrentPortalCapture(result);
    expect(spies.assets).toHaveBeenCalledTimes(2);
    expect(spies.assets.mock.calls[0]![3]).not.toBe(spies.assets.mock.calls[1]![3]);
    const files = await readdir(join(f.stateRoot, 'portal', 'capture-attempts'));
    const records = await Promise.all(
      files
        .filter(name => name.endsWith('.json'))
        .map(name =>
          f.store.get('capture-attempts', name.slice(0, -5), PortalCaptureAttemptSchema),
        ),
    );
    expect(records.some(record => record?.outcome === 'changed')).toBe(true);
  },
);
it('bounds repeated changes and preserves the previously coherent checkpoint', async () => {
  const f = await fixture();
  const first = await f.capture();
  spies.assets.mockImplementation(async () => {
    f.node.width++;
    return [png];
  });
  await expect(f.capture()).rejects.toMatchObject({
    cause: { code: 'PORTAL_CAPTURE_CONTENT_CHANGED' },
  });
  expect(spies.assets).toHaveBeenCalledTimes(3);
  const files = await readdir(join(f.stateRoot, 'portal', 'capture-progress'));
  const old = await f.store.get(
    'capture-progress',
    files.find(name => name.endsWith('.json'))!.slice(0, -5),
    PortalCapturedDesignSchema,
  );
  expect(old?.assetRoot).toBe(first.assetRoot);
});
it('keeps semantic fingerprints stable across capture times, folders and collector attempts', async () => {
  const f = await fixture();
  const first = await f.capture();
  const second = await f.capture();
  expect(first.assetRoot).not.toBe(second.assetRoot);
  expect(first.hash).not.toBe(second.hash);
  expect(first.collectorEvidence?.sourceBinding).not.toEqual(
    second.collectorEvidence?.sourceBinding,
  );
  expect(portalDesignFingerprint(first)).toBe(portalDesignFingerprint(second));
});
it('does not promote missing APIs or legacy records to current complete capture', async () => {
  const f = await fixture();
  Object.assign(f.figma, { getLocalPaintStylesAsync: undefined });
  const result = await f.capture();
  expect(result.complete).toBe(false);
  expect(() => requireCurrentPortalCapture(result)).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
  const legacy = PortalCapturedDesignSchema.parse({
    raw: result.raw,
    hash: result.hash,
    assets: result.assets,
    assetRoot: result.assetRoot,
    capturedAt: result.capturedAt,
    complete: true,
    liveVerified: true,
  });
  expect(() => requireCurrentPortalCapture(legacy)).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
  expect(portalDesignFingerprint(legacy)).not.toBe(portalDesignFingerprint(result));
});
it('does not reuse an incomplete checkpoint PNG when source bytes return to the same tree', async () => {
  const f = await fixture();
  spies.assets
    .mockResolvedValueOnce([{ query: png.query, status: 'pending' }])
    .mockResolvedValueOnce([{ query: png.query, status: 'pending' }]);
  const first = await f.capture();
  expect(first.complete).toBe(false);
  spies.assets.mockResolvedValue([png]);
  const second = await f.capture();
  expect(second.complete).toBe(true);
  expect(second.assetRoot).not.toBe(first.assetRoot);
  expect(spies.assets.mock.calls.at(-1)![4]).not.toHaveProperty('previous');
});
it('measures cleanup from before the awaited cleanup rather than after its rejection', async () => {
  const f = await fixture();
  let now = 100;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  spies.sessionClose.mockImplementationOnce(async () => {
    now += 1250;
    throw new Error('private cleanup');
  });
  await expect(f.capture()).rejects.toMatchObject({
    diagnostic: { stage: 'cleanup', elapsedMs: 1250 },
  });
});

it('carries the logical asset budget across invalidated attempts', async () => {
  const f = await fixture();
  const assets = Array.from({ length: 30 }, (_, index) => ({
    ...png,
    query: { kind: 'svg', nodeId: '1:' + String(index + 2) },
    bytes: 10_000_000,
    path: 'assets/' + index + '.svg',
  }));
  spies.assets
    .mockImplementationOnce(async () => {
      f.node.width++;
      return assets;
    })
    .mockResolvedValueOnce(assets);
  await expect(f.capture()).rejects.toMatchObject({
    cause: { code: 'PORTAL_CAPTURE_ASSET_LIMIT' },
  });
  expect(spies.assets.mock.calls[1]![4]).toMatchObject({ maxTotalBytes: 236_870_912 });
});
