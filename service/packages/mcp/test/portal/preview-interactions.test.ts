import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import { preparePortalObservationManifest } from '../../src/portal/observation-manifest.js';
import { assertNativePortalPreview } from '../../src/portal/preview.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
const setup = async (nodes: unknown[], requirements: any[] = []) => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const oracle = Buffer.from(
    png.encode([new Uint8Array(100 * 100 * 4).fill(255).buffer], 100, 100, 0),
  );
  const assets = join(f.root, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'root.png'), oracle);
  const capture = await currentCaptureFixture(f, {
    nodes,
    assetRoot: assets,
    assets: nodes.map(node => ({
      query: { kind: 'png' as const, nodeId: String((node as any).id) },
      status: 'captured' as const,
      path: 'root.png',
      sha256: storedChecksum(oracle),
      bytes: oracle.length,
    })),
  });
  const contract = derivePortalInteractionContract(capture.captured, requirements);
  const screen = {
    id: 'root',
    rootNodeId: '1:1',
    state: 'source:1:1',
    path: '/',
    viewport: { width: 100, height: 100 },
    oraclePath: 'root.png',
    oracleRoot: assets,
    oracleHash: storedChecksum(oracle),
    assertionIds: contract.interactions.map(value => value.id),
  };
  const screens = nodes.map((node, index) =>
    Object.assign({}, screen, {
      id: 'root-' + index,
      rootNodeId: String((node as any).id),
      state: 'source:' + String((node as any).id),
      path: index ? '/' + index : '/',
      assertionIds: contract.interactions
        .filter(value => value.rootNodeId === (node as any).id)
        .map(value => value.id),
    }),
  );
  const manifest = preparePortalObservationManifest(capture.captured, contract, screens, []);
  return { ...f, contract, screen: screens[0]!, screens, manifest };
};
const serve = async (content: (url: string) => string) => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(content(request.url ?? '/'));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanups.unshift(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  return `http://127.0.0.1:${address.port}`;
};
it('observes source-linked form state changes and rejects unchanged decorative assertions', async () => {
  const f = await setup(
    [
      {
        id: '1:1',
        type: 'FRAME',
        width: 100,
        height: 100,
        children: [
          { id: '1:2', type: 'RECTANGLE', width: 10, height: 10 },
          { id: '1:3', type: 'TEXT', width: 10, height: 10 },
        ],
      },
    ],
    [
      {
        id: 'email-form',
        description: 'Submit an email form',
        layers: ['frontend'],
        required: true,
      },
    ],
  );
  let inert = false;
  const baseUrl = await serve(
    () =>
      `<html lang="en"><head><title>Form</title><style>body{margin:0;background:white}input{position:absolute;width:10px;height:10px;border:0;background:white;color:white;padding:0}output{color:white;font-size:8px}</style></head><body><main data-sfp-root="1:1" style="width:100px;height:100px"><input data-sfp-node="1:2" aria-label="Email" oninput="${inert ? '' : `document.querySelector('output').textContent=this.value`}"><output data-sfp-node="1:3">${inert ? 'test@example.test' : ''}</output></main></body></html>`,
  );
  const spec = {
    root: f.workspaceRoot,
    baseUrl,
    manifest: f.manifest,
    interactionContract: f.contract,
    screens: [
      {
        ...f.screen,
        workflowAssertions: [
          {
            requirementId: 'email-form',
            actions: [
              { kind: 'fill', selector: '[data-sfp-node="1:2"]', value: 'test@example.test' },
              { kind: 'text', selector: '[data-sfp-node="1:3"]', value: 'test@example.test' },
            ],
          },
        ],
      },
    ],
  };
  const result = await assertNativePortalPreview(spec);
  expect((result.screens[0] as any).workflowReports[0].passed).toBe(true);
  inert = true;
  const other = join(f.root, 'inert');
  await mkdir(other);
  await expect(assertNativePortalPreview({ ...spec, root: other })).rejects.toThrow(
    'PORTAL_PREVIEW_FAILED',
  );
}, 30000);
it('requires measured visible motion separately from reduced-motion still screenshots', async () => {
  const f = await setup([
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
          reactions: [
            {
              trigger: { type: 'ON_CLICK' },
              actions: [
                {
                  type: 'NODE',
                  navigation: 'OVERLAY',
                  destinationId: '1:3',
                  transition: { type: 'DISSOLVE', duration: 0.3 },
                },
              ],
            },
          ],
        },
        { id: '1:3', type: 'FRAME', width: 30, height: 30 },
      ],
    },
  ]);
  let animate = true;
  const baseUrl = await serve(
    () =>
      `<html lang="en"><head><title>Motion</title><script>document.getAnimations=()=>[];window.getComputedStyle=()=>({visibility:'visible',opacity:'1',getPropertyValue:()=> 'forged'});</script><style>body{margin:0;background:white}button{border:0;color:white;background:white;width:10px;height:10px}#overlay{background:red;width:30px;height:30px;${animate ? 'animation:appear 300ms linear both' : ''}}@keyframes appear{from{opacity:0}to{opacity:1}}</style></head><body><main data-sfp-root="1:1" style="width:100px;height:100px"><button data-sfp-node="1:2" aria-label="Open" onclick="document.querySelector('#overlay').hidden=false">.</button><div id="overlay" data-sfp-node="1:3" role="dialog" aria-label="Overlay" hidden></div></main></body></html>`,
  );
  const spec = {
    root: f.workspaceRoot,
    baseUrl,
    manifest: f.manifest,
    interactionContract: f.contract,
    screens: [f.screen],
  };
  const result = await assertNativePortalPreview(spec);
  const temporal = (result.screens[0] as any).interactionReports[0].temporal;
  expect(temporal.observedMs).toBeGreaterThan(200);
  expect(temporal.observedMs).toBeLessThan(400);
  expect(temporal.animatedProperties).toContain('opacity');
  animate = false;
  const other = join(f.root, 'still');
  await mkdir(other);
  await expect(assertNativePortalPreview({ ...spec, root: other })).rejects.toThrow(
    'PORTAL_PREVIEW_FAILED',
  );
}, 30000);

