import {
  decodeFollowerInnerMessage,
  encodeFollowerInnerMessage,
  type ActorContext,
  type InvocationFrameV1,
} from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createFollowerInvocationEndpoint } from '../../src/execution/follower-invocation-endpoint.js';

const principal = Object.freeze({
  actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  entryPath: 'mcp-follower' as const,
}) satisfies ActorContext;
const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;

const frames = async function* (): AsyncIterable<InvocationFrameV1> {
  yield {
    version: 1,
    type: 'accepted',
    requestId,
    operationId: 'operation-1',
    operationKind: 'tool',
    operationName: 'get_selection',
  };
  yield {
    version: 1,
    type: 'result',
    requestId,
    operationId: 'operation-1',
    result: { nodes: [] },
  };
};

describe('authenticated follower inner invocation stream', () => {
  it('consumes decrypted plaintext only and writes framed accepted/result records', async () => {
    const invokeTool = vi.fn<() => AsyncIterable<InvocationFrameV1>>(() => frames());
    const written: { plaintext: Uint8Array; final: boolean }[] = [];
    const endpoint = createFollowerInvocationEndpoint({
      principalForMcpSession: () => principal,
      plane: {
        invokeTool,
        invokeService: vi.fn<() => never>(),
        cancel: vi.fn<() => never>(),
      },
    });
    const plaintext = encodeFollowerInnerMessage({
      version: 1,
      type: 'tool',
      request: {
        version: 1,
        requestId,
        toolName: 'get_selection',
        rawArgs: {},
        workspaceId: null,
        targetSelector: { kind: 'active' },
      },
    });
    await endpoint(
      { mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA', plaintext },
      {
        write: async (bytes, options) => {
          written.push({ plaintext: bytes, final: options.final });
        },
        truncate: async () => undefined,
      },
      new AbortController().signal,
    );

    expect(written.map(record => decodeFollowerInnerMessage(record.plaintext))).toEqual([
      expect.objectContaining({ type: 'accepted' }),
      expect.objectContaining({ type: 'result', result: { nodes: [] } }),
    ]);
    expect(written.map(record => record.final)).toEqual([false, true]);
    expect(invokeTool).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ requestId }),
      expect.any(AbortSignal),
    );
  });

  it('does not convert subscriber disconnect into operation cancel or retry', async () => {
    const cancel = vi.fn<() => never>();
    const invokeTool = vi.fn<() => AsyncIterable<InvocationFrameV1>>(() => frames());
    const endpoint = createFollowerInvocationEndpoint({
      principalForMcpSession: () => principal,
      plane: { invokeTool, invokeService: vi.fn<() => never>(), cancel },
    });
    const subscriber = new AbortController();
    subscriber.abort(new Error('disconnect'));
    await endpoint(
      {
        mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
        plaintext: encodeFollowerInnerMessage({
          version: 1,
          type: 'tool',
          request: {
            version: 1,
            requestId,
            toolName: 'get_selection',
            rawArgs: {},
            workspaceId: null,
            targetSelector: { kind: 'active' },
          },
        }),
      },
      { write: vi.fn<() => never>(), truncate: vi.fn<() => never>() },
      subscriber.signal,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(invokeTool).toHaveBeenCalledOnce();
  });

  it('redacts plugin paths, URLs, base64, and secrets before follower error framing', async () => {
    const secretFrames = async function* (): AsyncIterable<InvocationFrameV1> {
      yield {
        version: 1,
        type: 'error',
        requestId,
        operationId: 'operation-secret',
        error: {
          code: 'PLUGIN_RESULT_INVALID',
          message:
            'C:\\Users\\owner\\secret.fig https://token.example/?key=abc data:image/png;base64,AAAA',
          retryable: false,
        },
      };
    };
    const written: Uint8Array[] = [];
    const endpoint = createFollowerInvocationEndpoint({
      principalForMcpSession: () => principal,
      plane: {
        invokeTool: () => secretFrames(),
        invokeService: vi.fn<() => never>(),
        cancel: vi.fn<() => never>(),
      },
    });
    await endpoint(
      {
        mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
        plaintext: encodeFollowerInnerMessage({
          version: 1,
          type: 'tool',
          request: {
            version: 1,
            requestId,
            toolName: 'get_selection',
            rawArgs: {},
            workspaceId: null,
            targetSelector: { kind: 'active' },
          },
        }),
      },
      {
        write: async bytes => {
          written.push(bytes);
        },
        truncate: async () => undefined,
      },
      new AbortController().signal,
    );

    expect(decodeFollowerInnerMessage(written[0] as Uint8Array)).toMatchObject({
      type: 'error',
      error: { code: 'PLUGIN_RESULT_INVALID', message: 'plugin returned an invalid result' },
    });
    expect(Buffer.concat(written.map(bytes => Buffer.from(bytes))).toString('utf8')).not.toMatch(
      /secret\.fig|token\.example|base64/iu,
    );
  });
});
