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

  async open(
    plaintext: Uint8Array,
    signal: AbortSignal,
    cancelPlaintext?: Uint8Array,
  ): Promise<AsyncIterable<Uint8Array>> {
    if (this.role() !== 'follower') {
      throw Object.assign(new Error('only an authenticated follower may forward an invocation'), {
        code: 'FOLLOWER_ROLE_REQUIRED',
      });
    }
    const streamController = new AbortController();
    let cancelFlight: Promise<void> | null = null;
    const abort = (): void => {
      if (cancelPlaintext !== undefined && cancelFlight === null) {
        cancelFlight = this.sendCancel(cancelPlaintext);
      }
      if (!streamController.signal.aborted) {
        streamController.abort(
          signal.reason ?? Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }),
        );
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let authenticated: AsyncIterable<
      import('../security/follower-transport.js').AuthenticatedPlaintextRecord
    >;
    try {
      authenticated = await this.transport.open(
        {
          path: '/rpc',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext,
        },
        streamController.signal,
      );
    } catch (error) {
      signal.removeEventListener('abort', abort);
      await (cancelFlight as Promise<void> | null)?.catch(() => undefined);
      throw error;
    }
    return (async function* () {
      let expectedSequence = 0;
      let finalSeen = false;
      try {
        for await (const record of authenticated) {
          if (streamController.signal.aborted) throw streamController.signal.reason;
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
          throw Object.assign(
            new Error('authenticated follower stream ended without final record'),
            {
              code: 'FOLLOWER_STREAM_INVALID',
            },
          );
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await (cancelFlight as Promise<void> | null)?.catch(() => undefined);
      }
    })();
  }

  private async sendCancel(plaintext: Uint8Array): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        Object.assign(new Error('authenticated follower cancel timed out'), {
          code: 'FOLLOWER_CANCEL_TIMEOUT',
        }),
      );
    }, 5_000);
    timer.unref();
    try {
      const response = await this.transport.open(
        {
          path: '/rpc',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext,
        },
        controller.signal,
      );
      let finalSeen = false;
      for await (const record of response) {
        if (finalSeen || record.sequence !== 0 || !record.final) {
          throw Object.assign(new Error('authenticated follower cancel response is invalid'), {
            code: 'FOLLOWER_STREAM_INVALID',
          });
        }
        finalSeen = true;
      }
      if (!finalSeen) {
        throw Object.assign(new Error('authenticated follower cancel response is missing'), {
          code: 'FOLLOWER_STREAM_INVALID',
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
