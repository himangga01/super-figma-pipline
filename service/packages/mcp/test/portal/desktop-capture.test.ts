import type { RuntimeExecutionScope } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { createPortalCaptureAssetHandler } from '../../../plugin/src/handlers/portal-capture-asset.js';
import { createPortalCaptureReadHandler } from '../../../plugin/src/handlers/portal-capture-read.js';
import type { AuthenticatedTargetSession } from '../../src/execution/target-resolver.js';
import {
  resolvePortalCaptureSource,
  revalidatePortalCaptureGrant,
} from '../../src/portal/capture-source-admission.js';
import { requireCurrentPortalCapture } from '../../src/portal/design-capture.js';
import { createDesktopDesignCapture } from '../../src/portal/desktop-capture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of cleanups.splice(0)) await f();
});
async function fixture() {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const url = 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1';
  const rows: AuthenticatedTargetSession[] = [
    {
      sessionId: Buffer.alloc(16, 1).toString('base64url'),
      pluginGeneration: 'generation-1',
      fileIdentity: { kind: 'figma-file-key', value: '4IBhv1d8hEclifZQrOYxHS' },
      editorType: 'figma',
      capabilities: [],
      connectedSequence: 1,
      healthy: true,
    },
  ];
  const ports = {
    sessions: { list: () => rows, active: () => rows[0] },
    bindingFor: async () => null,
  };
  const admitted = await resolvePortalCaptureSource(
    { source: 'desktop', url },
    { kind: 'portal-source' },
    ports,
  );
  if (admitted.grant.kind !== 'desktop') throw Error('fixture');
  const node = {
    id: '1:1',
    name: 'Screen',
    type: 'FRAME',
    width: 10,
    height: 10,
    boundVariables: {},
    reactions: [],
    exportAsync: async () => new Uint8Array([1, 2, 3]),
  };
  const page = { id: '0:1', name: 'Page', type: 'PAGE', selection: [], children: [node] };
  const figma = {
    root: { name: 'Fixture' },
    currentPage: page,
    getNodeByIdAsync: async (id: string) =>
      id === '0:1' ? page : (page.children.find(child => child.id === id) ?? null),
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
    getImageByHash: () => null,
  };
  const handlers = {
    portal_capture_read: createPortalCaptureReadHandler(
      figma as unknown as Parameters<typeof createPortalCaptureReadHandler>[0],
    ),
    portal_capture_asset: createPortalCaptureAssetHandler(
      figma as unknown as Parameters<typeof createPortalCaptureAssetHandler>[0],
    ),
  };
  const actions: string[] = [];
  const scope = {
    actor: {
      actorId: 'actor1_' + 'a'.repeat(43),
      authSessionId: 'auth1_' + 'b'.repeat(43),
      entryPath: 'control',
    },
    target: admitted.target,
  } as unknown as RuntimeExecutionScope;
  const capture = createDesktopDesignCapture(f.stateRoot, f.permissions, f.store, {
    scope,
    grant: admitted.grant,
    action: { operationId: 'parent-operation', actionNonce: 'parent-nonce' },
    revalidate: () => revalidatePortalCaptureGrant(admitted.grant, admitted.target, ports),
    plugin: {
      execute: async (observed, name, args, signal, _reporter, action) => {
        expect(observed).toBe(scope);
        expect(action?.operationId).toBe('parent-operation');
        actions.push(action!.actionNonce);
        return handlers[name as keyof typeof handlers](args, { signal, report: () => {} });
      },
    },
  });
  cleanups.unshift(() => capture.close());
  return { ...f, capture, url, node, figma, rows, actions };
}
it('captures through compiled plugin handlers and signed coherent storage with distinct child actions', async () => {
  const f = await fixture();
  const captured = await f.capture.capture('desktop-test', f.url, new AbortController().signal);
  requireCurrentPortalCapture(captured);
  expect(captured.collectorProvenance?.collector).toBe('pinned-desktop-plugin-v2');
  expect(JSON.parse(captured.raw).source).toBe('figma-plugin-api-pinned');
  expect(new Set(f.actions).size).toBe(f.actions.length);
  expect(f.actions.length).toBeGreaterThan(5);
});
it('retries same-ID mutation during export using the same bounded reobservation', async () => {
  const f = await fixture();
  let exports = 0;
  f.node.exportAsync = async () => {
    if (++exports === 1) f.node.name = 'Changed';
    return new Uint8Array([1, 2, 3]);
  };
  const captured = await f.capture.capture('desktop-change', f.url, new AbortController().signal);
  expect(exports).toBe(2);
  expect(JSON.parse(captured.raw).nodes[0].name).toBe('Changed');
  requireCurrentPortalCapture(captured);
});
it('does not treat missing style APIs as complete empty catalogs', async () => {
  const f = await fixture();
  Object.defineProperty(f.figma, 'getLocalPaintStylesAsync', { value: undefined });
  const captured = await f.capture.capture('desktop-partial', f.url, new AbortController().signal);
  expect(captured.complete).toBe(false);
  expect(() => requireCurrentPortalCapture(captured)).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
});
it('cancels before the first plugin read without replacing the target', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort(Error('cancelled'));
  await expect(f.capture.capture('desktop-cancel', f.url, controller.signal)).rejects.toThrow(
    'cancelled',
  );
  expect(f.actions).toHaveLength(0);
});
it('rejects a generation replacement during an export before publishing complete proof', async () => {
  const f = await fixture();
  f.node.exportAsync = async () => {
    f.rows[0] = { ...f.rows[0]!, pluginGeneration: 'changed' };
    return new Uint8Array([1, 2, 3]);
  };
  await expect(
    f.capture.capture('desktop-replace', f.url, new AbortController().signal),
  ).rejects.toThrow('PORTAL_CAPTURE_TARGET_CHANGED');
});

