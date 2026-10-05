import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

import { chromium } from 'playwright';
import { expect, it } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { parseFigmaTarget } from '../src/figma-url.js';
import { exportFigmaWebDocument } from '../src/figma-web-export.js';

it('captures native web exports after immediate URL revocation and restores browser hooks', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const folder = await mkdtemp(join(tmpdir(), 'sfp-web-export-'));
  const fromTemp = relative(tmpdir(), folder);
  if (!fromTemp || isAbsolute(fromTemp) || fromTemp.startsWith('..'))
    throw new Error('INVALID_FIXTURE_ROOT');
  const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const target = parseFigmaTarget(
      'https://www.figma.com/design/ownedExportFixture/Example?node-id=0-1',
    );
    await page.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><button>Main menu</button>
      <button role="menuitem">File</button><button role="menuitem" id="save">Save local copy</button>
      <script>
      window.originalClick = HTMLAnchorElement.prototype.click;
      window.originalCreate = URL.createObjectURL;
      document.querySelector('#save').onclick = () => {
        const url = URL.createObjectURL(new Blob(['fig-kiwi' + 'source '.repeat(40000)]));
        const a = document.createElement('a'); a.href = url; a.download = 'Owned source.fig';
        a.click(); URL.revokeObjectURL(url);
      };
      </script>`,
      }),
    );
    await page.goto(target.url);
    const result = await exportFigmaWebDocument(page, target, folder, {
      deadlineAt: Date.now() + 10_000,
    });
    expect((await readFile(join(folder, 'document.fig'))).toString()).toBe(
      'fig-kiwi' + 'source '.repeat(40000),
    );
    expect(result).toMatchObject({
      source: 'figma-web-native-export',
      fullCapture: false,
      requestedNodeId: '0:1',
      filename: 'Owned source.fig',
    });
    expect(
      await page.evaluate(() => {
        const stored = window as unknown as { originalClick: unknown; originalCreate: unknown };
        return (
          stored.originalClick === HTMLAnchorElement.prototype.click &&
          stored.originalCreate === URL.createObjectURL &&
          !Object.keys(window).some(key => key.startsWith('sfpExport'))
        );
      }),
    ).toBe(true);
    await page
      .getByRole('menuitem', { name: 'Save local copy' })
      .evaluate(element => element.setAttribute('disabled', ''));
    await expect(
      exportFigmaWebDocument(page, target, folder, { deadlineAt: Date.now() + 10_000 }),
    ).rejects.toThrow('FIGMA_WEB_EXPORT_UNAVAILABLE');
    expect(
      await page.evaluate(() => !Object.keys(window).some(key => key.startsWith('sfpExport'))),
    ).toBe(true);
    const cancelled = new AbortController();
    cancelled.abort(new Error('owner cancelled'));
    await expect(
      exportFigmaWebDocument(page, target, folder, {
        deadlineAt: Date.now() + 10_000,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow('owner cancelled');
    await expect(
      exportFigmaWebDocument(
        page,
        parseFigmaTarget('https://www.figma.com/design/differentFileKey'),
        folder,
        { deadlineAt: Date.now() + 10_000 },
      ),
    ).rejects.toThrow('BROWSER_TARGET_CHANGED');
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
