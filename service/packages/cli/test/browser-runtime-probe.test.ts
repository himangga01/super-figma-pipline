import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { probeFigmaWebRuntime } from '../src/browser-session.js';
import { readFigmaPageSnapshot } from '../src/figma-page-reader.js';
import { parseFigmaTarget } from '../src/figma-url.js';

const target = parseFigmaTarget(
  'https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120',
);

describe('bounded Figma runtime identity diagnostics in owned Chrome', () => {
  let browser: Browser, page: Page;
  beforeAll(async () => {
    const executablePath = googleChromeExecutable();
    if (!executablePath) return;
    browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
    page = await browser.newPage();
    await page.route('**/*', route =>
      route.fulfill({ contentType: 'text/html', body: '<title>Runtime probe fixture</title>' }),
    );
  });
  beforeEach(async context => {
    requireChrome(context, googleChromeExecutable());
    await page.goto(target.url);
    await page.evaluate(fileKey => {
      const currentPage = { id: '1378:120', type: 'PAGE', parent: null };
      Object.defineProperty(globalThis, 'figma', {
        configurable: true,
        writable: true,
        value: { fileKey, currentPage, getNodeByIdAsync: async () => currentPage },
      });
    }, target.fileKey);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('reports matching file and stable object observations without claiming capture', async () => {
    expect(await probeFigmaWebRuntime(page, target)).toMatchObject({
      available: true,
      identityVerified: true,
      pageId: '1378:120',
      fileKeyPresent: true,
      fileKeyType: 'string',
      fileKeyMatches: true,
      stableApiObject: true,
      stablePageObject: true,
      fullCapture: false,
    });
  });
  it('reports a different runtime file without retaining its raw value and keeps capture rejected', async () => {
    await page.evaluate(() => {
      (globalThis as any).figma.fileKey = 'sensitive-unrelated-runtime-value';
    });
    const observed = await probeFigmaWebRuntime(page, target);
    expect(observed).toMatchObject({
      available: true,
      identityVerified: false,
      fileKeyPresent: true,
      fileKeyType: 'string',
      fileKeyMatches: false,
      stableApiObject: true,
      stablePageObject: true,
      fullCapture: false,
    });
    expect(JSON.stringify(observed)).not.toContain('sensitive-unrelated-runtime-value');
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
      'FIGMA_PAGE_IDENTITY_CHANGED',
    );
  });
  it.each(['missing', 'undefined', 'number'] as const)(
    'distinguishes %s file identity from a confirmed match',
    async kind => {
      await page.evaluate(value => {
        const api = (globalThis as any).figma;
        if (value === 'missing') delete api.fileKey;
        else api.fileKey = value === 'number' ? 42 : undefined;
      }, kind);
      expect(await probeFigmaWebRuntime(page, target)).toMatchObject({
        available: true,
        identityVerified: false,
        fileKeyPresent: kind !== 'missing',
        fileKeyType: kind === 'number' ? 'number' : 'undefined',
        fileKeyMatches: false,
        fullCapture: false,
      });
      await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
        'FIGMA_PAGE_IDENTITY_CHANGED',
      );
    },
  );
  it('diagnoses changing API wrappers without admitting them as a successful snapshot', async () => {
    await page.evaluate(() => {
      const api = (globalThis as any).figma;
      Object.defineProperty(globalThis, 'figma', { configurable: true, get: () => ({ ...api }) });
    });
    expect(await probeFigmaWebRuntime(page, target)).toMatchObject({
      available: true,
      identityVerified: true,
      fileKeyMatches: true,
      stableApiObject: false,
      stablePageObject: true,
      fullCapture: false,
    });
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
      'FIGMA_PAGE_IDENTITY_CHANGED',
    );
  });
  it('diagnoses changing page wrappers and reports unavailable getters as unknown', async () => {
    await page.evaluate(() => {
      const api = (globalThis as any).figma,
        current = api.currentPage;
      Object.defineProperty(api, 'currentPage', {
        configurable: true,
        get: () => ({ ...current }),
      });
    });
    expect(await probeFigmaWebRuntime(page, target)).toMatchObject({
      stableApiObject: true,
      stablePageObject: false,
      fullCapture: false,
    });
    await expect(readFigmaPageSnapshot(page, target)).rejects.toThrow(
      /FIGMA_PAGE_(IDENTITY|SCOPE)_CHANGED/u,
    );
    await page.evaluate(() => {
      Object.defineProperty((globalThis as any).figma, 'fileKey', {
        get: () => {
          throw Error('sensitive-getter-message');
        },
      });
    });
    const failed = await probeFigmaWebRuntime(page, target);
    expect(failed).toMatchObject({
      reason: 'runtime-unavailable',
      fileKeyPresent: null,
      fileKeyType: null,
      fileKeyMatches: null,
      stableApiObject: null,
      stablePageObject: null,
      fullCapture: false,
    });
    expect(JSON.stringify(failed)).not.toContain('sensitive-getter-message');
  });
});
