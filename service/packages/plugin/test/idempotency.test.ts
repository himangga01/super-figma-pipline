import { describe, expect, it, vi } from 'vitest';

import type { SandboxExecutionContext } from '../src/dispatcher.js';
import { createIdempotencyCache, idempotent } from '../src/idempotency.js';

describe('createIdempotencyCache', () => {
  it('shares pending writes even when they run past the cache TTL', async () => {
    let clock = 0;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    const cache = createIdempotencyCache(100, () => clock);
    const apply = vi.fn<() => Promise<string>>(async () => {
      await gate;
      return 'created-once';
    });
    const first = cache.run('concurrent', apply);
    await Promise.resolve();
    clock = 101;
    const second = cache.run('concurrent', apply);
    finish();
    expect(await Promise.all([first, second])).toEqual(['created-once', 'created-once']);
    expect(apply).toHaveBeenCalledOnce();
    expect(await cache.run('concurrent', apply)).toBe('created-once');
    expect(apply).toHaveBeenCalledOnce();
  });

  it('settles concurrent failures together and releases the pending slot', async () => {
    const cache = createIdempotencyCache();
    const failure = new Error('failed');
    const apply = vi.fn<() => Promise<never>>(async () => {
      throw failure;
    });
    const outcomes = await Promise.allSettled([
      cache.run('failed', apply),
      cache.run('failed', apply),
    ]);
    expect(outcomes).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(apply).toHaveBeenCalledOnce();
    expect(cache.size()).toBe(0);
    expect(await cache.run('failed', async () => 'retry')).toBe('retry');
  });
  it('runs once per requestId and replays the cached result', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<{ token: number }>>(async () => ({ token: Math.random() }));
    const first = await cache.run('req-1', fn);
    const second = await cache.run('req-1', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('runs separately for different requestIds', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run('a', fn);
    await cache.run('b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never dedupes when requestId is undefined', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run(undefined, fn);
    await cache.run(undefined, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('re-runs after the TTL expires and prunes stale entries', async () => {
    let clock = 1000;
    const cache = createIdempotencyCache(100, () => clock);
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run('x', fn);
    clock += 50;
    await cache.run('x', fn); // within TTL → cached
    expect(fn).toHaveBeenCalledTimes(1);
    clock += 100; // past TTL
    await cache.run('x', fn); // expired → re-run
    expect(fn).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
  });
});

describe('idempotent wrapper', () => {
  it('deduplicates the bound execution identity when params contain no requestId', async () => {
    const applied = vi.fn<() => Promise<string>>(async () => 'one mutation');
    const handler = idempotent(createIdempotencyCache(), applied);
    const context: SandboxExecutionContext = {
      requestId: 'authenticated-request',
      signal: new AbortController().signal,
      report: () => undefined,
    };
    await Promise.all([handler({ nodeId: '1:2' }, context), handler({ nodeId: '1:2' }, context)]);
    expect(applied).toHaveBeenCalledOnce();
    await handler({ requestId: 'untrusted-override' }, context);
    expect(applied).toHaveBeenCalledOnce();
  });
  it('applies a write once across 5 repeated calls with the same requestId', async () => {
    const cache = createIdempotencyCache();
    const applied = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    const handler = idempotent(cache, applied);
    const results: unknown[] = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design (simulating retries)
      results.push(await handler({ requestId: 'w-1', nodeId: '1:2' }));
    }
    expect(applied).toHaveBeenCalledTimes(1);
    expect(results.every(r => r === results[0])).toBe(true);
  });

  it('runs every call when no requestId is present', async () => {
    const cache = createIdempotencyCache();
    const applied = vi.fn<() => Promise<number>>(async () => 1);
    const handler = idempotent(cache, applied);
    await handler({ nodeId: '1:2' });
    await handler({ nodeId: '1:2' });
    expect(applied).toHaveBeenCalledTimes(2);
  });

  it('forwards the exact execution context through a wrapped write and replay never reinvokes it', async () => {
    const cache = createIdempotencyCache();
    const context: SandboxExecutionContext = {
      signal: new AbortController().signal,
      report: () => undefined,
    };
    const observed: Array<SandboxExecutionContext | undefined> = [];
    const handler = idempotent(cache, async (_params, received) => {
      observed.push(received);
      return { ok: true };
    });

    await handler({ requestId: 'ctx-1' }, context);
    await handler({ requestId: 'ctx-1' }, context);

    expect(observed).toEqual([context]);
  });
});
