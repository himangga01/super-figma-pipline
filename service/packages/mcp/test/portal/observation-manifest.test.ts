import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import { preparePortalObservationManifest } from '../../src/portal/observation-manifest.js';
import { assertNativePortalPreview } from '../../src/portal/preview.js';
import { verifyPortalVisualEvidence } from '../../src/portal/visual-evidence.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
const white = () => {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  return Buffer.from(png.encode([new Uint8Array(100 * 100 * 4).fill(255).buffer], 100, 100, 0));
};
const fixtures = async (reaction = false) => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const root = join(f.root, 'assets');
  await mkdir(root);
  const bytes = white();
  await writeFile(join(root, 'oracle.png'), bytes);
  const nodes = [
    {
      id: '1:1',
      type: 'FRAME',
      width: 100,
      height: 100,
      children: [
        {
          id: '1:2',
          type: 'RECTANGLE',
          width: 10,
          height: 10,
          ...(reaction
            ? {
                reactions: [
                  {
                    trigger: { type: 'ON_CLICK' },
                    actions: [{ type: 'NODE', destinationId: '2:1', navigation: 'NAVIGATE' }],
                  },
                ],
              }
            : {}),
        },
      ],
    },
    { id: '2:1', type: 'FRAME', width: 100, height: 100 },
  ];
  const { captured } = await currentCaptureFixture(f, {
    nodes,
    assetRoot: root,
    assets: nodes.map(node => ({
      query: { kind: 'png', nodeId: node.id },
      path: 'oracle.png',
      sha256: storedChecksum(bytes),
      bytes: bytes.length,
      status: 'captured',
    })),
  });
  const contract = derivePortalInteractionContract(captured, []);
  const screens = nodes.map((node, index) => ({
    id: 'screen-' + index,
    rootNodeId: node.id,
    path: '/' + index,
    state: 'source:' + node.id,
    viewport: { width: 100, height: 100 },
    oraclePath: 'oracle.png',
    oracleHash: storedChecksum(bytes),
    oracleRoot: root,
    assertionIds: contract.interactions
      .filter(value => value.rootNodeId === node.id)
      .map(value => value.id),
  }));
  const manifest = preparePortalObservationManifest(captured, contract, screens, []);
  return { ...f, captured, contract, screens, manifest };
};
it('requires two executions for two equal-byte roots; rejects duplicates and wrong root/route/state/viewport/assertions', async () => {
  const f = await fixtures();
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(
      `<html lang="en"><head><title>Fixture</title></head><body style="margin:0;background:white"><main data-sfp-root="${request.url === '/0' ? '1:1' : '2:1'}" style="width:100px;height:100px"></main></body></html>`,
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.unshift(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const spec = {
    root: f.workspaceRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    screens: f.screens,
    manifest: f.manifest,
    interactionContract: f.contract,
  };
  const report = await assertNativePortalPreview(spec);
  const verify = (value: unknown) =>
    verifyPortalVisualEvidence(
      f.captured,
      'SFP_PREVIEW_REPORT:' + JSON.stringify(value),
      f.workspaceRoot,
      new AbortController().signal,
      new Map(),
      f.manifest,
      f.contract,
    );
  expect(await verify(report)).toBe(true);
  const actualPath = join(f.workspaceRoot, String(report.screens[0]!.actualPath));
  const actualBytes = await readFile(actualPath);
  await writeFile(actualPath, Buffer.from('tampered screenshot'));
  expect(await verify(report)).toBe(false);
  await writeFile(actualPath, actualBytes);
  expect(await verify({ ...report, screens: [report.screens[0]] })).toBe(false);
  expect(await verify({ ...report, screens: [report.screens[0], report.screens[0]] })).toBe(false);
  for (const change of [
    { rootNodeId: '9:9' },
    { route: '/wrong' },
    { state: 'wrong' },
    { viewport: { width: 101, height: 100 } },
    { assertionIds: [storedChecksum('fake')] },
  ]) {
    const modified = structuredClone(report) as any;
    Object.assign(modified.screens[0].observation, change);
    expect(await verify(modified)).toBe(false);
  }
  expect(() =>
    preparePortalObservationManifest(f.captured, f.contract, [f.screens[0]!], []),
  ).toThrow('PORTAL_OBSERVATION_DISTINCT_ROOTS_REQUIRED');
  expect(
    await verifyPortalVisualEvidence(
      f.captured,
      'SFP_PREVIEW_REPORT:' + JSON.stringify(report),
      f.workspaceRoot,
      new AbortController().signal,
    ),
  ).toBe(false);
}, 30000);
it('executes captured navigation even when caller action arrays are empty; hidden unused controls fail', async () => {
  const f = await fixtures(true);
  let hidden = false;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(
      `<html lang="en"><head><title>Fixture</title><style>body{margin:0;background:white}button{border:0;background:white;color:white;width:10px;height:10px;${hidden ? 'opacity:0' : ''}}</style></head><body><main data-sfp-root="${request.url === '/0' ? '1:1' : '2:1'}" style="width:100px;height:100px"><button data-sfp-node="1:2" aria-label="Next" onclick="location.href='/1'">.</button></main></body></html>`,
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.unshift(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const spec = {
    root: f.workspaceRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    screens: f.screens,
    manifest: f.manifest,
    interactionContract: f.contract,
  };
  const report = await assertNativePortalPreview(spec);
  expect((report.screens[0] as any).interactionReports[0]).toMatchObject({
    passed: true,
    destinationNodeId: '2:1',
  });
  expect(
    await verifyPortalVisualEvidence(
      f.captured,
      'SFP_PREVIEW_REPORT:' + JSON.stringify(report),
      f.workspaceRoot,
      new AbortController().signal,
      new Map(),
      f.manifest,
      f.contract,
    ),
  ).toBe(true);
  const removed = structuredClone(report) as any;
  removed.screens[0].interactionReports = [];
  expect(
    await verifyPortalVisualEvidence(
      f.captured,
      'SFP_PREVIEW_REPORT:' + JSON.stringify(removed),
      f.workspaceRoot,
      new AbortController().signal,
      new Map(),
      f.manifest,
      f.contract,
    ),
  ).toBe(false);
  hidden = true;
  const other = join(f.root, 'hidden');
  await mkdir(other);
  await expect(assertNativePortalPreview({ ...spec, root: other })).rejects.toThrow(
    'PORTAL_PREVIEW_FAILED',
  );
}, 30000);
it('keeps the primitive copy exception source-bound and disallows a primitive with a reaction', async () => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const assets = join(f.root, 'primitive-assets');
  await mkdir(assets);
  const bytes = white();
  await writeFile(join(assets, 'oracle.png'), bytes);
  await writeFile(join(f.workspaceRoot, 'primitive.png'), bytes);
  const nodes = [
    { id: '1:1', type: 'RECTANGLE', width: 100, height: 100 },
    { id: '2:1', type: 'FRAME', width: 100, height: 100 },
  ];
  const make = async (reaction: boolean) =>
    currentCaptureFixture(f, {
      nodes: reaction
        ? [
            {
              ...nodes[0],
              reactions: [
                {
                  trigger: { type: 'ON_CLICK' },
                  actions: [{ type: 'NODE', navigation: 'NAVIGATE', destinationId: '2:1' }],
                },
              ],
            },
            nodes[1],
          ]
        : nodes,
      assetRoot: assets,
      assets: nodes.map(node => ({
        query: { kind: 'png', nodeId: node.id },
        status: 'captured',
        path: 'oracle.png',
        sha256: storedChecksum(bytes),
        bytes: bytes.length,
      })),
    });
  const { captured } = await make(false);
  const contract = derivePortalInteractionContract(captured, []);
  const screen = {
    id: 'frame',
    rootNodeId: '2:1',
    state: 'source:2:1',
    path: '/',
    viewport: { width: 100, height: 100 },
    oraclePath: 'oracle.png',
    oracleRoot: assets,
    oracleHash: storedChecksum(bytes),
    assertionIds: [],
  };
  const copies = [
    {
      nodeId: '1:1',
      path: 'primitive.png',
      oraclePath: 'oracle.png',
      oracleRoot: assets,
      oracleHash: storedChecksum(bytes),
    },
  ];
  const manifest = preparePortalObservationManifest(captured, contract, [screen], copies);
  const reactive = await make(true);
  expect(() =>
    preparePortalObservationManifest(
      reactive.captured,
      derivePortalInteractionContract(reactive.captured, []),
      [screen],
      copies,
    ),
  ).toThrow('PORTAL_OBSERVATION_PRIMITIVE_INVALID');
  const server = createServer((_q, r) => {
    r.setHeader('content-type', 'text/html');
    r.end(
      '<html lang="en"><head><title>Primitive</title></head><body style="margin:0;background:white"><main data-sfp-root="2:1" style="width:100px;height:100px"></main></body></html>',
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.unshift(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const report = await assertNativePortalPreview({
    root: f.workspaceRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    manifest,
    interactionContract: contract,
    screens: [screen],
    assets: copies,
  });
  const output = 'SFP_PREVIEW_REPORT:' + JSON.stringify(report);
  const published = new Map([['primitive.png', storedChecksum(bytes)]]);
  expect(
    await verifyPortalVisualEvidence(
      captured,
      output,
      f.workspaceRoot,
      new AbortController().signal,
      published,
      manifest,
      contract,
    ),
  ).toBe(true);
  await writeFile(join(f.workspaceRoot, 'primitive.png'), 'changed');
  expect(
    await verifyPortalVisualEvidence(
      captured,
      output,
      f.workspaceRoot,
      new AbortController().signal,
      published,
      manifest,
      contract,
    ),
  ).toBe(false);
}, 30000);
