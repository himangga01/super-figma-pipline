import { createServer, request as httpRequest } from 'node:http';
import { connect, type Socket } from 'node:net';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import { chromium } from 'playwright';
import { beforeEach, expect, it } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { PortalConsumptionBatchSchema } from '../../../shared/src/portal-consumption.js';
import { PortalNativeContourExpectationSchema } from '../../../shared/src/portal-native-contours.js';
import { googleChromeExecutable } from '../../src/portal/chrome-runtime.js';
import { matchesNativeContours } from '../../src/portal/native-contours.js';
import {
  consumptionCheckHash,
  observePortalConsumption,
  PortalConsumptionResources,
  preparePortalConsumptionObserver,
} from '../../src/portal/preview-consumption.js';
import { observeNativeContours } from '../../src/portal/preview-native-contours.js';
import { verifyConsumptionObservations } from '../../src/portal/recipes/core-consumption.js';

beforeEach(context => requireChrome(context, googleChromeExecutable()));
const path = 'M0 0 L1 0 L1 1 Z',
  hash = storedChecksum('fixture');
const expected = PortalNativeContourExpectationSchema.parse({
  kind: 'native-contour',
  version: 1,
  nodeId: '1:1',
  documentHash: hash,
  captureFingerprint: hash,
  fileKeyHash: hash,
  pageId: '1:0',
  characters: 'A',
  charactersHash: storedChecksum('A'),
  width: 10,
  height: 12,
  nominalFontSize: 10,
  paintedFontSizes: [14],
  fonts: [{ family: 'Fixture', style: 'Regular', weight: 400, digest: '0'.repeat(40) }],
  paths: [
    {
      index: 0,
      commandsHash: hash,
      pathHash: storedChecksum(path),
      transform: [14, 0, 0, -14, 0, 10],
      strokeWidth: 0,
    },
  ],
  paint: {
    fill: 'rgb(0, 0, 0)',
    stroke: 'none',
    opacity: 1,
    filter: 'none',
    paintOrder: 'stroke fill',
  },
});
const html = `<html><body><section data-sfp-root="1:0" style="width:100px;height:100px"><div data-sfp-node="1:1" style="width:10px;height:12px;color:black;font-size:10px"><svg width="10" height="12" role="img" aria-labelledby="label" style="overflow:visible"><title id="label">A</title><g fill="currentColor"><path d="${path}" transform="translate(0 10) scale(14 -14)" style="paint-order:stroke fill"/></g></svg></div></section></body></html>`;
const input = { selector: '[data-sfp-node="1:1"]', rootNodeId: '1:0', nodeId: '1:1' };
async function fixture(
  work: (page: import('playwright').Page, url: string, proxyUrl: string) => Promise<void>,
  markup = html,
  afterDenied?: (request: import('node:http').IncomingMessage) => void,
) {
  const server = createServer((_q, r) => {
    r.setHeader('content-type', 'text/html');
    r.end(markup);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE_ADDRESS');
  const url = 'http://127.0.0.1:' + address.port;
  // The owned proxy forwards only this exact fixture origin; external HTTP/CONNECT never opens.
  const proxy = createServer((incoming, response) => {
    let target: URL;
    try {
      target = new URL(incoming.url ?? '');
    } catch {
      response.writeHead(403).end();
      return;
    }
    if (target.origin !== url || incoming.method !== 'GET') {
      response.writeHead(403).end();
      return;
    }
    const upstream = httpRequest(target, { method: 'GET' }, r => {
      response.writeHead(r.statusCode ?? 500, r.headers);
      r.pipe(response);
    });
    upstream.on('error', () => response.writeHead(502).end());
    upstream.end();
  });
  const deniedSockets = new Map<Socket, Promise<void>>(),
    unexpectedDeniedErrors: string[] = [];
  let deniedCount = 0,
    expectedClosingErrors = 0;
  proxy.on('connect', (request, socket: Socket) => {
    deniedCount++;
    const closed = new Promise<void>(done => socket.once('close', done));
    deniedSockets.set(socket, closed);
    socket.on('error', error => {
      if (
        deniedSockets.has(socket) &&
        (socket.writableEnded || socket.destroyed) &&
        ['ECONNRESET', 'EPIPE'].includes((error as NodeJS.ErrnoException).code ?? '')
      )
        expectedClosingErrors++;
      else unexpectedDeniedErrors.push('UNEXPECTED_DENIED_CONNECT_SOCKET_ERROR');
      socket.destroy();
    });
    socket.once('close', () => deniedSockets.delete(socket));
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    afterDenied?.(request);
  });
  await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done));
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === 'string') throw Error('FIXTURE_PROXY_ADDRESS');
  const executablePath = googleChromeExecutable();
  const browser = await chromium.launch({
    channel: 'chrome',
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    proxy: { server: 'http://127.0.0.1:' + proxyAddress.port, bypass: '<-loopback>' },
  });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === url
        ? route.continue()
        : route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    await page.goto(url);
    await work(page, url, 'http://127.0.0.1:' + proxyAddress.port);
  } finally {
    try {
      await browser.close();
    } finally {
      const closing = [...deniedSockets.values()];
      for (const socket of deniedSockets.keys()) socket.destroy();
      await Promise.all(closing);
      proxy.closeAllConnections();
      await new Promise<void>((done, reject) => proxy.close(e => (e ? reject(e) : done())));
      await new Promise<void>((done, reject) => server.close(e => (e ? reject(e) : done())));
      expect(unexpectedDeniedErrors).toEqual([]);
    }
  }
  return { deniedCount, expectedClosingErrors };
}
it('handles an actual peer reset only while denying owned CONNECT and retains all unexpected transport failures', async () => {
  let peer: Socket | undefined;
  const peerErrors: string[] = [];
  const result = await fixture(
    async (_page, _url, proxyUrl) => {
      peer = connect({ host: '127.0.0.1', port: Number(new URL(proxyUrl).port) });
      const closed = new Promise<void>(done => peer!.once('close', done));
      peer.on('error', () => peerErrors.push('UNEXPECTED_RESET_PROBE_PEER_ERROR'));
      await new Promise<void>(done =>
        peer!.once('connect', () => {
          peer!.write(
            'CONNECT blocked.invalid:443 HTTP/1.1\r\nHost: blocked.invalid:443\r\nx-sfp-reset-regression: 1\r\n\r\n',
          );
          done();
        }),
      );
      await closed;
      await new Promise<void>(done => setImmediate(done));
    },
    html,
    request => {
      if (request.headers['x-sfp-reset-regression'] === '1')
        process.nextTick(() => peer!.resetAndDestroy());
    },
  );
  expect(peerErrors).toEqual([]);
  expect(result.deniedCount).toBeGreaterThanOrEqual(1);
  expect(result.expectedClosingErrors).toBeGreaterThanOrEqual(1);
});
it('public consumption observer and independent receipt verification accept actual painted paths without claiming CSS font consumption', async () => {
  await preparePortalConsumptionObserver();
  await fixture(async (page, url) => {
    const binding = {
      checkId: 'check',
      resultId: 'result',
      resultHash: hash,
      rowId: 'row',
      rowHash: hash,
      rootNodeId: '1:0',
      route: '/',
      state: 'source:1:0',
      selector: input.selector,
      phase: 'source' as const,
      expectation: expected,
    };
    const check = { ...binding, expectedHash: consumptionCheckHash(binding) };
    const batch = PortalConsumptionBatchSchema.parse({
      version: 1,
      contextHash: hash,
      blueprintHash: hash,
      declarationsHash: hash,
      captureFingerprint: hash,
      candidateHash: hash,
      checks: [check],
    });
    const resources = new PortalConsumptionResources(url, new AbortController().signal);
    const values = await observePortalConsumption(
      page,
      batch,
      { rootNodeId: '1:0', route: '/', state: 'source:1:0' },
      'source',
      resources,
    );
    expect(values[0]!.reason).toBeNull();
    expect(values[0]!.passed).toBe(true);
    expect(values[0]!.actual?.fontAvailable).toBeNull();
    expect(verifyConsumptionObservations(batch, values).size).toBe(1);
    const forged = structuredClone(values);
    forged[0]!.actual!.nativeContour!.accessibleText = 'B';
    expect(() => verifyConsumptionObservations(batch, forged)).toThrow(
      'PORTAL_CONSUMPTION_OBSERVATION_FAILED',
    );
  });
});
it('rejects ancestor compositing that erases actual glyph pixels while preserving honest source contours', async () => {
  await preparePortalConsumptionObserver();
  const markup = html
    .replace('<body>', '<body style="margin:0;background:white">')
    .replace('<div data-sfp-node', '<div id="ancestor"><div data-sfp-node')
    .replace('</div></section>', '</div></div></section>');
  await fixture(async (page, url) => {
    const binding = {
      checkId: 'ancestor-check',
      resultId: 'result',
      resultHash: hash,
      rowId: 'row',
      rowHash: hash,
      rootNodeId: '1:0',
      route: '/',
      state: 'source:1:0',
      selector: input.selector,
      phase: 'source' as const,
      expectation: expected,
    };
    const batch = PortalConsumptionBatchSchema.parse({
      version: 1,
      contextHash: hash,
      blueprintHash: hash,
      declarationsHash: hash,
      captureFingerprint: hash,
      candidateHash: hash,
      checks: [{ ...binding, expectedHash: consumptionCheckHash(binding) }],
    });
    const resources = new PortalConsumptionResources(url, new AbortController().signal);
    const baseline = await observePortalConsumption(
      page,
      batch,
      { rootNodeId: '1:0', route: '/', state: 'source:1:0' },
      'source',
      resources,
    );
    expect(baseline[0]!.passed).toBe(true);
    const pixels = (bytes: Buffer) => {
      const decoded = pngModule.decode(Uint8Array.from(bytes).buffer),
        rgba = new Uint8Array(pngModule.toRGBA8(decoded)[0]!);
      let n = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i]! < 250 || rgba[i + 1]! < 250 || rgba[i + 2]! < 250) n++;
      return n;
    };
    for (const erasure of [
      `document.querySelector('#ancestor').style.filter='opacity(0)'`,
      `document.querySelector('#ancestor').style.opacity='0.0001'`,
      `document.head.insertAdjacentHTML('beforeend','<style>[data-sfp-node]::after{content:"";position:fixed;inset:0;background:white;z-index:999}</style>')`,
    ]) {
      await page.reload();
      expect(pixels(await page.screenshot())).toBeGreaterThan(0);
      await page.evaluate(erasure);
      expect(pixels(await page.screenshot())).toBe(0);
      const hidden = await observePortalConsumption(
        page,
        batch,
        { rootNodeId: '1:0', route: '/', state: 'source:1:0' },
        'source',
        resources,
      );
      expect(hidden[0]!.passed).toBe(false);
      expect(hidden[0]!.reason).toBe('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    }
    await page.reload();
    expect(matchesNativeContours(expected, await observeNativeContours(page, input))).toBe(true);
    for (const mutation of [
      `document.body.style.filter='opacity(0)'`,
      `document.querySelector('#ancestor').style.filter='blur(2px)'`,
      `document.querySelector('#ancestor').style.opacity='0.1'`,
      `document.querySelector('#ancestor').style.mixBlendMode='difference'`,
      `document.querySelector('#ancestor').style.backdropFilter='blur(2px)'`,
      `document.querySelector('#ancestor').style.maskImage='linear-gradient(transparent,transparent)'`,
      `document.querySelector('#ancestor').style.clip='rect(0,0,0,0)'`,
      `document.head.insertAdjacentHTML('beforeend','<style>[data-sfp-node]{position:relative}[data-sfp-node]::after{content:"";position:absolute;inset:-10px;background:white;z-index:10}</style>')`,
    ]) {
      await page.reload();
      await page.evaluate(mutation);
      await expect(observeNativeContours(page, input)).rejects.toThrow(
        'PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH',
      );
    }
  }, markup);
});
it('rejects partial per-axis clipping and clipped stroke/shadow paint without changing source geometry', async () => {
  await preparePortalConsumptionObserver();
  const markup = html
    .replace('<body>', '<body style="margin:0;background:white">')
    .replace('<div data-sfp-node', '<div id="ancestor"><div data-sfp-node')
    .replace('</div></section>', '</div></div></section>');
  await fixture(async (page, url) => {
    const binding = {
      checkId: 'clip-check',
      resultId: 'result',
      resultHash: hash,
      rowId: 'row',
      rowHash: hash,
      rootNodeId: '1:0',
      route: '/',
      state: 'source:1:0',
      selector: input.selector,
      phase: 'source' as const,
      expectation: expected,
    };
    const batch = PortalConsumptionBatchSchema.parse({
      version: 1,
      contextHash: hash,
      blueprintHash: hash,
      declarationsHash: hash,
      captureFingerprint: hash,
      candidateHash: hash,
      checks: [{ ...binding, expectedHash: consumptionCheckHash(binding) }],
    });
    const resources = new PortalConsumptionResources(url, new AbortController().signal);
    const pixels = (bytes: Buffer) => {
      const decoded = pngModule.decode(Uint8Array.from(bytes).buffer),
        rgba = new Uint8Array(pngModule.toRGBA8(decoded)[0]!);
      let n = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i]! < 250 || rgba[i + 1]! < 250 || rgba[i + 2]! < 250) n++;
      return n;
    };
    for (const axis of ['both', 'x']) {
      await page.reload();
      const before = pixels(await page.screenshot());
      expect(before).toBeGreaterThan(0);
      await page.evaluate(
        `{const e=document.querySelector('#ancestor');e.style.width='10px';e.style.height='12px';${axis === 'both' ? "e.style.overflow='hidden'" : "e.style.overflowX='hidden';e.style.overflowY='visible'"}}`,
      );
      const after = pixels(await page.screenshot());
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThan(before);
      const values = await observePortalConsumption(
        page,
        batch,
        { rootNodeId: '1:0', route: '/', state: 'source:1:0' },
        'source',
        resources,
      );
      expect(values[0]!.passed).toBe(false);
      expect(values[0]!.reason).toBe('PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH');
    }
    await page.reload();
    await page.evaluate(
      `document.querySelector('#ancestor').style.cssText='padding:20px;width:100px;height:100px;overflow:hidden';document.querySelector('svg').style.filter='drop-shadow(rgb(0, 0, 0) 0px 4px 3px)'`,
    );
    const shadowExpected = {
      ...expected,
      paint: { ...expected.paint, filter: 'drop-shadow(rgb(0, 0, 0) 0px 4px 3px)' },
    };
    expect(matchesNativeContours(shadowExpected, await observeNativeContours(page, input))).toBe(
      true,
    );
    await page.evaluate(`document.querySelector('#ancestor').style.padding='4px'`);
    await expect(observeNativeContours(page, input)).rejects.toThrow(
      'PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH',
    );
    await page.reload();
    await page.evaluate(
      `document.querySelector('svg').setAttribute('viewBox','-1000 -1000 10 12')`,
    );
    await expect(observeNativeContours(page, input)).rejects.toThrow(
      'PORTAL_CONSUMPTION_NATIVE_CONTOUR_MISMATCH',
    );
  }, markup);
});
it('rejects hidden, altered, overpainted and falsely accessible contours while nominal CSS remains unchanged', async () => {
  await fixture(async page => {
    expect(matchesNativeContours(expected, await observeNativeContours(page, input))).toBe(true);
    const changes = [
      `document.querySelector('path').setAttribute('d','M0 0 L2 0 L2 2 Z')`,
      `document.querySelector('path').style.d='path("M0 0 L2 0 L2 2 Z")'`,
      `document.querySelector('path').style.opacity='0'`,
      `document.querySelector('path').style.fill='red'`,
      `document.querySelector('path').setAttribute('transform','translate(0 10) scale(12 -12)')`,
      `document.querySelector('svg').style.filter='blur(1px)'`,
      `document.querySelector('title').textContent='B'`,
      `document.querySelector('g').insertAdjacentHTML('beforeend','<text opacity="0">A</text>')`,
      `document.querySelector('svg').setAttribute('aria-labelledby','missing')`,
      `document.querySelector('[data-sfp-node]').setAttribute('aria-hidden','true')`,
      `document.querySelector('[data-sfp-node]').setAttribute('inert','')`,
      `document.querySelector('path').style.fillRule='evenodd'`,
      `document.querySelector('path').setAttribute('d','M0 0 L2 0 L2 2 Z');Element.prototype.getAttribute=function(){return '${path}'};SVGPathElement.prototype.getScreenCTM=()=>({a:14,b:0,c:0,d:-14,e:0,f:10})`,
    ];
    for (const change of changes) {
      await page.reload();
      await page.evaluate(change);
      let accepted = false;
      try {
        accepted = matchesNativeContours(expected, await observeNativeContours(page, input));
      } catch {
        accepted = false;
      }
      expect(accepted).toBe(false);
    }
  });
});
