import type { NodeRole } from '../election/node.js';
import {
  createFollowerTransportRequestId,
  type FollowerTransportClient,
} from '../security/follower-transport.js';

export class FollowerInvocationClient {
  constructor(
    private readonly transport: FollowerTransportClient,
    private readonly role: () => NodeRole,
  ) {}

  async open(plaintext: Uint8Array, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
    if (this.role() !== 'follower') {
      throw Object.assign(new Error('only an authenticated follower may forward an invocation'), {
        code: 'FOLLOWER_ROLE_REQUIRED',
      });
    }
    const authenticated = await this.transport.open(
      {
        path: '/rpc',
        transportRequestId: createFollowerTransportRequestId(),
        plaintext,
      },
      signal,
    );
    return (async function* () {
      let expectedSequence = 0;
      let finalSeen = false;
      for await (const record of authenticated) {
        if (signal.aborted) throw signal.reason;
        if (finalSeen || record.sequence !== expectedSequence) {
          throw Object.assign(new Error('authenticated follower plaintext sequence is invalid'), {
            code: 'FOLLOWER_STREAM_INVALID',
          });
        }
        expectedSequence += 1;
        finalSeen = record.final;
        yield Uint8Array.from(record.plaintext);
      }
      if (!finalSeen) {
        throw Object.assign(new Error('authenticated follower stream ended without final record'), {
          code: 'FOLLOWER_STREAM_INVALID',
        });
      }
    })();
  }
}
