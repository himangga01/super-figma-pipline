import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { storedChecksum } from '@sfp/ir';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  assets: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  close: vi.fn<() => Promise<void>>(async () => {}),
  sessionClose: vi.fn<() => Promise<void>>(async () => {}),
  nativeExport: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('../../../cli/src/figma-web-export.js', () => ({
  exportFigmaWebDocument: spies.nativeExport,
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
  nativeContourSupplementId,
  PortalNativeSupplementSchema,
} from '../../src/portal/capture-native-supplement.js';
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
const nativePlanId = `sfp_portal1_${'1'.repeat(32)}`;
async function fixture(
  options: {
    nativeContourSupplement?: boolean;
    nativeContourUnavailable?: 'fail' | 'retain-primary';
  } = {},
) {
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
  const port = new ExistingChromeDesignCapture(f.stateRoot, f.permissions, f.store, options);
  cleanups.unshift(() => port.close());
  return {
    ...f,
    node,
    figma,
    port,
    target,
    capture: () =>
      port.capture(
        options.nativeContourSupplement ? nativePlanId : 'coherence',
        target.url,
        new AbortController().signal,
      ),
  };
}

it('exports the optional native supplement between primary observations and signs it only after confirmed cleanup', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  const events: string[] = [];
  const bytes = Buffer.from('fig-kiwiOWNED');
  const attempt = async () => {
    const files = await readdir(join(f.stateRoot, 'portal', 'capture-attempts'));
    return f.store.get('capture-attempts', files[0]!.slice(0, -5), PortalCaptureAttemptSchema);
  };
  spies.assets.mockImplementation(async () => {
    events.push('assets');
    return [png];
  });
  spies.nativeExport.mockImplementation(async (_page, target, folder, options) => {
    events.push('native-export');
    expect(await attempt()).toMatchObject({ outcome: 'assets-exported' });
    expect(await attempt()).not.toHaveProperty('afterHash');
    expect(options).toMatchObject({
      deadlineAt: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    await writeFile(join(String(folder), 'document.fig'), bytes);
    return {
      schemaVersion: 1,
      source: 'figma-web-native-export',
      requestedUrl: (target as { url: string }).url,
      fileKey: f.target.fileKey,
      requestedNodeId: f.target.nodeId,
      path: 'document.fig',
      bytes: bytes.length,
      sha256: storedChecksum(bytes),
      capturedAt: new Date().toISOString(),
      fullCapture: false,
    };
  });
  spies.sessionClose.mockImplementation(async () => {
    events.push('cleanup');
    expect(await attempt()).toMatchObject({ outcome: 'observed', afterHash: expect.any(String) });
  });
  const create = vi.spyOn(f.store, 'create');
  const result = await f.capture();
  expect(spies.nativeExport).toHaveBeenCalledOnce();
  expect(events).toEqual(['assets', 'native-export', 'cleanup']);
  expect(result.complete).toBe(true);
  const publication = create.mock.calls.find(call => call[0] === 'native-contour-supplements');
  expect(publication?.[1]).toBe(nativeContourSupplementId(nativePlanId, result));
  expect(publication?.[2]).toMatchObject({
    atomic: false,
    fullCapture: false,
    primaryCapturedAt: result.capturedAt,
    documentHash: storedChecksum(bytes),
    beforeContentHash: result.contentFingerprint,
    afterContentHash: result.contentFingerprint,
  });
});

it('leaves ordinary captures native-export-free by default', async () => {
  const f = await fixture();
  await f.capture();
  expect(spies.nativeExport).not.toHaveBeenCalled();
});

it('retains coherent primary capture when the optional native download is confirmed disabled', async () => {
  const f = await fixture({
    nativeContourSupplement: true,
    nativeContourUnavailable: 'retain-primary',
  });
  spies.nativeExport.mockRejectedValue(new Error('FIGMA_WEB_EXPORT_UNAVAILABLE'));
  const captured = await f.capture();
  requireCurrentPortalCapture(captured);
  expect(captured.complete).toBe(true);
  expect(spies.nativeExport).toHaveBeenCalledOnce();
  expect(spies.sessionClose).toHaveBeenCalledOnce();
  expect(await supplementRecords(f)).toEqual([]);
});

it('still requires a native document when the explicit required policy cannot export', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  spies.nativeExport.mockRejectedValue(new Error('FIGMA_WEB_EXPORT_UNAVAILABLE'));
  await expect(f.capture()).rejects.toMatchObject({
    cause: { message: 'FIGMA_WEB_EXPORT_UNAVAILABLE' },
  });
  expect(await supplementRecords(f)).toEqual([]);
});

it.each(['fail', 'retain-primary'] as const)(
  'rejects an empty native export result under %s policy',
  async nativeContourUnavailable => {
    const f = await fixture({ nativeContourSupplement: true, nativeContourUnavailable });
    spies.nativeExport.mockResolvedValue(undefined);
    await expect(f.capture()).rejects.toMatchObject({
      cause: { code: 'PORTAL_CAPTURE_NATIVE_SUPPLEMENT_REQUIRED' },
    });
    expect(await supplementRecords(f)).toEqual([]);
  },
);

it.each([
  'FIGMA_WEB_EXPORT_TIMEOUT',
  'BROWSER_TARGET_CHANGED',
  'FIGMA_WEB_EXPORT_MODAL_UNSUPPORTED',
  'FIGMA_WEB_EXPORT_UNAVAILABLE: private-details',
])('does not suppress %s under the optional native policy', async message => {
  const f = await fixture({
    nativeContourSupplement: true,
    nativeContourUnavailable: 'retain-primary',
  });
  spies.nativeExport.mockRejectedValue(new Error(message));
  await expect(f.capture()).rejects.toMatchObject({ cause: { message } });
  expect(await supplementRecords(f)).toEqual([]);
});

async function supplementRecords(f: Awaited<ReturnType<typeof fixture>>) {
  const files = await readdir(join(f.stateRoot, 'portal', 'native-contour-supplements')).catch(
    error => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    },
  );
  return Promise.all(
    files
      .filter(n => n.endsWith('.json'))
      .map(n =>
        f.store.get('native-contour-supplements', n.slice(0, -5), PortalNativeSupplementSchema),
      ),
  );
}
function configureNativeExport(f: Awaited<ReturnType<typeof fixture>>) {
  const bytes = Buffer.from('fig-kiwiOWNED');
  const write = async (_page: unknown, target: unknown, folder: unknown) => {
    await writeFile(join(String(folder), 'document.fig'), bytes);
    return {
      schemaVersion: 1,
      source: 'figma-web-native-export',
      requestedUrl: (target as { url: string }).url,
      fileKey: f.target.fileKey,
      requestedNodeId: f.target.nodeId,
      path: 'document.fig',
      bytes: bytes.length,
      sha256: storedChecksum(bytes),
      capturedAt: new Date().toISOString(),
      fullCapture: false,
    };
  };
  spies.nativeExport.mockImplementation(write);
  return { bytes, write };
}

it('retains orphan native bytes after a changed attempt and publishes only the final coherent attempt', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  const native = configureNativeExport(f);
  spies.nativeExport.mockImplementationOnce(async (...args) => {
    const result = await native.write(args[0], args[1], args[2]);
    f.node.width++;
    return result;
  });
  const captured = await f.capture();
  expect(spies.nativeExport).toHaveBeenCalledTimes(2);
  const folders = spies.nativeExport.mock.calls.map(call => String(call[2]));
  expect(folders[0]).not.toBe(folders[1]);
  const record = await f.store.get(
    'native-contour-supplements',
    nativeContourSupplementId(nativePlanId, captured),
    PortalNativeSupplementSchema,
  );
  expect(record!.captureDirectory).toBe(
    `portal/captures/${captured.assetRoot.split(/[\\/]/u).at(-1)}`,
  );
  expect(record!.beforeContentHash).toBe(record!.afterContentHash);
  expect(spies.assets.mock.calls[1]![4]).toMatchObject({
    maxTotalBytes: 536_870_912 - png.bytes - native.bytes.length,
  });
});

