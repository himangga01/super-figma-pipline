import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';

import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { test } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../../mcp/src/portal/chrome-runtime.js';
import { safeAuthError } from '../figma-auth-public.js';

const provider = '00000000-0000-4000-8000-000000000001';
const flow = '00000000-0000-4000-8000-000000000002';
const csrf = 'OWNED_FIXTURE_FORM_CSRF';
const configuration = {
  endpoint: 'https://mcp.figma.com/mcp',
  mode: 'own-oauth',
  oauthTokenEnv: null,
  clientIdEnv: 'OWN_CLIENT_ID',
  clientSecretEnv: 'OWN_CLIENT_SECRET',
  contractReference: 'installed-own-contract',
  contractDigest: `sha256:${'a'.repeat(64)}`,
};
const authStatus = (extra = {}) => ({
  schemaVersion: 1,
  providerInstanceId: provider,
  configurationGeneration: 2,
  authGeneration: 3,
  configuration,
  stage: 'logged-out',
  code: null,
  expiresAt: null,
  flowId: null,
  handoffAvailable: false,
  eligibilitySource: 'operator-contract',
  serverAuthorizationObserved: false,
  sessionOnly: true,
  ...extra,
});
async function fixture(context, initial) {
  const executablePath = googleChromeExecutable();
  requireChrome(context, executablePath);
  if (!executablePath) throw Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const names = [
    'api.js',
    'figma-settings.js',
    'figma-auth-public.js',
    'figma-auth-consent.html',
    'figma-auth-consent.js',
    'figma-auth-consent.css',
  ];
  const sources = Object.fromEntries(
    await Promise.all(
      names.map(async name => [
        name,
        await readFile(new URL('../' + name, import.meta.url), 'utf8'),
      ]),
    ),
  );
  let status = initial ?? authStatus(),
    reads = 0,
    holdNext = false,
    heldRelease = null,
    failNext = false,
    holdConsentOnly = false;
  const deniedSockets = new Set(),
    unexpectedDeniedSocketErrors = [];
  const actions = [],
    forms = [],
    external = [],
    navigation = [],
    consoleMessages = [];
  let deniedOfficialConnects = 0,
    deniedOtherRequests = 0;
  const view = () => ({
    revision: 1,
    configuration: {
      endpoint: status.configuration.endpoint,
      oauthTokenEnv: status.configuration.oauthTokenEnv,
    },
    daemon: { providerInstanceId: provider },
    authentication: { desiredApplied: true, credentialConfigured: false, restartRequired: false },
    setup: { daemonSupportAvailable: true },
    lastProbe: null,
    readyForCaptureAttempt: false,
  });
  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    if (request.url.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/bootstrap')
        return response.end(JSON.stringify({ csrfToken: csrf }));
      if (request.url === '/api/figma-settings/auth' && request.method === 'GET') {
        reads++;
        const observed = JSON.stringify(status);
        if (
          holdNext &&
          (!holdConsentOnly || request.headers.referer === origin + '/figma-auth-consent')
        ) {
          holdNext = false;
          holdConsentOnly = false;
          await new Promise(resolve => {
            heldRelease = resolve;
          });
          heldRelease = null;
        }
        return response.end(observed);
      }
      if (request.url === '/api/figma-settings' && request.method === 'GET')
        return response.end(JSON.stringify(view()));
      let raw = '';
      for await (const chunk of request) raw += chunk;
      if (request.url === '/api/figma-settings/auth/handoff') {
        const form = new URLSearchParams(raw);
        forms.push({
          keys: [...form.keys()],
          csrfMatches: form.get('csrf') === csrf,
          originMatches: request.headers.origin === origin,
          originKind:
            request.headers.origin === 'null'
              ? 'null'
              : request.headers.origin === origin
                ? 'owned'
                : request.headers.origin === undefined
                  ? 'absent'
                  : 'other',
          fetchSiteMatches: request.headers['sec-fetch-site'] === 'same-origin',
          fetchModeMatches: request.headers['sec-fetch-mode'] === 'navigate',
          fetchDestMatches: request.headers['sec-fetch-dest'] === 'document',
          bindingMatches:
            form.get('providerInstanceId') === provider &&
            form.get('configurationGeneration') === '2' &&
            form.get('authGeneration') === String(status.authGeneration) &&
            form.get('flowId') === flow,
        });
        if (
          request.method !== 'POST' ||
          !forms.at(-1).csrfMatches ||
          !forms.at(-1).bindingMatches ||
          [...form.keys()].length !== 5
        ) {
          response.statusCode = 403;
          return response.end(JSON.stringify({ error: { code: 'CSRF_REQUIRED' } }));
        }
        response.statusCode = 303;
        response.setHeader('location', 'https://www.figma.com/oauth/mcp?state=OWNED_FORM_STATE');
        return response.end();
      }
      if (request.headers['x-sfp-csrf'] !== csrf) {
        response.statusCode = 403;
        return response.end(JSON.stringify({ error: { code: 'CSRF_REQUIRED' } }));
      }
      const input = JSON.parse(raw);
      actions.push({ action: request.url.split('/').at(-1), input });
      if (failNext) {
        failNext = false;
        response.statusCode = 500;
        return response.end(
          JSON.stringify({
            error: { code: 'OWNED_ERROR_CODE_CANARY', message: 'OWNED_ERROR_TOKEN_CANARY' },
          }),
        );
      }
      if (request.url === '/api/figma-settings' && request.method === 'PUT') {
        status = {
          ...status,
          configuration: input.configuration,
          configurationGeneration: status.configurationGeneration + 1,
        };
        return response.end(JSON.stringify(view()));
      }
      if (request.url.endsWith('/start'))
        status = {
          ...status,
          stage: 'waiting-for-callback',
          flowId: flow,
          handoffAvailable: true,
          expiresAt: input.deadlineAt,
        };
      if (request.url.endsWith('/cancel'))
        status = {
          ...status,
          stage: 'cancelled',
          flowId: null,
          handoffAvailable: false,
          authGeneration: status.authGeneration + 1,
        };
      if (request.url.endsWith('/logout'))
        status = {
          ...status,
          stage: 'logged-out',
          flowId: null,
          handoffAvailable: false,
          authGeneration: status.authGeneration + 1,
        };
      if (request.url.endsWith('/refresh'))
        status = { ...status, stage: 'authorized', authGeneration: status.authGeneration + 1 };
      return response.end(JSON.stringify(status));
    }
    if (request.url === '/fixture.js') {
      response.setHeader('content-type', 'text/javascript');
      return response.end(
        "import {createApi} from '/api.js';import {mountFigmaSettings} from '/figma-settings.js';const api=createApi();await api.bootstrap();window.disposeSettings=mountFigmaSettings(document.getElementById('settings'),{api,onError:error=>{window.safeErrors=(window.safeErrors??[]).concat(error.message)}});",
      );
    }
    if (request.url === '/figma-auth-consent') {
      response.setHeader('referrer-policy', 'same-origin');
      response.setHeader('content-type', 'text/html');
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self' 'nonce-OWNEDNONCE'; style-src 'self'; connect-src 'self'; form-action 'self' https://www.figma.com/oauth/mcp; base-uri 'none'; frame-ancestors 'none'",
      );
      return response.end(
        sources['figma-auth-consent.html'].replace('__SFP_FIGMA_CONSENT_NONCE__', 'OWNEDNONCE'),
      );
    }
    const name = request.url.slice(1);
    if (sources[name]) {
      response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
      return response.end(sources[name]);
    }
    response.setHeader('content-type', 'text/html');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
    );
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"></head><body><textarea id="feature-draft">UNSAVED_WORKFLOW_DRAFT</textarea><div id="settings"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  // Browser interception alone does not cover native redirect chains. The proxy
  // forwards ONLY this exact owned HTTP origin and never opens any CONNECT tunnel.
  const blocker = createServer((request, response) => {
    const transportError = error => {
      if (!['ECONNRESET', 'EPIPE'].includes(error.code))
        unexpectedDeniedSocketErrors.push('UNEXPECTED_OWNED_PROXY_STREAM_ERROR');
    };
    request.on('error', transportError);
    response.on('error', transportError);
    let target;
    try {
      target = new URL(request.url);
    } catch {
      response.writeHead(502);
      return response.end();
    }
    if (target.origin !== origin) {
      deniedOtherRequests++;
      response.writeHead(502);
      return response.end();
    }
    const forward = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: target.pathname + target.search,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${address.port}` },
      },
      result => {
        result.on('error', error => {
          transportError(error);
          response.destroy();
        });
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    forward.on('error', error => {
      transportError(error);
      if (!response.headersSent) response.writeHead(502);
      if (!response.writableEnded) response.end();
    });
    request.pipe(forward);
  });
  blocker.on('connect', (request, socket) => {
    deniedSockets.add(socket);
    socket.on('error', error => {
      if (!['ECONNRESET', 'EPIPE'].includes(error.code))
        unexpectedDeniedSocketErrors.push('UNEXPECTED_DENIED_SOCKET_ERROR');
      socket.destroy();
    });
    socket.on('close', () => deniedSockets.delete(socket));
    if (request.url === 'www.figma.com:443') deniedOfficialConnects++;
    else deniedOtherRequests++;
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const blockerAddress = blocker.address();
  assert(blockerAddress && typeof blockerAddress !== 'string');
  const browser = await chromium.launch({
    channel: 'chrome',
    executablePath,
    headless: true,
    args: ['--disable-background-networking'],
    proxy: { server: `http://127.0.0.1:${blockerAddress.port}`, bypass: '<-loopback>' },
  });
  const browserContext = await browser.newContext();
  await browserContext.addCookies([
    {
      name: 'owned_fixture_only',
      value: 'OWNED_COOKIE_CANARY',
      url: origin,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await browserContext.addInitScript(() => {
    window.fixtureStorageWrites = 0;
    for (const storage of [localStorage, sessionStorage])
      storage.setItem = () => {
        window.fixtureStorageWrites++;
      };
  });
  await browserContext.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push({ unexpected: true });
    return route.abort();
  });
  browserContext.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === 'https://www.figma.com' && url.pathname === '/oauth/mcp')
      navigation.push({
        method: request.method(),
        authorizationPresent: !!request.headers().authorization,
        cookiePresent: !!request.headers().cookie,
      });
  });
  browserContext.on('page', page =>
    page.on('console', message => consoleMessages.push(message.text())),
  );
  const page = await browserContext.newPage();
  await page.goto(origin + '/');
  await expect(page.locator('#figma-settings-form')).toBeVisible();
  return {
    page,
    browserContext,
    actions,
    forms,
    external,
    navigation,
    consoleMessages,
    origin,
    deniedOfficialConnects: () => deniedOfficialConnects,
    deniedOtherRequests: () => deniedOtherRequests,
    reads: () => reads,
    holdNextStatus: () => {
      holdNext = true;
    },
    holdNextConsentStatus: () => {
      holdNext = true;
      holdConsentOnly = true;
    },
    statusHeld: () => heldRelease !== null,
    releaseStatus: () => heldRelease?.(),
    failNextAction: () => {
      failNext = true;
    },
    setStatus: value => {
      status = value;
    },
    close: async () => {
      heldRelease?.();
      await browser.close();
      for (const socket of deniedSockets) socket.destroy();
      await new Promise(resolve => blocker.close(resolve));
      await new Promise(resolve => server.close(resolve));
      expect(unexpectedDeniedSocketErrors).toEqual([]);
    },
  };
}

