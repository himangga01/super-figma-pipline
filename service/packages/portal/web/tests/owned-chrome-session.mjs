import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

// One service-owned, visible Chrome window is retained across actual portal checks.
// The user's existing Figma profile and source connection are not touched.
const require = createRequire(new URL('../../../cli/package.json', import.meta.url));
const { chromium } = require('playwright');
const stateFile = process.argv[2];
assert.ok(isAbsolute(stateFile ?? ''), 'Supply an explicit private session state file');
const server = await chromium.launchServer({
  channel: 'chrome',
  headless: false,
  host: '127.0.0.1',
  port: 0,
  _sharedBrowser: true,
});
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: 'ko-KR',
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:4310', { waitUntil: 'networkidle' });
await page.bringToFront();
await writeFile(
  stateFile,
  JSON.stringify(
    {
      version: 1,
      ownerPid: process.pid,
      chromePid: server.process().pid,
      startedAt: new Date().toISOString(),
      browserWsEndpoint: server.wsEndpoint(),
      portalUrl: page.url(),
    },
    null,
    2,
  ),
  { flag: 'wx', mode: 0o600 },
);
process.stdout.write(
  JSON.stringify({
    ready: true,
    pid: process.pid,
    page: page.url(),
    browser: 'installed-google-chrome',
    reuse: 'same-context-and-tab',
  }) + '\n',
);
await new Promise(resolve => {
  server.once('close', resolve);
});