it('retains independent catalog continuation and same-name values through the Desktop consumer', async () => {
  const f = await fixture();
  Object.defineProperty(f.figma, 'getLocalPaintStylesAsync', {
    value: async () =>
      Array.from({ length: 513 }, (_, index) => ({
        id: 'paint-' + index,
        name: 'Duplicate name',
        paints: [{ type: 'SOLID', color: { r: index / 512, g: 0, b: 0 } }],
      })),
  });
  const captured = await f.capture.capture('desktop-catalog', f.url, new AbortController().signal);
  requireCurrentPortalCapture(captured);
  const raw = JSON.parse(captured.raw);
  expect(raw.styles.paints).toHaveLength(513);
  expect(raw.styles.paints[512].paints[0].color.r).toBe(1);
});
it('keeps separate root export queries even when their actual bytes are equal', async () => {
  const f = await fixture();
  f.figma.currentPage.children.push({ ...f.node, id: '2:1', name: 'Second screen' });
  const captured = await f.capture.capture('desktop-roots', f.url, new AbortController().signal);
  requireCurrentPortalCapture(captured);
  const pngs = captured.assets.filter(asset => asset.query.kind === 'png');
  expect(pngs.map(asset => (asset.query as { nodeId: string }).nodeId)).toEqual(['1:1', '2:1']);
  expect(pngs[0]?.sha256).toBe(pngs[1]?.sha256);
});
it('reads original image bytes referenced by strokes and styled text segments', async () => {
  const f = await fixture();
  Object.assign(f.node, {
    type: 'TEXT',
    strokes: [{ type: 'IMAGE', imageHash: 'a'.repeat(40) }],
    getStyledTextSegments: () => [
      { start: 0, end: 1, characters: 'A', fills: [{ type: 'IMAGE', imageHash: 'b'.repeat(40) }] },
    ],
  });
  Object.defineProperty(f.figma, 'getImageByHash', {
    value: () => ({ getBytesAsync: async () => new Uint8Array([7, 8, 9]) }),
  });
  const captured = await f.capture.capture('desktop-images', f.url, new AbortController().signal);
  requireCurrentPortalCapture(captured);
  expect(
    captured.assets.filter(asset => asset.query.kind === 'image').map(asset => asset.query),
  ).toEqual([
    { kind: 'image', imageHash: 'a'.repeat(40) },
    { kind: 'image', imageHash: 'b'.repeat(40) },
  ]);
});
it('cancels a waiting plugin catalog read without continuing to export', async () => {
  const f = await fixture();
  let release!: () => void,
    started = false,
    exports = 0;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  Object.defineProperty(f.figma.variables, 'getLocalVariablesAsync', {
    value: async () => {
      started = true;
      await gate;
      return [];
    },
  });
  f.node.exportAsync = async () => {
    exports++;
    return new Uint8Array([1, 2, 3]);
  };
  const controller = new AbortController();
  const capture = f.capture.capture('desktop-wait', f.url, controller.signal);
  const rejected = capture.then(
    () => null,
    error => error as Error,
  );
  await vi.waitFor(() => expect(started).toBe(true));
  controller.abort(Error('cancelled'));
  expect(await rejected).toMatchObject({ message: 'cancelled' });
  release();
  expect(exports).toBe(0);
});
