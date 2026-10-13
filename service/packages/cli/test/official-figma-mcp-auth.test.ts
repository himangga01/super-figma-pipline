import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../src/commands.js';
import { ControlClient } from '../src/control-client.js';
import { executeOfficialFigmaAuth } from '../src/official-figma-mcp-command.js';
import {
  executeServiceFeature,
  parseServiceFeature,
  serviceFeatures,
} from '../src/service-functions.js';

const provider = '00000000-0000-4000-8000-000000000001';
const flowId = '00000000-0000-4000-8000-000000000002';
const binding = { providerInstanceId: provider, configurationGeneration: 2, authGeneration: 3 };
const configuration = {
  endpoint: 'https://mcp.figma.com/mcp',
  mode: 'own-oauth',
  oauthTokenEnv: null,
  clientIdEnv: 'OWN_FIGMA_CLIENT_ID',
  clientSecretEnv: 'OWN_FIGMA_CLIENT_SECRET',
  contractReference: 'approved-own-client',
  contractDigest: `sha256:${'a'.repeat(64)}`,
};
const status = (extra = {}) => ({
  schemaVersion: 1,
  ...binding,
  configuration,
  stage: 'waiting-for-callback',
  code: null,
  expiresAt: Date.now() + 300000,
  flowId,
  handoffAvailable: true,
  eligibilitySource: 'operator-contract',
  serverAuthorizationObserved: false,
  sessionOnly: true,
  ...extra,
});
function setup() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw Error('LIVE_NETWORK_BLOCKED');
    }),
  );
  const client = new ControlClient();
  const request = vi.spyOn(client, 'request').mockResolvedValue(status());
  return { client, request, emit: vi.fn<(value: unknown) => void>() };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public daemon-owned official OAuth commands', () => {
  it('reads blocked prerequisites through the injected daemon without external discovery', async () => {
    const { client, request, emit } = setup();
    request.mockResolvedValue(
      status({
        stage: 'blocked',
        code: 'FIGMA_MCP_OAUTH_CONTRACT_REQUIRED',
        flowId: null,
        handoffAvailable: false,
        eligibilitySource: 'none',
      }),
    );
    await runCommand(['figma-mcp', 'auth', 'status'], emit, { client });
    expect(request).toHaveBeenCalledWith('/control/figma-mcp/auth/status', 'GET', undefined, {});
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        fullCapture: false,
        authentication: expect.objectContaining({
          stage: 'blocked',
          serverAuthorizationObserved: false,
        }),
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('starts with an exact generation tuple and emits only static manual portal instructions', async () => {
    const { client, request, emit } = setup();
    const deadline = Date.now() + 300000;
    await runCommand(
      [
        'figma-mcp',
        'auth',
        'start',
        '--provider-instance-id',
        provider,
        '--configuration-generation',
        '2',
        '--auth-generation',
        '3',
        '--deadline-at',
        String(deadline),
      ],
      emit,
      { client },
    );
    expect(request).toHaveBeenCalledWith(
      '/control/figma-mcp/auth/start',
      'POST',
      { ...binding, deadlineAt: deadline },
      {},
    );
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      consent: { available: true, portalPath: '/figma-auth-consent' },
      fullCapture: false,
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('https://www.figma.com/oauth');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('configures only environment names and a secret-free installed contract reference', async () => {
    const { client, request, emit } = setup();
    await runCommand(
      [
        'figma-mcp',
        'auth',
        'configure',
        '--provider-instance-id',
        provider,
        '--configuration-generation',
        '2',
        '--auth-generation',
        '3',
        '--client-id-env',
        'OWN_FIGMA_CLIENT_ID',
        '--client-secret-env',
        'OWN_FIGMA_CLIENT_SECRET',
        '--contract-reference',
        'approved-own-client',
        '--contract-digest',
        `sha256:${'a'.repeat(64)}`,
      ],
      emit,
      { client },
    );
    expect(request).toHaveBeenCalledWith(
      '/control/figma-mcp/auth/configure',
      'POST',
      { ...binding, configuration },
      {},
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'logout', 'refresh'] as const)(
    'dispatches explicit %s without handoff or replay',
    async action => {
      const { client, request } = setup();
      const input =
        action === 'refresh'
          ? { ...binding, deadlineAt: Date.now() + 15000 }
          : { ...binding, flowId };
      const signal = new AbortController().signal;
      await executeOfficialFigmaAuth(client, action, input, signal);
      expect(request).toHaveBeenCalledWith(`/control/figma-mcp/auth/${action}`, 'POST', input, {
        signal,
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      ['handoff'],
      ['status', '--client-secret', 'PRIVATE_CANARY_VALUE'],
      [
        'start',
        '--provider-instance-id',
        provider,
        '--configuration-generation',
        '2',
        '--auth-generation',
        'NaN',
      ],
      ['configure', '--client-id-env', 'secret value with spaces'],
    ].map(args => ({ args })),
  )('rejects invalid or secret-shaped CLI input before any request %#', async ({ args }) => {
    const { client, request, emit } = setup();
    await expect(runCommand(['figma-mcp', 'auth', ...args], emit, { client })).rejects.toThrow(
      'FIGMA_MCP_OAUTH_INPUT_INVALID',
    );
    expect(request).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('rejects extra secret response fields and arbitrary transport messages without stdout leakage', async () => {
    const { client, request, emit } = setup();
    request.mockResolvedValue(
      status({ authorizationUrl: 'https://www.figma.com/oauth/mcp?state=PRIVATE_CANARY_VALUE' }),
    );
    await expect(runCommand(['figma-mcp', 'auth', 'status'], emit, { client })).rejects.toThrow(
      'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
    );
    request.mockRejectedValue(
      Object.assign(Error('PRIVATE_CANARY_VALUE'), { code: 'PRIVATE_CANARY_VALUE' }),
    );
    await expect(runCommand(['figma-mcp', 'auth', 'status'], emit, { client })).rejects.toThrow(
      'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
    );
    expect(emit).not.toHaveBeenCalled();
  });
  it('uses a closed cancellation reason and never dispatches an already cancelled action', async () => {
    const { client, request } = setup();
    const controller = new AbortController();
    controller.abort('PRIVATE_CANARY_REASON');
    await expect(
      executeOfficialFigmaAuth(
        client,
        'start',
        { ...binding, deadlineAt: Date.now() + 300000 },
        controller.signal,
      ),
    ).rejects.toThrow('FIGMA_MCP_OAUTH_CANCELLED');
    expect(request).not.toHaveBeenCalled();
  });
  it('exposes all six commands in the public catalog with closed arguments and the same daemon client', async () => {
    const { client, request } = setup();
    expect(
      serviceFeatures()
        .filter(feature => feature.name.startsWith('figma-mcp.auth.'))
        .map(feature => feature.name),
    ).toEqual([
      'figma-mcp.auth.status',
      'figma-mcp.auth.configure',
      'figma-mcp.auth.start',
      'figma-mcp.auth.cancel',
      'figma-mcp.auth.logout',
      'figma-mcp.auth.refresh',
    ]);
    expect(() =>
      parseServiceFeature('figma-mcp.auth.start', { ...binding, PRIVATE_CANARY_VALUE: 'secret' }),
    ).toThrow('FIGMA_MCP_OAUTH_INPUT_INVALID');
    const output = await executeServiceFeature(
      client,
      'figma-mcp.auth.start',
      { ...binding, deadlineAt: Date.now() + 300000 },
      {
        workspaceId: null,
        targetSelector: { kind: 'none' },
        signal: new AbortController().signal,
        emit: vi.fn<(value: unknown) => void>(),
      },
    );
    expect(output).toMatchObject({
      consent: { portalPath: '/figma-auth-consent' },
      fullCapture: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
