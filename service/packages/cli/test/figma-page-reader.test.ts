import { setTimeout as delay } from 'node:timers/promises';

import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { normalizeDesignObservation } from '../../mcp/src/portal/design-normalization.js';
import { readFigmaPageAsset, readFigmaPageSnapshot } from '../src/figma-page-reader.js';
import { parseFigmaTarget } from '../src/figma-url.js';

const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9n9M5dwAAAABJRU5ErkJggg==',
  'base64',
);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0L1 1"/></svg>';

describe('independent page-global Figma reader in owned Chrome', () => {
  let browser: Browser, page: Page;
  beforeAll(async () => {
    const executablePath = googleChromeExecutable();
    if (!executablePath) return;
    browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
    page = await browser.newPage();
    await page.route('**/*', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Independent page API fixture</title>',
      }),
    );
  });
  beforeEach(async context => {
    requireChrome(context, googleChromeExecutable());
    await page.goto(target.url);
    await page.evaluate(
      ({ fileKey, pngBytes, svgText }) => {
        const fixture: any = {
          lookups: 0,
          imageCalls: 0,
          exports: 0,
          delayMs: 0,
          imageSize: 2 * 1_048_576,
          styleCount: 0,
        };
        const vector: any = {
          id: '2:1',
          type: 'VECTOR',
          name: 'Vector',
          boundVariables: {},
          reactions: [],
          children: [],
        };
        const frame: any = {
          id: '1:1',
          type: 'FRAME',
          name: 'Frame',
          width: 100,
          height: 100,
          boundVariables: {},
          reactions: [],
          children: [vector],
        };
        const currentPage: any = {
          id: '0:1',
          type: 'PAGE',
          name: 'Page',
          selection: [],
          children: [frame],
        };
        const root: any = { id: '0:0', type: 'DOCUMENT', name: 'Fixture', children: [currentPage] };
        vector.parent = frame;
        frame.parent = currentPage;
        currentPage.parent = root;
        const nodes: Record<string, any> = {
          '0:0': root,
          '0:1': currentPage,
          '1:1': frame,
          '2:1': vector,
        };
        const exportAsync = async (options: { format: string }) => {
          fixture.exports++;
          return options.format === 'SVG'
            ? new TextEncoder().encode(svgText)
            : Uint8Array.from(pngBytes);
        };
        frame.exportAsync = exportAsync;
        vector.exportAsync = exportAsync;
        const api: any = {
          fileKey,
          editorType: 'figma',
          root,
          currentPage,
          getNodeByIdAsync: async (id: string) => {
            fixture.lookups++;
            return nodes[id] ?? null;
          },
          variables: {
            getLocalVariablesAsync: async () => [],
            getLocalVariableCollectionsAsync: async () => [],
          },
          getLocalPaintStylesAsync: async () =>
            Array.from({ length: fixture.styleCount }, (_, i) => ({
              id: `s${i}`,
              name: `Paint ${i}`,
              paints: [],
            })),
          getLocalTextStylesAsync: async () => [],
          getLocalEffectStylesAsync: async () => [],
          getLocalGridStylesAsync: async () => [],
          base64Encode: (bytes: Uint8Array) => {
            let value = '';
            for (let i = 0; i < bytes.length; i += 32768)
              value += String.fromCharCode(...bytes.subarray(i, i + 32768));
            return btoa(value);
          },
          getImageByHash: (hash: string) =>
            hash === 'a'.repeat(40)
              ? {
                  getBytesAsync: async () => {
                    fixture.imageCalls++;
                    if (fixture.delayMs)
                      await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
                    return new Uint8Array(fixture.imageSize).fill(42);
                  },
                }
              : null,
        };
        Object.assign(globalThis, {
          figma: api,
          pageApiFixture: { ...fixture, fixture, nodes, api },
        });
      },
      { fileKey: target.fileKey, pngBytes: [...png], svgText: svg },
    );
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('reads full scoped tree/catalogs and exports PNG, SVG and original image chunks without Scripter', async () => {
    await page.evaluate(() => {
      (globalThis as any).pageApiFixture.fixture.styleCount = 257;
    });
    const snapshot = await readFigmaPageSnapshot(page, target, { depth: 40, maxNodes: 2 });
    expect(snapshot).toMatchObject({
      source: 'figma-web-page-api',
      nodeCount: 2,
      observation: { readComplete: true, reobserved: true },
      pageApiObservation: {
        api: 'window.figma',
        pageId: '0:1',
        scopeNodeId: '0:1',
        fullCapture: false,
      },
    });
    expect(snapshot.styles.paints).toHaveLength(257);
    expect(normalizeDesignObservation(snapshot).source).toBe('chrome-page-api');
    expect(await readFigmaPageAsset(page, target, { kind: 'png', nodeId: '1:1' })).toEqual(png);
    expect(
      (await readFigmaPageAsset(page, target, { kind: 'svg', nodeId: '2:1' })).toString(),
    ).toBe(svg);
    expect(
      await readFigmaPageAsset(page, target, { kind: 'image', imageHash: 'a'.repeat(40) }),
    ).toEqual(Buffer.alloc(2 * 1_048_576, 42));
    expect(await page.evaluate(() => (globalThis as any).pageApiFixture.fixture.imageCalls)).toBe(
      2,
    );
    expect(page.frames()).toHaveLength(1);
  });
  it('preserves incomplete coverage when optional APIs or requested depth are missing', async () => {
    await page.evaluate(() => {
      (globalThis as any).figma.getLocalPaintStylesAsync = undefined;
    });
    const partial = await readFigmaPageSnapshot(page, target, { depth: 0 });
    expect(partial.observation.readComplete).toBe(false);
    expect(partial.catalogs.paintStyles.state).toBe('unsupported');
    expect(partial.truncated).toBe(true);
    expect(partial.pageApiObservation.fullCapture).toBe(false);
  });
  it('rejects a missing page API rather than opening a plugin', async () => {
    await page.evaluate(() => {
      Reflect.deleteProperty(globalThis, 'figma');
    });
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow('FIGMA_PAGE_API_UNAVAILABLE');
    expect(page.frames()).toHaveLength(1);
  });
  it.each(['file', 'scope', 'page'] as const)('rejects an incorrect runtime %s', async kind => {
    await page.evaluate(value => {
      const state = (globalThis as any).pageApiFixture;
      if (value === 'file') state.api.fileKey = 'DifferentFileKey';
      if (value === 'scope') delete state.nodes['0:1'];
      if (value === 'page') state.api.currentPage = { id: '0:2', type: 'PAGE', children: [] };
    }, kind);
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
      /FIGMA_PAGE_(IDENTITY|SCOPE)_CHANGED/u,
    );
  });
  it('rejects page-global API replacement during a read', async () => {
    await page.evaluate(() => {
      const api = (globalThis as any).figma;
      api.variables.getLocalVariablesAsync = async () => {
        (globalThis as any).figma = { ...api };
        return [];
      };
    });
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
      'FIGMA_PAGE_IDENTITY_CHANGED',
    );
  });
  it('rejects scope replacement during export and an export outside the declared subtree', async () => {
    const frameTarget = parseFigmaTarget(target.url.replace('node-id=0-1', 'node-id=1-1'));
    await expect(
      readFigmaPageAsset(page, frameTarget, { kind: 'png', nodeId: '0:1' }),
    ).rejects.toThrow('FIGMA_PAGE_SCOPE_CHANGED');
    await page.evaluate(() => {
      const state = (globalThis as any).pageApiFixture;
      state.nodes['1:1'].exportAsync = async () => {
        state.nodes['0:1'] = { ...state.nodes['0:1'] };
        return new Uint8Array([1]);
      };
    });
    await expect(readFigmaPageAsset(page, target, { kind: 'png', nodeId: '1:1' })).rejects.toThrow(
      'FIGMA_PAGE_SCOPE_CHANGED',
    );
  });
  it('rejects caller-supplied executable text or source overrides before touching the API', async () => {
    await expect(
      readFigmaPageSnapshot(page, target, {
        code: 'figma.createFrame()',
        source: 'figma-plugin-api-via-scripter',
      }),
    ).rejects.toThrow(z.ZodError);
    await expect(
      readFigmaPageAsset(page, target, { kind: 'png', nodeId: '1:1', code: 'return true' }),
    ).rejects.toThrow(z.ZodError);
    expect(await page.evaluate(() => (globalThis as any).pageApiFixture.fixture.lookups)).toBe(0);
  });
  it.each(['timeout', 'cancel'] as const)(
    'does not continue image chunks or accept late bytes after %s',
    async mode => {
      await page.evaluate(() => {
        (globalThis as any).pageApiFixture.fixture.delayMs = 200;
      });
      const controller = new AbortController();
      const pending = readFigmaPageAsset(
        page,
        target,
        { kind: 'image', imageHash: 'a'.repeat(40) },
        { deadlineAt: Date.now() + (mode === 'timeout' ? 100 : 5000), signal: controller.signal },
      ).then(
        value => ({ value }),
        error => ({ error }),
      );
      await expect
        .poll(() => page.evaluate(() => (globalThis as any).pageApiFixture.fixture.imageCalls))
        .toBe(1);
      if (mode === 'cancel') controller.abort(Error('page-read-cancelled'));
      expect(await pending).toMatchObject({
        error: { message: mode === 'timeout' ? 'SNAPSHOT_READ_BUDGET' : 'page-read-cancelled' },
      });
      await delay(250);
      expect(await page.evaluate(() => (globalThis as any).pageApiFixture.fixture.imageCalls)).toBe(
        1,
      );
    },
  );
  it('rejects an already expired deadline without invoking the page API', async () => {
    await expect(
      readFigmaPageSnapshot(page, target, {}, { deadlineAt: Date.now() - 1 }),
    ).rejects.toThrow('SNAPSHOT_READ_BUDGET');
    expect(await page.evaluate(() => (globalThis as any).pageApiFixture.fixture.lookups)).toBe(0);
  });
  it.each([1, 2, 3, 4, 5])(
    'releases an acquired handle exactly once across cancellation microtask %s',
    async offset => {
      const controller = new AbortController();
      let acquired = 0,
        disposed = 0;
      const handle = {
        dispose: async () => {
          disposed++;
        },
        evaluate: async () => '0:1',
      };
      const fake = {
        url: () => target.url,
        evaluateHandle: () => {
          acquired++;
          const schedule = (remaining: number) =>
            queueMicrotask(() =>
              remaining > 1 ? schedule(remaining - 1) : controller.abort(Error('handle-cancelled')),
            );
          schedule(offset);
          return Promise.resolve(handle);
        },
      } as unknown as Page;
      await expect(
        readFigmaPageSnapshot(fake, target, {}, { signal: controller.signal }),
      ).rejects.toThrow('handle-cancelled');
      await delay(10);
      expect(acquired).toBe(1);
      expect(disposed).toBe(1);
    },
  );
});
