import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { chromium, type BrowserContext } from 'playwright';
import { expect, it, vi } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { ExistingChromeConnection, openChromeSession } from '../src/browser-session.js';

it('reattaches to restarted installed Chrome through fresh discovery without restarting the owner', async testContext => {
  const executablePath = googleChromeExecutable();
  requireChrome(testContext, executablePath);
  if (!executablePath) throw new Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const profileRoot = await mkdtemp(join(tmpdir(), 'sfp-owned-chrome-reconnect-'));
  const absolute = resolve(profileRoot);
  if (
    !absolute.startsWith(`${resolve(tmpdir())}${sep}`) ||
    !absolute.includes('sfp-owned-chrome-reconnect-')
  )
    throw new Error('CHROME_FIXTURE_CLEANUP_PATH_INVALID');
  const previousProfile = process.env.SFP_CHROME_USER_DATA_DIR;
  process.env.SFP_CHROME_USER_DATA_DIR = profileRoot;
  const connection = new ExistingChromeConnection();
  let context: BrowserContext | undefined;
  const targetUrl = 'https://www.figma.com/design/reconnectFixtureKey/Owned?node-id=0-1';
  const startChrome = async () => {
    const owned = await chromium.launchPersistentContext(profileRoot, {
      channel: 'chrome',
      executablePath,
      headless: true,
      args: ['--remote-debugging-port=0', '--site-per-process'],
    });
    context = owned;
    await owned.route('https://scripter.rsms.me/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main>Reader frame ready</main>',
      }),
    );
    await owned.route('https://www.figma.com/**', route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Owned reconnect fixture</title><main>Capture target</main><iframe src="https://scripter.rsms.me/owned-fixture"></iframe>',
      }),
    );
    const page = owned.pages()[0] ?? (await owned.newPage());
    await page.goto(targetUrl);
    const inspector = await owned.newCDPSession(page);
    const targets = await inspector.send('Target.getTargets');
    expect(
      targets.targetInfos.some(
        target => target.type === 'iframe' && target.url.startsWith('https://scripter.rsms.me/'),
      ),
    ).toBe(true);
    await inspector.detach();
    return page;
  };
  try {
    await startChrome();
    const unrelated = await context!.newPage();
    await unrelated.goto('about:blank');
    const standalone = await openChromeSession({ url: targetUrl });
    expect(standalone.context.pages()).toHaveLength(1);
    await standalone.page.frameLocator('iframe').getByText('Reader frame ready').waitFor();
    await standalone.close();
    expect(context!.pages()).toHaveLength(2);
    const first = await connection.open({ url: targetUrl });
    expect(await first.page.title()).toBe('Owned reconnect fixture');
    await first.page.frameLocator('iframe').getByText('Reader frame ready').waitFor();
    expect(first.context.pages()).toHaveLength(1);
    expect(context!.pages()).toHaveLength(2);
    await first.close();
    await context!.close();
    context = undefined;
    await vi.waitFor(() => expect(connection.state()).toBe('unavailable'));
    await startChrome();
    const second = await connection.open({ url: targetUrl });
    expect(await second.page.title()).toBe('Owned reconnect fixture');
    expect(second.page).not.toBe(first.page);
    expect(connection.state()).toBe('connected');
    await second.close();
    const addedUrl = 'https://www.figma.com/design/explicitOpenFixtureKey/Owned?node-id=0-1';
    const opened = await openChromeSession({ url: addedUrl, openIfMissing: true });
    expect(opened.target.fileKey).toBe('explicitOpenFixtureKey');
    expect(opened.context.pages()).toHaveLength(1);
    expect(await opened.page.title()).toBe('Owned reconnect fixture');
    expect(context!.pages()).toHaveLength(2);
    expect(second.page.url()).toBe(targetUrl);
    await opened.close();
    // Detaching this service client must leave both source tabs open.
    expect(context!.pages()).toHaveLength(2);
    const changedSource = await connection.open({ url: addedUrl });
    expect(changedSource.page.url()).toBe(
      'https://www.figma.com/design/explicitOpenFixtureKey?node-id=0-1',
    );
    expect(changedSource.context.pages()).toHaveLength(1);
    await changedSource.close();
    const originalSource = await connection.open({ url: targetUrl });
    expect(originalSource.page.url()).toBe(targetUrl);
    expect(originalSource.context.pages()).toHaveLength(1);
    await originalSource.close();
    expect(context!.pages()).toHaveLength(2);
  } finally {
    await connection.close();
    await context?.close();
    if (previousProfile === undefined) delete process.env.SFP_CHROME_USER_DATA_DIR;
    else process.env.SFP_CHROME_USER_DATA_DIR = previousProfile;
    await rm(absolute, { recursive: true, force: true });
  }
}, 30_000);
