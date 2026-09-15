import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import { firefox } from 'playwright';
import { afterEach, expect, it } from 'vitest';

import {
  PortalConsumptionBatchSchema,
  type PortalConsumptionCheck,
} from '../../../shared/src/portal-consumption.js';
import { derivePortalInteractionContract } from '../../src/portal/interaction-evidence.js';
import { preparePortalObservationManifest } from '../../src/portal/observation-manifest.js';
import {
  consumptionCheckHash,
  observePortalConsumption,
  PortalConsumptionResources,
  preparePortalConsumptionObserver,
} from '../../src/portal/preview-consumption.js';
import { assertNativePortalPreview } from '../../src/portal/preview.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const hash = storedChecksum('fixture');
const check = (
  id: string,
  selector: string,
  expectation: PortalConsumptionCheck['expectation'],
) => {
  const value = {
    checkId: id,
    resultId: 'result',
    resultHash: hash,
    rowId: 'row-' + id,
    rowHash: hash,
    rootNodeId: '1:1',
    route: '/',
    state: 'source:1:1',
    selector,
    phase: 'source' as const,
    expectation,
  };
  return { ...value, expectedHash: consumptionCheckHash(value) };
};
const batch = (checks: PortalConsumptionCheck[]) =>
  PortalConsumptionBatchSchema.parse({
    version: 1,
    contextHash: hash,
    blueprintHash: hash,
    declarationsHash: hash,
    captureFingerprint: hash,
    candidateHash: hash,
    checks,
  });
