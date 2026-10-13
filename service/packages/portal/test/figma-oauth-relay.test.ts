import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { FigmaOAuthStatus } from '../../mcp/src/control/figma-oauth-contract.js';
import { PortalBridge, type ControlPort } from '../src/bridge.js';
import { PortalFigmaSettings } from '../src/figma-settings.js';
import { createPortalServer } from '../src/server.js';
import { PortalStore } from '../src/store.js';

const originalFetch = globalThis.fetch;
const cleanup: Array<() => Promise<unknown>> = [];
const origins = new Set<string>();
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input));
    if (!origins.has(url.origin)) throw Error('GLOBAL_REMOTE_NETWORK_FORBIDDEN');
    return originalFetch(input, init);
  });
});
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
  origins.clear();
  vi.restoreAllMocks();
});
const id = '00000000-0000-4000-8000-000000000001',
  flow = '00000000-0000-4000-8000-000000000002';
const remote = 'https://mcp.figma.com/mcp' as const;
const configuration = {
  endpoint: remote,
  mode: 'own-oauth' as const,
  oauthTokenEnv: null,
  clientIdEnv: 'OWN_CLIENT_ID',
  clientSecretEnv: 'OWN_CLIENT_SECRET',
  contractReference: 'own-installed-contract',
  contractDigest: `sha256:${'1'.repeat(64)}`,
};
const status = (): FigmaOAuthStatus => ({
  schemaVersion: 1,
  providerInstanceId: id,
  configurationGeneration: 0,
  authGeneration: 0,
  configuration,
  stage: 'waiting-for-callback',
  code: null,
  expiresAt: Date.now() + 60000,
  flowId: flow,
  handoffAvailable: true,
  eligibilitySource: 'operator-contract',
  serverAuthorizationObserved: false,
  sessionOnly: true,
});
const tuple = { providerInstanceId: id, configurationGeneration: 0, authGeneration: 0 };
const base = () => ({
  schemaVersion: 1,
  provider: 'daemon-generation-provider',
  providerInstanceId: id,
  configurationRecognized: true,
  oauthTokenEnv: null,
  credentialAvailable: false,
  oauthLoginImplemented: true,
  clientRegistration: 'unverified',
});
const nativePost = (
  origin: string,
  body: URLSearchParams | string,
  headers: Record<string, string>,
) =>
  new Promise<{ status: number; headers: Record<string, unknown>; text(): Promise<string> }>(
    (resolve, reject) => {
      const request = httpRequest(
        origin + '/api/figma-settings/auth/handoff',
        { method: 'POST', headers },
        response => {
          let text = '';
          response.on('data', chunk => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 500,
              headers: response.headers,
              text: async () => text,
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end(String(body));
    },
  );
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sfp-oauth-relay-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = await PortalStore.open(root),
    web = join(root, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<!doctype html><p>Fixture portal</p>');
  await writeFile(
    join(web, 'figma-auth-consent.html'),
    '<!doctype html><script type="module" nonce="__SFP_FIGMA_CONSENT_NONCE__" src="/figma-auth-consent.js"></script>',
  );
  const actions: string[] = [];
  let current = status();
  const control: ControlPort = {
    health: async () => true,
    workspaces: async () => [],
    invoke: async () => {},
    decide: async () => {},
    figmaMcpStatus: async () => base(),
    figmaMcpAuthStatus: async () => current,
    figmaMcpAuthConfigure: async raw => {
      actions.push('configure');
      const input = raw as { configuration: typeof configuration };
      current = {
        ...current,
        configuration: input.configuration,
        configurationGeneration: current.configurationGeneration + 1,
        authGeneration: current.authGeneration + 1,
      };
      return current;
    },
    figmaMcpAuthAction: async action => {
      actions.push(action);
      return { ...current, authGeneration: current.authGeneration + 1 };
    },
    figmaMcpAuthHandoff: async (_input, deliver) => {
      actions.push('handoff');
      deliver(
        new URL(
          'https://www.figma.com/oauth/mcp?state=SYNTHETIC_PRIVATE_STATE&client_id=SYNTHETIC_PRIVATE_CLIENT',
        ),
      );
    },
    serviceJobs: {
      catalog: async () => ({ tools: [], features: [] }),
      prepare: async input => ({
        args: input.args,
        descriptor: {
          name: input.name,
          kind: 'write',
          description: 'fixture',
          group: 'chrome',
          inputSchema: {},
          prerequisites: [],
          confirmationRequired: false,
          executionProof: 'composite',
        },
      }),
      execute: async () => {
        throw Error('CHROME_CONNECTION_REQUIRED');
      },
      decide: async () => {},
      inspect: async () => null,
    },
  };
  const bridge = new PortalBridge(store, control),
    server = createPortalServer({ store, bridge, webRoot: web });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const origin = `http://127.0.0.1:${address.port}`;
  origins.add(origin);
  const boot = (await (await fetch(origin + '/api/bootstrap')).json()) as { csrfToken: string };
  const form = () =>
    new URLSearchParams({
      csrf: boot.csrfToken,
      providerInstanceId: id,
      configurationGeneration: '0',
      authGeneration: '0',
      flowId: flow,
    });
  const headers = {
    origin,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'content-type': 'application/x-www-form-urlencoded',
  };
  const post = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { origin, 'x-sfp-csrf': boot.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    root,
    store,
    bridge,
    control,
    actions,
    origin,
    boot,
    form,
    headers,
    post,
    setStatus: (value: FigmaOAuthStatus) => {
      current = value;
    },
  };
}
it('serves a query-free static consent document without creating authentication and scopes its nonce/CSP', async () => {
  const f = await fixture();
  const response = await fetch(f.origin + '/figma-auth-consent');
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('__SFP_FIGMA_CONSENT_NONCE__');
  expect(response.headers.get('content-security-policy')).toContain(
    'https://www.figma.com/oauth/mcp',
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('same-origin');
  expect((await fetch(f.origin + '/')).headers.get('referrer-policy')).toBe('no-referrer');
  expect(f.actions).toEqual([]);
  expect((await fetch(f.origin + '/figma-auth-consent.html')).status).toBe(404);
  expect((await fetch(f.origin + '/figma-auth-consent?code=SYNTHETIC_PRIVATE')).status).toBe(404);
  expect((await fetch(f.origin + '/')).headers.get('content-security-policy')).toContain(
    "form-action 'self'",
  );
  const safe = await (await fetch(f.origin + '/api/figma-settings/auth')).json();
  expect(safe).toMatchObject({
    providerInstanceId: id,
    eligibilitySource: 'operator-contract',
    serverAuthorizationObserved: false,
  });
  expect(f.actions).toEqual([]);
});
it('uses exact native form authority to relay only a 303 header and keeps private locations out of JSON/activity/logs', async () => {
  const f = await fixture();
  const response = await nativePost(f.origin, f.form(), f.headers);
  expect(response.status).toBe(303);
  expect(response.headers.location).toContain('https://www.figma.com/oauth/mcp?');
  expect(await response.text()).toBe('');
  expect(f.actions).toEqual(['handoff']);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(await readFile(join(f.root, 'portal.json'), 'utf8')).not.toContain('SYNTHETIC_PRIVATE');
  expect(await readFile(join(f.root, 'diagnostics/portal.jsonl'), 'utf8')).not.toContain(
    'SYNTHETIC_PRIVATE',
  );
});
it.each(['csrf', 'duplicate', 'unknown', 'origin', 'fetch-site', 'json', 'malformed', 'oversized'])(
  'rejects invalid native authority %s before consuming a handoff',
  async mode => {
    const f = await fixture(),
      form = f.form(),
      headers = { ...f.headers };
    let body: string | URLSearchParams = form;
    if (mode === 'csrf') form.set('csrf', 'A'.repeat(43));
    if (mode === 'duplicate') form.append('flowId', flow);
    if (mode === 'unknown') form.set('state', 'SYNTHETIC_PRIVATE_CANARY');
    if (mode === 'origin') headers.origin = 'http://unowned.invalid';
    if (mode === 'fetch-site') headers['sec-fetch-site'] = 'cross-site';
    if (mode === 'json') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(tuple);
    }
    if (mode === 'malformed') body = form.toString().replace('csrf=', 'csrf=%ZZ');
    if (mode === 'oversized') body = form.toString() + 'x'.repeat(4097);
    const response = await nativePost(f.origin, body, headers);
    const expected = {
      csrf: 403,
      duplicate: 400,
      unknown: 400,
      origin: 403,
      'fetch-site': 403,
      json: 415,
      malformed: 400,
      oversized: 413,
    };
    expect(response.status).toBe(expected[mode as keyof typeof expected]);
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_CANARY');
    expect(f.actions).toEqual([]);
  },
);
it('retains header CSRF on every other mutator and keeps GET auth/handoff nonmutating', async () => {
  const f = await fixture();
  const attempt = await fetch(f.origin + '/api/figma-settings/auth/start', {
    method: 'POST',
    headers: f.headers,
    body: f.form(),
  });
  expect(attempt.status).toBe(403);
  expect((await fetch(f.origin + '/api/figma-settings/auth/handoff')).status).toBe(404);
  expect(f.actions).toEqual([]);
  expect(
    (await f.post('/api/figma-settings/auth/start', { ...tuple, deadlineAt: Date.now() + 60000 }))
      .status,
  ).toBe(200);
  expect(f.actions).toEqual(['start']);
});
it('honors global unknown fences while allowing exact auth cleanup and preserving the old unknown row', async () => {
  const f = await fixture(),
    jobs = await f.bridge.jobs();
  const job = await jobs.create({
    type: 'feature',
    name: 'chrome.export',
    args: {},
    workspaceId: id,
    targetSelector: { kind: 'none' },
  });
  await jobs.idle();
  const before = await readFile(join(f.root, 'service-jobs.json'), 'utf8');
  expect(
    (await f.post('/api/figma-settings/auth/start', { ...tuple, deadlineAt: Date.now() + 60000 }))
      .status,
  ).toBe(409);
  const handoff = await nativePost(f.origin, f.form(), f.headers);
  expect(handoff.status).toBe(409);
  expect(f.actions).toEqual([]);
  expect((await f.post('/api/figma-settings/auth/cancel', { ...tuple, flowId: flow })).status).toBe(
    200,
  );
  expect(jobs.get(job.id).status).toBe('unknown');
  expect(jobs.hasUnknownMutation(null)).toBe(true);
  expect(await readFile(join(f.root, 'service-jobs.json'), 'utf8')).toBe(before);
});
it('persists only modern public configuration after local and daemon CAS, without starting login', async () => {
  const f = await fixture();
  const save = () =>
    fetch(f.origin + '/api/figma-settings', {
      method: 'PUT',
      headers: {
        origin: f.origin,
        'x-sfp-csrf': f.boot.csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ revision: 0, ...tuple, configuration }),
    });
  expect((await save()).status).toBe(200);
  expect(f.actions).toEqual(['configure']);
  expect((await save()).status).toBe(409);
  expect(f.actions).toEqual(['configure']);
  const text = await readFile(join(f.root, 'figma-settings.json'), 'utf8');
  expect(text).toContain('OWN_CLIENT_SECRET');
  expect(text).not.toContain('SYNTHETIC_PRIVATE');
});
it('invalidates old probe readiness and refuses late read publication after same-provider generation changes', async () => {
  const f = await fixture();
  let current = status();
  current.configuration = { ...configuration, mode: 'external-token', oauthTokenEnv: 'OWN_TOKEN' };
  f.control.figmaMcpAuthStatus = async () => current;
  f.control.figmaMcpStatus = async () => ({
    ...base(),
    oauthTokenEnv: 'OWN_TOKEN',
    credentialAvailable: true,
  });
  const probe = () => ({
    schemaVersion: 1,
    endpoint: remote,
    checkedAt: new Date().toISOString(),
    status: 'connected',
    code: null,
    authentication: { ...base(), oauthTokenEnv: 'OWN_TOKEN', credentialAvailable: true },
    tools: ['get_metadata'],
    programCaptureSupported: true,
    fullCapture: false,
  });
  f.control.figmaMcpProbe = async () => probe();
  const settings = await PortalFigmaSettings.open(f.root, f.control);
  await settings.save({ revision: 0, endpoint: remote, oauthTokenEnv: 'OWN_TOKEN' });
  expect((await settings.probe({ revision: 1 })).readyForCaptureAttempt).toBe(true);
  current = { ...current, authGeneration: 1 };
  expect((await settings.get()).readyForCaptureAttempt).toBe(false);
  let release!: () => void;
  f.control.figmaMcpRead = async () => {
    await new Promise<void>(resolve => {
      release = resolve;
    });
    return {
      source: 'official-figma-mcp',
      endpoint: remote,
      requestedTarget: { fileKey: 'abcdefghij1234567890', nodeId: '0:1' },
      tool: 'get_metadata',
      identityBinding: 'request-only',
      result: 'PRIVATE_READ_CANARY',
      fullCapture: false,
      authentication: probe().authentication,
      checkedAt: new Date().toISOString(),
    };
  };
  const pending = settings.read({
    revision: 1,
    target: { fileKey: 'abcdefghij1234567890', nodeId: '0:1' },
    tool: 'get_metadata',
  });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  current = { ...current, authGeneration: 2 };
  release();
  await expect(pending).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_SUPERSEDED' });
  expect(await readFile(join(f.root, 'figma-settings.json'), 'utf8')).not.toContain(
    'PRIVATE_READ_CANARY',
  );
});
it('rechecks an unknown fence established while authorization status was held before start dispatch', async () => {
  const f = await fixture();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  f.control.figmaMcpAuthStatus = async () => {
    enter();
    await held;
    return status();
  };
  const starting = f.post('/api/figma-settings/auth/start', {
    ...tuple,
    deadlineAt: Date.now() + 60000,
  });
  await entered;
  const jobs = await f.bridge.jobs();
  await jobs.create({
    type: 'feature',
    name: 'chrome.export',
    args: {},
    workspaceId: id,
    targetSelector: { kind: 'none' },
  });
  await jobs.idle();
  release();
  const response = await starting;
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('SERVICE_JOB_OUTCOME_UNKNOWN');
  expect(f.actions).toEqual([]);
});
