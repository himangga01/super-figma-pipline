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
      signal,
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
});
