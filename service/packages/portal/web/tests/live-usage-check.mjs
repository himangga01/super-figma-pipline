/* eslint-disable no-await-in-loop -- one actual browser workflow and its evidence must stay ordered */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const object = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const key = process.platform === 'darwin' ? 'Meta' : 'Control';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const comparePath = value => resolve(value).replaceAll('\\', '/').toLowerCase();

export function designIdentity(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.ok(['www.figma.com', 'figma.com'].includes(url.hostname));
  assert.ok(!url.username && !url.password && !url.port);
  const fileKey = /^\/(?:design|file)\/([A-Za-z0-9]{10,128})(?:\/[^/]*)?\/?$/u.exec(
    url.pathname,
  )?.[1];
  const nodeId = url.searchParams.get('node-id')?.replace(/^(\d+)-(\d+)$/u, '$1:$2');
  assert.ok(fileKey && nodeId);
  return { fileKey, nodeId };
}

export function validateConfig(input) {
  assert.ok(
    input && typeof input === 'object' && !Array.isArray(input),
    'Use a JSON config object',
  );
  const base = new URL(input.baseUrl ?? 'http://127.0.0.1:4310');
  assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname));
  assert.ok(
    base.port === '4310' &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
    'This runner is scoped to the actual production portal on loopback port 4310',
  );
  if (input.browserWsEndpoint !== undefined) {
    const endpoint = new URL(input.browserWsEndpoint);
    assert.ok(
      endpoint.protocol === 'ws:' &&
        endpoint.hostname === '127.0.0.1' &&
        endpoint.port &&
        endpoint.pathname !== '/' &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.search &&
        !endpoint.hash,
      'Use the coordinator-owned loopback Chrome WebSocket endpoint',
    );
    assert.ok(
      ['playwright', 'cdp'].includes(input.browserConnection ?? 'playwright'),
      'Choose the actual helper connection protocol',
    );
    assert.notEqual(
      input.isolatedBrowser,
      true,
      'Do not request another browser in persistent reuse mode',
    );
  }
  assert.ok(
    isAbsolute(input.workspaceFolder ?? '') && !/^[/\\]{2}|^\\[?.]\\/u.test(input.workspaceFolder),
    'Use an explicit owned local workspace folder',
  );
  assert.ok(isAbsolute(input.evidenceRoot ?? ''), 'Use an explicit absolute evidence directory');
  const inside = relative(resolve(input.workspaceFolder), resolve(input.evidenceRoot));
  assert.ok(
    isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`),
    'Keep evidence outside the target workspace',
  );
  assert.deepEqual(
    designIdentity(input.designUrl),
    { fileKey: 'ly06O8jAcrd7oWmwhz5Vr6', nodeId: '1378:120' },
    'These three usage rounds are scoped to the authorized CDD page',
  );
  const requirements = (
    Array.isArray(input.requirements) ? input.requirements : [input.requirements]
  ).map((value, index) => {
    const requirement = object(value),
      workflow = object(requirement.workflow);
    assert.ok(typeof requirement.description === 'string' && requirement.description.trim());
    assert.ok(
      typeof requirement.id === 'string' && requirement.id.trim(),
      `Supply reviewed requirement ID ${index + 1}`,
    );
    assert.deepEqual(requirement.layers, ['frontend']);
    assert.equal(workflow.status, 'confirmed', 'Use owner-reviewed product requirements');
    for (const field of ['roles', 'states', 'routes', 'apiContracts', 'dataContracts'])
      assert.ok(
        Array.isArray(workflow[field]) &&
          workflow[field].every(item => typeof item === 'string' && item.trim()),
        `Supply reviewed ${field}`,
      );
    assert.ok(workflow.roles.length && workflow.states.length);
    assert.ok(
      workflow.decisions?.length === 1 &&
        workflow.decisions[0].layer === 'frontend' &&
        workflow.decisions[0].action === 'implement' &&
        typeof workflow.decisions[0].evidence === 'string',
    );
    return requirement;
  });
  assert.ok(requirements.length > 0 && requirements.length <= 16);
  assert.equal(new Set(requirements.map(item => item.id)).size, requirements.length);
  assert.ok(
    Array.isArray(input.rounds) && input.rounds.length === 3,
    'Declare all three real usage rounds',
  );
  const targets = new Set();
  const rounds = input.rounds.map((round, index) => {
    assert.equal(round.number, index + 1);
    assert.equal(
      round.case ?? 'new-blank',
      'new-blank',
      'All three rounds are C4; later case acceptance remains separate',
    );
    assert.equal(round.source, ['chrome-page-api', 'chrome-scripter', 'chrome-page-api'][index]);
    assert.ok(
      typeof round.targetPath === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(round.targetPath) &&
        !round.targetPath.split('/').some(part => !part || part === '.' || part === '..'),
      'Use a fresh relative output path',
    );
    assert.ok(
      !targets.has(round.targetPath.toLowerCase()),
      'Every round needs a different output target',
    );
    targets.add(round.targetPath.toLowerCase());
    if (round.decisionFile !== undefined) assert.ok(isAbsolute(round.decisionFile));
    assert.ok(
      round.requestContext !== true || round.sessionMode === 'web-only',
      'Web coding leases cannot be transferred to an external CLI/MCP session',
    );
    return { ...round, case: 'new-blank', number: index + 1 };
  });
  const approvalOperations = input.approvalOperations ?? [];
  assert.ok(
    Array.isArray(approvalOperations) &&
      approvalOperations.every(name =>
        ['portal_plan', 'portal_start', 'portal_next', 'portal_status'].includes(name),
      ),
    "Only this runner's source/context operation approvals can be authorized",
  );
  const observeTimeoutMs = input.observeTimeoutMs ?? 360000;
  assert.ok(
    Number.isInteger(observeTimeoutMs) && observeTimeoutMs >= 10000 && observeTimeoutMs <= 900000,
  );
  const requiredOutcome = input.requiredOutcome ?? 'agent-handoff';
  assert.ok(['capture', 'agent-handoff', 'generation'].includes(requiredOutcome));
  return {
    ...input,
    baseUrl: base.origin,
    requirements,
    rounds,
    approvalOperations,
    observeTimeoutMs,
    requiredOutcome,
    headless: input.headless !== false,
  };
}

export function selectOwnedPortalPage(browser, origin) {
  const pages = browser
    .contexts()
    .flatMap(context => context.pages())
    .filter(page => {
      try {
        return new URL(page.url()).origin === origin;
      } catch {
        return false;
      }
    });
  assert.equal(
    pages.length,
    1,
    'The owned helper must expose exactly one existing portal tab; no new context or page is created',
  );
  return pages[0];
}

export function safeRunnerFailure(error, privateValues = []) {
  let message = String(error?.message ?? 'Unknown runner failure').slice(0, 2000);
  for (const value of privateValues) if (value) message = message.replaceAll(value, '[redacted]');
  const locations = [
    ...new Set(String(error?.stack ?? '').match(/live-usage-check\.mjs:\d+:\d+/gu) ?? []),
  ].slice(0, 6);
  return { message, locations };
}

export function summarizeRun(run) {
  assert.ok(
    [
      'queued',
      'active',
      'awaiting-input',
      'awaiting-agent',
      'awaiting-approval',
      'failed',
      'unknown',
      'completed',
      'cancelled',
    ].includes(run.status),
    'Unexpected public run status',
  );
  const context = object(run.context);
  const blueprint = Object.hasOwn(context, 'blueprint') ? object(context.blueprint) : context;
  const design = object(blueprint.design);
  const result = object(run.result);
  const validation = object(result.validation);
  const coverage = object(blueprint.workflowCoverage);
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowRevision: run.workflowRevision,
    workspaceId: run.workspaceId,
    status: run.status,
    serviceState: result.state ?? null,
    planId: run.planId,
    serviceRunId: run.serviceRunId,
    operationId: run.operationId,
    error: run.error ? { code: run.error.code, message: run.error.message } : null,
    nodes: (run.nodes ?? []).map(node => ({
      nodeId: node.nodeId,
      type: node.type,
      status: node.status,
      message: node.message,
    })),
    design: {
      complete: design.complete === true,
      liveVerified: design.liveVerified === true,
      captureFailure: design.captureFailure
        ? {
            code: design.captureFailure.code,
            stage: design.captureFailure.stage,
            type: design.captureFailure.type,
          }
        : null,
    },
    workflowCoverage: {
      complete: coverage.complete === true,
      analysisHash: coverage.analysisHash ?? null,
      pendingScopes: (coverage.scopes ?? [])
        .filter(scope => scope.status === 'unresolved')
        .map(scope => ({ id: scope.id, status: scope.status, evidenceIds: scope.evidenceIds })),
    },
    issues: [
      ...(Array.isArray(blueprint.issues) ? blueprint.issues : []),
      ...(Array.isArray(result.issues) ? result.issues : []),
    ].filter(value => typeof value === 'string'),
    codingLeasePresent: typeof object(context.lease).leaseId === 'string',
    outputs: (run.outputs ?? []).map(file => ({
      path: file.path,
      action: file.action,
      contentHash: file.contentHash,
    })),
    candidateHash: result.candidateHash ?? null,
    appliedHash: result.appliedHash ?? null,
    sourceAuthorityVersion: result.sourceAuthorityVersion ?? null,
    validation: {
      liveDesignVerified: validation.liveDesignVerified === true,
      runtimeVerified: validation.runtimeVerified === true,
      target: object(validation.nativeEnvironment).target ?? null,
      checksRecorded: Array.isArray(validation.checks) && validation.checks.length > 0,
      requiredChecksPassed:
        Array.isArray(validation.checks) &&
        validation.checks.filter(check => check.required).every(check => check.status === 'passed'),
    },
    actions: (run.actions ?? []).map(action => ({
      action: action.action,
      enabled: action.enabled,
      reason: action.reason,
    })),
  };
}

export function validateDecisionReceipt(receipt, run, workflow) {
  const context = object(run.context);
  const blueprint = Object.hasOwn(context, 'blueprint') ? object(context.blueprint) : context;
  assert.equal(
    blueprint.planId,
    run.planId,
    'The displayed blueprint must belong to this actual run',
  );
  if (context.runId !== undefined) assert.equal(context.runId, run.serviceRunId);
  assert.equal(blueprint.design?.complete, true);
  assert.equal(blueprint.design?.liveVerified, true);
  const coverage = object(blueprint.workflowCoverage);
  assert.match(coverage.analysisHash ?? '', /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    receipt.analysisHash,
    coverage.analysisHash,
    'A decision receipt from another analysis cannot be applied',
  );
  assert.equal(run.workflowId, workflow.id);
  const pendingIds = new Set(
    (coverage.scopes ?? [])
      .filter(scope => scope.status === 'unresolved')
      .flatMap(scope => scope.evidenceIds ?? []),
  );
  const requirements = new Set(
    workflow.plan.requirements
      .filter(requirement => requirement.required && requirement.workflow?.status === 'confirmed')
      .map(requirement => requirement.id),
  );
  assert.ok(Array.isArray(receipt.decisions) && receipt.decisions.length > 0);
  const used = new Set();
  for (const decision of receipt.decisions) {
    assert.ok(
      pendingIds.has(decision.evidenceId) && !used.has(decision.evidenceId),
      'Only a current unresolved evidence row can be mapped once',
    );
    // PortalWorkflowDecisionSchema accepts bounded evidence identifiers, including design-<hash>.
    // Authority comes from exact membership in this run's pending set and its analysis hash.
    assert.ok(
      typeof decision.evidenceId === 'string' &&
        decision.evidenceId.length >= 1 &&
        decision.evidenceId.length <= 256,
    );
    assert.ok(['implement', 'reuse', 'extend'].includes(decision.decision));
    assert.ok(
      Array.isArray(decision.requirementIds) &&
        decision.requirementIds.length === 1 &&
        requirements.has(decision.requirementIds[0]),
    );
    assert.ok(
      typeof decision.rationale === 'string' &&
        decision.rationale.trim().length >= 20 &&
        decision.rationale.length <= 2048,
    );
    used.add(decision.evidenceId);
  }
  assert.deepEqual(
    [...used].toSorted(),
    [...pendingIds].toSorted(),
    'Review every current unresolved evidence row explicitly',
  );
  return receipt.decisions;
}

export function assertSafeActivity(value, sentinel) {
  assert.ok(
    !JSON.stringify(value).includes(sentinel),
    'A test-only authorization sentinel reached persistent activity data',
  );
  const forbidden =
    /^(?:authorization|cookie|set-cookie|password|secret|credentials?|apiKey|accessToken|refreshToken|clientSecret|headers|rawBody|requestBody|responseBody|args|csrfToken|authSessionId)$/iu;
  const inspect = (item, depth = 0) => {
    assert.ok(depth <= 20, 'Activity data exceeded its bounded structural shape');
    if (Array.isArray(item)) {
      for (const row of item) inspect(row, depth + 1);
    } else if (item && typeof item === 'object')
      for (const [name, child] of Object.entries(item)) {
        assert.ok(!forbidden.test(name), `Raw or credential activity field is forbidden: ${name}`);
        inspect(child, depth + 1);
      }
  };
  inspect(value);
}

function requestSummary(request) {
  if (!['POST', 'PUT'].includes(request.method())) return undefined;
  const raw = request.postData() ?? '';
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { bytes: Buffer.byteLength(raw), sha256: hash(raw), validJson: false };
  }
  return {
    bytes: Buffer.byteLength(raw),
    sha256: hash(raw),
    action: body.action,
    revision: body.revision,
    workspaceId: body.workspaceId,
    plan: body.plan
      ? {
          case: body.plan.case,
          targetPath: body.plan.targetPath,
          source: body.plan.design?.source,
          collector: body.plan.design?.collector,
          design: designIdentity(body.plan.design.url),
          requirements: body.plan.requirements?.length,
        }
      : undefined,
  };
}

async function installedChrome() {
  const paths = [
    process.env.SFP_CHROME_EXECUTABLE,
    join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      /* try the next installed Chrome location */
    }
  }
  throw new Error('Installed Google Chrome is required; no alternate engine is allowed');
}

async function expectAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`A fresh target must not already exist: ${path}`);
}

export async function runUsage(config, number) {
  assert.ok(
    config.browserWsEndpoint || config.isolatedBrowser === true,
    'Actual usage requires the coordinator-owned existing Chrome endpoint; isolated browser creation is explicit fixture-only',
  );
  const round = config.rounds[number - 1];
  assert.ok(round, 'Choose round 1, 2 or 3');
  const workspace = await realpath(config.workspaceFolder);
  const folder = await lstat(config.workspaceFolder);
  assert.ok(
    folder.isDirectory() && !folder.isSymbolicLink(),
    'Use the explicitly owned real directory',
  );
  if (number === 1)
    assert.deepEqual(
      await readdir(workspace),
      [],
      'Round 1 registers a newly owned empty directory',
    );
  const target = resolve(workspace, ...round.targetPath.split('/'));
  assert.ok(
    relative(workspace, target) &&
      !relative(workspace, target).startsWith('..') &&
      !isAbsolute(relative(workspace, target)),
  );
  await expectAbsent(target);
  const attemptId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`;
  const output = join(resolve(config.evidenceRoot), `round-${number}`, attemptId);
  await mkdir(output, { recursive: true });
  await mkdir(join(config.evidenceRoot, 'target-claims'), { recursive: true });
  await writeFile(
    join(
      config.evidenceRoot,
      'target-claims',
      `${hash(comparePath(workspace) + '\0' + round.targetPath.toLowerCase())}.json`,
    ),
    JSON.stringify(
      {
        round: number,
        attemptId,
        targetPath: round.targetPath,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const evidence = {
    version: 1,
    round: number,
    attemptId,
    baseUrl: config.baseUrl,
    targetPath: round.targetPath,
    source: round.source,
    requiredOutcome: config.requiredOutcome,
    beganAt: new Date().toISOString(),
    sourceControl: 'service-owned production portal UI',
    fixturesUsed: false,
    nativeChromeApprovalAutomated: false,
    browserMode: config.browserWsEndpoint
      ? 'existing-owned-context-and-tab'
      : 'explicit-isolated-fixture',
    round3FreshBrowserSuperseded: number === 3 && Boolean(config.browserWsEndpoint),
    checks: [],
    errors: [],
    approvals: [],
    servedAssets: {},
    snapshots: [],
    startedRuns: [],
    run: null,
    functionalChecksPassed: false,
    captureAccepted: false,
    agentHandoffObserved: false,
    fullGenerationAccepted: false,
  };
  const secretSentinel = `SFP_TEST_ONLY_${randomUUID()}`;
  evidence.activitySecretProbeSha256 = config.browserWsEndpoint ? null : hash(secretSentinel);
  evidence.syntheticAuthorizationProbe = config.browserWsEndpoint
    ? 'not-injected-existing-page-headers-preserved'
    : 'injected-owned-isolated-page';
  const saveEvidence = async () => {
    await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
    await writeFile(
      join(config.evidenceRoot, `round-${number}-latest.json`),
      JSON.stringify({ output, ...evidence }, null, 2),
    );
  };
  const failureDetails = error =>
    safeRunnerFailure(error, [secretSentinel, config.browserWsEndpoint]);
  await saveEvidence();
  let browser, page;
  try {
    const require = createRequire(new URL('../../../cli/package.json', import.meta.url));
    const { chromium } = require('playwright');
    if (config.browserWsEndpoint) {
      browser =
        config.browserConnection === 'cdp'
          ? await chromium.connectOverCDP(config.browserWsEndpoint)
          : await chromium.connect(config.browserWsEndpoint);
      page = selectOwnedPortalPage(browser, config.baseUrl);
      await page.bringToFront();
    } else {
      const executablePath = await installedChrome();
      browser = await chromium.launch({
        channel: 'chrome',
        executablePath,
        headless: config.headless,
      });
      page = await browser.newPage({
        viewport: { width: 1512, height: 982 },
        extraHTTPHeaders: { authorization: `Bearer ${secretSentinel}` },
      });
    }
  } catch (error) {
    evidence.errors.push({ type: 'browser-start', ...failureDetails(error) });
    evidence.requiredOutcomePassed = false;
    evidence.endedAt = new Date().toISOString();
    await saveEvidence();
    await browser?.close();
    return evidence;
  }
  const pending = new Set();
  const responses = [];
  const events = new Map();
  let latestRun = null;
  let savedWorkflow = null;
  let receiptNumber = 0;
  let writes = Promise.resolve();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error =>
    evidence.errors.push({ type: 'browser', ...failureDetails(error) }),
  );
  const record = receipt => {
    writes = writes.then(() =>
      appendFile(join(output, 'network.ndjson'), JSON.stringify(receipt) + '\n'),
    );
  };
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== config.baseUrl) return;
    const request = response.request();
    const receipt = {
      sequence: ++receiptNumber,
      at: new Date().toISOString(),
      method: request.method(),
      path: url.pathname + url.search,
      status: response.status(),
    };
    const task = (async () => {
      if (/^\/(?:app|api|model|guide)\.js$|^\/styles\.css$/u.test(url.pathname)) {
        evidence.servedAssets[url.pathname] = hash(await response.body());
        return;
      }
      if (!url.pathname.startsWith('/api/')) return;
      receipt.request = requestSummary(request);
      if (url.pathname === '/api/activities') {
        const data = await response.json();
        assertSafeActivity(data, secretSentinel);
        receipt.activities = Array.isArray(data.activities) ? data.activities.length : undefined;
        receipt.audit = data.audit;
        receipt.retention = data.retention;
      }
      if (/^\/api\/runs\/[^/]+(?:\/events)?$/u.test(url.pathname)) {
        const data = await response.json();
        if (Array.isArray(data.events)) {
          const runId = url.pathname.split('/')[3];
          for (const event of data.events)
            events.set(`${runId}:${event.sequence}`, {
              runId,
              sequence: event.sequence,
              at: event.at,
              type: event.type,
              message: event.message,
              state: object(event.data).state,
              code: object(event.data).code,
              operationId: object(event.data).operationId,
            });
          receipt.events = data.events.length;
        } else if (data.id === evidence.run?.id) {
          if (!latestRun || Date.parse(data.updatedAt) >= Date.parse(latestRun.updatedAt))
            latestRun = data;
          receipt.run = summarizeRun(data);
        }
      }
      responses.push(receipt);
      record(receipt);
    })().catch(error =>
      evidence.errors.push({ type: 'receipt', ...failureDetails(error), path: url.pathname }),
    );
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  const check = async (name, action) => {
    try {
      await action();
    } catch (error) {
      evidence.failedCheck = name;
      evidence.checks.push({
        name,
        passed: false,
        at: new Date().toISOString(),
        ...failureDetails(error),
      });
      throw error;
    }
    evidence.checks.push({ name, passed: true, at: new Date().toISOString() });
    await saveEvidence();
  };
  const screenshot = async name =>
    page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  async function uiResponse(path, method, action, verifyRequest) {
    const observed = page
      .waitForResponse(
        response =>
          new URL(response.url()).origin === config.baseUrl &&
          new URL(response.url()).pathname === path &&
          response.request().method() === method,
        { timeout: 35000 },
      )
      .then(
        response => ({ response }),
        error => ({ error }),
      );
    await action();
    const found = await observed;
    if (found.error) throw found.error;
    const data = await found.response.json();
    assert.ok(
      found.response.ok(),
      `${method} ${path} returned ${found.response.status()}: ${data.error?.code ?? 'HTTP_ERROR'}`,
    );
    if (verifyRequest) verifyRequest(found.response.request().postDataJSON());
    return data;
  }
  async function runAction(action, args = {}) {
    assert.ok(evidence.run?.id);
    const button = page.locator(`[data-run-action="${action}"]`);
    await button.click();
    if (await page.locator('#action-args').count())
      await page.locator('#action-args').fill(JSON.stringify(args, null, 2));
    const data = await uiResponse(`/api/runs/${evidence.run.id}/actions`, 'POST', () =>
      page.locator('#run-action-form button[type="submit"]').click(),
    );
    latestRun = data;
    evidence.run = summarizeRun(data);
    return data;
  }
  async function verifyActivities() {
    const open = () => page.locator('[data-view="activities"]').click();
    const initial = await uiResponse('/api/activities', 'GET', open);
    assertSafeActivity(initial, secretSentinel);
    await page.locator('#activity-panel').waitFor();
    const form = page.locator('#activity-filter-form');
    await form.locator('[name="workflowId"]').selectOption(evidence.workflowId);
    await form.locator('[name="source"]').selectOption('server');
    const filtered = await uiResponse('/api/activities', 'GET', () =>
      form.locator('button[type="submit"]').click(),
    );
    assertSafeActivity(filtered, secretSentinel);
    assert.ok(
      filtered.audit?.available && filtered.audit?.complete,
      'Actual activity persistence must be available and complete',
    );
    assert.ok(
      filtered.activities?.length > 0,
      'The actual server actions must have persistent activity records',
    );
    assert.ok(
      filtered.activities.every(
        row => row.workflowId === evidence.workflowId && row.source === 'server',
      ),
      'Activity filters must match the actual selected workflow/source',
    );
    const retained =
      filtered.activities.find(row => row.status === 'succeeded') ?? filtered.activities[0];
    await page.locator(`[data-activity-id="${retained.id}"]`).waitFor();
    await screenshot('actual-activity-filter');
    await form.locator('[name="action"]').fill(retained.type);
    const typed = await uiResponse('/api/activities', 'GET', () =>
      form.locator('button[type="submit"]').click(),
    );
    assertSafeActivity(typed, secretSentinel);
    assert.ok(typed.activities.length && typed.activities.every(row => row.type === retained.type));
    await page.reload();
    await page.locator('.app-shell').waitFor();
    await uiResponse('/api/activities', 'GET', open);
    await form.locator('[name="workflowId"]').selectOption(evidence.workflowId);
    await form.locator('[name="source"]').selectOption('server');
    await form.locator('[name="action"]').fill(retained.type);
    const reloaded = await uiResponse('/api/activities', 'GET', () =>
      form.locator('button[type="submit"]').click(),
    );
    assertSafeActivity(reloaded, secretSentinel);
    assert.ok(
      reloaded.activities.some(row => row.id === retained.id),
      'The same durable activity ID must survive a real page reload',
    );
    await page.locator(`[data-activity-id="${retained.id}"]`).waitFor();
    await screenshot('actual-activity-after-reload');
    evidence.activity = {
      persistedId: retained.id,
      type: retained.type,
      source: retained.source,
      workflowId: evidence.workflowId,
      filterVerified: true,
      reloadVerified: true,
      syntheticAuthorizationExcluded: config.browserWsEndpoint ? null : true,
      activityStructureVerified: true,
      audit: reloaded.audit,
      retention: reloaded.retention,
    };
  }
  async function observe() {
    const deadline = Date.now() + config.observeTimeoutMs;
    const decided = new Set();
    let last = '',
      contextRequested = false,
      heartbeat = 0,
      decisionsStaged = false,
      decisionDialogOpen = false,
      lastServiceRefresh = 0;
    while (Date.now() < deadline) {
      const run = latestRun;
      if (!run) {
        await sleep(500);
        continue;
      }
      const snapshot = summarizeRun(run);
      evidence.run = snapshot;
      const retained = evidence.startedRuns.findIndex(item => item.id === run.id);
      if (retained >= 0) evidence.startedRuns[retained] = snapshot;
      const signature = JSON.stringify([
        snapshot.status,
        snapshot.operationId,
        snapshot.serviceState,
        snapshot.design,
        snapshot.workflowCoverage.complete,
      ]);
      if (signature !== last) {
        last = signature;
        evidence.snapshots.push({ at: new Date().toISOString(), ...snapshot });
        await screenshot(
          `state-${String(evidence.snapshots.length).padStart(2, '0')}-${snapshot.status}`,
        );
        await saveEvidence();
      }
      if (Date.now() - heartbeat >= 15000) {
        heartbeat = Date.now();
        process.stdout.write(
          JSON.stringify({
            type: 'progress',
            round: number,
            runId: run.id,
            status: run.status,
            sourceComplete: snapshot.design.complete,
            liveVerified: snapshot.design.liveVerified,
          }) + '\n',
        );
      }
      const prompt = (run.approvals ?? []).find(
        item =>
          item.operationId === run.operationId &&
          Number(item.expiresAt) > Date.now() &&
          !decided.has(item.approvalId),
      );
      if (prompt) {
        assert.equal(run.workflowId, evidence.workflowId);
        assert.equal(run.workspaceId, evidence.workspaceId);
        assert.equal(
          prompt.channel,
          'owner-control-session',
          'Only the current server-side service approval is eligible',
        );
        if (!config.approvalOperations.includes(prompt.operationName)) {
          evidence.blocker = {
            code: 'SERVICE_APPROVAL_NOT_AUTHORIZED_IN_RUNNER',
            operationName: prompt.operationName,
          };
          break;
        }
        await page.locator('[data-run-action="approve"]').click();
        const currentPrompts = (run.approvals ?? []).filter(
          item => item.operationId === run.operationId && Number(item.expiresAt) > Date.now(),
        );
        const index = currentPrompts.findIndex(item => item.approvalId === prompt.approvalId);
        if (currentPrompts.length > 1)
          await page.locator('#approval-choice').selectOption(String(index));
        assert.equal(await page.locator('#action-args').count(), 0);
        assert.ok(
          (await page.locator('#approval-summary').innerText()).includes(prompt.target.label),
        );
        await screenshot(`service-approval-${evidence.approvals.length + 1}`);
        decided.add(prompt.approvalId);
        const approved = await uiResponse(
          `/api/runs/${run.id}/actions`,
          'POST',
          () => page.locator('#run-action-form button[type="submit"]').click(),
          body =>
            assert.deepEqual(body, { action: 'approve', args: { approvalId: prompt.approvalId } }),
        );
        const receipt = responses.findLast(
          item => item.method === 'POST' && item.path === `/api/runs/${run.id}/actions`,
        );
        evidence.approvals.push({
          at: new Date().toISOString(),
          operationId: prompt.operationId,
          operationName: prompt.operationName,
          approvalId: prompt.approvalId,
          promptHash: prompt.promptHash,
          target: prompt.target.label,
          effectSummary: prompt.effectSummary,
          requestSequence: receipt?.sequence,
        });
        latestRun = approved;
        continue;
      }
      const busy = (run.actions ?? []).some(action =>
        action.reason.startsWith('Another operation'),
      );
      if (!busy && !['queued', 'active', 'awaiting-approval'].includes(run.status)) {
        if (
          !decisionsStaged &&
          run.status === 'awaiting-input' &&
          snapshot.design.complete &&
          snapshot.design.liveVerified &&
          snapshot.workflowCoverage.pendingScopes.length
        ) {
          evidence.pendingWorkflowDecision = {
            analysisHash: snapshot.workflowCoverage.analysisHash,
            scopes: snapshot.workflowCoverage.pendingScopes,
          };
          if (!decisionDialogOpen) {
            await page.locator('[data-action="review-decisions"]').click();
            await page.locator('#decision-dialog').waitFor({ state: 'visible' });
            await screenshot('fresh-workflow-decision-panel');
            decisionDialogOpen = true;
            evidence.checks.push({
              name: 'Current captured unresolved evidence has an actionable human decision panel',
              passed: true,
              at: new Date().toISOString(),
            });
            await saveEvidence();
          }
          if (!round.decisionFile) {
            evidence.blocker = { code: 'FRESH_WORKFLOW_REVIEW_REQUIRED' };
            break;
          }
          let receiptBytes;
          try {
            receiptBytes = await readFile(round.decisionFile, 'utf8');
          } catch (error) {
            if (error.code === 'ENOENT') {
              await sleep(500);
              continue;
            }
            throw error;
          }
          const receipt = JSON.parse(receiptBytes),
            choices = validateDecisionReceipt(receipt, run, savedWorkflow);
          const form = page.locator('#workflow-decision-form');
          assert.equal(await form.getAttribute('data-analysis-hash'), receipt.analysisHash);
          assert.equal(await form.getAttribute('data-run-id'), run.id);
          for (const choice of choices) {
            let row;
            for (const candidate of await form.locator('[data-decision-evidence]').all()) {
              if ((await candidate.getAttribute('data-decision-evidence')) === choice.evidenceId) {
                assert.equal(row, undefined, 'Only one displayed row may carry the evidence ID');
                row = candidate;
              }
            }
            assert.ok(row, 'The exact current evidence row must be displayed');
            await row.locator('[name="decision"]').selectOption(choice.decision);
            await row.locator('[name="requirementId"]').selectOption(choice.requirementIds[0]);
            await row.locator('[name="rationale"]').fill(choice.rationale);
          }
          await screenshot('reviewed-fresh-workflow-decisions');
          await form.locator('button[type="submit"]').click();
          await page.locator('#decision-dialog').waitFor({ state: 'hidden' });
          const priorId = run.id;
          savedWorkflow = await uiResponse(`/api/workflows/${savedWorkflow.id}`, 'PUT', () =>
            page.locator('[data-action="save"]').click(),
          );
          assert.deepEqual(
            savedWorkflow.plan.workflowDecisions.toSorted((a, b) =>
              a.evidenceId.localeCompare(b.evidenceId),
            ),
            choices
              .map(choice => ({
                ...choice,
                rationale: choice.rationale.trim(),
                analysisHash: receipt.analysisHash,
              }))
              .toSorted((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
          );
          const next = await uiResponse(`/api/workflows/${savedWorkflow.id}/runs`, 'POST', () =>
            page.locator('[data-action="start"]').click(),
          );
          assert.notEqual(
            next.id,
            priorId,
            'Decisions require a new explicit run, never replaying the old operation',
          );
          assert.equal(next.workflowRevision, savedWorkflow.revision);
          assert.equal(savedWorkflow.plan.targetPath, round.targetPath);
          evidence.decisionReview = {
            sourceRunId: priorId,
            analysisHash: receipt.analysisHash,
            receiptSha256: hash(receiptBytes),
            mappedEvidenceIds: choices.map(choice => choice.evidenceId),
            newRunId: next.id,
          };
          evidence.workflowRevision = savedWorkflow.revision;
          evidence.startedRuns.push(summarizeRun(next));
          evidence.run = summarizeRun(next);
          latestRun = next;
          decisionsStaged = true;
          continue;
        }
        if (
          round.requestContext === true &&
          !contextRequested &&
          run.actions?.some(action => action.action === 'next' && action.enabled)
        ) {
          contextRequested = true;
          const advanced = page.getByText('고급: 현재 웹 연결에서 코딩', { exact: true });
          if (await advanced.count()) await advanced.click();
          await runAction('next');
          evidence.contextRequested = true;
          continue;
        }
        if (
          round.waitForExternalAgent === true &&
          !['failed', 'unknown', 'cancelled', 'completed'].includes(run.status)
        ) {
          if (
            Date.now() - lastServiceRefresh >= 10000 &&
            run.actions?.some(action => action.action === 'refresh' && action.enabled)
          ) {
            lastServiceRefresh = Date.now();
            const refreshed = await uiResponse(`/api/runs/${run.id}/actions`, 'POST', () =>
              page.locator('[data-action="refresh-run"]').click(),
            );
            latestRun = refreshed;
            evidence.externalAgentStatusRefreshes =
              (evidence.externalAgentStatusRefreshes ?? 0) + 1;
          }
          await sleep(500);
          continue;
        }
        evidence.settled = true;
        break;
      }
      await sleep(500);
    }
    if (!evidence.settled && !evidence.blocker)
      evidence.blocker = {
        code: 'OBSERVATION_WINDOW_ENDED',
        note: 'The service operation was neither replayed nor automatically cancelled.',
      };
  }
  try {
    const bootstrap = await uiResponse('/api/bootstrap', 'GET', () => page.goto(config.baseUrl));
    await page.locator('.app-shell').waitFor();
    evidence.readiness = bootstrap.service;
    await check('Guide opens by keyboard, traps focus and returns focus on Escape', async () => {
      const button = page.locator('[data-action="usage-guide"]');
      await button.focus();
      await button.press('Enter');
      const dialog = page.locator('#usage-guide-dialog');
      await dialog.waitFor({ state: 'visible' });
      assert.ok((await page.locator('#usage-guide-title').innerText()).trim());
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
      await screenshot('guide');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await button.evaluate(element => document.activeElement === element));
    });
    assert.equal(
      bootstrap.service.available,
      true,
      'Actual control daemon must be available; an offline fixture is not a real usage round',
    );
    let workspaceRow = bootstrap.workspaces.find(
      item => comparePath(item.realPath) === comparePath(workspace),
    );
    await check(
      number === 1
        ? 'Register the explicitly owned existing workspace through UI'
        : 'Select the actual previously registered workspace',
      async () => {
        if (number === 1) {
          assert.equal(workspaceRow, undefined, 'Round 1 must register a fresh owned folder');
          await page.locator('[data-action="register-workspace"]').click();
          await page.locator('#workspace-registration-form [name="folder"]').fill(workspace);
          await screenshot('workspace-registration');
          const registered = await uiResponse('/api/workspaces', 'POST', () =>
            page.locator('#workspace-registration-form button[type="submit"]').click(),
          );
          workspaceRow = registered.workspace;
        }
        assert.ok(workspaceRow && uuid.test(workspaceRow.workspaceId));
        assert.equal(comparePath(workspaceRow.realPath), comparePath(workspace));
        evidence.workspaceId = workspaceRow.workspaceId;
      },
    );
    if (number === 3)
      await check(
        config.browserWsEndpoint
          ? 'The retained Chrome tab reopens a persisted workflow from the preceding round'
          : 'A fresh browser reopens a persisted workflow from the preceding round',
        async () => {
          const previous = JSON.parse(
            await readFile(join(config.evidenceRoot, 'round-2-latest.json'), 'utf8'),
          );
          assert.ok(uuid.test(previous.workflowId));
          assert.ok(
            !['active', 'queued', 'unknown', 'awaiting-approval'].includes(previous.run?.status),
            'Inspect the preceding unsettled run before proceeding',
          );
          await uiResponse(`/api/workflows/${previous.workflowId}`, 'GET', () =>
            page.locator(`[data-open-workflow="${previous.workflowId}"]`).click(),
          );
          await page.locator('[data-node="requirements"]').click();
          assert.equal(
            await page.locator('[data-field="plan.targetPath"]').inputValue(),
            config.rounds[1].targetPath,
          );
        },
      );
    const name = round.name ?? `CDD real usage ${number} ${attemptId.slice(0, 19)}`;
    await check(
      'Guided setup applies reviewed C4 inputs to the actual editable draft',
      async () => {
        await page.locator('[data-action="guided-setup"]').click();
        const form = page.locator('#guided-setup-form');
        await form.locator('[name="name"]').fill(name);
        await form.locator('[name="workspaceId"]').selectOption(workspaceRow.workspaceId);
        await form.locator('[name="figmaUrl"]').fill(config.designUrl);
        await form.locator('[name="nodeId"]').fill('1378:120');
        await form.locator('[name="case"]').selectOption('new-blank');
        await form.locator('[name="targetPath"]').fill(round.targetPath);
        await form.getByText('API·데이터 계약과 식별자', { exact: true }).click();
        const firstRequirement = config.requirements[0];
        await form.locator('[name="requirementId"]').fill(firstRequirement.id);
        await form.locator('[name="description"]').fill(firstRequirement.description);
        for (const field of ['roles', 'states', 'routes', 'apiContracts', 'dataContracts'])
          await form.locator(`[name="${field}"]`).fill(firstRequirement.workflow[field].join('\n'));
        await form
          .locator('[name="decisionEvidence"]')
          .fill(firstRequirement.workflow.decisions[0].evidence);
        await form.locator('[name="confirmed"]').check();
        await screenshot('guided-setup');
        await form.locator('button[type="submit"]').click();
        await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
        for (const requirement of config.requirements.slice(1)) {
          await page.locator('[data-action="edit-setup"]').click();
          const edit = page.locator('#guided-setup-form');
          await edit.locator('[name="requirementChoice"]').selectOption('__new__');
          await edit.getByText('API·데이터 계약과 식별자', { exact: true }).click();
          await edit.locator('[name="requirementId"]').fill(requirement.id);
          await edit.locator('[name="description"]').fill(requirement.description);
          for (const field of ['roles', 'states', 'routes', 'apiContracts', 'dataContracts'])
            await edit.locator(`[name="${field}"]`).fill(requirement.workflow[field].join('\n'));
          await edit
            .locator('[name="decisionEvidence"]')
            .fill(requirement.workflow.decisions[0].evidence);
          await edit.locator('[name="confirmed"]').check();
          await edit.locator('button[type="submit"]').click();
          await page.locator('#setup-dialog').waitFor({ state: 'hidden' });
        }
        await page.locator('[data-node="source"]').click();
        await page.locator('[data-field="source"]').selectOption(round.source);
      },
    );
    await check(
      'A real invalid-draft check shows actionable feedback before execution',
      async () => {
        await page.locator('[data-node="requirements"]').click();
        await page.locator('[data-field="plan.targetPath"]').fill('../rejected-escape');
        await page.locator('[data-field="plan.targetPath"]').press('Tab');
        const validation = await uiResponse('/api/workflows/validate', 'POST', () =>
          page.locator('[data-action="check"]').click(),
        );
        assert.equal(validation.valid, false);
        assert.ok(validation.issues.length);
        await page.locator('#action-dialog').waitFor({ state: 'visible' });
        assert.ok((await page.locator('.issue-list').innerText()).trim());
        await screenshot('invalid-draft-feedback');
        await page.keyboard.press('Escape');
        await page.locator('[data-field="plan.targetPath"]').fill(round.targetPath);
        await page.locator('[data-field="plan.targetPath"]').press('Tab');
      },
    );
    await page.locator('[data-node="source"]').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    const nodeLabel = `CDD source · round ${number}`;
    await page.locator('[data-field="node.label"]').fill(nodeLabel);
    let saved;
    await check(
      'Save, reload and keyboard save persist real configuration and graph data',
      async () => {
        saved = await uiResponse('/api/workflows', 'POST', () => page.keyboard.press(`${key}+s`));
        assert.equal(saved.name, name);
        assert.equal(saved.workspaceId, workspaceRow.workspaceId);
        assert.equal(saved.plan.targetPath, round.targetPath);
        assert.equal(saved.plan.case, 'new-blank');
        assert.deepEqual(
          saved.plan.requirements,
          config.requirements,
          'The guided forms must preserve all reviewed product requirements exactly',
        );
        assert.deepEqual(designIdentity(saved.plan.design.url), designIdentity(config.designUrl));
        assert.equal(saved.plan.design.collector, number === 2 ? 'scripter' : 'page-api');
        assert.equal(saved.graph.nodes.find(node => node.id === 'source').label, nodeLabel);
        evidence.workflowId = saved.id;
        evidence.workflowRevision = saved.revision;
        savedWorkflow = saved;
        await uiResponse(`/api/workflows/${saved.id}`, 'GET', () =>
          page.locator('[data-action="reload"]').click(),
        );
        await page.locator('[data-node="source"]').click();
        assert.equal(await page.locator('[data-field="node.label"]').inputValue(), nodeLabel);
        if (number === 2) {
          await page.locator('[data-field="node.label"]').fill(`${nodeLabel} · edited`);
          saved = await uiResponse(`/api/workflows/${saved.id}`, 'PUT', () =>
            page.keyboard.press(`${key}+s`),
          );
          assert.equal(saved.revision, evidence.workflowRevision + 1);
          evidence.workflowRevision = saved.revision;
          savedWorkflow = saved;
          await uiResponse(`/api/workflows/${saved.id}`, 'GET', () =>
            page.locator('[data-action="reload"]').click(),
          );
        }
        await screenshot('saved-builder');
      },
    );
    await check('The saved executable graph passes actual service API validation', async () => {
      const validation = await uiResponse('/api/workflows/validate', 'POST', () =>
        page.locator('[data-action="check"]').click(),
      );
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
    });
    await check('Starting through UI binds the actual saved workflow revision', async () => {
      const run = await uiResponse(`/api/workflows/${saved.id}/runs`, 'POST', () =>
        page.locator('[data-action="start"]').click(),
      );
      assert.equal(run.workflowId, saved.id);
      assert.equal(run.workflowRevision, saved.revision);
      assert.deepEqual(run.graph, saved.graph);
      latestRun = run;
      evidence.run = summarizeRun(run);
      evidence.startedRuns.push(summarizeRun(run));
      await page.locator('.run-state-strip').waitFor();
    });
    await observe();
    await check(
      'Live graph, event history and output schema show the actual recorded run',
      async () => {
        await page.locator('[data-node="source"]').click();
        await page.locator('[data-tab="test"]').click();
        await page.locator('.timeline').waitFor();
        await sleep(3200);
        assert.ok(
          [...events.values()].some(event => event.runId === evidence.run.id),
          'Actual current-run service events must be observed',
        );
        await page.locator('[data-tab="schema"]').click();
        assert.ok((await page.locator('.inspector-body').innerText()).includes('nodeId'));
        await screenshot('live-schema');
        await page.locator('[data-tab="test"]').click();
        const final = summarizeRun(latestRun);
        evidence.run = final;
        if (!final.design.complete || !final.design.liveVerified)
          assert.notEqual(final.nodes.find(node => node.type === 'source')?.status, 'completed');
        if (final.status === 'awaiting-agent')
          assert.notEqual(
            final.nodes.find(node => node.type === 'generation')?.status,
            'completed',
          );
        if (final.error?.code || final.design.captureFailure?.code) {
          const code = final.error?.code ?? final.design.captureFailure.code;
          assert.ok((await page.locator('.inspector-body').innerText()).includes(code));
          evidence.actionableIncompleteState = true;
        }
        await screenshot('final-live');
      },
    );
    if (evidence.run.status === 'awaiting-agent' && !round.requestContext)
      await check(
        'Agent handoff stays on one coding session and does not acquire a web lease',
        async () => {
          const handoff = page.locator('[data-action="copy-agent-handoff"]');
          assert.ok(
            await handoff.isVisible(),
            'The current service run needs a visible coding-agent handoff',
          );
          assert.ok(
            (await page.locator('.timeline').innerText()).includes(evidence.run.serviceRunId),
            'The visible actual event history must identify the service run handed to the coding agent',
          );
          await handoff.click();
          await page.waitForFunction(() =>
            document
              .querySelector('#notice')
              ?.textContent.includes('에이전트 전달 정보를 복사했습니다'),
          );
          assert.ok(
            !responses.some(
              receipt => receipt.request?.action === 'next' || receipt.request?.action === 'submit',
            ),
            'Normal handoff must not acquire or submit a web-session lease',
          );
          evidence.agentHandoffPresented = true;
          await screenshot('agent-handoff-without-web-lease');
        },
      );
    await check(
      'Actual server activity is visible, safely filtered and persistent after reload',
      verifyActivities,
    );
    const final = evidence.run;
    evidence.captureAccepted =
      final.design.complete &&
      final.design.liveVerified &&
      !final.design.captureFailure &&
      final.nodes.find(node => node.type === 'source')?.status === 'completed';
    evidence.agentHandoffObserved =
      evidence.captureAccepted &&
      (evidence.agentHandoffPresented === true ||
        (round.requestContext === true && final.codingLeasePresent));
    evidence.fullGenerationAccepted =
      evidence.captureAccepted &&
      final.status === 'completed' &&
      final.serviceState === 'completed' &&
      !!final.appliedHash &&
      !!final.candidateHash &&
      final.sourceAuthorityVersion === 2 &&
      final.validation.liveDesignVerified &&
      final.validation.runtimeVerified &&
      final.validation.target === 'applied' &&
      final.validation.checksRecorded &&
      final.validation.requiredChecksPassed;
    evidence.functionalChecksPassed = evidence.errors.length === 0;
    evidence.requiredOutcomePassed =
      evidence.functionalChecksPassed &&
      {
        capture: evidence.captureAccepted,
        'agent-handoff': evidence.agentHandoffObserved,
        generation: evidence.fullGenerationAccepted,
      }[config.requiredOutcome];
    if (final.workflowCoverage.pendingScopes.length)
      evidence.pendingWorkflowDecision = {
        analysisHash: final.workflowCoverage.analysisHash,
        scopes: final.workflowCoverage.pendingScopes,
        note: 'Fresh UI-bound decisions require explicit reviewed input; no old decision JSON was submitted.',
      };
  } catch (error) {
    evidence.errors.push({
      type: 'assertion',
      check: evidence.failedCheck ?? null,
      ...failureDetails(error),
    });
    evidence.requiredOutcomePassed = false;
    await screenshot('failure').catch(() => {});
  } finally {
    await Promise.allSettled(pending);
    await writes;
    await writeFile(
      join(output, 'events.json'),
      JSON.stringify(
        [...events.values()].toSorted(
          (a, b) => String(a.at).localeCompare(String(b.at)) || a.sequence - b.sequence,
        ),
        null,
        2,
      ),
    );
    evidence.endedAt = new Date().toISOString();
    await saveEvidence();
    if (config.browserWsEndpoint && page) {
      await page.bringToFront().catch(() => {});
    }
    // For an attached browser this closes our protocol connection only. The helper owns the
    // existing context/page; this runner never calls either one's close method.
    await browser.close();
  }
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      output,
      round: number,
      runId: evidence.run?.id,
      status: evidence.run?.status,
      functionalChecksPassed: evidence.functionalChecksPassed,
      captureAccepted: evidence.captureAccepted,
      agentHandoffObserved: evidence.agentHandoffObserved,
      fullGenerationAccepted: evidence.fullGenerationAccepted,
      requiredOutcomePassed: evidence.requiredOutcomePassed,
    }) + '\n',
  );
  return evidence;
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  assert.ok(
    args.includes('--config') &&
      args.includes('--round') &&
      args.includes('--execute') !== args.includes('--dry-run'),
    'Usage: node live-usage-check.mjs --config <file> --round <1|2|3> (--dry-run | --execute)',
  );
  const config = validateConfig(JSON.parse(await readFile(resolve(value('--config')), 'utf8')));
  const number = Number(value('--round'));
  assert.ok([1, 2, 3].includes(number));
  if (args.includes('--dry-run')) {
    process.stdout.write(
      JSON.stringify({
        dryRun: true,
        networkRequests: 0,
        mutations: 0,
        round: number,
        targetPath: config.rounds[number - 1].targetPath,
        source: config.rounds[number - 1].source,
        requiredOutcome: config.requiredOutcome,
        requestContext: config.rounds[number - 1].requestContext === true,
        approvalOperations: config.approvalOperations,
      }) + '\n',
    );
    return;
  }
  const result = await runUsage(config, number);
  if (!result.requiredOutcomePassed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  void main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
