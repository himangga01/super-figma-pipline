import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

// Run against the real local portal server with its isolated test storage.
// This check never starts a design capture, generation or application operation.
const target = new URL(process.argv[2] ?? '');
assert.ok(
  target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname),
  'Use the service-owned loopback portal URL',
);
const output = resolve(process.argv[3] ?? 'portal-chrome-evidence');
await mkdir(output, { recursive: true });
const require = createRequire(new URL('../../../cli/package.json', import.meta.url));
const { chromium } = require('playwright');
const paths =
  process.platform === 'win32'
    ? [
        process.env.SFP_CHROME_EXECUTABLE,
        join(
          process.env.PROGRAMFILES ?? 'C:/Program Files',
          'Google/Chrome/Application/chrome.exe',
        ),
        join(
          process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
          'Google/Chrome/Application/chrome.exe',
        ),
        join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      ]
    : [
        process.env.SFP_CHROME_EXECUTABLE,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ];
const candidates = paths.filter(Boolean);
const installed = await Promise.allSettled(candidates.map(path => access(path)));
const executablePath = candidates[installed.findIndex(result => result.status === 'fulfilled')];
assert.ok(executablePath, 'Installed Google Chrome is required; no fallback engine is allowed');
const browser = await chromium.launch({ channel: 'chrome', executablePath, headless: true });
const errors = [];
const checks = [];
const deferredActivity = () => {
  let release, notify;
  const pending = new Promise(resolveDelay => {
    release = resolveDelay;
  });
  const started = new Promise(resolveStarted => {
    notify = resolveStarted;
  });
  return { pending, started, release, notify };
};
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(target.href);
  await page.locator('.app-shell').waitFor();
  await page.getByRole('button', { name: '새 초안', exact: true }).click();
  await page.locator('[data-field="name"]').fill(`Chrome UI check ${Date.now()}`);
  await page.locator('[data-field="name"]').press('Tab');
  const workflowName = await page.locator('[data-field="name"]').inputValue();
  await page.locator('[data-field="node.label"]').fill('Figma 소스 · Chrome QA');
  await page.locator('[data-field="node.label"]').press('Tab');
  await page.locator('[data-field="source"]').selectOption('chrome-scripter');
  await page.locator('[data-field="source"]').selectOption('chrome-page-api');
  checks.push('Source path updates the real plan configuration');
  await page.getByRole('button', { name: '검증 노드 추가', exact: true }).click();
  assert.equal(await page.locator('[data-node]').count(), 6);
  await page.getByRole('button', { name: '노드 삭제', exact: true }).click();
  assert.equal(await page.locator('[data-node]').count(), 5);
  checks.push('Adding and deleting a node modifies the graph');
  const sourceNode = page.locator('[data-node="source"]');
  await sourceNode.focus();
  const before = await sourceNode.evaluate(element => ({
    left: parseInt(element.style.left, 10),
    top: parseInt(element.style.top, 10),
  }));
  await sourceNode.press('ArrowRight');
  assert.equal(
    await sourceNode.evaluate(element => parseInt(element.style.left, 10)),
    before.left + 20,
  );
  checks.push('Keyboard node movement changes persisted coordinates');
  await page.locator('[data-node="requirements"]').click();
  await page
    .locator('[data-field="requirement.description"]')
    .fill('Build an accessible frontend from the chosen design.');
  await page.locator('[data-field="requirement.description"]').press('Tab');
  let releaseSave;
  const holdSave = new Promise(resolveHold => {
    releaseSave = resolveHold;
  });
  await page.route('**/api/workflows', async route => {
    if (route.request().method() === 'POST') await holdSave;
    await route.continue();
  });
  const saveResponse = page
    .waitForResponse(
      response =>
        response.url().endsWith('/api/workflows') && response.request().method() === 'POST',
    )
    .then(
      response => ({ response }),
      error => ({ error }),
    );
  try {
    await page.getByRole('button', { name: '저장', exact: true }).click();
    assert.ok(
      await page.locator('[data-field="requirement.description"]').isDisabled(),
      'Inspector edits must be locked while a real HTTP save is pending',
    );
    assert.ok(
      await page.getByRole('button', { name: '검증 노드 추가', exact: true }).isDisabled(),
      'Node addition must be locked while save is pending',
    );
    const pendingSource = page.locator('[data-node="source"]');
    await pendingSource.focus();
    await pendingSource.press('ArrowRight');
    assert.equal(
      await pendingSource.evaluate(element => parseInt(element.style.left, 10)),
      before.left + 20,
      'Keyboard mutation must be ignored during save',
    );
    checks.push('Delayed real HTTP save locks inspector, palette and keyboard graph mutations');
    const pendingViewport = await page
      .locator('#graph-plane')
      .evaluate(element => element.style.transform);
    const canvasBox = await page.locator('#canvas').boundingBox();
    await page.locator('#canvas').evaluate(element => {
      element.addEventListener(
        'wheel',
        () => {
          element.dataset.testWheelObserved = 'true';
        },
        { once: true },
      );
    });
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height - 80);
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    try {
      await page.mouse.wheel(0, -200);
    } finally {
      await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    }
    await page.waitForFunction(
      () => document.querySelector('#canvas').dataset.testWheelObserved === 'true',
    );
    assert.equal(
      await page.locator('#graph-plane').evaluate(element => element.style.transform),
      pendingViewport,
      'Ctrl+wheel must not mutate the viewport while real HTTP save is pending',
    );
    checks.push('Ctrl+wheel cannot change the viewport during a pending actual HTTP save');
  } finally {
    releaseSave();
    await saveResponse;
    await page.unroute('**/api/workflows');
  }
  const received = await saveResponse;
  if (received.error) throw received.error;
  const saved = await received.response.json();
  assert.equal(saved.name, workflowName);
  assert.equal(saved.plan.design.source, 'chrome');
  assert.equal(saved.plan.design.collector, 'page-api');
  assert.equal(saved.graph.nodes.find(node => node.id === 'source').position.x, before.left + 20);
  assert.equal(
    saved.plan.requirements[0].description,
    'Build an accessible frontend from the chosen design.',
  );
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.locator('[data-node="source"]').click();
  assert.equal(
    await page.locator('[data-field="node.label"]').inputValue(),
    'Figma 소스 · Chrome QA',
  );
  checks.push(
    'Save/reload preserves labels, plan edits and node positions through the actual HTTP API',
  );
  await page.locator('[data-field="node.label"]').fill('Figma 소스 · 키보드 저장');
  const shortcutResponse = page
    .waitForResponse(
      response =>
        response.url().endsWith(`/api/workflows/${saved.id}`) &&
        response.request().method() === 'PUT',
    )
    .then(
      response => ({ response }),
      error => ({ error }),
    );
  await page
    .locator('[data-field="node.label"]')
    .press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  const shortcut = await shortcutResponse;
  if (shortcut.error) throw shortcut.error;
  const keyboardSaved = await shortcut.response.json();
  assert.equal(
    keyboardSaved.graph.nodes.find(node => node.id === 'source').label,
    'Figma 소스 · 키보드 저장',
    'Keyboard save must commit focused input without needing blur',
  );
  checks.push('Ctrl+S persists focused text edits through actual HTTP without requiring blur');
  await page.locator('[data-node="requirements"]').click();
  await page.locator('details:has([data-field="requirements-json"])').evaluate(element => {
    element.open = true;
  });
  const mutations = [];
  const observeMutation = request => {
    if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/api/workflows'))
      mutations.push(request.url());
  };
  page.on('request', observeMutation);
  await page.locator('[data-field="requirements-json"]').fill('[{');
  await page
    .locator('[data-field="requirements-json"]')
    .press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.locator('#notice.error').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('[data-field="requirements-json"]').inputValue(),
    '[{',
    'Invalid JSON must remain visible after a blocked save',
  );
  assert.deepEqual(
    mutations,
    [],
    'Invalid JSON must not invoke a save or execute the previous plan',
  );
  await page.locator('[data-node="source"]').click();
  await page.locator('[data-node="requirements"]').click();
  assert.equal(
    await page.locator('[data-field="requirements-json"]').inputValue(),
    '[{',
    'Invalid JSON must survive node navigation',
  );
  page.off('request', observeMutation);
  await page.locator('[data-field="requirements-json"]').fill(
    JSON.stringify(
      [
        {
          id: 'requirement-1',
          description: 'JSON keyboard draft',
          layers: ['frontend'],
          required: true,
        },
      ],
      null,
      2,
    ),
  );
  const validJsonResponse = page
    .waitForResponse(
      response =>
        response.url().endsWith(`/api/workflows/${saved.id}`) &&
        response.request().method() === 'PUT',
    )
    .then(
      response => ({ response }),
      error => ({ error }),
    );
  await page
    .locator('[data-field="requirements-json"]')
    .press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  const validJson = await validJsonResponse;
  if (validJson.error) throw validJson.error;
  assert.equal(
    (await validJson.response.json()).plan.requirements[0].description,
    'JSON keyboard draft',
  );
  checks.push(
    'Invalid JSON stays visible, blocks HTTP mutation and can be corrected then saved without blur',
  );
  await page.locator('[data-node="source"]').click();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  const zoomLabel = await page.locator('#zoom-value').textContent();
  await page.getByRole('button', { name: '축소', exact: true }).click();
  assert.notEqual(await page.locator('#zoom-value').textContent(), zoomLabel);
  checks.push('Canvas zoom controls operate');
  await page.screenshot({ path: join(output, 'builder-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: '실행 맵', exact: true }).click();
  await page.locator('.timeline').waitFor();
  await page.screenshot({ path: join(output, 'live-empty-desktop.png'), fullPage: true });
  checks.push('Live empty state presents real absence of execution history');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: '워크플로 빌더', exact: true }).click();
  await page.screenshot({ path: join(output, 'builder-mobile.png'), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile portal must not overflow the viewport',
  );
  checks.push('Mobile layout has no horizontal document overflow');
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.locator('[data-action="usage-guide"]').click();
  await page.locator('[data-action="close-guide"]').click();
  const firstActivity = deferredActivity();
  let delayedActivity = firstActivity;
  const activityQueries = [];
  await page.route('**/api/activities?*', async route => {
    if (route.request().method() === 'GET') {
      activityQueries.push(new URL(route.request().url()).searchParams.get('type'));
      const delayed = delayedActivity;
      delayedActivity = null;
      delayed?.notify();
      if (delayed) await delayed.pending;
    }
    await route.continue();
  });
  try {
    await page.locator('[data-view="activities"]').first().click();
    await firstActivity.started;
    const filter = page.locator('#activity-filter-form [name="action"]');
    await filter.fill('guide.open');
    await filter.evaluate(element => element.setSelectionRange(2, 7, 'backward'));
    const firstResponse = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/activities' &&
        response.request().method() === 'GET',
    );
    firstActivity.release();
    await firstResponse;
    await page.locator('.activity-row').first().waitFor();
    assert.equal(
      await filter.inputValue(),
      'guide.open',
      'A delayed activity load must preserve the unsubmitted filter draft',
    );
    assert.deepEqual(
      await filter.evaluate(element => ({
        focused: document.activeElement === element,
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection,
      })),
      { focused: true, start: 2, end: 7, direction: 'backward' },
      'An asynchronous activity render must preserve the focused filter selection',
    );
    await page.locator('[data-action="refresh-activities"]').click();
    await page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/activities' &&
        response.request().method() === 'GET',
    );
    assert.equal(
      activityQueries.at(-1),
      null,
      'Refreshing must use the applied query, not the unsent draft',
    );
    assert.equal(await filter.inputValue(), 'guide.open');
    checks.push(
      'Delayed activity refresh preserves unsent filter text, focus and caret without silently applying it',
    );
    const applied = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/activities' &&
        new URL(response.url()).searchParams.get('type') === 'guide.open',
    );
    await page.locator('#activity-filter-form button[type="submit"]').click();
    await applied;
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.activity-row h3')];
      return rows.length > 0 && rows.every(row => row.textContent === 'guide.open');
    });
    assert.equal(activityQueries.at(-1), 'guide.open');
    checks.push(
      'Applying an activity draft sends the actual filter and renders matching persisted records',
    );
    const stale = deferredActivity();
    delayedActivity = stale;
    try {
      await page.locator('[data-action="refresh-activities"]').click();
      await stale.started;
      await filter.fill('workflow.update');
      const latest = page.waitForResponse(
        response =>
          new URL(response.url()).pathname === '/api/activities' &&
          new URL(response.url()).searchParams.get('type') === 'workflow.update',
      );
      await page.locator('#activity-filter-form button[type="submit"]').click();
      await latest;
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('.activity-row h3')];
        return rows.length > 0 && rows.every(row => row.textContent === 'workflow.update');
      });
      const old = page.waitForResponse(
        response =>
          new URL(response.url()).pathname === '/api/activities' &&
          new URL(response.url()).searchParams.get('type') === 'guide.open',
      );
      stale.release();
      await old;
      await page.waitForTimeout(100);
      assert.equal(await filter.inputValue(), 'workflow.update');
      assert.ok(
        (await page.locator('.activity-row h3').allTextContents()).every(
          type => type === 'workflow.update',
        ),
        'A stale activity response must not overwrite a newer applied filter',
      );
      checks.push(
        'Activity query epochs reject an older delayed response after a newer filter is applied',
      );
    } finally {
      stale.release();
    }
  } finally {
    firstActivity.release();
    await page.unroute('**/api/activities?*');
  }
  assert.deepEqual(errors, [], 'No uncaught browser JavaScript errors');
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        target: target.origin,
        workflowId: saved.id,
        checks,
        errors,
        sourceCaptureExecuted: false,
        generationExecuted: false,
        applicationExecuted: false,
      },
      null,
      2,
    ),
  );
  process.stdout.write(JSON.stringify({ workflowId: saved.id, checks, errors, output }, null, 2));
} finally {
  await browser.close();
}
