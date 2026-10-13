import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { PortalBridge } from '../src/bridge.js';
import { defaultWorkflow } from '../src/contract.js';
import { PortalFigmaSettings, type FigmaSettingsControl } from '../src/figma-settings.js';
import { PortalStore } from '../src/store.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const remote = 'https://mcp.figma.com/mcp';
const desktop = 'http://127.0.0.1:3845/mcp';
const auth = () => ({
  schemaVersion: 1,
  provider: 'daemon-generation-provider',
  providerInstanceId: '00000000-0000-4000-8000-000000000001',
  configurationRecognized: true,
  oauthTokenEnv: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
  credentialAvailable: true,
  oauthLoginImplemented: false,
  clientRegistration: 'unverified',
});
const probe = (endpoint = remote) => ({
  schemaVersion: 1,
  endpoint,
  checkedAt: new Date().toISOString(),
  status: 'connected',
  code: null,
  authentication: auth(),
  tools: ['get_metadata'],
  programCaptureSupported: true,
  fullCapture: false,
});
async function setup(control: FigmaSettingsControl = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sfp-figma-settings-'));
  roots.push(directory);
  return { directory, settings: await PortalFigmaSettings.open(directory, control) };
}

const readTarget = { fileKey: 'abcdefghij1234567890', nodeId: '1378:120' };
it('accepts a valid operator-selected environment name and distinguishes saved preference from actual daemon configuration', async () => {
  const { settings } = await setup({ figmaMcpStatus: async () => auth() });
  const result = await settings.save({
    revision: 0,
    endpoint: remote,
    oauthTokenEnv: 'MY_FIGMA_TOKEN',
  });
  expect(result.configuration.oauthTokenEnv).toBe('MY_FIGMA_TOKEN');
  expect(result.authentication).toMatchObject({ desiredApplied: false, restartRequired: true });
  expect(result.daemon?.oauthTokenEnv).toBe('SFP_FIGMA_MCP_OAUTH_TOKEN');
});
const readFixture = (endpoint = remote) => ({
  source: 'official-figma-mcp',
  endpoint,
  requestedTarget: readTarget,
  tool: 'get_metadata',
  identityBinding: 'request-only',
  result: { content: [{ type: 'text', text: 'private-file-result-never-persist' }] },
  fullCapture: false,
  authentication: auth(),
  checkedAt: new Date().toISOString(),
});

