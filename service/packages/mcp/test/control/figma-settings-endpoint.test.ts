import type { ActorContext } from '@sfp/shared';
import { expect, it, vi } from 'vitest';

import { createFigmaMcpSettingsEndpoint } from '../../src/control/figma-settings-endpoint.js';
import { registerFigmaMcpSettingsRoutes } from '../../src/control/route-registry.js';
import { AuthenticatedControlRouter } from '../../src/control/router.js';
import {
  OFFICIAL_FIGMA_REMOTE,
  OFFICIAL_FIGMA_DESKTOP,
  type probeOfficialFigmaMcp,
  type readOfficialFigmaMcp,
} from '../../src/official-figma-mcp.js';

const principal = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control' as const,
} satisfies ActorContext;
const successful = () => ({
  source: 'official-figma-mcp' as const,
  endpoint: OFFICIAL_FIGMA_REMOTE,
  connected: true,
  server: undefined,
  tools: [{ name: 'get_metadata', inputSchema: { type: 'object' as const } }],
  captureCapability: { supported: true, method: 'fixed-plugin-api-program', liveVerified: false },
  fullCapture: false,
});
const target = { fileKey: 'abcdefghij1234567890', nodeId: '1378:120' };
const readInput = { endpoint: OFFICIAL_FIGMA_REMOTE, target, tool: 'get_metadata' as const };
const successfulRead = (input = readInput) => ({
  source: 'official-figma-mcp' as const,
  endpoint: input.endpoint,
  requestedTarget: input.target,
  tool: input.tool,
  identityBinding: 'request-only' as const,
  result: { content: [{ type: 'text' as const, text: 'Actual fixture metadata' }] },
  fullCapture: false,
});

it('reads only a bound official target through the same effective generation provider without persistence or full-capture claims', async () => {
  const read = vi.fn<typeof readOfficialFigmaMcp>(async (input, options) => {
    expect(input).toEqual(readInput);
    expect(await options?.oauthToken?.()).toBe('synthetic-private-oauth');
    expect(options?.deadlineAt).toBeLessThanOrEqual(Date.now() + 20000);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return successfulRead();
  });
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {
      SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'FIGMA_OAUTH_TOKEN',
      FIGMA_OAUTH_TOKEN: 'synthetic-private-oauth',
    },
    read,
  });
  const result = await endpoint.read(readInput, new AbortController().signal);
  expect(read.mock.calls[0]?.[1]?.oauthToken).toBe(endpoint.connection.oauthToken);
  expect(result).toMatchObject({
    requestedTarget: target,
    identityBinding: 'request-only',
    fullCapture: false,
  });
  expect(JSON.stringify(result)).not.toContain('synthetic-private-oauth');
});

it.each([
  { ...readInput, tool: 'use_figma' },
  { ...readInput, endpoint: 'https://attacker.test/mcp' },
  { ...readInput, target: { ...target, nodeId: 'root' } },
  { ...readInput, target: { ...target, fileKey: 'x' } },
  { ...readInput, oauthToken: 'synthetic-secret' },
  { ...readInput, args: { code: 'arbitrary code' } },
])('rejects an unsupported read request before any network adapter call (case %#)', async input => {
  const read = vi.fn<typeof readOfficialFigmaMcp>();
  const endpoint = createFigmaMcpSettingsEndpoint({ environment: {}, read });
  await expect(endpoint.read(input, new AbortController().signal)).rejects.toMatchObject({
    name: 'ZodError',
  });
  expect(read).not.toHaveBeenCalled();
});

it('preserves Desktop identity limits and never passes remote credentials to a Desktop read', async () => {
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {
      SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'FIGMA_OAUTH_TOKEN',
      FIGMA_OAUTH_TOKEN: 'private-oauth',
    },
    read: async (_input, options) => {
      expect(options?.oauthToken).toBeUndefined();
      return {
        ...successfulRead(),
        endpoint: OFFICIAL_FIGMA_DESKTOP,
        identityBinding: 'desktop-active-file-unverified',
      };
    },
  });
  expect(
    await endpoint.read(
      { ...readInput, endpoint: OFFICIAL_FIGMA_DESKTOP },
      new AbortController().signal,
    ),
  ).toMatchObject({ identityBinding: 'desktop-active-file-unverified', fullCapture: false });
});

