import {
  BoundedInvocationFrameSink,
  BoundedInvocationFrameChannel,
  INVOCATION_ADMISSION_LIMITS,
  OperationProgressBroadcaster,
  OperationProgressRegistry,
  PROGRESS_TRANSPORT_LIMITS,
  type InvocationFrameV1,
} from '@sfp/shared';
import { describe, expect, it } from 'vitest';

const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
const operationId = 'operation-1';
const progress = (completed: number, phase = 'export'): InvocationFrameV1 => ({
  version: 1,
  type: 'progress',
  requestId,
  operationId,
  progress: {
    operationId,
    phase,
    completed,
    total: 100,
    message: `step ${completed}`,
    emittedAt: completed,
  },
});

describe('bounded invocation progress transport', () => {
  it('never buffers above the frame/byte cap and delivers the terminal outside that queue', async () => {
    const delivered: InvocationFrameV1[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let first = true;
    const sink = new BoundedInvocationFrameSink(async frame => {
      if (first) {
        first = false;
        await gate;
      }
      delivered.push(frame);
    });

    const writes = Array.from({ length: 80 }, (_, index) => sink.emit(progress(index)));
    const terminal = sink.emit({
      version: 1,
      type: 'result',
      requestId,
      operationId,
      result: { ok: true },
    });
    expect(sink.bufferedFrames).toBeLessThanOrEqual(PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames);
    expect(sink.bufferedBytes).toBeLessThanOrEqual(PROGRESS_TRANSPORT_LIMITS.maxSubscriberBytes);
    release();
    await Promise.all([...writes, terminal]);

    expect(delivered.at(-1)).toMatchObject({ type: 'result' });
    expect(delivered.filter(frame => frame.type === 'result')).toHaveLength(1);
  });

  it('coalesces the 21st same-phase progress update in one half-open second', async () => {
    const delivered: InvocationFrameV1[] = [];
    const sink = new BoundedInvocationFrameSink(
      async frame => {
        delivered.push(frame);
      },
      { now: () => 100 },
    );
    await Promise.all(Array.from({ length: 21 }, (_, index) => sink.emit(progress(index))));
    await sink.flush();

    expect(delivered.filter(frame => frame.type === 'progress').length).toBeLessThanOrEqual(20);
    expect(sink.coalescedProgress).toBeGreaterThanOrEqual(1);
  });

  it('rejects phase/message boundaries above their inclusive limits', async () => {
    const sink = new BoundedInvocationFrameSink(async () => undefined);
    await expect(sink.emit(progress(1, 'a'.repeat(65)))).rejects.toMatchObject({
      code: 'PROGRESS_INVALID',
    });
    await expect(
      sink.emit(
        (() => {
          const base = progress(1);
          if (base.type !== 'progress') throw new Error('progress fixture expected');
          return { ...base, progress: { ...base.progress, message: '한'.repeat(342) } };
        })(),
      ),
    ).rejects.toMatchObject({ code: 'PROGRESS_INVALID' });
  });

  it('fans one operation stream to MCP, follower, and control with one reserved terminal', async () => {
    const mcp: InvocationFrameV1[] = [];
    const follower: InvocationFrameV1[] = [];
    const control: InvocationFrameV1[] = [];
    const broadcaster = new OperationProgressBroadcaster({ requestId, operationId });
    broadcaster.subscribe('mcp', async frame => {
      mcp.push(frame);
    });
    broadcaster.subscribe('follower', async frame => {
      follower.push(frame);
    });
    broadcaster.subscribe('control', async frame => {
      control.push(frame);
    });
    for (let index = 0; index < 21; index += 1) {
      broadcaster.reporter.report({
        phase: 'render',
        completed: index,
        total: 21,
        message: `step ${index}`,
      });
    }
    await broadcaster.terminal({
      version: 1,
      type: 'result',
      requestId,
      operationId,
      result: { ok: true },
    });

    expect([mcp, follower, control].map(frames => frames.at(-1)?.type)).toEqual([
      'result',
      'result',
      'result',
    ]);
    expect(mcp).toEqual(follower);
    expect(follower).toEqual(control);
    await expect(
      broadcaster.terminal({
        version: 1,
        type: 'error',
        requestId,
        operationId,
        error: { code: 'LATE', message: 'late', retryable: false },
      }),
    ).rejects.toMatchObject({ code: 'TERMINAL_ALREADY_SETTLED' });
  });

  it('shares one bounded operation broadcaster across entries and caps slow subscribers', async () => {
    const registry = new OperationProgressRegistry();
    const first = registry.acquire({ ownerId: 'owner-1', requestId, operationId });
    const follower = registry.acquire({ ownerId: 'owner-1', requestId, operationId });
    expect(follower.broadcaster).toBe(first.broadcaster);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const delivered: InvocationFrameV1[][] = Array.from({ length: 8 }, () => []);
    for (const [index, frames] of delivered.entries()) {
      first.broadcaster.subscribe(`subscriber-${index}`, async frame => {
        await gate;
        frames.push(frame);
      });
    }
    expect(() =>
      first.broadcaster.subscribe('subscriber-over-cap', async () => undefined),
    ).toThrowError(expect.objectContaining({ code: 'SERVER_BUSY' }));
    for (let index = 0; index < 10_000; index += 1) {
      first.broadcaster.reporter.report({
        phase: 'render',
        completed: index,
        total: 10_000,
        message: `step ${index}`,
      });
    }
    expect(first.broadcaster.bufferedFrames).toBeLessThanOrEqual(
      PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames,
    );
    release();
    await first.broadcaster.terminal({
      version: 1,
      type: 'result',
      requestId,
      operationId,
      result: { ok: true },
    });
    expect(delivered.every(frames => frames.at(-1)?.type === 'result')).toBe(true);
    first.producerSettled();
    first.terminalSettled();
    first.release();
    follower.release();
    expect(registry.size).toBe(0);
  });

  it('keeps a slow consumer channel within exact frame/byte caps and reserves terminal delivery', async () => {
    const channel = new BoundedInvocationFrameChannel();
    const writes = Array.from(
      { length: PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames },
      (_, index) => channel.write(progress(index, `phase-${index}`)),
    );
    expect(channel.bufferedFrames).toBe(PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames);
    expect(channel.bufferedBytes).toBeLessThanOrEqual(PROGRESS_TRANSPORT_LIMITS.maxSubscriberBytes);
    const terminalWrite = channel.write({
      version: 1,
      type: 'result',
      requestId,
      operationId,
      result: { ok: true },
    });
    const drained: InvocationFrameV1[] = [];
    while (drained.at(-1)?.type !== 'result') drained.push(await channel.next());
    await Promise.all([...writes, terminalWrite]);
    expect(drained.at(-1)?.type).toBe('result');
    expect(channel.bufferedFrames).toBe(0);
  });

  it('enforces the owner-wide subscriber cap across distinct operations', () => {
    const registry = new OperationProgressRegistry();
    const handles = Array.from(
      { length: INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOwner },
      (_, index) =>
        registry.acquire({
          ownerId: 'owner-cap',
          requestId,
          operationId: `operation-owner-${index}`,
        }),
    );
    expect(() =>
      registry.acquire({
        ownerId: 'owner-cap',
        requestId,
        operationId: 'operation-owner-over',
      }),
    ).toThrowError(expect.objectContaining({ code: 'SERVER_BUSY' }));
    for (const handle of handles) handle.release();
  });

  it('enforces an exact byte cap on progress buffered before acceptance', () => {
    const broadcaster = new OperationProgressBroadcaster({ requestId, operationId });
    for (let index = 0; index < PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames; index += 1) {
      broadcaster.reporter.report({
        phase: `phase-${index}`,
        completed: index,
        total: PROGRESS_TRANSPORT_LIMITS.maxSubscriberFrames,
        message: 'x'.repeat(PROGRESS_TRANSPORT_LIMITS.maxMessageUtf8Bytes),
      });
    }

    expect(broadcaster.preAcceptedBufferedBytes).toBeGreaterThan(0);
    expect(broadcaster.preAcceptedBufferedBytes).toBeLessThanOrEqual(65_536);
  });

  it('fails queued writes and the reserved terminal when a consumer disconnects', async () => {
    const channel = new BoundedInvocationFrameChannel();
    const outcomes: string[] = [];
    const observe = (promise: Promise<void>, label: string): void => {
      void promise.then(
        () => outcomes.push(`${label}:resolved`),
        () => outcomes.push(`${label}:rejected`),
      );
    };
    observe(channel.write(progress(1)), 'progress');
    observe(
      channel.write({
        version: 1,
        type: 'result',
        requestId,
        operationId,
        result: { ok: true },
      }),
      'terminal',
    );

    channel.fail(Object.assign(new Error('subscriber disconnected'), { code: 'DISCONNECTED' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(outcomes.toSorted()).toEqual(['progress:rejected', 'terminal:rejected']);
    expect(channel.bufferedFrames).toBe(0);
    expect(channel.bufferedBytes).toBe(0);
    await expect(channel.write(progress(2))).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('retains a disconnected operation until producer and terminal ownership both settle', () => {
    const registry = new OperationProgressRegistry();
    const handle = registry.acquire({ ownerId: 'owner-lifecycle', requestId, operationId });
    expect(handle.isProducer).toBe(true);
    handle.release();
    expect(registry.size).toBe(1);
    handle.producerSettled();
    expect(registry.size).toBe(1);
    handle.terminalSettled();
    expect(registry.size).toBe(0);
  });

  it('bounds repeated disconnected producers by the owner operation cap and releases all state', () => {
    const registry = new OperationProgressRegistry();
    const handles = Array.from(
      { length: INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner },
      (_, index) =>
        registry.acquire({
          ownerId: 'owner-disconnected-producers',
          requestId,
          operationId: `operation-disconnected-${index}`,
        }),
    );
    for (const handle of handles) {
      handle.broadcaster.reporter.report({
        phase: 'retained',
        completed: 0,
        total: null,
        message: 'x'.repeat(PROGRESS_TRANSPORT_LIMITS.maxMessageUtf8Bytes),
      });
      handle.release();
    }
    expect(registry.size).toBe(INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner);
    expect(
      handles.reduce((bytes, handle) => bytes + handle.broadcaster.preAcceptedBufferedBytes, 0),
    ).toBeLessThanOrEqual(INVOCATION_ADMISSION_LIMITS.maxActiveOperationsPerOwner * 65_536);
    expect(() =>
      registry.acquire({
        ownerId: 'owner-disconnected-producers',
        requestId,
        operationId: 'operation-disconnected-over-cap',
      }),
    ).toThrowError(expect.objectContaining({ code: 'SERVER_BUSY' }));
    for (const handle of handles) {
      handle.producerSettled();
      handle.terminalSettled();
    }
    expect(registry.size).toBe(0);
  });

  it('rejects the ninth registry subscriber before it can retain operation ownership', () => {
    const registry = new OperationProgressRegistry();
    const handles = Array.from(
      { length: INVOCATION_ADMISSION_LIMITS.maxSubscribersPerOperation },
      () =>
        registry.acquire({
          ownerId: 'owner-operation-subscriber-cap',
          requestId,
          operationId: 'operation-subscriber-cap',
        }),
    );
    expect(() =>
      registry.acquire({
        ownerId: 'owner-operation-subscriber-cap',
        requestId,
        operationId: 'operation-subscriber-cap',
      }),
    ).toThrowError(expect.objectContaining({ code: 'SERVER_BUSY' }));
    for (const handle of handles) handle.release();
    handles[0]!.producerSettled();
    handles[0]!.terminalSettled();
    expect(registry.size).toBe(0);
  });
});