test('shows useful blocked own-client setup with zero login or external requests and preserves reference drafts', async context => {
  const f = await fixture(
    context,
    authStatus({
      stage: 'blocked',
      code: 'FIGMA_MCP_OAUTH_CONTRACT_REQUIRED',
      eligibilitySource: 'none',
      configuration: {
        ...configuration,
        clientIdEnv: null,
        clientSecretEnv: null,
        contractReference: null,
        contractDigest: null,
      },
    }),
  );
  try {
    await expect(f.page.getByRole('button', { name: '새 로그인 시작' })).toBeDisabled();
    await expect(f.page.locator('#figma-auth-state')).toContainText('계약 기록');
    await f.page.locator('[name=clientIdEnv]').fill('UNSAVED_OWN_ENV');
    await f.page.getByRole('button', { name: '인증 상태 읽기' }).click();
    await expect(f.page.locator('[name=clientIdEnv]')).toHaveValue('UNSAVED_OWN_ENV');
    await expect(f.page.locator('#feature-draft')).toHaveValue('UNSAVED_WORKFLOW_DRAFT');
    expect(f.actions).toHaveLength(0);
    expect(f.external).toHaveLength(0);
    expect(await f.page.evaluate(() => fixtureStorageWrites)).toBe(0);
    expect(await f.page.locator('input[type=password]').count()).toBe(0);
  } finally {
    await f.close();
  }
}, 60000);