const fixture = async (html: string, assets: Record<string, Buffer> = {}) => {
  const server = createServer((request, response) => {
    const asset = assets[request.url ?? ''];
    response.writeHead(asset || request.url === '/' ? 200 : 404, {
      'content-type': asset ? 'image/png' : 'text/html; charset=utf-8',
    });
    response.end(asset ?? html);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanups.push(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const url = `http://127.0.0.1:${address.port}`;
  await preparePortalConsumptionObserver();
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 400, height: 400 },
    serviceWorkers: 'block',
  });
  cleanups.unshift(() => browser.close());
  const page = await context.newPage(),
    resources = new PortalConsumptionResources(url, new AbortController().signal);
  await context.route('**/*', route => resources.handle(route));
  await page.goto(url, { waitUntil: 'networkidle' });
  return {
    page,
    resources,
    url,
    observe: (checks: PortalConsumptionCheck[]) =>
      observePortalConsumption(
        page,
        batch(checks),
        { rootNodeId: '1:1', route: '/', state: 'source:1:1' },
        'source',
        resources,
      ),
  };
};
it('observes real scoped properties, source modes and opacity despite poisoned page globals', async () => {
  const f = await fixture(
    `<html><style>#root{width:200px;height:200px}#valid{color:rgba(255,0,0,.5);opacity:.4;padding-left:12px;font:16px monospace}#hidden{opacity:0;color:red}#outside{color:red}</style><body><main id="root" data-sfp-root="1:1"><span id="valid">상품</span><span id="hidden">hidden</span></main><span id="outside">outside</span><script>window.getComputedStyle=()=>({getPropertyValue:()=>"rgb(0,0,255)"});document.querySelectorAll=()=>[];Element.prototype.getAttribute=()=>"forged";</script></body></html>`,
  );
  const rows = await f.observe([
    check('color', '#valid', {
      kind: 'property',
      property: 'color',
      value: { kind: 'color', value: [1, 0, 0, 0.5] },
    }),
    check('mode', '#valid', {
      kind: 'property',
      property: 'color',
      value: { kind: 'color', value: [0, 0, 1, 0.5] },
    }),
    check('alpha', '#valid', {
      kind: 'property',
      property: 'color',
      value: { kind: 'color', value: [1, 0, 0, 1] },
    }),
    check('opacity', '#valid', {
      kind: 'property',
      property: 'opacity',
      value: { kind: 'number', value: 0.4, unit: '' },
    }),
    check('padding', '#valid', {
      kind: 'property',
      property: 'padding-left',
      value: { kind: 'number', value: 12, unit: 'px' },
    }),
    check('text', '#valid', {
      kind: 'property',
      property: 'textContent',
      value: { kind: 'text', value: '상품' },
    }),
    check('font', '#valid', {
      kind: 'property',
      property: 'font-family',
      value: { kind: 'font', value: 'monospace' },
    }),
    check('hidden', '#hidden', {
      kind: 'property',
      property: 'color',
      value: { kind: 'color', value: [1, 0, 0, 1] },
    }),
    check('outside', '#outside', {
      kind: 'property',
      property: 'color',
      value: { kind: 'color', value: [1, 0, 0, 1] },
    }),
  ]);
  expect(rows.map(row => [row.checkId, row.passed])).toEqual([
    ['color', true],
    ['mode', false],
    ['alpha', false],
    ['opacity', true],
    ['padding', true],
    ['text', true],
    ['font', true],
    ['hidden', false],
    ['outside', false],
  ]);
}, 30000);
it('proves inherited and local CSS variable influence, rejects unused declarations and restores inline state', async () => {
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" style="--brand:rgb(255,0,0) !important;color:var(--brand);width:200px;height:200px"><span id="inherited">inherited</span><span id="local" style="--local:rgb(255,0,0);color:var(--local)">local</span><span id="unused" style="--unused:red;color:red">unused</span></main></body></html>',
  );
  const before = await f.page.locator('main').getAttribute('style');
  const rows = await f.observe(
    ['inherited', 'local', 'unused'].map(id =>
      check(id, '#' + id, {
        kind: 'property',
        property: 'color',
        value: { kind: 'color', value: [1, 0, 0, 1] },
        cssVariable: '--' + (id === 'inherited' ? 'brand' : id),
      }),
    ),
  );
  expect(rows.map(row => row.passed)).toEqual([true, true, false]);
  expect(rows[0]?.actual?.dependency).toMatchObject({ ancestorDepth: 1, restored: true });
  expect(rows[1]?.actual?.dependency).toMatchObject({ ancestorDepth: 0, restored: true });
  expect(await f.page.locator('main').getAttribute('style')).toBe(before);
  expect(await f.page.locator('#inherited').getAttribute('style')).toBeNull();
}, 30000);
it('checks bytes actually delivered to a visible image and background rather than a copied unused asset', async () => {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const image = Buffer.from(png.encode([new Uint8Array(16 * 16 * 4).fill(255).buffer], 16, 16, 0)),
    other = Buffer.from(png.encode([new Uint8Array(16 * 16 * 4).fill(0).buffer], 16, 16, 0));
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" style="width:200px;height:200px"><img id="used" src="/used.png" width="16" height="16"><img id="wrong" src="/wrong.png" width="16" height="16"><div id="background" style="width:32px;height:32px;background-image:url(/used.png)"></div><span id="unused">copied only</span></main></body></html>',
    { '/used.png': image, '/wrong.png': other, '/unused.png': image },
  );
  const expected = {
    kind: 'asset' as const,
    usage: 'img' as const,
    hash: storedChecksum(image),
    bytes: image.length,
  };
  const rows = await f.observe([
    check('used', '#used', expected),
    check('wrong', '#wrong', expected),
    check('unused', '#unused', expected),
    check('background', '#background', { ...expected, usage: 'background-image' }),
  ]);
  expect(rows.map(row => row.passed)).toEqual([true, false, false, true]);
  expect(rows[0]?.actual?.resourceHash).toBe(storedChecksum(image));
}, 30000);
it('accepts bounded base64 and percent data images and rejects a background painted outside its box', async () => {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const image = Buffer.from(png.encode([new Uint8Array(16 * 16 * 4).fill(255).buffer], 16, 16, 0));
  const data = 'data:image/png;base64,' + image.toString('base64'),
    percent =
      'data:image/png,' + [...image].map(byte => '%' + byte.toString(16).padStart(2, '0')).join('');
  const f = await fixture(
    `<html><body><main data-sfp-root="1:1" style="width:200px;height:200px"><img id="base64" src="${data}" width="16" height="16"><img id="percent" src="${percent}" width="16" height="16"><div id="offscreen" style="width:32px;height:32px;background-image:url('${data}');background-repeat:no-repeat;background-position:9999px 0"></div></main></body></html>`,
  );
  const value = {
    kind: 'asset' as const,
    usage: 'img' as const,
    hash: storedChecksum(image),
    bytes: image.length,
  };
  const rows = await f.observe([
    check('base64', '#base64', value),
    check('percent', '#percent', value),
    check('offscreen', '#offscreen', { ...value, usage: 'background-image' }),
  ]);
  expect(rows.map(row => row.passed)).toEqual([true, true, false]);
}, 30000);
it('does not relabel a visible image from a later different hidden response at the same URL', async () => {
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const image = Buffer.from(png.encode([new Uint8Array(16 * 16 * 4).fill(255).buffer], 16, 16, 0)),
    other = Buffer.from(png.encode([new Uint8Array(16 * 16 * 4).fill(0).buffer], 16, 16, 0));
  const assets = { '/used.png': image };
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" style="width:200px;height:200px"><img id="used" src="/used.png" width="16" height="16"></main></body></html>',
    assets,
  );
  assets['/used.png'] = other;
  await f.page.evaluate(
    `new Promise(resolve=>{const img=document.createElement('img');img.crossOrigin='anonymous';img.style.display='none';img.onload=resolve;img.onerror=resolve;img.src='/used.png';document.body.append(img)})`,
  );
  const rows = await f.observe([
    check('old', '#used', {
      kind: 'asset',
      usage: 'img',
      hash: storedChecksum(image),
      bytes: image.length,
    }),
    check('new', '#used', {
      kind: 'asset',
      usage: 'img',
      hash: storedChecksum(other),
      bytes: other.length,
    }),
  ]);
  expect(rows.every(row => !row.passed)).toBe(true);
  expect(rows[0]?.reason).toBe('PORTAL_CONSUMPTION_RESOURCE_NOT_PROVEN');
}, 30000);
it('requires actual after-action state, qualified row hashes and visible component association', async () => {
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" data-sfp-state="idle" style="width:200px;height:200px"><button onclick="this.parentElement.dataset.sfpState=\'submitted\';document.querySelector(\'#value\').textContent=\'Saved\'">Save</button><span id="value" data-sfp-node="1:2">Idle</span></main></body></html>',
  );
  const original = check('state', '#value', {
      kind: 'property',
      property: 'textContent',
      value: { kind: 'text', value: 'Saved' },
    }),
    value = { ...original, state: 'submitted', phase: 'after-actions' as const };
  value.expectedHash = consumptionCheckHash(value);
  const observe = () =>
    observePortalConsumption(
      f.page,
      batch([value]),
      { rootNodeId: '1:1', route: '/', state: 'source:1:1' },
      'after-actions',
      f.resources,
    );
  expect((await observe())[0]?.passed).toBe(false);
  await f.page.getByRole('button').click();
  expect((await observe())[0]?.passed).toBe(true);
  const association = check('component', '#value', { kind: 'component', sourceNodeId: '1:2' });
  expect((await f.observe([association]))[0]?.passed).toBe(true);
  expect(
    (await f.observe([{ ...association, rowHash: storedChecksum('different') }]))[0]?.reason,
  ).toBe('PORTAL_CONSUMPTION_EXPECTATION_CHANGED');
}, 30000);
it('fails explicit check and aggregate capacity limits instead of truncating expectations', () => {
  const item = check('one', 'main', {
    kind: 'property',
    property: 'textContent',
    value: { kind: 'text', value: 'x' },
  });
  expect(() => batch([item, item])).toThrow('PORTAL_CONSUMPTION_DUPLICATE_CHECK');
  expect(() =>
    batch(Array.from({ length: 4097 }, (_, index) => ({ ...item, checkId: String(index) }))),
  ).toThrow(/Too big|PORTAL_CONSUMPTION_CAPACITY/u);
  expect(() =>
    batch(
      Array.from({ length: 200 }, (_, index) => ({
        ...item,
        checkId: String(index),
        expectation: {
          kind: 'property',
          property: 'textContent',
          value: { kind: 'text', value: 'x'.repeat(16384) },
        },
      })),
    ),
  ).toThrow('PORTAL_CONSUMPTION_CAPACITY');
});

