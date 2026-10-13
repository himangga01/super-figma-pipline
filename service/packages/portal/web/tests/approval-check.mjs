import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const target = new URL(process.argv[2] ?? '');
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname));
const runId = process.argv[3];
assert.ok(runId);
const output = resolve(process.argv[4]);
await mkdir(output, { recursive: true });
const executablePath = process.env.SFP_CHROME_EXECUTABLE;
assert.ok(
  executablePath,
  'The service test wrapper must supply its resolved installed Google Chrome executable',
);
await access(executablePath);
const require = createRequire(new URL('../../../cli/package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(target.href);
  await page.locator('.app-shell').waitFor();
  await page.getByRole('tab', { name: '실행 맵', exact: true }).click();
  await page.locator(`[data-open-run="${runId}"]`).click();
  await page.locator('[data-run-action="approve"]').click();
  assert.equal(
    await page.locator('#action-args').count(),
    0,
    'Approval must not ask the user to type an internal ID as JSON',
  );
  assert.equal(
    await page.locator('#approval-choice option').count(),
    2,
    'Expired prompts must not be selectable',
  );
  await page.locator('#approval-choice').selectOption('1');
  assert.ok(
    (await page.locator('#approval-summary').textContent()).includes('Second fixture target'),
  );
  assert.ok(
    (await page.locator('#approval-summary').textContent()).includes(
      'filesystem-write:non-destructive:targetPath',
    ),
  );
  const approvedResponse = page
    .waitForResponse(
      response =>
        response.url().endsWith(`/api/runs/${runId}/actions`) &&
        response.request().method() === 'POST',
    )
    .then(
      response => ({ response }),
      error => ({ error }),
    );
  await page.getByRole('button', { name: '승인 요청', exact: true }).click();
  const approved = await approvedResponse;
  if (approved.error) throw approved.error;
  assert.deepEqual(approved.response.request().postDataJSON(), {
    action: 'approve',
    args: { approvalId: 'second-retained-approval' },
  });
  assert.equal(approved.response.status(), 202);
  await page.locator('[data-run-action="reject"]').click();
  assert.equal(await page.locator('#action-args').count(), 0);
  assert.equal(
    await page.locator('#approval-choice').count(),
    0,
    'A single retained prompt must be preselected automatically',
  );
  assert.ok(
    (await page.locator('#approval-summary').textContent()).includes('First fixture target'),
  );
  await page.screenshot({ path: join(output, 'single-approval-dialog.png'), fullPage: true });
  const rejectedResponse = page
    .waitForResponse(
      response =>
        response.url().endsWith(`/api/runs/${runId}/actions`) &&
        response.request().method() === 'POST',
    )
    .then(
      response => ({ response }),
      error => ({ error }),
    );
  await page.getByRole('button', { name: '거절 요청', exact: true }).click();
  const rejected = await rejectedResponse;
  if (rejected.error) throw rejected.error;
  assert.deepEqual(rejected.response.request().postDataJSON(), {
    action: 'reject',
    args: { approvalId: 'first-retained-approval' },
  });
  assert.equal(rejected.response.status(), 202);
  assert.deepEqual(errors, []);
  const result = {
    multiplePromptSelection: true,
    singlePromptPreselected: true,
    internalIdEntryRequired: false,
    errors,
    sourceCaptureExecuted: false,
    nativeChromeApprovalAutomated: false,
  };
  await writeFile(join(output, 'approval-result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result));
} finally {
  await browser.close();
}
