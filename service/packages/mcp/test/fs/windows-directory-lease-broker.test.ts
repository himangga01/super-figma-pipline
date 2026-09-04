import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DirectoryLeaseBroker,
  DirectoryLeaseBrokerPool,
} from '../../src/fs/windows-directory-lease-broker.js';

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      child =>
        new Promise<void>(resolve => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.kill();
        }),
    ),
  );
});

const childScript = String.raw`
  const readline = require('node:readline');
  const mode = process.env.SFP_BROKER_MODE;
  const input = readline.createInterface({ input: process.stdin });
  const handles = new Set();
  let acquireCount = 0;
  if (mode === 'stubborn') {
    setInterval(() => {}, 1000);
    process.on('SIGTERM', () => {});
  }
  process.stdout.write('READY\n');
  input.on('line', line => {
    const command = JSON.parse(line);
    if (command.action === 'acquire') {
      acquireCount += 1;
      if (mode === 'acquire-failure-once' && acquireCount === 1) {
        process.stdout.write(JSON.stringify({ id: command.id, ok: false, error: 'path unavailable' }) + '\n');
        return;
      }
      if (mode === 'late') {
        setTimeout(() => {
          handles.add(command.id);
          process.stdout.write(JSON.stringify({ id: command.id, ok: true, identity: '1:2' }) + '\n');
        }, 500);
        return;
      }
      if (mode === 'malformed') {
        process.stdout.write('{not-json\n');
        return;
      }
      if (mode === 'oversized-stdout') {
        process.stdout.write('x'.repeat(2048));
        return;
      }
      if (mode === 'oversized-stderr') {
        process.stderr.write('e'.repeat(2048));
        return;
      }
      handles.add(command.id);
      process.stdout.write(JSON.stringify({ id: command.id, ok: true, identity: '1:2' }) + '\n');
      return;
    }
    if (command.action === 'release') {
      if (mode === 'release-failure') {
        process.stdout.write(JSON.stringify({ id: command.id, ok: false, error: 'release failed' }) + '\n');
        return;
      }
      handles.delete(command.id);
      process.stdout.write(JSON.stringify({ id: command.id, ok: true }) + '\n');
    }
  });
`;

const spawnBroker = (mode: string): ChildProcessWithoutNullStreams => {
  const child = spawn(process.execPath, ['-e', childScript], {
    env: { ...process.env, SFP_BROKER_MODE: mode },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  return child;
};

const start = (mode: string, overrides: Record<string, number> = {}) =>
  DirectoryLeaseBroker.start({
    spawnChild: () => spawnBroker(mode),
    requestTimeoutMs: 250,
    maxLineBytes: 1_024,
    maxStdoutBytes: 4_096,
    maxStderrBytes: 1_024,
    maxCommandBytes: 131_072,
    ...overrides,
  });

const neverExitingBrokerChild = (emitReady = true): ChildProcessWithoutNullStreams => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    unref: () => undefined,
  }) as unknown as ChildProcessWithoutNullStreams;
  stdin.write = ((chunk: Uint8Array, callback?: (error?: Error | null) => void) => {
    const command = JSON.parse(Buffer.from(chunk).toString('utf8')) as {
      id: string;
      action: 'acquire' | 'release';
    };
    setImmediate(() => {
      stdout.write(
        `${JSON.stringify({
          id: command.id,
          ok: true,
          ...(command.action === 'acquire' ? { identity: '1:2' } : {}),
        })}\n`,
      );
      callback?.();
    });
    return true;
  }) as typeof stdin.write;
  stdin.end = (() => stdin) as typeof stdin.end;
  if (emitReady) setImmediate(() => stdout.write('READY\n'));
  return child;
};

