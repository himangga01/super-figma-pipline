import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../src/commands.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('official Figma MCP public CLI', () => {
  it('exposes the approved remote configuration without making a network request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const emit = vi.fn<(value: unknown) => void>();
    await runCommand(['figma-mcp', 'config'], emit);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://mcp.figma.com/mcp',
        connected: false,
        authentication: 'external-oauth',
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('documents the official config, probe and read route in public help', async () => {
    const emit = vi.fn<(value: unknown) => void>();
    await runCommand(['help'], emit);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      commands: expect.arrayContaining([expect.stringContaining('figma-mcp config|probe|read')]),
    });
  });

  it('rejects unofficial endpoint and write tool before network access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    await expect(
      runCommand(
        ['figma-mcp', 'probe', '--endpoint', 'https://unofficial.example/mcp'],
        vi.fn<(value: unknown) => void>(),
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
      ),
    ).rejects.toThrow('FIGMA_MCP_READ_TOOL_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires explicit node identity and emits no success on actual auth rejection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const emit = vi.fn<(value: unknown) => void>();
    await expect(
      runCommand(
        ['figma-mcp', 'read', '--url', 'https://www.figma.com/design/abcdefghij/Test'],
        emit,
      ),
    ).rejects.toThrow('FIGMA_MCP_TARGET_REQUIRED');
    await expect(runCommand(['figma-mcp', 'probe'], emit)).rejects.toThrow(
      'FIGMA_MCP_AUTH_REQUIRED',
    );
    expect(emit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['get_metadata', 'get_design_context'] as const)(
    'reads %s through the public route with exact file/node arguments without emitting OAuth credentials',
    async tool => {
      vi.stubEnv('SFP_TEST_EXTERNAL_OAUTH', 'authorized-fixture-value');
      const messages: Record<string, unknown>[] = [];
      const result = { content: [{ type: 'text', text: '<frame id="12:34" />' }] };
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        if (init?.method === 'GET') return new Response(null, { status: 405 });
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer authorized-fixture-value',
        );
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
                      name: tool,
                      inputSchema: {
                        type: 'object',
                        properties: { fileKey: { type: 'string' }, nodeId: { type: 'string' } },
                        required: ['fileKey', 'nodeId'],
                      },
                    },
                  ],
                }
              : result;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: body }), {
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetch);
      const emit = vi.fn<(value: unknown) => void>();
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
      );
      expect(messages.find(message => message.method === 'tools/call')).toMatchObject({
        params: { name: tool, arguments: { fileKey: 'abcdefghij', nodeId: '12:34' } },
      });
      expect(emit.mock.calls[0]?.[0]).toMatchObject({
        result,
        fullCapture: false,
        identityBinding: 'request-only',
      });
      expect(JSON.stringify(emit.mock.calls)).not.toContain('authorized-fixture-value');
    },
  );
});
