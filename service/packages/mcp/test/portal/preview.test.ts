import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import pngModule from '@pdf-lib/upng';
import { storedChecksum } from '@sfp/ir';
import type { Page } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../src/portal/chrome-runtime.js';
import { auditPortalControlNames } from '../../src/portal/preview-accessibility.js';
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
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const part = relative(tmpdir(), root);
    if (!part || isAbsolute(part) || part.startsWith('..'))
      throw Error('Invalid preview cleanup root');
    await rm(root, { recursive: true, force: true });
  }
});
it.each(['unavailable', 'empty'] as const)(
  'refuses %s Chrome AX evidence without a DOM-name fallback',
  async mode => {
    let detached = 0;
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: async () => {
            if (mode === 'unavailable') throw Error('Accessibility domain unavailable');
            return { nodes: [] };
          },
          detach: async () => {
            detached++;
          },
        }),
      }),
      evaluate: async () => [],
    } as unknown as Page;
    await expect(auditPortalControlNames(page)).rejects.toMatchObject({
      code: 'PORTAL_PREVIEW_AX_UNAVAILABLE',
    });
    expect(detached).toBe(1);
  },
);
it.each(['deadline', 'cancel'] as const)(
  'bounds a stalled AX read and detaches after %s',
  async mode => {
    const controller = new AbortController();
    let detached = 0;
    const page = {
      context: () => ({
        newCDPSession: async () => ({
          send: () => {
            if (mode === 'cancel') controller.abort(Error('audit-cancelled'));
            return new Promise(() => {});
          },
          detach: async () => {
            detached++;
          },
        }),
      }),
    } as unknown as Page;
    await expect(
      auditPortalControlNames(page, { signal: controller.signal, deadlineAt: Date.now() + 30 }),
    ).rejects.toThrow(mode === 'cancel' ? 'audit-cancelled' : 'PORTAL_PREVIEW_AX_TIMEOUT');
    expect(detached).toBe(1);
  },
);
it('releases a late AX session without dispatching a read after cancellation', async () => {
  const controller = new AbortController();
  let acquired: ((value: unknown) => void) | undefined;
  let detached = 0,
    reads = 0;
  const page = {
    context: () => ({
      newCDPSession: () =>
        new Promise(resolve => {
          acquired = resolve;
        }),
    }),
  } as unknown as Page;
  const audit = auditPortalControlNames(page, { signal: controller.signal });
  controller.abort(Error('audit-cancelled'));
  await expect(audit).rejects.toThrow('audit-cancelled');
  acquired!({
    send: async () => {
      reads++;
    },
    detach: async () => {
      detached++;
    },
  });
  await vi.waitFor(() => expect(detached).toBe(1));
  expect(reads).toBe(0);
});
it('does not accept complete AX evidence while session cleanup remains unconfirmed', async () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => originalTimeout(30));
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({
          nodes: [{ nodeId: '1', ignored: false, role: { value: 'RootWebArea' } }],
        }),
        detach: () => new Promise(() => {}),
      }),
    }),
  } as unknown as Page;
  await expect(auditPortalControlNames(page)).rejects.toMatchObject({
    code: 'PORTAL_PREVIEW_AX_CLEANUP_UNCONFIRMED',
  });
});
it('rejects cancellation during successful AX session cleanup before returning evidence', async () => {
  const controller = new AbortController();
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({
          nodes: [{ nodeId: '1', ignored: false, role: { value: 'RootWebArea' } }],
        }),
        detach: async () => {
          controller.abort(Error('audit-cleanup-cancelled'));
        },
      }),
    }),
  } as unknown as Page;
  await expect(auditPortalControlNames(page, { signal: controller.signal })).rejects.toThrow(
    'audit-cleanup-cancelled',
  );
});
it('does not open a Chrome AX session after its audit deadline', async () => {
  let opened = 0;
  const page = {
    context: () => {
      opened++;
      throw Error('Unexpected session lookup');
    },
  } as unknown as Page;
  await expect(auditPortalControlNames(page, { deadlineAt: Date.now() - 1 })).rejects.toThrow(
    'PORTAL_PREVIEW_AX_TIMEOUT',
  );
  expect(opened).toBe(0);
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
it('audits Chrome control names in initial and exercised states instead of hidden SVG text', async context => {
  requireChrome(context, googleChromeExecutable());
  const root = await mkdtemp(join(tmpdir(), 'sfp-control-names-'));
  roots.push(root);
  const oracle = solid(255, 255, 255, 400, 200);
  await writeFile(join(root, 'oracle.png'), oracle);
  const server = createServer((request, response) => {
    const named = ['/named', '/lose-name', '/dom-rules'].includes(request.url ?? '');
    const brokenDom = request.url === '/dom-rules';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<html ${brokenDom ? '' : 'lang="ko"'}><head><title>${brokenDom ? '' : 'Control names'}</title></head><body style="margin:0">
      <button id="footer" ${named ? 'aria-label="회사 소개"' : ''} onclick="${request.url === '/lose-name' ? "this.removeAttribute('aria-label')" : "this.setAttribute('aria-label','About us')"}"><svg aria-hidden="true" width="120" height="30"><text y="20">회사 소개</text></svg></button>
      ${named ? '<span id="name" hidden>Email address</span><input aria-labelledby="name"><label>Message<textarea></textarea></label><a href="#about"><img alt="About" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1\' height=\'1\'/%3E"></a><button title="Close"><svg aria-hidden="true"></svg></button>' : ''}
      ${request.url === '/invalid-label' ? '<input aria-labelledby="missing-label">' : ''}
      ${brokenDom ? '<div style="width:500px"><img src="data:image/png,broken"></div>' : ''}
      </body></html>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture server address');
  try {
    const result = await assertNativePortalPreview(
      {
        root,
        baseUrl: `http://127.0.0.1:${address.port}`,
        screens: ['unnamed', 'named', 'transition', 'invalid-label', 'lose-name', 'dom-rules'].map(
          id => ({
            id,
            path: '/' + id,
            oraclePath: 'oracle.png',
            oracleHash: storedChecksum(oracle),
            viewport: { width: 400, height: 200 },
            actions: ['transition', 'lose-name'].includes(id)
              ? [{ kind: 'click', selector: '#footer' }]
              : [],
          }),
        ),
      },
      undefined,
      { emitReport: false, retainFailedReport: true },
    );
    expect(result.screens[0]!.failures).toContain('CONTROL_NAME_MISSING');
    expect(result.screens[1]!.failures).not.toContain('CONTROL_NAME_MISSING');
    expect(result.screens[1]!.failures).not.toContain('CONTROL_LABEL_MISSING');
    expect(result.screens[2]!.failures).toContain('CONTROL_NAME_MISSING');
    expect(result.screens[3]!.failures).toContain('CONTROL_LABEL_MISSING');
    expect(result.screens[4]!.failures).toContain('CONTROL_NAME_MISSING');
    expect(result.screens[5]!.failures).toEqual(
      expect.arrayContaining([
        'MISSING_LANGUAGE',
        'MISSING_TITLE',
        'IMAGE_ALT_MISSING',
        'BROKEN_IMAGE',
        'HORIZONTAL_OVERFLOW',
      ]),
    );
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
}, 30000);
it('requires actual Chrome names for native date and time inputs', async context => {
  requireChrome(context, googleChromeExecutable());
  const root = await mkdtemp(join(tmpdir(), 'sfp-input-names-'));
  roots.push(root);
  const oracle = solid(255, 255, 255);
  await writeFile(join(root, 'oracle.png'), oracle);
  const types = ['time', 'date', 'datetime-local', 'month', 'week', 'text'];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const type = types.find(value => '/' + value === url.pathname) ?? 'text';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      `<html lang="en"><head><title>Native input names</title></head><body><input type="${type}" ${url.searchParams.has('named') ? 'aria-label="Appointment"' : ''}><div id="swatch" style="width:100px;height:100px;background:white"></div></body></html>`,
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture server address');
  try {
    const result = await assertNativePortalPreview(
      {
        root,
        baseUrl: `http://127.0.0.1:${address.port}`,
        screens: types.flatMap(type =>
          [false, true].map(named => ({
            id: type + (named ? '-named' : '-unnamed'),
            path: '/' + type + (named ? '?named' : ''),
            oraclePath: 'oracle.png',
            oracleHash: storedChecksum(oracle),
            viewport: { width: 400, height: 200 },
            captureSelector: '#swatch',
          })),
        ),
      },
      undefined,
      { emitReport: false, retainFailedReport: true },
    );
    for (const screen of result.screens.filter((_screen, index) => index % 2 === 0))
      expect(screen.failures).toContain('CONTROL_LABEL_MISSING');
    for (const screen of result.screens.filter((_screen, index) => index % 2 === 1))
      expect(screen).toMatchObject({ passed: true, failures: [] });
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
}, 30000);
it('checks explicit contained text without relaxing exact text assertions in Chrome', async context => {
  requireChrome(context, googleChromeExecutable());
  const root = await mkdtemp(join(tmpdir(), 'sfp-contained-text-'));
  roots.push(root);
  const oracle = solid(0, 0, 255);
  await writeFile(join(root, 'oracle.png'), oracle);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<html lang="en"><head><title>Text assertion</title></head><body style="margin:0;background:white;color:black;font:24px Arial"><main>prefix <b>Ready</b> suffix</main></body></html>',
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture server address');
  try {
    const result = await assertNativePortalPreview(
      {
        root,
        baseUrl: `http://127.0.0.1:${address.port}`,
        screens: [
          { id: 'contained', kind: 'contains-text', value: 'Ready' },
          { id: 'exact', kind: 'text', value: 'Ready' },
          { id: 'missing', kind: 'contains-text', value: 'Missing' },
          { id: 'focus', kind: 'focused', value: null },
        ].map(({ id, kind, value }) => ({
          id,
          path: '/',
          oraclePath: 'oracle.png',
          oracleHash: storedChecksum(oracle),
          viewport: { width: 100, height: 100 },
          maxDifferenceRatio: 0,
          actions: [
            kind === 'focused' ? { kind, selector: 'main' } : { kind, selector: 'main', value },
          ],
        })),
      },
      undefined,
      { emitReport: false, retainFailedReport: true },
    );
    expect(result.screens[0]!.failures).not.toContain('ACTION_STATE_MISMATCH:main');
    expect(result.screens[1]!.failures).toContain('ACTION_STATE_MISMATCH:main');
    expect(result.screens[2]!.failures).toContain('ACTION_STATE_MISMATCH:main');
    expect(result.screens[3]!.failures).toContain('ACTION_STATE_MISMATCH:main');
    for (const screen of result.screens) expect(screen.failures).toContain('VISUAL_MISMATCH');
    const bytes = await readFile(join(root, '.sfp-native-preview/contained.actual.png'));
    const pixels = new Uint8Array(
      png.toRGBA8(
        png.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      )[0]!,
    );
    let fringes = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
      if (pixels[offset] !== pixels[offset + 1] || pixels[offset + 1] !== pixels[offset + 2])
        fringes++;
    expect(fringes).toBe(0);
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
}, 60000);

it('waits for images inserted after action navigation to settle while retaining genuine broken-image failures', async context => {
  requireChrome(context, googleChromeExecutable());
  const root = await mkdtemp(join(tmpdir(), 'sfp-preview-image-settle-'));
  roots.push(root);
  const oracle = solid(0, 0, 255),
    image = solid(0, 0, 255, 1, 1);
  await writeFile(join(root, 'oracle.png'), oracle);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cancellation = new AbortController();
  let cancelledImageRequestedAt: number | null = null;
  let completedImages = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.endsWith('.png')) {
      if (url.pathname === '/never.png') {
        cancelledImageRequestedAt = Date.now();
        const timer = setTimeout(() => {
          timers.delete(timer);
          cancellation.abort(new Error('owned-preview-image-cancelled'));
        }, 150);
        timers.add(timer);
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        completedImages++;
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(url.pathname === '/delayed.png' ? image : Buffer.from('not-an-image'));
      }, 1500);
      timers.add(timer);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      `<html lang="en"><head><title>Image settle fixture</title></head><body style="margin:0;background:blue"><button id="navigate" aria-label="Next" style="display:block;width:100px;height:100px;border:0;background:blue" onclick="location.href='/after?asset=${url.searchParams.get('asset')}'"></button><div id="ready"></div>${url.pathname === '/after' ? `<script>addEventListener('load',()=>{const image=document.createElement('img');image.alt='';image.width=1;image.height=1;image.src='/${url.searchParams.get('asset')}.png';document.body.append(image);document.querySelector('#ready').textContent='Ready';});</script>` : ''}</body></html>`,
    );
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing image fixture address');
  try {
    const report = await assertNativePortalPreview(
      {
        root,
        baseUrl: `http://127.0.0.1:${address.port}`,
        screens: ['delayed', 'broken'].map(id => ({
          id,
          path: '/start?asset=' + id,
          oraclePath: 'oracle.png',
          oracleHash: storedChecksum(oracle),
          viewport: { width: 100, height: 100 },
          actions: [
            { kind: 'click', selector: '#navigate' },
            { kind: 'contains-text', selector: '#ready', value: 'Ready' },
          ],
        })),
      },
      undefined,
      { emitReport: false, retainFailedReport: true },
    );
    expect(report.screens[0]?.failures).toEqual([]);
    expect(report.screens[1]?.failures).toContain('BROKEN_IMAGE');
    expect(report.screens[1]?.failures).not.toContain('IMAGE_LOAD_TIMEOUT');
    expect(completedImages).toBe(2);
    await expect(
      assertNativePortalPreview(
        {
          root,
          baseUrl: `http://127.0.0.1:${address.port}`,
          screens: [
            {
              id: 'cancelled',
              path: '/start?asset=never',
              oraclePath: 'oracle.png',
              oracleHash: storedChecksum(oracle),
              viewport: { width: 100, height: 100 },
              actions: [
                { kind: 'click', selector: '#navigate' },
                { kind: 'contains-text', selector: '#ready', value: 'Ready' },
              ],
            },
          ],
        },
        cancellation.signal,
        { emitReport: false, retainFailedReport: true },
      ),
    ).rejects.toThrow('owned-preview-image-cancelled');
    expect(cancelledImageRequestedAt).not.toBeNull();
    expect(Date.now() - cancelledImageRequestedAt!).toBeLessThan(1500);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
}, 30000);

it('renders an owned local fixture in Chrome and rejects a real visual mismatch', async context => {
  requireChrome(context, googleChromeExecutable());
  const root = await mkdtemp(join(tmpdir(), 'sfp-chrome-preview-'));
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
    expect(result.browser).toBe('chrome');
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

it('captures a small real component in its hover state without shrinking the browser viewport', async context => {
  requireChrome(context, googleChromeExecutable());
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