it('executes source-bound close, change-state and back actions against actual local state', async () => {
  for (const kind of ['CLOSE', 'CHANGE_TO', 'BACK']) {
    const action =
      kind === 'CHANGE_TO'
        ? { type: 'NODE', navigation: 'CHANGE_TO', destinationId: '1:3' }
        : { type: kind };
    const root = {
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
          reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [action] }],
        },
        { id: '1:3', type: 'FRAME', width: 20, height: 20 },
      ],
    };
    const f = await setup(
      kind === 'BACK' ? [root, { id: '2:1', type: 'FRAME', width: 100, height: 100 }] : [root],
    );
    const onClick =
      kind === 'CLOSE'
        ? 'this.parentElement.hidden=true'
        : kind === 'BACK'
          ? 'history.back()'
          : "this.hidden=true;document.querySelector('#target').hidden=false";
    const baseUrl = await serve(
      url =>
        '<html lang="en"><head><title>States</title><style>body{margin:0;background:white}button{width:10px;height:10px;border:0;color:white;background:white}</style></head><body><main data-sfp-root="' +
        (url === '/1' ? '2:1' : '1:1') +
        '" style="width:100px;height:100px"><div ' +
        (kind === 'CLOSE' ? 'role="dialog" aria-label="Dialog"' : '') +
        '><button data-sfp-node="1:2" aria-label="Action" onclick="' +
        onClick +
        '">.</button></div><div id="target" data-sfp-node="1:3" hidden>Changed</div></main></body></html>',
    );
    const result = await assertNativePortalPreview({
      root: f.workspaceRoot,
      baseUrl,
      manifest: f.manifest,
      interactionContract: f.contract,
      screens: f.screens,
    });
    expect((result.screens[0] as any).interactionReports[0].passed).toBe(true);
  }
}, 30000);

it('rejects candidate-written window motion data without actual animation', async () => {
  const f = await setup([
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
          reactions: [
            {
              trigger: { type: 'ON_CLICK' },
              actions: [
                {
                  type: 'NODE',
                  navigation: 'OVERLAY',
                  destinationId: '1:3',
                  transition: { type: 'DISSOLVE', duration: 0.3 },
                },
              ],
            },
          ],
        },
        { id: '1:3', type: 'FRAME', width: 30, height: 30 },
      ],
    },
  ]);
  const baseUrl = await serve(
    () =>
      `<html lang="en"><head><title>Static</title><style>body{margin:0;background:white}button{border:0;color:white;background:white;width:10px;height:10px}#overlay{background:red;width:30px;height:30px}</style></head><body><main data-sfp-root="1:1" style="width:100px;height:100px"><button data-sfp-node="1:2" aria-label="Open" onclick="document.querySelector('#overlay').hidden=false;window.__sfpMotion=[{duration:300,easing:'linear',frames:[{opacity:'0'},{opacity:'1'}],start:0,elapsed:300,samples:[{x:'0',y:'0',opacity:'0'},{x:'0',y:'0',opacity:'1'}]}]">.</button><div id="overlay" data-sfp-node="1:3" role="dialog" aria-label="Overlay" hidden></div></main></body></html>`,
  );
  await expect(
    assertNativePortalPreview({
      root: f.workspaceRoot,
      baseUrl,
      manifest: f.manifest,
      interactionContract: f.contract,
      screens: [f.screen],
    }),
  ).rejects.toThrow('PORTAL_PREVIEW_FAILED');
}, 30000);
