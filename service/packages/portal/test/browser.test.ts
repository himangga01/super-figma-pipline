import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { requireChrome } from '../../../test/support/required-suite.js';
import { googleChromeExecutable } from '../../mcp/src/portal/chrome-runtime.js';
import { PortalBridge, type ControlPort } from '../src/bridge.js';
import { defaultWorkflow } from '../src/contract.js';
import { createPortalServer } from '../src/server.js';
import { PortalStore } from '../src/store.js';

const runChild = promisify(execFile);

async function removeOwnedFixture(directory: string): Promise<void> {
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('sfp-portal-browser-')
  )
    throw new Error('Unsafe portal fixture cleanup target');
  await rm(directory, { recursive: true, force: true });
}

async function waitForFixtureIdle(bridge: PortalBridge, runId: string | undefined): Promise<void> {
  if (!runId) return;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!bridge.getRun(runId).actions.some(action => action.reason.startsWith('Another operation')))
      return;
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
  }
  throw new Error('The fixture operation did not settle before cleanup');
}

// Mandatory service-owned Chrome coverage: no prerequisite skip override or alternate engine.
it('persists portal edits and fences pending saves in installed Chrome through actual HTTP', async context => {
  const executablePath = googleChromeExecutable();
  if (!executablePath)
    throw new Error('Google Chrome stable is required for the portal browser suite.');
  requireChrome(context, executablePath);

  const directory = await mkdtemp(join(tmpdir(), 'sfp-portal-browser-'));
  const root = resolve(import.meta.dirname, '..');
  const evidence = join(directory, 'evidence');
  const store = await PortalStore.open(join(directory, 'store'));
  let serviceCalls = 0;
  const unavailable = async (): Promise<never> => {
    serviceCalls++;
    throw Object.assign(new Error('The fixture has no connected control daemon.'), {
      code: 'CONTROL_NOT_READY',
    });
  };
  const control: ControlPort = {
    health: async () => false,
    workspaces: async () => [],
    invoke: unavailable,
    decide: unavailable,
  };
  const server = createPortalServer({
    store,
    bridge: new PortalBridge(store, control),
    webRoot: join(root, 'web'),
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('The portal fixture did not bind a loopback port.');
    const target = `http://127.0.0.1:${address.port}`;
    // Async execFile keeps this process's real fixture HTTP server responsive during Chrome actions.
    const result = await runChild(
      process.execPath,
      [join(root, 'web/tests/chrome-check.mjs'), target, evidence],
      {
        cwd: resolve(root, '../..'),
        env: { ...process.env, SFP_CHROME_EXECUTABLE: executablePath },
        windowsHide: true,
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.stderr).toBe('');
    const recorded = JSON.parse(await readFile(join(evidence, 'result.json'), 'utf8')) as {
      target: string;
      workflowId: string;
      checks: string[];
      errors: unknown[];
      sourceCaptureExecuted: boolean;
      generationExecuted: boolean;
      applicationExecuted: boolean;
    };
    expect(recorded.target).toBe(target);
    expect(recorded.checks).toHaveLength(14);
    expect(recorded.errors).toEqual([]);
    expect([
      recorded.sourceCaptureExecuted,
      recorded.generationExecuted,
      recorded.applicationExecuted,
    ]).toEqual([false, false, false]);
    expect(serviceCalls).toBe(0);
    // Reopen the actual store so a browser-side result cannot manufacture successful persistence.
    const saved = (await PortalStore.open(store.directory)).getWorkflow(recorded.workflowId);
    expect(saved.revision).toBe(3);
    expect(saved.plan.design).toMatchObject({ source: 'chrome', collector: 'page-api' });
    expect(saved.plan.requirements[0]?.description).toBe('JSON keyboard draft');
    expect(saved.graph.nodes.find(node => node.id === 'source')).toMatchObject({
      label: 'Figma 소스 · 키보드 저장',
      position: { x: 100, y: 120 },
    });
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close(error => (error ? reject(error) : resolveClose())),
    );
    // Only remove this test's verified, newly created temporary directory on Windows.
    await removeOwnedFixture(directory);
  }
}, 120000);

it('binds human-readable approval choices to retained prompt IDs through real portal HTTP', async context => {
  const executablePath = googleChromeExecutable();
  if (!executablePath)
    throw new Error('Google Chrome stable is required for the portal browser suite.');
  requireChrome(context, executablePath);
  const directory = await mkdtemp(join(tmpdir(), 'sfp-portal-browser-'));
  const root = resolve(import.meta.dirname, '..');
  const store = await PortalStore.open(join(directory, 'store'));
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const operationId = 'fixture-retained-operation';
  const planId = 'sfp_portal1_11111111111111111111111111111111';
  const decisions: Array<{ approvalId: string; decision: string }> = [];
  let releasePlan: ((value: unknown) => void) | undefined;
  const bridge = new PortalBridge(store, {
    health: async () => true,
    workspaces: async () => [{ workspaceId, realPath: directory, availability: 'available' }],
    invoke: async call => {
      if (call.name === 'portal_start')
        return {
          runId: planId,
          planId,
          state: 'waiting-agent',
          version: 1,
          files: [],
          candidateHash: null,
          appliedHash: null,
          issues: [],
          validation: null,
        };
      if (call.name !== 'portal_plan') throw new Error('Unexpected fixture control operation');
      call.emit({ status: 'accepted-locally', operationId });
      for (const [approvalId, label, expiresAt] of [
        ['expired-approval', 'Expired fixture target', Date.now() - 1000],
        ['first-retained-approval', 'First fixture target', Date.now() + 60000],
        ['second-retained-approval', 'Second fixture target', Date.now() + 60000],
      ] as const)
        call.emit({
          status: 'approval-required',
          prompt: {
            approvalId,
            operationId,
            expiresAt,
            operationName: 'portal_plan',
            target: { label },
            effectSummary: ['filesystem-write:non-destructive:targetPath'],
          },
        });
      return new Promise(resolvePlan => {
        releasePlan = resolvePlan;
      });
    },
    decide: async (approvalId, decision) => {
      decisions.push({ approvalId, decision });
      if (decisions.length === 2) releasePlan?.({ planId });
    },
  });
  const server = createPortalServer({ store, bridge, webRoot: join(root, 'web') });
  let runId: string | undefined;
  try {
    const workflow = await store.createWorkflow({ ...defaultWorkflow(), workspaceId });
    const run = await bridge.start(workflow.id, workflow.revision);
    runId = run.id;
    await expect.poll(() => bridge.getRun(run.id).approvals.length).toBe(3);
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('The approval fixture did not bind a loopback port.');
    const result = await runChild(
      process.execPath,
      [
        join(root, 'web/tests/approval-check.mjs'),
        `http://127.0.0.1:${address.port}`,
        run.id,
        join(directory, 'evidence'),
      ],
      {
        cwd: resolve(root, '../..'),
        env: { ...process.env, SFP_CHROME_EXECUTABLE: executablePath },
        windowsHide: true,
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.stderr).toBe('');
    expect(decisions).toEqual([
      { approvalId: 'second-retained-approval', decision: 'approved' },
      { approvalId: 'first-retained-approval', decision: 'rejected' },
    ]);
    const recorded = JSON.parse(
      await readFile(join(directory, 'evidence/approval-result.json'), 'utf8'),
    );
    expect(recorded).toMatchObject({
      multiplePromptSelection: true,
      singlePromptPreselected: true,
      internalIdEntryRequired: false,
      errors: [],
      sourceCaptureExecuted: false,
      nativeChromeApprovalAutomated: false,
    });
  } finally {
    releasePlan?.({ planId });
    await waitForFixtureIdle(bridge, runId);
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await removeOwnedFixture(directory);
  }
}, 120000);
