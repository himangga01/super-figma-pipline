import { chromium } from 'playwright';
import { expect, it } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { parseFigmaTarget } from '../src/figma-url.js';
import { openScripter } from '../src/scripter-bridge.js';

it.for(['open', 'actions', 'main-menu'])(
  'recognizes the pinned plugin with the %s search entry point',
  { timeout: 30_000 },
  async (entry, testContext) => {
    const executablePath = googleChromeExecutable();
    requireChrome(testContext, executablePath);
    if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
    const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
    try {
      const page = await browser.newPage();
      const target = parseFigmaTarget('https://www.figma.com/design/scripterUIFixtureKey/Owned');
      await page.route('https://s3-alpha-sig.figma.com/**', route => route.abort());
      await page.route('https://scripter.rsms.me/**', route =>
        route.fulfill({ contentType: 'text/html', body: '<main>Verified plugin fixture</main>' }),
      );
      await page.route('https://www.figma.com/**', route =>
        route.fulfill({
          contentType: 'text/html',
          body: `
      <input role="searchbox" aria-label="Search" value="Scripter" ${entry === 'open' ? '' : 'hidden'}>
      <button id="actions" aria-label="Actions">Actions</button>
      ${entry === 'main-menu' ? '<button id="menu" aria-label="Main menu">Menu</button>' : ''}
      <button id="plugin" aria-label="Scripter"><img src="https://s3-alpha-sig.figma.com/plugins/757836922707087381/4177/icon"></button>
      <script>
      let editorFocused = false;
      document.querySelector('#menu')?.addEventListener('click', () => { editorFocused = true; });
      document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === '/') document.querySelector('input').hidden = !editorFocused; });
      document.querySelector('#actions').onclick = () => { document.querySelector('input').hidden = false; };
      document.querySelector('#plugin').onclick = () => { const frame = document.createElement('iframe'); frame.src = 'https://scripter.rsms.me/'; document.body.append(frame); };
      </script>`,
        }),
      );
      await page.goto(target.url);
      const frame = await openScripter(page, target);
      expect(frame.url()).toBe('https://scripter.rsms.me/');
      expect(await page.getByRole('searchbox').isVisible()).toBe(true);
      expect(await openScripter(page, target)).toBe(frame);
      expect(page.frames().filter(candidate => candidate.url() === frame.url())).toHaveLength(1);
    } finally {
      await browser.close();
    }
  },
);
