import { decodeFollowerInnerMessage, encodeFollowerInnerMessage } from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { NodeRole } from '../../src/election/node.js';
import { FollowerInvocationClient } from '../../src/execution/follower-invocation-client.js';
import type {
  AuthenticatedPlaintextRecord,
  FollowerTransportClient,
} from '../../src/security/follower-transport.js';

const records = async function* (): AsyncIterable<AuthenticatedPlaintextRecord> {
  yield { sequence: 0, final: false, plaintext: Uint8Array.from([1, 2]) };
  yield { sequence: 1, final: true, plaintext: Uint8Array.from([3]) };
};

describe('opaque follower invocation client', () => {
  it('uses the authenticated public stream facade once and yields ordered plaintext only', async () => {
    const open = vi.fn<FollowerTransportClient['open']>(async () => records());
    const transport = {
      mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
      leaderInfo: async () => undefined,
      open,
    } as FollowerTransportClient;
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const signal = new AbortController().signal;
    const stream = await client.open(Uint8Array.from([9, 8, 7]), signal);
    const chunks: number[][] = [];
    for await (const chunk of stream) chunks.push([...chunk]);

    expect(chunks).toEqual([[1, 2], [3]]);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/rpc',
        plaintext: Uint8Array.from([9, 8, 7]),
        transportRequestId: expect.stringMatching(/^sfp_req1_/),
      }),
      expect.any(AbortSignal),
    );
  });

  it.each([NodeRole.Unknown, NodeRole.Conflicted, NodeRole.Leader])(
    'forwards no payload while role is %s',
    async role => {
      const open = vi.fn<FollowerTransportClient['open']>();
      const client = new FollowerInvocationClient(
        {
          mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
          leaderInfo: async () => undefined,
          open,
        } as unknown as FollowerTransportClient,
        () => role,
      );
      await expect(
        client.open(Uint8Array.from([1]), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'FOLLOWER_ROLE_REQUIRED' });
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('uses the handler abort to send one authenticated same-session cancel request', async () => {
    const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
    const operationId = 'operation-follower-mcp-cancel';
    const sent: Uint8Array[] = [];
    const transport = {
      mcpSession: 'mcp1_AQAAAAAAAAAAAAAAAAAAAA',
      leaderInfo: async () => undefined,
      open: async (
        input: { plaintext: Uint8Array },
        signal: AbortSignal,
      ): Promise<AsyncIterable<AuthenticatedPlaintextRecord>> => {
        sent.push(Uint8Array.from(input.plaintext));
        if (sent.length > 1) {
          return (async function* () {
            yield {
              sequence: 0,
              final: true,
              plaintext: encodeFollowerInnerMessage({
                version: 1,
                type: 'result',
                requestId,
                operationId,
                result: { cancelled: true },
              }),
            };
          })();
        }
        return (async function* () {
          yield {
            sequence: 0,
            final: false,
            plaintext: encodeFollowerInnerMessage({
              version: 1,
              type: 'accepted',
              requestId,
              operationId,
              operationKind: 'tool',
              operationName: 'get_selection',
            }),
          };
          await new Promise<never>((_resolve, reject) => {
            const abort = (): void => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
        })();
      },
    } as unknown as FollowerTransportClient;
    const controller = new AbortController();
    const client = new FollowerInvocationClient(transport, () => NodeRole.Follower);
    const tool = encodeFollowerInnerMessage({
      version: 1,
      type: 'tool',
      request: {
        version: 1,
        requestId,
        operationId,
        toolName: 'get_selection',
        rawArgs: {},
        workspaceId: null,
        targetSelector: { kind: 'active' },
      },
    });
    const cancel = encodeFollowerInnerMessage({
      version: 1,
      type: 'cancel',
      requestId,
      operationId,
    });
    const stream = await client.open(tool, controller.signal, cancel);
    const consuming = (async () => {
      for await (const chunk of stream) {
        void chunk;
        controller.abort(Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }));
      }
    })();
    await consuming.catch(() => undefined);

    expect(sent.map(bytes => decodeFollowerInnerMessage(bytes))).toEqual([
      expect.objectContaining({
        type: 'tool',
        request: expect.objectContaining({ requestId, operationId }),
      }),
      { version: 1, type: 'cancel', requestId, operationId },
    ]);
  });
});