it.each(['secret', 'oversize', 'mismatch', 'sdk-error'])(
  'refuses unsafe or unbound official read output: %s',
  async scenario => {
    const endpoint = createFigmaMcpSettingsEndpoint({
      environment: {
        SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'FIGMA_OAUTH_TOKEN',
        FIGMA_OAUTH_TOKEN: 'private-oauth-value',
      },
      read: async () => {
        if (scenario === 'sdk-error') throw new Error('private-oauth-value in SDK body');
        return {
          ...successfulRead(),
          ...(scenario === 'mismatch' ? { requestedTarget: { ...target, nodeId: '1:2' } } : {}),
          result: {
            content: [
              {
                type: 'text' as const,
                text:
                  scenario === 'secret'
                    ? 'private-oauth-value'
                    : scenario === 'oversize'
                      ? 'x'.repeat(2 * 1024 * 1024)
                      : 'metadata',
              },
            ],
          },
        };
      },
    });
    const failure = await endpoint
      .read(readInput, new AbortController().signal)
      .catch(error => error);
    expect(failure.code).toMatch(/^FIGMA_MCP_READ_/u);
    expect(failure.message).not.toContain('private-oauth-value');
  },
);

it('cancels reads and shares single-flight capacity with probes, then releases capacity', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {},
    read: async (_input, options) => {
      await held;
      options?.signal?.throwIfAborted();
      return successfulRead();
    },
    probe: async () => successful(),
  });
  const controller = new AbortController();
  const pending = endpoint.read(readInput, controller.signal);
  await expect(
    endpoint.probe({ endpoint: OFFICIAL_FIGMA_REMOTE }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_PROBE_BUSY' });
  controller.abort();
  release();
  await expect(pending).rejects.toMatchObject({ code: 'FIGMA_MCP_READ_CANCELLED' });
  expect(
    await endpoint.probe({ endpoint: OFFICIAL_FIGMA_REMOTE }, new AbortController().signal),
  ).toMatchObject({ status: 'connected' });
});

it('authenticates the closed read route and rejects browser credential fields', async () => {
  const read = vi.fn<typeof readOfficialFigmaMcp>(async () => successfulRead());
  const router = new AuthenticatedControlRouter();
  registerFigmaMcpSettingsRoutes(router, createFigmaMcpSettingsEndpoint({ environment: {}, read }));
  router.freeze();
  const request = { method: 'POST', path: '/control/figma-mcp/read', input: readInput };
  const signal = new AbortController().signal;
  await expect(
    router.dispatch(request, { ...principal, entryPath: 'mcp-direct' }, signal),
  ).rejects.toThrow('control router requires a control principal');
  await expect(
    router.dispatch({ ...request, input: { ...readInput, token: 'private' } }, principal, signal),
  ).rejects.toMatchObject({ code: 'CONTROL_ROUTE_INPUT_INVALID' });
  expect(read).not.toHaveBeenCalled();
  expect(await router.dispatch(request, principal, signal)).toMatchObject({
    fullCapture: false,
    tool: 'get_metadata',
  });
});

