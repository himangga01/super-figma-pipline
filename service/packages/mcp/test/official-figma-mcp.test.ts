import { describe, expect, it, vi } from 'vitest';

import {
  assertOfficialFigmaEndpoint,
  officialFigmaConfiguration,
  probeOfficialFigmaMcp,
  readOfficialFigmaMcp,
} from '../src/official-figma-mcp.js';

const remote = 'https://mcp.figma.com/mcp';
const desktop = 'http://127.0.0.1:3845/mcp';
const target = { fileKey: 'abcdefghij', nodeId: '12:34' };
const result = { content: [{ type: 'text', text: '<frame id="12:34" />' }] };

function fixture(
  options: {
    desktop?: boolean;
    toolError?: boolean;
    unknownRequired?: boolean;
    tool?: 'get_metadata' | 'get_design_context';
  } = {},
) {
  const messages: Record<string, unknown>[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as Record<string, unknown>;
    messages.push(message);
    if (message.id === undefined) return new Response(null, { status: 202 });
    const body =
      message.method === 'initialize'
        ? {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'Figma', version: '1' },
          }
        : message.method === 'tools/list'
          ? {
              tools: [
                {
                  name: options.tool ?? 'get_metadata',
                  inputSchema: {
                    type: 'object',
                    properties: options.desktop
                      ? { nodeId: { type: 'string' } }
                      : { nodeId: { type: 'string' }, fileKey: { type: 'string' } },
                    required: options.unknownRequired
                      ? ['nodeId', 'fileKey', 'unknownArgument']
                      : options.desktop
                        ? ['nodeId']
                        : ['nodeId', 'fileKey'],
                  },
                },
                { name: 'use_figma', inputSchema: { type: 'object' } },
              ],
            }
          : options.toolError
            ? { ...result, isError: true }
            : result;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: body }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, messages, requests };
}

describe('official Figma MCP integration', () => {
  it.each([remote, desktop])('supports the documented endpoint %s', endpoint => {
    expect(assertOfficialFigmaEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([
    'https://mcp.figma.com/mcp?token=x',
    'https://mcp.figma.com/mcp#x',
    'https://user@mcp.figma.com/mcp',
    'https://mcp.figma.com:443/mcp',
    'http://localhost:3845/mcp',
    'https://figma.example/mcp',
    'http://127.0.0.1:3846/mcp',
  ])('rejects unofficial or credential-bearing endpoint %s', endpoint => {
    expect(() => assertOfficialFigmaEndpoint(endpoint)).toThrow('FIGMA_MCP_ENDPOINT_UNSUPPORTED');
  });

  it('emits supported configuration and external OAuth handoff without claiming connection', () => {
    expect(officialFigmaConfiguration(remote)).toMatchObject({
      endpoint: remote,
      connected: false,
      browser: 'chrome',
      authentication: 'external-oauth',
      approvedClientRequired: true,
    });
  });

  it.each(['get_metadata', 'get_design_context'] as const)(
    'reads %s through the SDK handshake with exact response and requested identity',
    async tool => {
      const server = fixture({ tool });
      const read = await readOfficialFigmaMcp(
        { endpoint: remote, target, tool },
        { fetch: server.fetch, oauthToken: async () => 'authorized-test-token' },
      );
      expect(read).toMatchObject({
        source: 'official-figma-mcp',
        endpoint: remote,
        requestedTarget: target,
        tool,
        result,
        fullCapture: false,
        identityBinding: 'request-only',
      });
      expect(server.messages.find(message => message.method === 'initialize')).toMatchObject({
        params: { clientInfo: { name: 'super-figma-pipeline', version: '0.1.0' } },
      });
      expect(server.messages.find(message => message.method === 'tools/call')).toMatchObject({
        params: { name: tool, arguments: target },
      });
      expect(
        server.requests.every(({ url, init }) => url === remote && init.redirect === 'manual'),
      ).toBe(true);
      expect(new Headers(server.requests[0]?.init.headers).get('authorization')).toBe(
        'Bearer authorized-test-token',
      );
    },
  );

  it('never sends remote OAuth credentials to the desktop endpoint and reports its active-file limitation', async () => {
    const server = fixture({ desktop: true });
    const token = vi.fn<() => Promise<string>>(async () => 'remote-token');
    const read = await readOfficialFigmaMcp(
      { endpoint: desktop, target, tool: 'get_metadata' },
      { fetch: server.fetch, oauthToken: token },
    );
    expect(token).not.toHaveBeenCalled();
    expect(read.identityBinding).toBe('desktop-active-file-unverified');
    expect(server.messages.find(message => message.method === 'tools/call')).toMatchObject({
      params: { arguments: { nodeId: '12:34' } },
    });
    expect(
      server.requests.every(({ init }) => new Headers(init.headers).get('authorization') === null),
    ).toBe(true);
  });

  it('filters write tools from the real probe and rejects their execution before network access', async () => {
    const server = fixture();
    expect(await probeOfficialFigmaMcp(remote, { fetch: server.fetch })).toMatchObject({
      connected: true,
      tools: [{ name: 'get_metadata' }],
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      readOfficialFigmaMcp(
        { endpoint: remote, target, tool: 'use_figma' as 'get_metadata' },
        { fetch },
      ),
    ).rejects.toThrow('FIGMA_MCP_READ_TOOL_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects redirects without contacting the new credential destination', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://third-party.example/mcp' },
        }),
    );
    await expect(
      probeOfficialFigmaMcp(remote, { fetch, oauthToken: async () => 'test-token' }),
    ).rejects.toThrow('FIGMA_MCP_REDIRECT_REJECTED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports actual authentication failure with external handoff and no fabricated result', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 }));
    await expect(probeOfficialFigmaMcp(remote, { fetch })).rejects.toThrow(
      'FIGMA_MCP_AUTH_REQUIRED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps actual tool errors as errors instead of successful capture', async () => {
    const server = fixture({ toolError: true });
    await expect(
      readOfficialFigmaMcp(
        { endpoint: remote, target, tool: 'get_metadata' },
        { fetch: server.fetch },
      ),
    ).rejects.toThrow('FIGMA_MCP_TOOL_FAILED');
  });

  it('rejects unsupported required server arguments instead of silently sending a partial request', async () => {
    const server = fixture({ unknownRequired: true });
    await expect(
      readOfficialFigmaMcp(
        { endpoint: remote, target, tool: 'get_metadata' },
        { fetch: server.fetch },
      ),
    ).rejects.toThrow('FIGMA_MCP_INPUT_UNSUPPORTED');
    expect(server.messages.some(message => message.method === 'tools/call')).toBe(false);
  });

  it('snapshots the requested tool before asynchronous authentication or discovery', async () => {
    const server = fixture();
    const request = { endpoint: remote, target, tool: 'get_metadata' as const };
    const reading = readOfficialFigmaMcp(request, { fetch: server.fetch });
    Object.assign(request, { tool: 'get_screenshot' });
    expect(await reading).toMatchObject({ tool: 'get_metadata', requestedTarget: target });
  });
});
