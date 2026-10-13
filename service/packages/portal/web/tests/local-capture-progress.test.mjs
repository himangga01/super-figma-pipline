import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { chromium } from 'playwright';
import { expect, test } from 'vitest';

import { requireChrome } from '../../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../../mcp/src/portal/chrome-runtime.js';

test('refreshes safe active progress without replacing feature or unknown recovery drafts', async context => {
  const executablePath = googleChromeExecutable();
  requireChrome(context, executablePath);
  if (!executablePath) throw Error('INSTALLED_GOOGLE_CHROME_REQUIRED');
  const sources = Object.fromEntries(
    await Promise.all(
      ['service-functions.js', 'schema-form.js', 'api.js'].map(async name => [
        name,
        await readFile(new URL('../' + name, import.meta.url), 'utf8'),
      ]),
    ),
  );
  let state = 'running',
    reads = 0;
  const id = '00000000-0000-4000-8000-000000000001';
  const fingerprint = `sha256:${'1'.repeat(64)}`;
  const deadlineAt = Date.now() + 300000;
  const job = () => ({
    id,
    name: 'chrome.export',
    type: 'feature',
    status: state,
    workspaceId: id,
    deadlineAt,
    requestPreview: state === 'awaiting-approval' ? { args: { text: 'EXACT_REVIEW_INPUT' } } : null,
    approvals:
      state === 'awaiting-approval'
        ? [
            {
              approvalId: id,
              source: 'service',
              operationName: 'chrome.export',
              target: { label: 'Owned approval fixture' },
              effectSummary: ['Review the owned fixture'],
              expiresAt: deadlineAt,
            },
          ]
        : [],
    result: null,
    error:
      state === 'unknown'
        ? { code: 'CHROME_CONNECTION_REQUIRED', message: 'Connection unavailable' }
        : null,
    progress: [{ phase: reads > 1 ? 'exporting' : 'connecting', at: new Date().toISOString() }],
    actions: [
      { action: 'prepare-recovery', enabled: state === 'unknown', reason: '' },
      { action: 'approve', enabled: state === 'awaiting-approval', reason: '' },
    ],
    recovery: { available: state === 'unknown', challenge: null },
  });
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/bootstrap')
        return response.end(JSON.stringify({ csrfToken: 'OWNED_FIXTURE_CSRF' }));
      if (request.url === '/api/service/catalog')
        return response.end(
          JSON.stringify({
            tools: [],
            features: [
              {
                name: 'chrome.export',
                description: 'Owned export fixture',
                kind: 'write',
                group: 'chrome',
                prerequisites: [],
                inputSchema: {
                  type: 'object',
                  required: ['text'],
                  properties: { text: { type: 'string' } },
                  additionalProperties: false,
                },
              },
            ],
          }),
        );
      if (request.url === '/api/service/jobs')
        return response.end(JSON.stringify({ jobs: [job()] }));
      if (request.url.endsWith('/actions'))
        return response.end(
          JSON.stringify({
            job: {
              ...job(),
              recovery: {
                available: true,
                challenge: {
                  id,
                  fingerprint,
                  workspaceBinding: fingerprint,
                  legacy: true,
                  expiresAt: Date.now() + 60000,
                },
              },
            },
          }),
        );
      reads++;
      return response.end(JSON.stringify({ job: job() }));
    }
    response.setHeader(
      'content-type',
      request.url.endsWith('.js') ? 'text/javascript' : 'text/html',
    );
    response.end(
      sources[request.url.slice(1)] ??
        `<!doctype html><div id="app"></div><script type="module">
      import {mountServiceFunctions} from '/service-functions.js';import {createApi} from '/api.js';
      const api=createApi();await api.bootstrap();window.unmount=mountServiceFunctions(document.querySelector('#app'),{api});
    </script>`,
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-function-id="feature:chrome.export"]').click();
    await page.locator('[data-job-id]').click();
    const field = page.locator('[data-schema-field="text"] textarea').first();
    await field.fill('unsent owner draft');
    await page.locator('#service-function-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-job-progress="exporting"]'));
    assert.equal(await field.inputValue(), 'unsent owner draft');
    assert.equal(await page.locator('#service-request-preview').isVisible(), true);
    state = 'awaiting-approval';
    const approval = page.locator('[data-job-action="approve"]');
    await approval.waitFor();
    await page.locator('#service-job-detail details').evaluateAll(items => {
      for (const detail of items) detail.open = true;
    });
    await approval.focus();
    const oldApproval = await approval.elementHandle();
    const reviewing = reads;
    await expect.poll(() => reads, { timeout: 7000 }).toBeGreaterThan(reviewing);
    assert.equal(await oldApproval.evaluate(element => element.isConnected), true);
    assert.equal(await approval.evaluate(element => document.activeElement === element), true);
    assert.equal(
      await page
        .locator('#service-job-detail details')
        .evaluateAll(items => items.every(item => item.open)),
      true,
    );
    state = 'unknown';
    await page.waitForFunction(() =>
      document.querySelector('[data-job-action="prepare-recovery"]'),
    );
    const stopped = reads;
    await page.locator('[data-job-action="prepare-recovery"]').click();
    const reason = page.locator('[data-local-recovery] input[name="reason"]');
    await reason.fill('owner has not submitted this decision');
    await page.waitForTimeout(1400);
    assert.equal(reads, stopped);
    assert.equal(await reason.inputValue(), 'owner has not submitted this decision');
    assert.equal(await field.inputValue(), 'unsent owner draft');
    assert.match(
      await page.locator('[data-local-recovery]').textContent(),
      /서비스가 과거 종료를 증명한 것이 아닙니다/u,
    );
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.unmount());
    await page.waitForTimeout(1100);
    assert.equal(reads, stopped);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}, 20000);
