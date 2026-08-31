import { decodeFollowerInnerMessage } from '@sfp/shared';

import type { NodeRole } from '../election/node.js';
import {
  createFollowerTransportRequestId,
  type FollowerTransportClient,
} from '../security/follower-transport.js';

export const FOLLOWER_CANCEL_NOT_ADMITTED = 'FOLLOWER_CANCEL_NOT_ADMITTED';
const FOLLOWER_CANCEL_TIMEOUT_MS = 5_000;
const FOLLOWER_CANCEL_RETRY_DELAY_MS = 25;

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
    const cancelIdentity =
      cancelPlaintext === undefined
        ? null
        : (() => {
            const decoded = decodeFollowerInnerMessage(cancelPlaintext);
            if (decoded.type !== 'cancel') {
              throw Object.assign(new Error('follower cancel request is invalid'), {
                code: 'FOLLOWER_STREAM_INVALID',
              });
            }
            return Object.freeze({
              requestId: decoded.requestId,
              operationId: decoded.operationId,
            });
          })();
    const streamController = new AbortController();
    let cancelFlight: Promise<void> | null = null;
    let abortRequested = signal.aborted;
    let accepted = false;
    const disconnect = (): void => {
      if (!streamController.signal.aborted) {
        streamController.abort(
          signal.reason ?? Object.assign(new Error('MCP request aborted'), { code: 'ABORT_ERR' }),
        );
      }
    };
    const startReconciliation = (disconnectAfterSettlement: boolean): Promise<void> | null => {
      if (!abortRequested || cancelIdentity === null) return null;
      if (cancelFlight === null) {
        cancelFlight = this.reconcileCancel(cancelPlaintext as Uint8Array, cancelIdentity);
      }
      if (disconnectAfterSettlement) void cancelFlight.then(disconnect, disconnect);
      return cancelFlight;
    };
    const startCancel = (): void => {
      if (!abortRequested || !accepted || cancelIdentity === null || cancelFlight !== null) return;
      startReconciliation(true);
    };
    const abort = (): void => {
      abortRequested = true;
      if (cancelIdentity === null) disconnect();
      else startCancel();
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
          if (cancelIdentity !== null) {
            const frame = decodeFollowerInnerMessage(record.plaintext);
            if (
              'requestId' in frame &&
              (frame.requestId !== cancelIdentity.requestId ||
                ('operationId' in frame && frame.operationId !== cancelIdentity.operationId))
            ) {
              throw Object.assign(
                new Error('authenticated follower response identity is invalid'),
                { code: 'FOLLOWER_STREAM_INVALID' },
              );
            }
            if (frame.type === 'accepted') {
              accepted = true;
              startCancel();
            }
          }
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
      } catch (error) {
        if (abortRequested && !accepted && cancelIdentity !== null) {
          await startReconciliation(false);
        }
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
        await (cancelFlight as Promise<void> | null);
      }
    })();
  }

  private async reconcileCancel(
    plaintext: Uint8Array,
    identity: Readonly<{ requestId: string; operationId: string }>,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        Object.assign(new Error('authenticated follower cancel timed out'), {
          code: 'FOLLOWER_CANCEL_TIMEOUT',
        }),
      );
    }, FOLLOWER_CANCEL_TIMEOUT_MS);
    timer.unref();
    try {
      for (;;) {
        let outcome: 'acknowledged' | 'not-admitted';
        try {
          // eslint-disable-next-line no-await-in-loop -- authenticated retries are ordered and bounded
          outcome = await this.sendCancelAttempt(plaintext, identity, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          throw error;
        }
        if (outcome === 'acknowledged') return;
        try {
          // eslint-disable-next-line no-await-in-loop -- each typed rejection gets one bounded delay
          await this.waitForCancelRetry(controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          throw error;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendCancelAttempt(
    plaintext: Uint8Array,
    identity: Readonly<{ requestId: string; operationId: string }>,
    signal: AbortSignal,
  ): Promise<'acknowledged' | 'not-admitted'> {
    const response = await this.transport.open(
      {
        path: '/rpc',
        transportRequestId: createFollowerTransportRequestId(),
        plaintext,
      },
      signal,
    );
    let outcome: 'acknowledged' | 'not-admitted' | null = null;
    for await (const record of response) {
      if (outcome !== null || record.sequence !== 0 || !record.final) {
        throw Object.assign(new Error('authenticated follower cancel response is missing'), {
          code: 'FOLLOWER_STREAM_INVALID',
        });
      }
      const acknowledgement = decodeFollowerInnerMessage(record.plaintext);
      if (
        !('requestId' in acknowledgement) ||
        acknowledgement.requestId !== identity.requestId ||
        !('operationId' in acknowledgement) ||
        acknowledgement.operationId !== identity.operationId
      ) {
        throw Object.assign(new Error('authenticated follower cancel response is invalid'), {
          code: 'FOLLOWER_STREAM_INVALID',
        });
      }
      if (
        acknowledgement.type === 'result' &&
        typeof acknowledgement.result === 'object' &&
        acknowledgement.result !== null &&
        'cancelled' in acknowledgement.result &&
        acknowledgement.result.cancelled === true
      ) {
        outcome = 'acknowledged';
        continue;
      }
      if (
        acknowledgement.type === 'error' &&
        acknowledgement.error.code === FOLLOWER_CANCEL_NOT_ADMITTED &&
        acknowledgement.error.retryable
      ) {
        outcome = 'not-admitted';
        continue;
      }
      if (acknowledgement.type === 'error') {
        throw Object.assign(new Error(acknowledgement.error.message), acknowledgement.error);
      }
      throw Object.assign(new Error('authenticated follower cancel response is invalid'), {
        code: 'FOLLOWER_STREAM_INVALID',
      });
    }
    if (outcome === null) {
      throw Object.assign(new Error('authenticated follower cancel response is missing'), {
        code: 'FOLLOWER_STREAM_INVALID',
      });
    }
    return outcome;
  }

  private waitForCancelRetry(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const retry = setTimeout(() => settle(), FOLLOWER_CANCEL_RETRY_DELAY_MS);
      retry.unref();
      const abort = (): void => settle(signal.reason);
      const settle = (error?: unknown): void => {
        clearTimeout(retry);
        signal.removeEventListener('abort', abort);
        if (error === undefined) resolve();
        else reject(error);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