it('runs the complete approved batch in real preview and omits consumption proof when no batch exists', async () => {
  const f = await fixture(
    '<html lang="en"><head><title>Preview</title></head><body style="margin:0"><main data-sfp-root="1:1" style="width:100px;height:100px;--page:white;background-color:var(--page)"></main></body></html>',
  );
  const state = await portalFixture();
  cleanups.push(state.cleanup);
  const png =
      'encode' in pngModule
        ? pngModule
        : (pngModule as unknown as { default: typeof pngModule }).default,
    oracle = Buffer.from(png.encode([new Uint8Array(100 * 100 * 4).fill(255).buffer], 100, 100, 0));
  const assets = join(state.root, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'root.png'), oracle);
  const captured = await currentCaptureFixture(state, {
    assetRoot: assets,
    assets: [
      {
        query: { kind: 'png', nodeId: '1:1' },
        status: 'captured',
        path: 'root.png',
        sha256: storedChecksum(oracle),
        bytes: oracle.length,
      },
    ],
  });
  const contract = derivePortalInteractionContract(captured.captured, []);
  const screen = {
    id: 'root',
    rootNodeId: '1:1',
    state: 'source:1:1',
    path: '/',
    viewport: { width: 100, height: 100 },
    oraclePath: 'root.png',
    oracleRoot: assets,
    oracleHash: storedChecksum(oracle),
    assertionIds: [],
  };
  const manifest = preparePortalObservationManifest(captured.captured, contract, [screen], []);
  const consumption = {
    ...batch([
      check('page', 'main', {
        kind: 'property',
        property: 'background-color',
        value: { kind: 'color', value: [1, 1, 1, 1] },
        cssVariable: '--page',
      }),
    ]),
    captureFingerprint: contract.captureFingerprint,
  };
  const spec = {
    root: state.workspaceRoot,
    baseUrl: f.url,
    manifest,
    interactionContract: contract,
    screens: [screen],
    consumption,
  };
  const report = await assertNativePortalPreview(spec, undefined, { emitReport: false });
  expect(report.consumption?.observations).toHaveLength(1);
  expect(report.consumption?.observations[0]?.passed).toBe(true);
  const other = join(state.root, 'without');
  await mkdir(other);
  const plain = await assertNativePortalPreview(
    { ...spec, root: other, consumption: undefined },
    undefined,
    { emitReport: false },
  );
  expect(plain).not.toHaveProperty('consumption');
  const redirect = createServer((_request, response) => {
    response.writeHead(302, { location: f.url });
    response.end();
  });
  await new Promise<void>(done => redirect.listen(0, '127.0.0.1', done));
  cleanups.push(async () => {
    await new Promise<void>(done => redirect.close(() => done()));
  });
  const address = redirect.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const cross = join(state.root, 'redirect');
  await mkdir(cross);
  await expect(
    assertNativePortalPreview(
      {
        ...spec,
        root: cross,
        baseUrl: 'http://127.0.0.1:' + address.port,
        allowedOrigins: [f.url],
      },
      undefined,
      { emitReport: false },
    ),
  ).rejects.toThrow(/NS_ERROR|ERR_|ORIGIN_MISMATCH/iu);
}, 30000);