it('selects the saved endpoint for a read and never persists file results', async () => {
  const read = vi.fn<NonNullable<FigmaSettingsControl['figmaMcpRead']>>(async input => {
    expect(input).toEqual({ endpoint: desktop, target: readTarget, tool: 'get_metadata' });
    return { ...readFixture(desktop), identityBinding: 'desktop-active-file-unverified' };
  });
  const { directory, settings } = await setup({ figmaMcpRead: read });
  await settings.save({ revision: 0, endpoint: desktop, oauthTokenEnv: null });
  const result = await settings.read({ revision: 1, target: readTarget, tool: 'get_metadata' });
  expect(result).toMatchObject({
    endpoint: desktop,
    identityBinding: 'desktop-active-file-unverified',
    fullCapture: false,
  });
  expect(await readFile(join(directory, 'figma-settings.json'), 'utf8')).not.toContain(
    'private-file-result-never-persist',
  );
  await expect(
    settings.read({ revision: 0, target: readTarget, tool: 'get_metadata' }),
  ).rejects.toMatchObject({ code: 'FIGMA_SETTINGS_CONFLICT' });
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  { tool: 'use_figma' },
  { endpoint: remote },
  { oauthToken: 'secret' },
  { target: { ...readTarget, nodeId: 'arbitrary' } },
])('rejects arbitrary read instructions before control dispatch (case %#)', async extra => {
  const read = vi.fn<NonNullable<FigmaSettingsControl['figmaMcpRead']>>();
  const { settings } = await setup({ figmaMcpRead: read });
  await expect(
    settings.read({ revision: 0, target: readTarget, tool: 'get_metadata', ...extra }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(read).not.toHaveBeenCalled();
});

it('refuses stale read publication, shared concurrency, wrong-target output and unavailable daemon', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const { settings } = await setup({
    figmaMcpRead: async () => {
      await held;
      return readFixture();
    },
    figmaMcpProbe: async () => probe(),
  });
  const pending = settings.read({ revision: 0, target: readTarget, tool: 'get_metadata' });
  await expect(settings.probe({ revision: 0 })).rejects.toMatchObject({
    code: 'FIGMA_MCP_PROBE_BUSY',
  });
  await settings.save({ revision: 0, endpoint: desktop, oauthTokenEnv: null });
  release();
  await expect(pending).rejects.toMatchObject({ code: 'FIGMA_SETTINGS_CONFLICT' });
  const wrong = await setup({
    figmaMcpRead: async () => ({
      ...readFixture(),
      requestedTarget: { ...readTarget, nodeId: '1:2' },
    }),
  });
  await expect(
    wrong.settings.read({ revision: 0, target: readTarget, tool: 'get_metadata' }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_READ_MISMATCH' });
  const missing = await setup();
  await expect(
    missing.settings.read({ revision: 0, target: readTarget, tool: 'get_metadata' }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_DAEMON_UNSUPPORTED' });
});

it('persists only public preferences, rejects stale saves and never probes as a save side effect', async () => {
  const network = vi.fn<NonNullable<FigmaSettingsControl['figmaMcpProbe']>>();
  const { directory, settings } = await setup({
    figmaMcpStatus: async () => auth(),
    figmaMcpProbe: network,
  });
  await settings.save({
    revision: 0,
    endpoint: remote,
    oauthTokenEnv: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
  });
  expect(
    (await PortalFigmaSettings.open(directory, {})).bindWorkflow({
      plan: { design: { source: 'official-mcp' } },
    }),
  ).toMatchObject({ plan: { design: { officialEndpoint: remote } } });
  await expect(
    settings.save({ revision: 0, endpoint: desktop, oauthTokenEnv: null }),
  ).rejects.toMatchObject({ code: 'FIGMA_SETTINGS_CONFLICT' });
  expect(network).not.toHaveBeenCalled();
  expect(await readFile(join(directory, 'figma-settings.json'), 'utf8')).not.toContain('Bearer');
});

it.each([
  { endpoint: 'https://attacker.test/mcp', oauthTokenEnv: null },
  { endpoint: remote, oauthTokenEnv: 'Bearer synthetic-private-token' },
  { endpoint: remote, oauthTokenEnv: 'invalid-env-name' },
  { endpoint: desktop, oauthTokenEnv: 'SFP_FIGMA_MCP_OAUTH_TOKEN' },
  { endpoint: remote, oauthTokenEnv: null, oauthToken: 'synthetic-private-token' },
])(
  'rejects unsupported endpoints or credential values without persisting them (case %#)',
  async input => {
    const { directory, settings } = await setup();
    await expect(settings.save({ revision: 0, ...input })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(readFile(join(directory, 'figma-settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);

it('binds the saved preferred endpoint into actual portal_plan arguments, preserving explicit choices and Chrome', async () => {
  const { directory, settings } = await setup();
  await settings.save({ revision: 0, endpoint: desktop, oauthTokenEnv: null });
  const draft = defaultWorkflow();
  draft.workspaceId = '00000000-0000-4000-8000-000000000002';
  draft.plan.design = {
    url: draft.plan.design.url,
    source: 'official-mcp',
    freshness: 'require-live',
  };
  const store = await PortalStore.open(join(directory, 'portal'));
  const workflow = await store.createWorkflow(settings.bindWorkflow(draft));
  const calls: unknown[] = [],
    planId = `sfp_portal1_${'1'.repeat(32)}`;
  const bridge = new PortalBridge(store, {
    health: async () => true,
    workspaces: async () => [{ workspaceId: draft.workspaceId!, realPath: directory }],
    decide: async () => {},
    invoke: async call => {
      calls.push(call);
      return call.name === 'portal_plan'
        ? { planId }
        : { planId, runId: planId, state: 'needs-input', files: [], issues: [] };
    },
  });
  const run = await bridge.start(workflow.id, workflow.revision);
  await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-input');
  await expect
    .poll(() =>
      bridge.getRun(run.id).actions.some(action => action.reason.startsWith('Another operation')),
    )
    .toBe(false);
  expect(calls[0]).toMatchObject({
    name: 'portal_plan',
    args: { design: { source: 'official-mcp', officialEndpoint: desktop } },
  });
  expect(
    settings.bindWorkflow({
      plan: { design: { source: 'official-mcp', officialEndpoint: remote } },
    }),
  ).toMatchObject({ plan: { design: { officialEndpoint: remote } } });
  const chrome = defaultWorkflow();
  expect(settings.bindWorkflow(chrome)).toEqual(chrome);
});

it('distinguishes pending restart, daemon-backed probe and a later provider restart', async () => {
  let current = { ...auth(), oauthTokenEnv: 'OTHER_FIGMA_OAUTH_TOKEN' };
  const { settings } = await setup({
    figmaMcpStatus: async () => current,
    figmaMcpProbe: async () => probe(),
  });
  await settings.save({
    revision: 0,
    endpoint: remote,
    oauthTokenEnv: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
  });
  expect(await settings.get()).toMatchObject({
    authentication: { restartRequired: true, desiredApplied: false },
    readyForCaptureAttempt: false,
  });
  current = auth();
  expect(await settings.probe({ revision: 1 })).toMatchObject({
    readyForCaptureAttempt: true,
    fullCaptureAccepted: false,
  });
  current = { ...current, providerInstanceId: '00000000-0000-4000-8000-000000000003' };
  expect(await settings.get()).toMatchObject({
    readyForCaptureAttempt: false,
    fullCaptureAccepted: false,
  });
});

it('does not promote sparse tools or a missing daemon into capture readiness', async () => {
  const { settings } = await setup({
    figmaMcpStatus: async () => {
      throw Error('private control detail');
    },
    figmaMcpProbe: async () => ({ ...probe(), programCaptureSupported: false }),
  });
  await settings.save({
    revision: 0,
    endpoint: remote,
    oauthTokenEnv: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
  });
  const view = await settings.probe({ revision: 1 });
  expect(view).toMatchObject({
    daemon: null,
    readyForCaptureAttempt: false,
    fullCaptureAccepted: false,
  });
  expect(JSON.stringify(view)).not.toContain('private control detail');
});

it('never publishes a probe into a changed configuration or leaks unexpected response fields', async () => {
  let release!: (value: unknown) => void;
  const { settings } = await setup({
    figmaMcpProbe: async () =>
      new Promise(resolve => {
        release = resolve;
      }),
  });
  const pending = settings.probe({ revision: 0 });
  await settings.save({ revision: 0, endpoint: desktop, oauthTokenEnv: null });
  release(probe());
  await expect(pending).rejects.toMatchObject({ code: 'FIGMA_SETTINGS_CONFLICT' });
  expect((await settings.get()).lastProbe).toBeNull();
  const other = await setup({
    figmaMcpProbe: async () => ({ ...probe(), secret: 'synthetic-private-value' }),
  });
  await expect(other.settings.probe({ revision: 0 })).rejects.toMatchObject({
    code: 'FIGMA_MCP_PROBE_UNAVAILABLE',
  });
  expect((await other.settings.get()).lastProbe).toBeNull();
});