it('shares the daemon generation credential provider with an explicit probe but never publishes a credential', async () => {
  const environment = {
    SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
    SFP_FIGMA_MCP_OAUTH_TOKEN: 'synthetic-private-token',
  };
  let seen: unknown;
  const probe = vi.fn<typeof probeOfficialFigmaMcp>(async (_endpoint, options) => {
    seen = options?.oauthToken;
    expect(await options?.oauthToken?.()).toBe('synthetic-private-token');
    return successful();
  });
  const endpoint = createFigmaMcpSettingsEndpoint({ environment, probe });
  expect(probe).not.toHaveBeenCalled();
  expect(endpoint.status().credentialAvailable).toBe(true);
  const result = await endpoint.probe(
    { endpoint: OFFICIAL_FIGMA_REMOTE },
    new AbortController().signal,
  );
  expect(seen).toBe(endpoint.connection.oauthToken);
  expect(result).toMatchObject({
    status: 'connected',
    programCaptureSupported: true,
    fullCapture: false,
    authentication: {
      provider: 'daemon-generation-provider',
      oauthLoginImplemented: false,
      clientRegistration: 'unverified',
    },
  });
  expect(JSON.stringify(result)).not.toContain('synthetic-private-token');
});

it('retains the startup variable selection instead of claiming a later selector edit changed generation', async () => {
  const environment: Record<string, string> = {
    SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'FIGMA_OAUTH_FIRST',
    FIGMA_OAUTH_FIRST: 'one',
    FIGMA_OAUTH_SECOND: 'two',
  };
  const endpoint = createFigmaMcpSettingsEndpoint({ environment });
  environment.SFP_FIGMA_MCP_OAUTH_TOKEN_ENV = 'FIGMA_OAUTH_SECOND';
  expect(endpoint.status().oauthTokenEnv).toBe('FIGMA_OAUTH_FIRST');
  expect(await endpoint.connection.oauthToken?.()).toBe('one');
});

it('does not pass the remote credential callback to the Desktop probe', async () => {
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {
      SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'FIGMA_OAUTH_TOKEN',
      FIGMA_OAUTH_TOKEN: 'synthetic-private-value',
    },
    probe: async (_url, options) => {
      expect(options?.oauthToken).toBeUndefined();
      return successful();
    },
  });
  expect(
    await endpoint.probe({ endpoint: OFFICIAL_FIGMA_DESKTOP }, new AbortController().signal),
  ).toMatchObject({ endpoint: OFFICIAL_FIGMA_DESKTOP, fullCapture: false });
});

it('keeps malformed optional auth from blocking startup and does not expose invalid reference text', async () => {
  for (const name of ['Bearer synthetic value', 'invalid-env-name']) {
    const endpoint = createFigmaMcpSettingsEndpoint({
      environment: {
        SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: name,
        [name]: 'synthetic-unrelated-credential',
      },
    });
    expect(endpoint.status()).toMatchObject({
      configurationRecognized: false,
      oauthTokenEnv: null,
      credentialAvailable: false,
    });
    expect(JSON.stringify(endpoint.status())).not.toContain(name);
    await expect(endpoint.connection.oauthToken?.()).rejects.toMatchObject({
      code: 'FIGMA_MCP_OAUTH_ENV_REQUIRED',
    });
  }
});

it('preserves the existing operator-selected OAuth environment identifier without a prefix convention', async () => {
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {
      SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'MY_FIGMA_TOKEN',
      MY_FIGMA_TOKEN: 'synthetic-authorized-oauth',
    },
  });
  expect(endpoint.status()).toMatchObject({
    configurationRecognized: true,
    oauthTokenEnv: 'MY_FIGMA_TOKEN',
    credentialAvailable: true,
  });
  expect(await endpoint.connection.oauthToken?.()).toBe('synthetic-authorized-oauth');
  expect(JSON.stringify(endpoint.status())).not.toContain('synthetic-authorized-oauth');
});

it('keeps missing credentials and sparse tool support distinct from full capture', async () => {
  const probe = vi.fn<typeof probeOfficialFigmaMcp>(async () => ({
    ...successful(),
    captureCapability: {
      supported: false,
      reason: 'FIGMA_MCP_CAPTURE_UNSUPPORTED',
      liveVerified: false,
    },
  }));
  const endpoint = createFigmaMcpSettingsEndpoint({ environment: {}, probe });
  expect(endpoint.status().credentialAvailable).toBe(false);
  expect(
    await endpoint.probe({ endpoint: OFFICIAL_FIGMA_REMOTE }, new AbortController().signal),
  ).toMatchObject({ status: 'connected', programCaptureSupported: false, fullCapture: false });
});