test('polls only active safe status without replacing drafts or caret and retains the portal beside a manual consent tab', async context => {
  const f = await fixture(context);
  try {
    await f.page.getByRole('button', { name: '새 로그인 시작' }).click();
    const link = f.page.getByRole('link', { name: '별도 탭에서 동의 화면 열기' });
    await expect(link).toBeVisible();
    const input = f.page.locator('[name=clientIdEnv]');
    await input.fill('UNSAVED_REFERENCE');
    await input.evaluate(element => {
      element.focus();
      element.setSelectionRange(3, 8);
    });
    await expect.poll(f.reads, { timeout: 15000 }).toBeGreaterThan(2);
    await expect(input).toHaveValue('UNSAVED_REFERENCE');
    expect(
      await input.evaluate(element => [
        document.activeElement === element,
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([true, 3, 8]);
    const popupPromise = f.browserContext.waitForEvent('page');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' })).toBeEnabled();
    expect(f.browserContext.pages()).toHaveLength(2);
    expect(f.page.url()).toBe(f.origin + '/');
    await expect(f.page.locator('#feature-draft')).toHaveValue('UNSAVED_WORKFLOW_DRAFT');
    expect(f.forms).toHaveLength(0);
    expect(f.external).toHaveLength(0);
    expect(f.actions[0].input).toMatchObject({
      providerInstanceId: provider,
      configurationGeneration: 2,
      authGeneration: 3,
    });
    expect(f.actions[0].input.deadlineAt - Date.now()).toBeLessThanOrEqual(300000);
    await f.page.evaluate(() => disposeSettings());
    const reads = f.reads();
    await new Promise(resolve => setTimeout(resolve, 1300));
    expect(f.reads()).toBe(reads);
  } finally {
    await f.close();
  }
}, 60000);

test('sends the exact native CSRF form only after manual Continue and permits pinned 303 intent while the owned proxy denies all external transport', async context => {
  const f = await fixture(
    context,
    authStatus({ stage: 'waiting-for-callback', flowId: flow, handoffAvailable: true }),
  );
  try {
    const popupPromise = f.browserContext.waitForEvent('page');
    await f.page.getByRole('link', { name: '별도 탭에서 동의 화면 열기' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' })).toBeEnabled();
    expect(f.forms).toHaveLength(0);
    await popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' }).click();
    await expect.poll(() => f.forms.length).toBe(1);
    await expect.poll(() => f.deniedOfficialConnects() + f.external.length).toBeGreaterThan(0);
    expect(f.forms).toEqual([
      {
        keys: ['csrf', 'providerInstanceId', 'configurationGeneration', 'authGeneration', 'flowId'],
        csrfMatches: true,
        originMatches: true,
        originKind: 'owned',
        fetchSiteMatches: true,
        fetchModeMatches: true,
        fetchDestMatches: true,
        bindingMatches: true,
      },
    ]);
    expect(f.navigation).toEqual([
      { method: 'GET', authorizationPresent: false, cookiePresent: false },
    ]);
    expect(
      f.consoleMessages.some(value => value.includes('form-action') && value.includes('violates')),
    ).toBe(false);
    expect(f.page.url()).toBe(f.origin + '/');
    expect(JSON.stringify(f.actions)).not.toContain('OWNED_FORM_STATE');
    expect(f.consoleMessages.join(' ')).not.toContain('OWNED_FORM_STATE');
    expect(await f.page.evaluate(() => fixtureStorageWrites)).toBe(0);
  } finally {
    await f.close();
  }
}, 60000);

test('refuses a superseded flow at manual Continue without redeeming or starting another login', async context => {
  const f = await fixture(
    context,
    authStatus({ stage: 'waiting-for-callback', flowId: flow, handoffAvailable: true }),
  );
  try {
    const popupPromise = f.browserContext.waitForEvent('page');
    await f.page.getByRole('link', { name: '별도 탭에서 동의 화면 열기' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' })).toBeEnabled();
    f.setStatus(authStatus({ stage: 'cancelled', authGeneration: 4 }));
    await popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' }).click();
    await expect(popup.locator('#figma-consent-status')).toContainText(
      '동의를 전송하지 않았습니다',
    );
    expect(f.forms).toHaveLength(0);
    expect(f.actions).toHaveLength(0);
    expect(f.external).toHaveLength(0);
    expect(await popup.locator('input[name=csrf]').inputValue()).toBe('');
  } finally {
    await f.close();
  }
}, 60000);

test('exposes explicit cancel logout and refresh using current generations without automatic refresh or external requests', async context => {
  const f = await fixture(context);
  try {
    await f.page.getByRole('button', { name: '새 로그인 시작' }).click();
    await expect(f.page.getByRole('button', { name: '현재 로그인 취소' })).toBeEnabled();
    await f.page.getByRole('button', { name: '현재 로그인 취소' }).click();
    await expect(f.page.locator('#figma-auth-state')).toContainText('취소됨');
    await f.page.getByRole('button', { name: '로컬 세션 로그아웃' }).click();
    await expect(f.page.locator('#figma-auth-state')).toContainText('로그아웃됨');
    f.setStatus(
      authStatus({
        stage: 'authorized',
        authGeneration: 5,
        serverAuthorizationObserved: true,
        expiresAt: Date.now() + 60000,
      }),
    );
    await f.page.getByRole('button', { name: '인증 상태 읽기' }).click();
    await expect(f.page.getByRole('button', { name: '인증 명시적으로 갱신' })).toBeEnabled();
    expect(f.actions.map(action => action.action)).toEqual(['start', 'cancel', 'logout']);
    await f.page.getByRole('button', { name: '인증 명시적으로 갱신' }).click();
    await expect.poll(() => f.actions.length).toBe(4);
    expect(f.actions[1].input.flowId).toBe(flow);
    expect(f.actions[2].input.authGeneration).toBe(4);
    expect(f.actions[3].input.authGeneration).toBe(5);
    expect(f.actions[3].input.deadlineAt - Date.now()).toBeLessThanOrEqual(15000);
    expect(f.external).toHaveLength(0);
    expect(f.forms).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 60000);

test('rejects late status after cancellation and shows only closed failures while preserving reference drafts', async context => {
  const f = await fixture(
    context,
    authStatus({
      stage: 'waiting-for-callback',
      flowId: flow,
      handoffAvailable: true,
      expiresAt: Date.now() + 300000,
    }),
  );
  try {
    await expect(f.page.getByRole('button', { name: '현재 로그인 취소' })).toBeEnabled();
    await f.page.locator('[name=clientIdEnv]').fill('UNSAVED_CANCEL_REFERENCE');
    f.holdNextStatus();
    await expect.poll(f.statusHeld, { timeout: 15000 }).toBe(true);
    await f.page.getByRole('button', { name: '현재 로그인 취소' }).click();
    await expect(f.page.locator('#figma-auth-state')).toContainText('취소됨');
    f.releaseStatus();
    await expect(f.page.getByRole('link', { name: '별도 탭에서 동의 화면 열기' })).toHaveCount(0);
    await expect(f.page.locator('[name=clientIdEnv]')).toHaveValue('UNSAVED_CANCEL_REFERENCE');
    f.failNextAction();
    await f.page.getByRole('button', { name: '새 로그인 시작' }).click();
    await expect(f.page.getByRole('alert')).toContainText('서비스 상태를 다시 확인');
    expect(await f.page.locator('body').textContent()).not.toContain('OWNED_ERROR_TOKEN_CANARY');
    expect(JSON.stringify(await f.page.evaluate(() => safeErrors))).not.toContain('OWNED_ERROR');
    expect(f.forms).toHaveLength(0);
    expect(f.external).toHaveLength(0);
    expect(f.deniedOfficialConnects()).toBe(0);
  } finally {
    f.releaseStatus();
    await f.close();
  }
}, 60000);

for (const { part, when } of [
  { part: 'query', when: 'entry' },
  { part: 'hash', when: 'entry' },
  { part: 'query', when: 'after-status' },
  { part: 'hash', when: 'after-status' },
])
  test(`refuses a late ${part} at ${when} before native consent submission`, async context => {
    const f = await fixture(
      context,
      authStatus({ stage: 'waiting-for-callback', flowId: flow, handoffAvailable: true }),
    );
    try {
      const opened = f.browserContext.waitForEvent('page');
      await f.page.getByRole('link', { name: '별도 탭에서 동의 화면 열기' }).click();
      const popup = await opened;
      await popup.waitForLoadState();
      await expect(popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' })).toBeEnabled();
      let reads = 0;
      popup.on('request', request => {
        if (new URL(request.url()).pathname === '/api/figma-settings/auth') reads++;
      });
      if (when === 'after-status') {
        f.holdNextConsentStatus();
        await popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' }).click();
        await expect.poll(f.statusHeld, { timeout: 15000 }).toBe(true);
      }
      await popup.evaluate(
        value =>
          history.replaceState(
            null,
            '',
            '/figma-auth-consent' +
              (value === 'query' ? '?unexpected=OWNED_LOCATION_CANARY' : '#OWNED_LOCATION_CANARY'),
          ),
        part,
      );
      if (when === 'entry')
        await popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' }).click();
      else f.releaseStatus();
      await expect(popup.locator('#figma-consent-status')).toContainText(
        '동의를 전송하지 않았습니다',
      );
      await expect(popup.getByRole('button', { name: 'Figma 동의 화면으로 계속' })).toBeDisabled();
      expect(f.forms).toHaveLength(0);
      expect(f.navigation).toHaveLength(0);
      expect(f.deniedOfficialConnects()).toBe(0);
      expect(reads).toBe(when === 'entry' ? 0 : 1);
      expect(await popup.locator('input[name=csrf]').inputValue()).toBe('');
      expect(await popup.locator('body').textContent()).not.toContain('OWNED_LOCATION_CANARY');
    } finally {
      f.releaseStatus();
      await f.close();
    }
  }, 60000);

test.each(['RUN_OUTCOME_UNKNOWN', 'SERVICE_JOB_OUTCOME_UNKNOWN'])(
  'projects actual %s to a fixed preserved-fence explanation without echoing messages',
  code => {
    const error = safeAuthError({
      code,
      message: 'OWNED_PRIVATE_MESSAGE_CANARY',
      stack: 'OWNED_PRIVATE_STACK_CANARY',
    });
    expect(error.code).toBe(code);
    expect(error.message).toContain('미확정');
    expect(error.message).toContain('원래');
    expect(error.message).not.toContain('OWNED_PRIVATE');
  },
);
