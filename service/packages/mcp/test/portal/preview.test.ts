import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { assertNativePortalPreview, comparePortalPng } from '../../src/portal/preview.js';
import { verifyPortalVisualEvidence } from '../../src/portal/visual-evidence.js';
const png =
  'encode' in pngModule
    ? pngModule
    : (pngModule as unknown as { default: typeof pngModule }).default;
const solid = (red: number, green: number, blue: number, width = 100, height = 100) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = red;
    rgba[at + 1] = green;
    rgba[at + 2] = blue;
    rgba[at + 3] = 255;
  }
  return new Uint8Array(png.encode([rgba.buffer], width, height, 0));
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const part = relative(tmpdir(), root);
    if (!part || isAbsolute(part) || part.startsWith('..'))
      throw Error('Invalid preview cleanup root');
    await rm(root, { recursive: true, force: true });
  }
});
it('compares actual RGBA values and refuses malformed or oversized PNG inputs', () => {
  const blue = solid(0, 0, 255),
    red = solid(255, 0, 0);
  expect(comparePortalPng(blue, blue)).toMatchObject({
    sameDimensions: true,
    ratio: 0,
    differingPixels: 0,
  });
  expect(comparePortalPng(blue, red)).toMatchObject({
    sameDimensions: true,
    ratio: 1,
    differingPixels: 10000,
  });
  const large = Buffer.from(blue);
  large.writeUInt32BE(100_000, 16);
  expect(() => comparePortalPng(large, red)).toThrow('PORTAL_PREVIEW_PIXEL_LIMIT');
  const duplicate = Buffer.concat([
    Buffer.from(blue).subarray(0, 33),
    Buffer.from(blue).subarray(8),
  ]);
  expect(() => comparePortalPng(duplicate, red)).toThrow('PORTAL_PREVIEW_PNG_INVALID');
});
it('renders an owned local fixture in Firefox and rejects a real visual mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-firefox-preview-'));
  roots.push(root);
  const oracle = solid(0, 0, 255);
  await writeFile(join(root, 'oracle.png'), oracle);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      `<html lang="en"><head><title>Native preview fixture</title></head><body style="margin:0;background:${request.url === '/red' ? 'red' : 'blue'}"><main aria-label="Scene" style="width:100px;height:100px"></main></body></html>`,
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture server address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const screen = {
    oraclePath: 'oracle.png',
    oracleHash: storedChecksum(oracle),
    viewport: { width: 100, height: 100 },
    maxDifferenceRatio: 0,
    actions: [{ kind: 'visible', selector: 'main' }],
  };
  try {
    const result = await assertNativePortalPreview({
      root,
      baseUrl,
      screens: [{ ...screen, id: 'blue', path: '/blue' }],
    });
    expect(result.browser).toBe('firefox');
    expect(result.screens[0]).toMatchObject({ passed: true, ratio: 0 });
    const captured = {
      raw: '{}',
      hash: storedChecksum('{}'),
      capturedAt: new Date().toISOString(),
      assetRoot: root,
      complete: true,
      liveVerified: true as const,
      assets: [
        {
          query: { kind: 'png' as const, nodeId: '1:1' },
          status: 'captured' as const,
          path: 'oracle.png',
          sha256: storedChecksum(oracle),
        },
      ],
    };
    const output = `SFP_PREVIEW_REPORT:${JSON.stringify(result)}`;
    expect(
      await verifyPortalVisualEvidence(captured, output, root, new AbortController().signal),
    ).toBe(false);
    expect(
      await verifyPortalVisualEvidence(
        captured,
        'command exited successfully',
        root,
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(
      await verifyPortalVisualEvidence(
        {
          ...captured,
          assets: [
            ...captured.assets,
            { ...captured.assets[0]!, sha256: storedChecksum('unrelated oracle') },
          ],
        },
        output,
        root,
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(
      (await readFile(join(root, '.sfp-native-preview/blue.actual.png'))).length,
    ).toBeGreaterThan(0);
    await expect(
      assertNativePortalPreview({
        root,
        baseUrl,
        screens: [{ ...screen, id: 'red', path: '/red' }],
      }),
    ).rejects.toMatchObject({ code: 'PORTAL_PREVIEW_FAILED' });
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
}, 30_000);

it('captures a small real component in its hover state without shrinking the browser viewport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-component-preview-'));
  roots.push(root);
  const oracle = solid(0, 0, 255, 50, 32);
  await writeFile(join(root, 'component.png'), oracle);
  const panel = solid(249, 241, 231, 280, 177);
  await writeFile(join(root, 'panel.png'), panel);
  await writeFile(join(root, 'copied-panel.png'), panel);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<html lang="en"><head><title>Component preview</title><style>#tile{position:absolute;left:50px;top:50px;width:50px;height:32px;padding:0;border:0;background:red}#tile[data-color="blue"]:hover{background:blue}</style></head><body><select id="color" aria-label="Color" onchange="document.querySelector(\'#tile\').dataset.color=this.value"><option>red</option><option>blue</option></select><button id="tile" aria-label="Component"></button><span id="notice" hidden>Transient state</span></body></html>',
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server');
  try {
    const result = await assertNativePortalPreview({
      root,
      baseUrl: `http://127.0.0.1:${address.port}`,
      assets: [
        {
          nodeId: '2:1',
          path: 'copied-panel.png',
          oraclePath: 'panel.png',
          oracleHash: storedChecksum(panel),
        },
      ],
      screens: [
        {
          id: 'component',
          path: '/',
          oraclePath: 'component.png',
          oracleHash: storedChecksum(oracle),
          viewport: { width: 200, height: 200 },
          captureSelector: '#tile',
          maxDifferenceRatio: 0,
          beforeActions: [
            { kind: 'hidden', selector: '#notice' },
            { kind: 'select', selector: '#color', value: 'blue' },
            { kind: 'hover', selector: '#tile' },
          ],
        },
      ],
    });
    expect(result.screens[0]).toMatchObject({ passed: true, ratio: 0 });
    const captured = {
      raw: JSON.stringify({
        nodes: [
          { id: '1:1', type: 'FRAME', width: 50, height: 32 },
          {
            id: '2:1',
            type: 'GROUP',
            width: 280,
            height: 177,
            children: [{ type: 'RECTANGLE', width: 280, height: 177 }],
          },
        ],
      }),
      hash: storedChecksum('{}'),
      assetRoot: root,
      capturedAt: new Date().toISOString(),
      complete: true,
      liveVerified: true as const,
      assets: [
        {
          query: { kind: 'png' as const, nodeId: '1:1' },
          status: 'captured' as const,
          path: 'component.png',
          sha256: storedChecksum(oracle),
        },
        {
          query: { kind: 'png' as const, nodeId: '2:1' },
          status: 'captured' as const,
          path: 'panel.png',
          sha256: storedChecksum(panel),
        },
      ],
    };
    const published = new Map([['copied-panel.png', storedChecksum(panel)]]);
    expect(
      await verifyPortalVisualEvidence(
        captured,
        `SFP_PREVIEW_REPORT:${JSON.stringify(result)}`,
        root,
        new AbortController().signal,
        published,
      ),
    ).toBe(false);
    const mislabeledScreen = {
      ...captured,
      raw: captured.raw.replace('"type":"GROUP"', '"type":"FRAME"'),
    };
    await writeFile(join(root, 'copied-panel.png'), Buffer.from('changed'));
    expect(
      await verifyPortalVisualEvidence(
        captured,
        `SFP_PREVIEW_REPORT:${JSON.stringify(result)}`,
        root,
        new AbortController().signal,
        published,
      ),
    ).toBe(false);
    await writeFile(join(root, 'copied-panel.png'), panel);
    expect(
      await verifyPortalVisualEvidence(
        mislabeledScreen,
        `SFP_PREVIEW_REPORT:${JSON.stringify(result)}`,
        root,
        new AbortController().signal,
        published,
      ),
    ).toBe(false);
    await writeFile(join(root, '.sfp-native-preview/copied-panel.png'), panel);
    const scratchOnly = {
      ...result,
      assets: result.assets.map(asset =>
        Object.assign({}, asset, { actualPath: '.sfp-native-preview/copied-panel.png' }),
      ),
    };
    expect(
      await verifyPortalVisualEvidence(
        captured,
        `SFP_PREVIEW_REPORT:${JSON.stringify(scratchOnly)}`,
        root,
        new AbortController().signal,
        published,
      ),
    ).toBe(false);
    expect(
      comparePortalPng(
        oracle,
        await readFile(join(root, '.sfp-native-preview/component.actual.png')),
      ),
    ).toMatchObject({ sameDimensions: true, width: 50, height: 32, ratio: 0 });
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
}, 30_000);
