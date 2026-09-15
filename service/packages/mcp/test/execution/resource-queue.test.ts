import { describe, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const write = (key: string) => ({ key, mode: 'write' as const });
const read = (key: string) => ({ key, mode: 'read' as const });
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('atomic resource queue', () => {
  it('acquires opposite resource orders without partial grants and lets disjoint work progress', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const events: string[] = [];
    const incumbent = queue.runResources([write('b')], () => release.promise);
    const first = queue.runResources([write('a'), write('b')], async () => {
      events.push('first');
    });
    const second = queue.runResources([write('b'), write('a')], async () => {
      events.push('second');
    });
    await expect(queue.runResources([write('c')], async () => 'independent')).resolves.toBe(
      'independent',
    );
    expect(events).toEqual([]);
    release.resolve();
    await Promise.all([incumbent, first, second]);
    expect(events).toEqual(['first', 'second']);
  });

  it('promotes duplicate mixed modes to write and shares locks with the single-key API', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const active = queue.runResources(
      [read('figma:a'), write('figma:a'), read('figma:a')],
      () => release.promise,
    );
    const later = vi.fn<() => Promise<string>>(async () => 'reader');
    const reader = queue.run('figma:a', 'parallel-read', later);
    await tick();
    expect(later).not.toHaveBeenCalled();
    release.resolve();
    await expect(reader).resolves.toBe('reader');
    await active;
  });

  it('allows simultaneous compatible reads but prevents later reads starving a waiting writer', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const events: string[] = [];
    const first = queue.runResources([read('a')], () => release.promise);
    await expect(queue.runResources([read('a'), read('b')], async () => 'shared')).resolves.toBe(
      'shared',
    );
    const writer = queue.runResources([write('a')], async () => {
      events.push('writer');
    });
    const reader = queue.runResources([read('a')], async () => {
      events.push('reader');
    });
    await tick();
    expect(events).toEqual([]);
    release.resolve();
    await Promise.all([first, writer, reader]);
    expect(events).toEqual(['writer', 'reader']);
  });

  it('preserves conflicting FIFO even when an earlier reader waits for a different resource', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const events: string[] = [];
    const active = queue.runResources([write('b')], () => release.promise);
    const reader = queue.runResources([read('a'), read('b')], async () => {
      events.push('reader');
    });
    const writer = queue.runResources([write('a')], async () => {
      events.push('writer');
    });
    await tick();
    expect(events).toEqual([]);
    release.resolve();
    await Promise.all([active, reader, writer]);
    expect(events).toEqual(['reader', 'writer']);
  });

  it('promptly removes cancelled pending work without holding partial grants or retaining its fairness barrier', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const active = queue.runResources([write('b')], () => release.promise);
    const controller = new AbortController();
    const callback = vi.fn<() => Promise<string>>(async () => 'never');
    const pending = queue.runResources([write('a'), write('b')], callback, controller.signal);

    const following = queue.runResources([write('a')], async () => 'free');
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    await expect(following).resolves.toBe('free');
    expect(callback).not.toHaveBeenCalled();
    release.resolve();
    await active;
    await expect(queue.runResources([write('b'), write('a')], async () => 'reused')).resolves.toBe(
      'reused',
    );
  });

  it('rejects pre-aborted submissions and preserves the signal reason', async () => {
    const queue = new FileExecutionQueue();
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    const callback = vi.fn<() => Promise<void>>(async () => undefined);
    await expect(queue.runResources([write('a')], callback, controller.signal)).rejects.toBe(
      reason,
    );
    expect(callback).not.toHaveBeenCalled();
    await expect(queue.runResources([write('a')], async () => 'free')).resolves.toBe('free');
  });

  it('retains all active grants after abort, including abort before the callback microtask', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const controller = new AbortController();
    const started = vi.fn<() => Promise<void>>(() => release.promise);
    const active = queue.runResources([write('a'), write('b')], started, controller.signal);
    controller.abort();
    const later = vi.fn<() => Promise<string>>(async () => 'later');
    const following = queue.runResources([write('b')], later);
    await tick();
    expect(started).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    release.resolve();
    await expect(active).resolves.toBeUndefined();
    await expect(following).resolves.toBe('later');
  });

  it('releases every resource on synchronous and asynchronous failures', async () => {
    const queue = new FileExecutionQueue();
    for (const callback of [
      () => {
        throw new Error('sync');
      },
      async () => {
        throw new Error('async');
      },
    ]) {
      await expect(queue.runResources([read('a'), write('b')], callback)).rejects.toThrow(
        /sync|async/,
      );
      await expect(
        queue.runResources([write('a'), read('b')], async () => 'released'),
      ).resolves.toBe('released');
    }
  });

  it('copies the resource declaration so caller mutation cannot change pending authority', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const active = queue.runResources([write('a')], () => release.promise);
    const resources = [write('a')];
    const callback = vi.fn<() => Promise<string>>(async () => 'done');
    const pending = queue.runResources(resources, callback);
    resources[0]!.key = 'b';
    resources.length = 0;
    await tick();
    expect(callback).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([active, pending]);
  });

  it('bounds raw resource declarations and rejects invalid keys or modes without reserving grants', async () => {
    const queue = new FileExecutionQueue();
    const callback = vi.fn<() => Promise<string>>(async () => 'done');
    for (const resources of [
      [],
      Array.from({ length: 65 }, () => write('a')),
      [write('')],
      [write('x'.repeat(1025))],
      [{ key: 'a', mode: 'invalid' }],
    ]) {
      // Exercise untrusted callers that bypass the static resource type.
      await expect(
        queue.runResources(resources as Parameters<typeof queue.runResources>[0], callback),
      ).rejects.toThrow(/Execution requests require|Invalid execution resource/);
    }
    expect(callback).not.toHaveBeenCalled();
    await expect(
      queue.runResources(
        Array.from({ length: 64 }, (_, i) => write(`key:${i}`)),
        callback,
      ),
    ).resolves.toBe('done');
  });

  it('detaches cancellation listeners after cancellation, grant, and rejection', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred();
    const active = queue.runResources([write('a')], () => release.promise);
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = queue.runResources([write('a')], async () => undefined, controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(removed).toHaveBeenCalledOnce();
    release.resolve();
    await active;
    for (const fails of [false, true]) {
      const next = new AbortController();
      const nextRemoved = vi.spyOn(next.signal, 'removeEventListener');
      const result = queue.runResources(
        [write('a')],
        async () => {
          if (fails) throw new Error('failed');
        },
        next.signal,
      );
      const outcome = await Promise.allSettled([result]);
      expect(outcome[0]?.status).toBe(fails ? 'rejected' : 'fulfilled');
      expect(nextRemoved).toHaveBeenCalledOnce();
    }
  });
});
