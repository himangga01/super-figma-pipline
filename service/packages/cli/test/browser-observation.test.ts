import { existsSync } from 'node:fs';

import { firefox, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { observeFigmaPage } from '../src/browser-session.js';
import { parseFigmaTarget } from '../src/figma-url.js';

const target = parseFigmaTarget('https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1');
const marker =
  '<input readonly tabindex="-1" aria-hidden="true" role="application" aria-label="Figma Design" style="position:absolute;top:-200px">';

describe.skipIf(!existsSync(firefox.executablePath()))(
  'Figma editor observation in a real browser',
  () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
      browser = await firefox.launch({ headless: true });
      page = await browser.newPage();
      await page.route('**/*', route =>
        route.fulfill({ contentType: 'text/html', body: '<title>Figma fixture</title>' }),
      );
      await page.goto(target.url);
    });
    afterAll(async () => {
      await browser?.close();
    });

    it('recognizes the rendered editor with screenreader support disabled', async () => {
      await page.setContent(
        `${marker}<canvas width="500" height="300"></canvas><div role="treegrid">Home</div><div role="grid">Visual Design</div>`,
      );
      expect(await page.getByRole('application', { name: /Figma/iu }).count()).toBe(0);
      const result = await observeFigmaPage(page, target);
      expect(result.status).toBe('ready');
      expect(result.layers).toEqual(['Home']);
      expect(result.exactDesignValues).toBe(false);
    });

    it('does not treat the hidden marker alone as a loaded editor', async () => {
      await page.setContent(marker);
      expect((await observeFigmaPage(page, target)).status).toBe('loading');
    });

    it('finds a visible editor canvas after a hidden canvas and rejects hidden-only canvases', async () => {
      await page.setContent(`${marker}<canvas hidden></canvas><canvas></canvas>`);
      expect((await observeFigmaPage(page, target)).status).toBe('ready');
      await page.setContent(`${marker}<canvas hidden></canvas>`);
      expect((await observeFigmaPage(page, target)).status).toBe('loading');
    });

    it.each([
      ['<label>Email<input type="email"></label>', 'login-required'],
      ['<p>You need access</p>', 'access-required'],
    ])('preserves the authentication/access gate: %s', async (content, status) => {
      await page.setContent(`${marker}<canvas></canvas>${content}`);
      expect((await observeFigmaPage(page, target)).status).toBe(status);
    });
  },
);
