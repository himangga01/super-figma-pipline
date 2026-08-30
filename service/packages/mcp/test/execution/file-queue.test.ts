import { describe, expect, it } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('per-file execution queue', () => {
  it('serializes writes targeting two sessions with the same FileExecutionKey', async () => {
    const queue = new FileExecutionQueue();
    const releaseFirst = deferred<void>();
    const events: string[] = [];
    const first = queue.run('figma:file-a', 'file-write', async () => {
      events.push('first-start');
      await releaseFirst.promise;
      events.push('first-end');
    });
    const second = queue.run('figma:file-a', 'file-write', async () => {
      events.push('second-start');
    });
    await Promise.resolve();

    expect(events).toEqual(['first-start']);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('allows reads and operations on different files to proceed concurrently', async () => {
    const queue = new FileExecutionQueue();
    const release = deferred<void>();
    let active = 0;
    let maximum = 0;
    const run = (key: `figma:${string}`, concurrency: 'parallel-read' | 'file-write') =>
      queue.run(key, concurrency, async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await release.promise;
        active -= 1;
      });
    const operations = [
      run('figma:file-a', 'parallel-read'),
      run('figma:file-a', 'parallel-read'),
      run('figma:file-b', 'file-write'),
    ];
    await Promise.resolve();
    expect(maximum).toBe(3);
    release.resolve();
    await Promise.all(operations);
  });

  it('continues the queue after a failed operation', async () => {
    const queue = new FileExecutionQueue();
    await expect(
      queue.run('figma:file-a', 'file-write', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(queue.run('figma:file-a', 'file-write', async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });

  it('turns a synchronous writer throw into rejection and releases the next writer', async () => {
    const queue = new FileExecutionQueue();
    await expect(
      queue.run('figma:file-a', 'file-write', () => {
        throw new Error('sync writer');
      }),
    ).rejects.toThrow('sync writer');
    await expect(queue.run('figma:file-a', 'file-write', async () => 'released')).resolves.toBe(
      'released',
    );
  });

  it('releases a synchronous reader throw so an already queued writer can run', async () => {
    const queue = new FileExecutionQueue();
    const reader = queue.run('figma:file-a', 'parallel-read', () => {
      throw new Error('sync reader');
    });
    const writer = queue.run('figma:file-a', 'file-write', async () => 'writer-ran');

    await expect(reader).rejects.toThrow('sync reader');
    await expect(writer).resolves.toBe('writer-ran');
  });
});