it('does not claim an unavailable first font or a covered/unrelated component as consumed', async () => {
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" style="width:200px;height:200px;position:relative"><span id="missing" style="font-family:MissingSfpFontReference">text</span><span id="covered" data-sfp-node="1:2" style="position:absolute;left:0;top:50px;width:30px;height:30px">covered</span><div style="position:absolute;left:0;top:50px;width:30px;height:30px;background:white;z-index:2"></div></main></body></html>',
  );
  const values = await f.observe([
    check('font', '#missing', {
      kind: 'property',
      property: 'font-family',
      value: { kind: 'font', value: 'MissingSfpFontReference' },
    }),
    check('component', '#covered', { kind: 'component', sourceNodeId: '1:2' }),
  ]);
  expect(values.map(value => value.passed)).toEqual([false, false]);
}, 30000);

it('observes normal and italic font-style and proves its live CSS variable dependency', async () => {
  const f = await fixture(
    '<html><body><main data-sfp-root="1:1" style="width:200px;height:200px"><span id="italic" style="--slant:italic;font-style:var(--slant)">italic</span><span id="normal" style="font-style:normal">normal</span><span id="unused" style="--slant:italic;font-style:italic">unused</span></main></body></html>',
  );
  const values = await f.observe([
    check('italic', '#italic', {
      kind: 'property',
      property: 'font-style',
      value: { kind: 'text', value: 'italic' },
      cssVariable: '--slant',
    }),
    check('normal', '#normal', {
      kind: 'property',
      property: 'font-style',
      value: { kind: 'text', value: 'normal' },
    }),
    check('wrong', '#normal', {
      kind: 'property',
      property: 'font-style',
      value: { kind: 'text', value: 'italic' },
    }),
    check('unused', '#unused', {
      kind: 'property',
      property: 'font-style',
      value: { kind: 'text', value: 'italic' },
      cssVariable: '--slant',
    }),
  ]);
  expect(values.map(value => value.passed)).toEqual([true, true, false, false]);
}, 30000);
