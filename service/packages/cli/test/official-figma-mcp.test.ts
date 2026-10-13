import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../src/commands.js';
import { ControlClient } from '../src/control-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function client() {
  const instance = new ControlClient();
  const request = vi.spyOn(instance, 'request');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw Error('LIVE_NETWORK_BLOCKED');
    }),
  );
  return { instance, request };
}
const remote = 'https://mcp.figma.com/mcp';
const provider = '00000000-0000-4000-8000-000000000001';
const tokenStatus = {
  schemaVersion: 1,
  providerInstanceId: provider,
  configurationGeneration: 2,
  authGeneration: 3,
  configuration: {
    endpoint: remote,
    mode: 'external-token',
    oauthTokenEnv: 'SFP_TEST_EXTERNAL_OAUTH',
    clientIdEnv: null,
    clientSecretEnv: null,
    contractReference: null,
    contractDigest: null,
  },
  stage: 'external-token-configured',
  code: null,
  expiresAt: null,
  flowId: null,
  handoffAvailable: false,
  eligibilitySource: 'none',
  serverAuthorizationObserved: false,
  sessionOnly: true,
};

describe('official Figma MCP public CLI', () => {
  it('exposes the approved remote configuration without making a network request', async () => {
    const { request } = client();
    const emit = vi.fn<(value: unknown) => void>();
    await runCommand(['figma-mcp', 'config'], emit);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: remote,
        connected: false,
        authentication: 'external-oauth',
      }),
    );
    expect(request).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('documents the official config probe read and safe auth routes in public help', async () => {
    const emit = vi.fn<(value: unknown) => void>();
    await runCommand(['help'], emit);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      commands: expect.arrayContaining([
        expect.stringContaining('figma-mcp config|probe|read'),
        expect.stringContaining('figma-mcp auth status|configure|start|cancel|logout|refresh'),
      ]),
    });
  });
  it('rejects unofficial endpoint and write tool before daemon or external requests', async () => {
    const { instance, request } = client();
    await expect(
      runCommand(
        ['figma-mcp', 'probe', '--endpoint', 'https://unofficial.example/mcp'],
        vi.fn<(value: unknown) => void>(),
        { client: instance },
      ),
    ).rejects.toThrow('FIGMA_MCP_ENDPOINT_UNSUPPORTED');
    await expect(
      runCommand(
        [
          'figma-mcp',
          'read',
          '--url',
          'https://www.figma.com/design/abcdefghij/Test?node-id=12-34',
          '--tool',
          'use_figma',
        ],
        vi.fn<(value: unknown) => void>(),
        { client: instance },
      ),
    ).rejects.toThrow('FIGMA_MCP_READ_TOOL_REQUIRED');
    expect(request).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('requires explicit node identity and emits no success on daemon auth rejection', async () => {
    const { instance, request } = client();
    request.mockRejectedValue(
      Object.assign(Error('FIGMA_MCP_AUTH_REQUIRED'), { code: 'FIGMA_MCP_AUTH_REQUIRED' }),
    );
    const emit = vi.fn<(value: unknown) => void>();
    await expect(
      runCommand(
        ['figma-mcp', 'read', '--url', 'https://www.figma.com/design/abcdefghij/Test'],
        emit,
        { client: instance },
      ),
    ).rejects.toThrow('FIGMA_MCP_TARGET_REQUIRED');
    expect(request).not.toHaveBeenCalled();
    await expect(runCommand(['figma-mcp', 'probe'], emit, { client: instance })).rejects.toThrow(
      'FIGMA_MCP_AUTH_REQUIRED',
    );
    expect(emit).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      '/control/figma-mcp/probe',
      'POST',
      { endpoint: remote },
      {},
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['get_metadata', 'get_design_context'] as const)(
    'reads %s using exact file node and daemon token reference without copying CLI credentials',
    async tool => {
      const { instance, request } = client();
      vi.stubEnv('SFP_TEST_EXTERNAL_OAUTH', 'OWNED_CLI_VALUE_MUST_NOT_LEAVE_PROCESS');
      const output = {
        result: { content: [{ type: 'text', text: '<frame id="12:34" />' }] },
        fullCapture: false,
        identityBinding: 'request-only',
      };
      request.mockImplementation(async route =>
        route.endsWith('/auth/status') ? tokenStatus : output,
      );
      const emit = vi.fn<(value: unknown) => void>();
      const signal = new AbortController().signal;
      await runCommand(
        [
          'figma-mcp',
          'read',
          '--url',
          'https://www.figma.com/design/abcdefghij/Test?node-id=12-34',
          '--oauth-token-env',
          'SFP_TEST_EXTERNAL_OAUTH',
          '--tool',
          tool,
        ],
        emit,
        { client: instance, signal },
      );
      expect(request.mock.calls.map(call => call[0])).toEqual([
        '/control/figma-mcp/auth/status',
        '/control/figma-mcp/read',
      ]);
      expect(request.mock.calls[1]).toEqual([
        '/control/figma-mcp/read',
        'POST',
        { endpoint: remote, target: { fileKey: 'abcdefghij', nodeId: '12:34' }, tool },
        { signal },
      ]);
      expect(emit).toHaveBeenCalledWith(output);
      expect(JSON.stringify(request.mock.calls)).not.toContain(
        'OWNED_CLI_VALUE_MUST_NOT_LEAVE_PROCESS',
      );
      expect(JSON.stringify(emit.mock.calls)).not.toContain(
        'OWNED_CLI_VALUE_MUST_NOT_LEAVE_PROCESS',
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
  it('refuses a different daemon token environment reference and never probes with CLI credentials', async () => {
    const { instance, request } = client();
    request.mockResolvedValue(tokenStatus);
    await expect(
      runCommand(
        ['figma-mcp', 'probe', '--oauth-token-env', 'OTHER_ENV'],
        vi.fn<(value: unknown) => void>(),
        { client: instance },
      ),
    ).rejects.toThrow('FIGMA_MCP_OAUTH_BINDING_MISMATCH');
    expect(request).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('uses the same daemon provider for Desktop and sends no remote credential reference', async () => {
    const { instance, request } = client();
    request.mockResolvedValue({ status: 'connected' });
    await runCommand(
      ['figma-mcp', 'probe', '--endpoint', 'http://127.0.0.1:3845/mcp'],
      vi.fn<(value: unknown) => void>(),
      { client: instance },
    );
    expect(request).toHaveBeenCalledWith(
      '/control/figma-mcp/probe',
      'POST',
      { endpoint: 'http://127.0.0.1:3845/mcp' },
      {},
    );
    await expect(
      runCommand(
        [
          'figma-mcp',
          'probe',
          '--endpoint',
          'http://127.0.0.1:3845/mcp',
          '--oauth-token-env',
          'SFP_TEST_EXTERNAL_OAUTH',
        ],
        vi.fn<(value: unknown) => void>(),
        { client: instance },
      ),
    ).rejects.toThrow('FIGMA_MCP_OAUTH_REMOTE_ONLY');
    expect(request).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
