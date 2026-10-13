import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BrowserReadQuerySchema } from '../../shared/src/figma-capture-query.js';
import { officialCaptureProgram } from '../src/official-figma-mcp-program.js';
import {
  OFFICIAL_FIGMA_REMOTE,
  openOfficialFigmaCapture,
  officialFigmaConnectionFromEnvironment,
  probeOfficialFigmaMcp,
} from '../src/official-figma-mcp.js';
import { officialServerFixture, officialTarget } from './official-mcp-fixture.js';

const request = { endpoint: OFFICIAL_FIGMA_REMOTE, target: officialTarget };
afterEach(() => {
  vi.restoreAllMocks();
});
it('cancels a pending HTTP request at its original scoped deadline, before the fixed RPC timeout', async () => {
  const server = officialServerFixture();
  let block = false,
    observedSignal: AbortSignal | undefined;
  const session = await openOfficialFigmaCapture(request, {
    fetch: async (input, init) => {
      if (
        block &&
        init?.method === 'POST' &&
        JSON.parse(String(init.body)).method === 'tools/call'
      ) {
        observedSignal = init.signal!;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(observedSignal!.reason);
          observedSignal!.addEventListener('abort', abort, { once: true });
          if (observedSignal!.aborted) abort();
        });
      }
      return server.fetch(input, init);
    },
  });
  try {
    block = true;
    await expect(
      session.execute({ kind: 'identity' }, { deadlineAt: Date.now() + 50 }),
    ).rejects.toThrow('FIGMA_MCP_DEADLINE_EXCEEDED');
    expect(observedSignal?.aborted).toBe(true);
  } finally {
    await session.close();
  }
});
it('does not start discovery or a program after the handshake exhausts the original deadline', async () => {
  const server = officialServerFixture();
  let now = Date.now();
  const deadlineAt = now + 5000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const value = await server.fetch(input, init);
    now = deadlineAt + 1;
    return value;
  });
  await expect(openOfficialFigmaCapture(request, { fetch, deadlineAt })).rejects.toThrow(
    'FIGMA_MCP_DEADLINE_EXCEEDED',
  );
  expect(server.calls).toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('reports discovered capture capability without exposing arbitrary use_figma or claiming a live capture', async () => {
  const server = officialServerFixture();
  const result = await probeOfficialFigmaMcp(OFFICIAL_FIGMA_REMOTE, { fetch: server.fetch });
  expect(result.captureCapability).toEqual({
    supported: true,
    method: 'fixed-plugin-api-program',
    liveVerified: false,
  });
  expect(result.fullCapture).toBe(false);
  expect(result.tools.some(tool => tool.name === 'use_figma')).toBe(false);
  expect(server.calls).toHaveLength(0);
});
it('discovers the actual official tool and runs only schema-bounded fixed read/export programs', async () => {
  const server = officialServerFixture();
  const session = await openOfficialFigmaCapture(request, { fetch: server.fetch });
  try {
    const result = await session.execute({
      kind: 'read',
      query: BrowserReadQuerySchema.parse({ nodeId: officialTarget.nodeId, mode: 'roots' }),
    });
    expect(result).toMatchObject({
      source: 'official-figma-mcp',
      scopeNodeId: officialTarget.nodeId,
      nodes: [{ id: '1:1' }],
    });
    expect(
      server.calls.every(
        call =>
          call.name === 'use_figma' &&
          call.arguments.fileKey === officialTarget.fileKey &&
          call.arguments.skillNames === 'figma-use',
      ),
    ).toBe(true);
    const count = server.calls.length;
    await expect(
      session.execute({
        kind: 'read',
        query: { nodeId: '0:1', code: 'figma.createFrame()' },
      } as never),
    ).rejects.toThrow('Unrecognized key');
    expect(server.calls).toHaveLength(count);
  } finally {
    await session.close();
  }
});
it.each([
  { tool: false },
  { fileArgument: false },
  { required: ['fileKey', 'code', 'unsafeExtra'] },
])(
  'rejects missing or incompatible official capability before program execution: %j',
  async options => {
    const server = officialServerFixture(options);
    await expect(openOfficialFigmaCapture(request, { fetch: server.fetch })).rejects.toThrow(
      /FIGMA_MCP_(CAPTURE|INPUT)_UNSUPPORTED/u,
    );
    expect(server.calls).toHaveLength(0);
  },
);
it('does not promote normal metadata or design-context prose into native evidence', async () => {
  const server = officialServerFixture({ prose: true });
  await expect(openOfficialFigmaCapture(request, { fetch: server.fetch })).rejects.toThrow(
    'FIGMA_MCP_RESULT_UNSUPPORTED',
  );
});
it.each(['fileKey', 'scopeNodeId', 'nonce'] as const)(
  'rejects a mismatched %s from the official response',
  async field => {
    const server = officialServerFixture();
    server.rewrite(value => ({
      ...value,
      [field]: field === 'nonce' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'wrong',
    }));
    await expect(openOfficialFigmaCapture(request, { fetch: server.fetch })).rejects.toThrow(
      /FIGMA_MCP_(FILE_IDENTITY_UNVERIFIED|SCOPE_MISMATCH)/u,
    );
  },
);
it('rejects page replacement after session admission and rejects calls after close', async () => {
  const server = officialServerFixture();
  const session = await openOfficialFigmaCapture(request, { fetch: server.fetch });
  server.rewrite(value => ({ ...value, pageId: '99:99' }));
  await expect(session.execute({ kind: 'identity' })).rejects.toThrow('FIGMA_MCP_SCOPE_MISMATCH');
  await session.close();
  await expect(session.execute({ kind: 'identity' })).rejects.toThrow('FIGMA_MCP_SESSION_CLOSED');
});
it('checks actual runtime file identity before reading even when the request has the intended key', async () => {
  const server = officialServerFixture();
  server.figma.fileKey = 'WrongFileKey';
  await expect(openOfficialFigmaCapture(request, { fetch: server.fetch })).rejects.toThrow(
    'FIGMA_MCP_TOOL_FAILED',
  );
});
it('honors cancellation before any connection or program execution', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(
    openOfficialFigmaCapture(request, { fetch, signal: AbortSignal.abort(Error('cancelled')) }),
  ).rejects.toThrow('cancelled');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps user program input unavailable and rejects a whole-document/null scope', () => {
  expect(() =>
    officialCaptureProgram(
      officialTarget,
      { kind: 'javascript', code: 'return figma.createFrame()' },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ),
  ).toThrow(z.ZodError);
  expect(() =>
    officialCaptureProgram(
      officialTarget,
      { kind: 'read', query: {} },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ),
  ).toThrow('FIGMA_MCP_TARGET_REQUIRED');
});
it('resolves only an explicitly configured credential variable at call time', async () => {
  const environment: Record<string, string | undefined> = {
    SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'EXTERNAL_OAUTH',
  };
  const options = officialFigmaConnectionFromEnvironment(environment);
  await expect(options.oauthToken!()).rejects.toThrow('FIGMA_MCP_OAUTH_ENV_REQUIRED');
  environment.EXTERNAL_OAUTH = 'fixture-credential';
  expect(await options.oauthToken!()).toBe('fixture-credential');
  expect(officialFigmaConnectionFromEnvironment({})).toEqual({});
});