it.each([
  'https://attacker.test/mcp',
  'https://mcp.figma.com/mcp?token=x',
  'http://localhost:3845/mcp',
])('rejects a noncanonical endpoint before any external call: %s', async url => {
  const probe = vi.fn<typeof probeOfficialFigmaMcp>();
  const endpoint = createFigmaMcpSettingsEndpoint({ environment: {}, probe });
  await expect(
    endpoint.probe({ endpoint: url }, new AbortController().signal),
  ).rejects.toMatchObject({ name: 'ZodError' });
  expect(probe).not.toHaveBeenCalled();
});

it('returns a bounded safe authentication result without publishing SDK errors or response bodies', async () => {
  const endpoint = createFigmaMcpSettingsEndpoint({
    environment: {},
    probe: async () => {
      throw Object.assign(new Error('Bearer synthetic-secret'), {
        code: 'FIGMA_MCP_AUTH_REQUIRED',
        body: 'private-sdk-body',
      });
    },
  });
  const result = await endpoint.probe(
    { endpoint: OFFICIAL_FIGMA_REMOTE },
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    status: 'auth-required',
    code: 'FIGMA_MCP_AUTH_REQUIRED',
    fullCapture: false,
  });
  expect(JSON.stringify(result)).not.toMatch(/synthetic-secret|private-sdk-body/u);
});

it('keeps probes bounded, cancellation-aware and single-flight', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const probe = vi.fn<typeof probeOfficialFigmaMcp>(async (_url, options) => {
    expect(options?.deadlineAt).toBeLessThanOrEqual(Date.now() + 20000);
    expect(options?.signal).toBeDefined();
    await held;
    options?.signal?.throwIfAborted();
    return successful();
  });
  const endpoint = createFigmaMcpSettingsEndpoint({ environment: {}, probe });
  const controller = new AbortController();
  const first = endpoint.probe({ endpoint: OFFICIAL_FIGMA_REMOTE }, controller.signal);
  await expect(
    endpoint.probe({ endpoint: OFFICIAL_FIGMA_REMOTE }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_PROBE_BUSY' });
  controller.abort();
  release();
  expect(await first).toMatchObject({
    status: 'cancelled',
    programCaptureSupported: false,
    fullCapture: false,
  });
  expect(probe).toHaveBeenCalledTimes(1);
});

it('exposes only authenticated closed status/probe routes and refuses credential input', async () => {
  const probe = vi.fn<typeof probeOfficialFigmaMcp>(async () => successful());
  const endpoint = createFigmaMcpSettingsEndpoint({ environment: {}, probe });
  const router = new AuthenticatedControlRouter();
  registerFigmaMcpSettingsRoutes(router, endpoint);
  router.freeze();
  const signal = new AbortController().signal;
  const request = {
    method: 'POST',
    path: '/control/figma-mcp/probe',
    input: { endpoint: OFFICIAL_FIGMA_REMOTE },
  };
  await expect(
    router.dispatch(
      { ...request, input: { ...request.input, oauthToken: 'never accepted' } },
      principal,
      signal,
    ),
  ).rejects.toMatchObject({ code: 'CONTROL_ROUTE_INPUT_INVALID' });
  await expect(
    router.dispatch(request, { ...principal, entryPath: 'mcp-direct' }, signal),
  ).rejects.toThrow('control router requires a control principal');
  expect(probe).not.toHaveBeenCalled();
  expect(
    await router.dispatch(
      { method: 'GET', path: '/control/figma-mcp/status', input: {} },
      principal,
      signal,
    ),
  ).toMatchObject({ provider: 'daemon-generation-provider' });
  expect(await router.dispatch(request, principal, signal)).toMatchObject({
    status: 'connected',
    fullCapture: false,
  });
});