it('never signs a supplement after failed session cleanup', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  configureNativeExport(f);
  spies.sessionClose.mockRejectedValueOnce(new Error('owned cleanup failure'));
  await expect(f.capture()).rejects.toMatchObject({ diagnostic: { stage: 'cleanup' } });
  expect(await supplementRecords(f)).toEqual([]);
});

it('does not publish a late export or reset the primary capture deadline', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  const native = configureNativeExport(f);
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  spies.nativeExport.mockImplementation(async (...args) => {
    expect(args[3]).toMatchObject({ deadlineAt: now + 300_000 });
    const result = await native.write(args[0], args[1], args[2]);
    now += 300_001;
    return result;
  });
  await expect(f.capture()).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_COHERENCE_BUDGET' });
  expect(await supplementRecords(f)).toEqual([]);
});

it('cancels logically while keeping the physical native export queued and never signs its late bytes', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  const native = configureNativeExport(f);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  spies.nativeExport.mockImplementation(async (...args) => {
    await gate;
    return native.write(args[0], args[1], args[2]);
  });
  const controller = new AbortController(),
    reason = new Error('OPERATION_CANCELLED');
  const pending = f.port.capture(nativePlanId, f.target.url, controller.signal);
  const outcome = pending.then(
    () => ({ reason: null }),
    error => ({ reason: error }),
  );
  await vi.waitFor(() => expect(spies.nativeExport).toHaveBeenCalledOnce());
  controller.abort(reason);
  expect((await outcome).reason).toBe(reason);
  expect(spies.sessionClose).not.toHaveBeenCalled();
  release();
  await f.port.close();
  expect(await supplementRecords(f)).toEqual([]);
});