describe('bounded Windows directory lease broker protocol', () => {
  it('keeps one healthy broker after a local acquire rejection and reuses it without waiting for close', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return start('acquire-failure-once');
    });

    const first = await Promise.race([
      pool.acquire('C:/missing').then(
        () => ({ code: 'unexpected-success' }),
        error => ({ code: (error as { code?: string }).code }),
      ),
      new Promise<{ code: string }>(resolve =>
        setTimeout(() => resolve({ code: 'TEST_TIMEOUT' }), 250),
      ),
    ]);
    expect(first).toEqual({ code: 'DIRECTORY_LEASE_ACQUIRE_FAILED' });
    const lease = await pool.acquire('C:/workspace');
    expect(lease.identity).toBe('1:2');
    expect(spawns).toBe(1);
    await lease.release();
    await pool.close();
  });

  it('does not retire an open broker for a locally oversized command', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return start('normal', { maxCommandBytes: 128 });
    });
    await expect(pool.acquire(`C:/${'x'.repeat(256)}`)).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_PROTOCOL_INVALID',
    });
    const lease = await pool.acquire('C:/ok');
    expect(spawns).toBe(1);
    await lease.release();
    await pool.close();
  });

  it('rejects pending-cap overflow locally without waiting for the open broker to close', async () => {
    const broker = await start('late', { requestTimeoutMs: 200, maxPending: 1 });
    const pool = new DirectoryLeaseBrokerPool(async () => broker);
    const first = pool.acquire('C:/first').catch(error => error as Error);
    await new Promise(resolve => setImmediate(resolve));
    const second = await Promise.race([
      pool.acquire('C:/second').then(
        () => ({ code: 'unexpected-success' }),
        error => ({ code: (error as { code?: string }).code }),
      ),
      new Promise<{ code: string }>(resolve =>
        setTimeout(() => resolve({ code: 'TEST_TIMEOUT' }), 75),
      ),
    ]);
    expect(second).toEqual({ code: 'DIRECTORY_LEASE_PROTOCOL_INVALID' });
    await first;
    await pool.close();
  });

  it('bounds graceful close and escalates termination for a child that keeps the event loop alive', async () => {
    const broker = await start('stubborn', { shutdownTimeoutMs: 40, forceKillTimeoutMs: 80 });
    const outcome = await Promise.race([
      broker.close().then(() => 'closed'),
      new Promise<'timed-out'>(resolve => setTimeout(() => resolve('timed-out'), 300)),
    ]);
    expect(outcome).toBe('closed');
    await broker.waitForClosed();
  });

  it('fails the pool permanently when forceful child termination cannot be confirmed', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return DirectoryLeaseBroker.start({
        spawnChild: neverExitingBrokerChild,
        requestTimeoutMs: 25,
        shutdownTimeoutMs: 10,
        forceKillTimeoutMs: 10,
        maxLineBytes: 1_024,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 1_024,
        maxCommandBytes: 4_096,
      });
    });
    await pool.acquire('C:/workspace');
    await expect(pool.close()).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED',
    });
    await expect(pool.acquire('C:/must-not-respawn')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED',
    });
    expect(spawns).toBe(1);
  });

  it('does not spawn again after an unconfirmed startup child termination', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return DirectoryLeaseBroker.start({
        spawnChild: () => neverExitingBrokerChild(false),
        requestTimeoutMs: 10,
        shutdownTimeoutMs: 10,
        forceKillTimeoutMs: 10,
        maxLineBytes: 1_024,
        maxStdoutBytes: 4_096,
        maxStderrBytes: 1_024,
        maxCommandBytes: 4_096,
      });
    });
    await expect(pool.acquire('C:/first')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED',
    });
    await expect(pool.acquire('C:/second')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TERMINATION_UNCONFIRMED',
    });
    expect(spawns).toBe(1);
  });

  it('terminates and awaits the child on a late acquire response so no lease can leak', async () => {
    const broker = await start('late');
    const child = children.at(-1)!;

    await expect(broker.acquire('C:/workspace')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TIMEOUT',
    });
    await broker.waitForClosed();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it.each(['malformed', 'oversized-stdout', 'oversized-stderr'])(
    'invalidates and awaits the child for %s output',
    async mode => {
      const broker = await start(mode);
      const child = children.at(-1)!;

      await expect(broker.acquire('C:/workspace')).rejects.toMatchObject({
        code: 'DIRECTORY_LEASE_PROTOCOL_INVALID',
      });
      await broker.waitForClosed();
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    },
  );

  it('awaits stdin backpressure and still completes acquire/release in order', async () => {
    const events: string[] = [];
    const broker = await DirectoryLeaseBroker.start({
      spawnChild: () => {
        const child = spawnBroker('normal');
        const originalWrite = child.stdin.write.bind(child.stdin) as (
          chunk: Uint8Array,
          callback: (error?: Error | null) => void,
        ) => boolean;
        child.stdin.write = ((chunk: Uint8Array, callback: (error?: Error | null) => void) => {
          const accepted = originalWrite(chunk, error => {
            events.push('callback');
            callback(error);
          });
          events.push(`write:${String(accepted)}`);
          if (!accepted) child.stdin.once('drain', () => events.push('drain'));
          return accepted;
        }) as typeof child.stdin.write;
        return child;
      },
      requestTimeoutMs: 75,
      maxLineBytes: 1_024,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 1_024,
      maxCommandBytes: 131_072,
    });
    const lease = await broker.acquire(`C:/${'a'.repeat(65_536)}`);
    events.push('resolved');

    expect(lease.identity).toBe('1:2');
    expect(events).toContain('write:false');
    expect(events.indexOf('drain')).toBeGreaterThan(events.indexOf('write:false'));
    expect(events.indexOf('resolved')).toBeGreaterThan(events.indexOf('drain'));
    expect(events.indexOf('resolved')).toBeGreaterThan(events.indexOf('callback'));
    await lease.release();
    await broker.close();
    await broker.waitForClosed();
  });

  it('invalidates and awaits the child when release is rejected', async () => {
    const broker = await start('release-failure');
    const child = children.at(-1)!;
    const lease = await broker.acquire('C:/workspace');

    await expect(lease.release()).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_RELEASE_FAILED',
    });
    await broker.waitForClosed();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('does not spawn a replacement broker until the failed child has exited', async () => {
    const events: string[] = [];
    let calls = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      calls += 1;
      const broker = await start(calls === 1 ? 'late' : 'normal');
      const child = children.at(-1)!;
      if (calls === 1) child.once('exit', () => events.push('first-exit'));
      else events.push('second-spawn');
      return broker;
    });

    await expect(pool.acquire('C:/first')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_TIMEOUT',
    });
    const second = await pool.acquire('C:/second');
    expect(events).toEqual(['first-exit', 'second-spawn']);
    await second.release();
    await pool.close();
  });
});
