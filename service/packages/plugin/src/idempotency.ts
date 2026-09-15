import type { SandboxToolHandler } from './dispatcher.js';
import { isMutatingFailure } from './mutation.js';

export const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;

interface Entry {
  result: unknown;
  ts: number;
  failed?: boolean;
}

export interface IdempotencyCache {
  /** Run fn unless this requestId already produced a result within the TTL; then replay it. */
  run(requestId: string | undefined, fn: () => unknown | Promise<unknown>): Promise<unknown>;
  size(): number;
}

/**
 * Dedupe write side-effects across retries. The server reuses one requestId for all retries of a
 * logical tool call (our resilience layer retries on transport errors), so a replayed write must
 * not apply twice — it returns the original result instead.
 */
export const createIdempotencyCache = (
  ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS,
  now: () => number = Date.now,
): IdempotencyCache => {
  const map = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<unknown>>();

  const prune = (): void => {
    const cutoff = now() - ttlMs;
    for (const [key, entry] of map) {
      if (entry.ts < cutoff) map.delete(key);
    }
  };

  return {
    async run(requestId, fn) {
      if (requestId === undefined) return fn(); // no key → no dedup
      const hit = map.get(requestId);
      if (hit !== undefined && now() - hit.ts < ttlMs) {
        if (hit.failed) throw hit.result;
        return hit.result;
      }
      const pending = inFlight.get(requestId);
      if (pending !== undefined) return pending;
      // Publish before invoking the handler, including handlers that synchronously re-enter.
      // Pending work never expires: a slow mutation must not execute twice across the TTL.
      const execution = Promise.resolve().then(fn);
      inFlight.set(requestId, execution);
      try {
        const result = await execution;
        map.set(requestId, { result, ts: now() });
        prune();
        return result;
      } catch (error) {
        // A failed write with an observed or uncertain effect is terminal too: never apply its
        // partial effect twice. Pure preflight failures remain retryable within this layer.
        if (isMutatingFailure(error)) {
          map.set(requestId, { result: error, ts: now(), failed: true });
          prune();
        }
        throw error;
      } finally {
        inFlight.delete(requestId);
      }
    },
    size: () => map.size,
  };
};

/**
 * Wrap a write handler so repeated calls carrying the same `requestId` apply the effect once. Calls
 * without a requestId run normally (reads, or writes invoked without idempotency).
 */
export const idempotent =
  (cache: IdempotencyCache, handler: SandboxToolHandler): SandboxToolHandler =>
  (params, context) => {
    const requestId = context?.requestId ?? (params as { requestId?: unknown } | null)?.requestId;
    return cache.run(typeof requestId === 'string' ? requestId : undefined, () =>
      handler(params, context),
    );
  };