it('quarantines a swallowed native restoration failure and blocks another attachment', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  const native = configureNativeExport(f);
  spies.nativeExport.mockImplementation(async (...args) => {
    const options = args[3] as { sourceWork<T>(promise: Promise<T>, cleanup: boolean): Promise<T> };
    await options
      .sourceWork(Promise.reject(new Error('owned restoration failure')), true)
      .catch(() => {});
    return native.write(args[0], args[1], args[2]);
  });
  await expect(f.capture()).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_CLEANUP_UNCONFIRMED' });
  expect(await supplementRecords(f)).toEqual([]);
  await expect(f.capture()).rejects.toMatchObject({ code: 'PORTAL_CAPTURE_CLEANUP_UNCONFIRMED' });
  expect(spies.open).toHaveBeenCalledOnce();
});
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

it('publishes separate immutable supplements for repeated same-plan fresh captures used by live validation', async () => {
  const f = await fixture({ nativeContourSupplement: true });
  configureNativeExport(f);
  const first = await f.capture(),
    firstId = nativeContourSupplementId(nativePlanId, first);
  const firstRecord = await f.store.get(
    'native-contour-supplements',
    firstId,
    PortalNativeSupplementSchema,
  );
  const second = await f.capture(),
    secondId = nativeContourSupplementId(nativePlanId, second);
  expect(second.complete).toBe(true);
  expect(second.assetRoot).not.toBe(first.assetRoot);
  expect(secondId).not.toBe(firstId);
  expect(portalDesignFingerprint(second)).toBe(portalDesignFingerprint(first));
  expect(spies.nativeExport).toHaveBeenCalledTimes(2);
  expect(spies.sessionClose).toHaveBeenCalledTimes(2);
  expect(
    await f.store.get('native-contour-supplements', firstId, PortalNativeSupplementSchema),
  ).toEqual(firstRecord);
  expect(await supplementRecords(f)).toHaveLength(2);
});
