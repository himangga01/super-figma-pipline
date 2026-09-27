import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, win32 } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AtomicFileStore,
  acquireWindowsDirectoryLease,
  windowsDirectoryLeaseInvocation,
  withRetainedDirectoryChain,
} from '../../src/fs/atomic-file.js';
import {
  DirectoryLeaseBroker,
  DirectoryLeaseBrokerPool,
  directoryLeaseTarget,
  encodeDirectoryLeasePath,
} from '../../src/fs/windows-directory-lease-broker.js';

const READY = 'READY windows-directory-lease-v2';
const children: ChildProcessWithoutNullStreams[] = [];
const temporaryRoots: string[] = [];
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
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const childScript = String.raw`
  const readline = require('node:readline');
  const { appendFileSync } = require('node:fs');
  const { createHash } = require('node:crypto');
  const mode = process.env.SFP_BROKER_MODE;
  const record = process.env.SFP_BROKER_RECORD;
  const input = readline.createInterface({ input: process.stdin });
  const handles = new Set();
  let acquireCount = 0;
  const respond = value => process.stdout.write(JSON.stringify(value) + '\n');
  if (mode === 'stubborn') {
    setInterval(() => {}, 1000);
    process.on('SIGTERM', () => {});
  }
  const startup = () => {
    if (mode === 'restricted-language') {
      process.stdout.write('RESTRICTED language-mode ConstrainedLanguage\r\n');
      process.exit(3);
    }
    if (mode === 'restricted-add-type') {
      const reason = Buffer.from('컴파일러 실행이 차단되었습니다', 'utf16le').toString('base64');
      process.stdout.write('RESTRICTED add-type ' + reason + '\n');
      process.exit(4);
    }
    if (mode === 'amsi-blocked') {
      process.stderr.write(Buffer.concat([
        Buffer.from('#< CLIXML\r\n<Objs><S S="Error">'),
        Buffer.from([0xbe, 0xc7, 0xbc, 0xba]),
        Buffer.from(' blocked_x000D__x000A_</S><S S="Error">+ FullyQualifiedErrorId : ScriptContainedMaliciousContent_x000D__x000A_</S></Objs>'),
      ]));
      process.exit(1);
    }
    if (mode === 'startup-stderr-exit') {
      process.stderr.write(Buffer.concat([Buffer.from([0xc0, 0xdf, 0xb8, 0xf8]), Buffer.from(' startup-diagnostic '), Buffer.alloc(6000, 0x41)]));
      process.exit(1);
    }
    process.stdout.write(${JSON.stringify(READY)} + '\n');
  };
  if (mode === 'slow-ready') setTimeout(startup, 300);
  else startup();
  input.on('line', line => {
    if (Buffer.byteLength(line, 'utf8') !== line.length || /[^\x20-\x7e]/.test(line)) {
      process.stderr.write('non-ASCII request line\n');
      process.exit(9);
    }
    const command = JSON.parse(line);
    if (typeof command.id !== 'string' || !/^[0-9a-f]{32}$/.test(command.id)) process.exit(10);
    if (command.action === 'acquire') {
      acquireCount += 1;
      if (typeof command.pathUtf16B64 !== 'string' || 'path' in command) process.exit(11);
      const bytes = Buffer.from(command.pathUtf16B64, 'base64');
      if (record) appendFileSync(record, JSON.stringify(bytes.toString('base64')) + '\n');
      const pathSha256 = createHash('sha256').update(bytes).digest('hex');
      if (mode === 'acquire-failure-once' && acquireCount === 1) {
        respond({ id: command.id, ok: false, error: 'path unavailable' });
        return;
      }
      if (mode === 'late') {
        setTimeout(() => {
          handles.add(command.id);
          respond({ id: command.id, ok: true, identity: '1:2', pathSha256 });
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
      if (mode === 'non-ascii-response') {
        process.stdout.write(JSON.stringify({ id: command.id, ok: false, error: '경로 오류' }) + '\n');
        return;
      }
      handles.add(command.id);
      respond({
        id: command.id,
        ok: true,
        identity: '1:2',
        pathSha256: mode === 'echo-mismatch' ? '0'.repeat(64) : pathSha256,
      });
      return;
    }
    if (command.action === 'release') {
      if (mode === 'release-failure') {
        respond({ id: command.id, ok: false, error: 'release failed' });
        return;
      }
      handles.delete(command.id);
      respond({ id: command.id, ok: true });
    }
  });
`;

const spawnBroker = (mode: string, environment: Record<string, string> = {}) => {
  const child = spawn(process.execPath, ['-e', childScript], {
    env: { ...process.env, SFP_BROKER_MODE: mode, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  return child;
};

const start = (
  mode: string,
  overrides: Record<string, number> = {},
  environment: Record<string, string> = {},
) =>
  DirectoryLeaseBroker.start({
    spawnChild: () => spawnBroker(mode, environment),
    requestTimeoutMs: 250,
    startupTimeoutMs: 10_000,
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
      pathUtf16B64?: string;
    };
    setImmediate(() => {
      stdout.write(
        `${JSON.stringify({
          id: command.id,
          ok: true,
          ...(command.action === 'acquire'
            ? {
                identity: '1:2',
                pathSha256: sha256(Buffer.from(command.pathUtf16B64 ?? '', 'base64')),
              }
            : {}),
        })}\n`,
      );
      callback?.();
    });
    return true;
  }) as typeof stdin.write;
  stdin.end = (() => stdin) as typeof stdin.end;
  if (emitReady) setImmediate(() => stdout.write(`${READY}\n`));
  return child;
};

const decodeTarget = (encoded: string): string =>
  Buffer.from(encoded, 'base64').toString('utf16le');

describe('Windows directory lease protocol v2 path codec', () => {
  it.each([
    [
      'a drive path with Korean segments',
      'C:\\Users\\강지혜\\AppData\\Local',
      '\\\\?\\C:\\Users\\강지혜\\AppData\\Local',
    ],
    [
      'forward slashes and dot segments',
      'C:/Users/owner/../강지혜/./state/',
      '\\\\?\\C:\\Users\\강지혜\\state',
    ],
    ['a UNC share path', '\\\\server\\share\\상태\\dir', '\\\\?\\UNC\\server\\share\\상태\\dir'],
    ['a forward-slash UNC path', '//server/share/dir', '\\\\?\\UNC\\server\\share\\dir'],
    ['an extended-length drive path', '\\\\?\\C:\\already\\x', '\\\\?\\C:\\already\\x'],
    ['an extended-length UNC path', '\\\\?\\UNC\\server\\share\\x', '\\\\?\\UNC\\server\\share\\x'],
  ])('maps %s to the extended-length target', (_label, input, expected) => {
    expect(directoryLeaseTarget(input)).toBe(expected);
  });

  it('keeps surrogate pairs as exact UTF-16 code units and emits an ASCII-only encoding', () => {
    const target = directoryLeaseTarget('C:\\state\\emoji-\u{1F600}-\u{20BB7}');
    const encoded = encodeDirectoryLeasePath(target);
    expect(target).toBe('\\\\?\\C:\\state\\emoji-\u{1F600}-\u{20BB7}');
    expect(encoded.pathUtf16B64).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    expect(decodeTarget(encoded.pathUtf16B64)).toBe(target);
    expect(Buffer.from(encoded.pathUtf16B64, 'base64')).toEqual(Buffer.from(target, 'utf16le'));
    expect(encoded.pathSha256).toBe(sha256(Buffer.from(target, 'utf16le')));
  });

  it('does not normalize NFD names', () => {
    const nfd = 'C:\\state\\Cafe\u0301-\u1100\u1161';
    const target = directoryLeaseTarget(nfd);
    const decoded = decodeTarget(encodeDirectoryLeasePath(target).pathUtf16B64);
    expect(decoded).toBe(`\\\\?\\${nfd}`);
    expect(decoded).not.toBe(decoded.normalize('NFC'));
  });

  it('encodes paths longer than 300 characters without truncation', () => {
    let path = 'C:\\state';
    while (path.length <= 300) path = win32.join(path, '긴-경로-segment-0123456789');
    const target = directoryLeaseTarget(path);
    const encoded = encodeDirectoryLeasePath(target);
    expect(target).toBe(`\\\\?\\${path}`);
    expect(decodeTarget(encoded.pathUtf16B64)).toBe(target);
    expect(encoded.pathSha256).toBe(sha256(Buffer.from(target, 'utf16le')));
  });

  it.each([
    ['empty', ''],
    ['NUL', 'C:\\state\u0000\\x'],
    ['over the Windows path limit', `C:\\${'x'.repeat(32_767)}`],
  ])('rejects an %s path before it reaches the broker', (_label, path) => {
    expect(() => encodeDirectoryLeasePath(directoryLeaseTarget(path))).toThrowError(
      expect.objectContaining({ code: 'DIRECTORY_LEASE_PATH_INVALID' }),
    );
  });

  it('sends only ASCII request lines and the exact extended-length target bytes', async () => {
    const recordRoot = await temporaryRoot('sfp-lease-record-');
    const recordPath = join(recordRoot, 'requests.jsonl');
    await writeFile(recordPath, '');
    const broker = await start('normal', {}, { SFP_BROKER_RECORD: recordPath });
    let long = 'C:\\state';
    while (long.length <= 300) long = win32.join(long, '강지혜-0123456789');
    const inputs = [
      'C:\\Users\\강지혜\\AppData\\Local',
      'C:\\state\\Cafe\u0301',
      'C:\\state\\\u{1F600}',
      '\\\\server\\share\\상태',
      long,
    ];
    for (const input of inputs) {
      const lease = await broker.acquire(input);
      expect(lease.identity).toBe('1:2');
      await lease.release();
    }
    const recorded = (await readFile(recordPath, 'utf8'))
      .trim()
      .split('\n')
      .map(line => decodeTarget(JSON.parse(line) as string));
    expect(recorded).toEqual(inputs.map(input => directoryLeaseTarget(input)));
    await broker.close();
  });
});

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

  it('closes the broker with a typed error when the path echo does not match', async () => {
    const broker = await start('echo-mismatch');
    const child = children.at(-1)!;

    await expect(broker.acquire('C:\\Users\\강지혜')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_ECHO_MISMATCH',
    });
    await broker.waitForClosed();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('replaces a broker closed by an echo mismatch on the next pool acquire', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return start(spawns === 1 ? 'echo-mismatch' : 'normal');
    });
    await expect(pool.acquire('C:\\state\\강지혜')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_ECHO_MISMATCH',
    });
    const lease = await pool.acquire('C:\\state\\강지혜');
    expect(spawns).toBe(2);
    await lease.release();
    await pool.close();
  });

  it('rejects non-ASCII broker output as a protocol failure', async () => {
    const broker = await start('non-ascii-response');
    await expect(broker.acquire('C:\\state')).rejects.toMatchObject({
      code: 'DIRECTORY_LEASE_PROTOCOL_INVALID',
    });
    await broker.waitForClosed();
  });

  it.each([
    ['restricted-language', /ConstrainedLanguage/u],
    ['restricted-add-type', /컴파일러 실행이 차단되었습니다/u],
    ['amsi-blocked', /antivirus|AMSI/iu],
  ])(
    'reports a %s host as HOST_POWERSHELL_RESTRICTED instead of starting',
    async (mode, reason) => {
      let spawns = 0;
      const pool = new DirectoryLeaseBrokerPool(async () => {
        spawns += 1;
        return start(mode);
      });
      const failure = await pool.acquire('C:\\state').catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'HOST_POWERSHELL_RESTRICTED' });
      expect((failure as Error).message).toMatch(reason);
      expect(spawns).toBe(1);
      await pool.close();
    },
  );

  it('keeps the first 4 KiB of startup stderr in the failure', async () => {
    const failure = (await start('startup-stderr-exit', { maxStderrBytes: 65_536 }).catch(
      (error: unknown) => error,
    )) as Error & { code?: string; stderr?: string; stderrBase64?: string; stderrBytes?: number };
    expect(failure.code).toBe('DIRECTORY_LEASE_PROTOCOL_INVALID');
    expect(failure.message).toContain('startup-diagnostic');
    expect(failure.stderr).toContain('startup-diagnostic');
    expect(failure.stderrBytes).toBe(4 + ' startup-diagnostic '.length + 6000);
    const retained = Buffer.from(failure.stderrBase64 ?? '', 'base64');
    expect(retained).toHaveLength(4096);
    expect([...retained.subarray(0, 4)]).toEqual([0xc0, 0xdf, 0xb8, 0xf8]);
  });

  it('uses the startup budget for READY and the request budget for requests', async () => {
    const broker = await start('slow-ready', { requestTimeoutMs: 100, startupTimeoutMs: 5_000 });
    const lease = await broker.acquire('C:\\state');
    await lease.release();
    await broker.close();
    await expect(
      start('slow-ready', { requestTimeoutMs: 5_000, startupTimeoutMs: 50 }),
    ).rejects.toMatchObject({ code: 'DIRECTORY_LEASE_TIMEOUT' });
  });

  it('retires an idle broker after its idle budget but never while a lease is held', async () => {
    const spawned: ChildProcessWithoutNullStreams[] = [];
    const pool = new DirectoryLeaseBrokerPool(
      async () => {
        const broker = await start('normal');
        spawned.push(children.at(-1)!);
        return broker;
      },
      { idleRetirementMs: 60 },
    );
    const held = await pool.acquire('C:\\held');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(spawned[0]!.exitCode).toBeNull();
    await held.release();
    await Promise.race([
      once(spawned[0]!, 'exit'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('idle broker was not retired')), 2_000),
      ),
    ]);
    const next = await pool.acquire('C:\\next');
    expect(spawned).toHaveLength(2);
    await next.release();
    await pool.close();
  });

  it('recycles an idle broker before its lifetime stdout budget can fail a lease', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return start('normal', { maxStdoutBytes: 1_000 });
    });
    for (let index = 0; index < 12; index += 1) {
      const lease = await pool.acquire(`C:\\state\\${index}`);
      await lease.release();
    }
    expect(spawns).toBeGreaterThan(1);
    await pool.close();
  });

  it('does not retire an open broker for a locally oversized command', async () => {
    let spawns = 0;
    const pool = new DirectoryLeaseBrokerPool(async () => {
      spawns += 1;
      return start('normal', { maxCommandBytes: 256 });
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
      requestTimeoutMs: 5_000,
      maxLineBytes: 1_024,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 1_024,
      maxCommandBytes: 131_072,
    });
    const lease = await broker.acquire(`C:/${'a'.repeat(30_000)}`);
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

/** Reads newline-delimited responses from a raw real broker child. */
const lineReader = (child: ChildProcessWithoutNullStreams) => {
  let buffer = '';
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter === undefined) lines.push(line);
      else waiter(line);
    }
  });
  return (timeoutMs = 30_000): Promise<string> => {
    const ready = lines.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('broker line timed out')), timeoutMs);
      waiters.push(line => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  };
};

describe.runIf(process.platform === 'win32')('real Windows directory lease broker', () => {
  const koreanFixture = async () => {
    const base = await temporaryRoot('강지혜-');
    const profileLike = join(base, '강지혜', 'AppData', 'Local');
    const nfd = join(base, 'Cafe\u0301-\u1100\u1161');
    const surrogate = join(base, 'emoji-\u{1F600}-\u{20BB7}');
    let long = join(base, '긴경로');
    while (long.length <= 300) long = join(long, '한글-segment-0123456789');
    for (const path of [profileLike, nfd, surrogate, long]) await mkdir(path, { recursive: true });
    return { base, profileLike, nfd, surrogate, long };
  };

  it('acquires and releases Korean, NFD, surrogate and over-260-character directories', async () => {
    const fixture = await koreanFixture();
    expect(fixture.long.length).toBeGreaterThan(300);
    for (const path of [
      fixture.base,
      fixture.profileLike,
      fixture.nfd,
      fixture.surrogate,
      fixture.long,
    ]) {
      const lease = await acquireWindowsDirectoryLease(path);
      const identity = await lstat(path, { bigint: true });
      expect({ path, dev: lease.identity.dev, ino: lease.identity.ino }).toEqual({
        path,
        dev: identity.dev,
        ino: identity.ino,
      });
      await lease.release();
    }
  }, 120_000);

  it('publishes through a retained Korean directory chain end to end', async () => {
    const fixture = await koreanFixture();
    const target = join(fixture.profileLike, '상태', '기록');
    await withRetainedDirectoryChain(
      fixture.base,
      target,
      async authority => {
        await new AtomicFileStore().createNew(authority.child('결과.json'), Buffer.from('{}'));
      },
      { createMissing: true },
    );
    await expect(readFile(join(target, '결과.json'), 'utf8')).resolves.toBe('{}');
  }, 120_000);

  it('answers a malformed request line with an error and keeps serving the next request', async () => {
    const fixture = await koreanFixture();
    const invocation = windowsDirectoryLeaseInvocation();
    expect(invocation.protocol).toBe('windows-directory-lease-v2');
    const child = spawn(invocation.executable, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    const next = lineReader(child);
    expect(await next()).toBe(READY);

    child.stdin.write('{not-json\n');
    const malformed = JSON.parse(await next()) as { id: string; ok: boolean; error: string };
    expect(malformed).toMatchObject({ id: '', ok: false });
    expect(typeof malformed.error).toBe('string');

    for (const path of [fixture.profileLike, `\\\\?\\${fixture.long}`]) {
      const id = randomUUID().replaceAll('-', '');
      const bytes = Buffer.from(path, 'utf16le');
      child.stdin.write(
        `${JSON.stringify({ action: 'acquire', id, pathUtf16B64: bytes.toString('base64') })}\n`,
      );
      const acquired = JSON.parse(await next()) as Record<string, unknown>;
      expect(acquired).toMatchObject({ id, ok: true, pathSha256: sha256(bytes) });
      expect(acquired.identity).toMatch(/^[0-9]+:[0-9]+$/u);
      child.stdin.write(`${JSON.stringify({ action: 'release', id })}\n`);
      expect(JSON.parse(await next())).toEqual({ id, ok: true });
    }
    child.stdin.end();
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code).toBe(0);
  }, 120_000);

  it('reports constrained language mode as HOST_POWERSHELL_RESTRICTED', async () => {
    const invocation = windowsDirectoryLeaseInvocation();
    const harness =
      '$script=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:SFP_LEASE_SCRIPT_B64));' +
      "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage';" +
      'Invoke-Expression $script';
    const failure = await DirectoryLeaseBroker.start({
      spawnChild: () => {
        const child = spawn(
          invocation.executable,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', harness],
          {
            env: { ...process.env, SFP_LEASE_SCRIPT_B64: invocation.args[4] as string },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        children.push(child);
        return child;
      },
      startupTimeoutMs: 30_000,
      requestTimeoutMs: 5_000,
      maxLineBytes: 16_384,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxCommandBytes: 131_072,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'HOST_POWERSHELL_RESTRICTED' });
    expect((failure as Error).message).toMatch(/ConstrainedLanguage/u);
  }, 120_000);

  it.runIf(process.env.SFP_LEASE_SOAK === '1')(
    'soaks 1,000 sequential leases on a Korean-named directory',
    async () => {
      const fixture = await koreanFixture();
      const expected = await lstat(fixture.profileLike, { bigint: true });
      const warm = await acquireWindowsDirectoryLease(fixture.profileLike);
      await warm.release();
      const started = performance.now();
      for (let index = 0; index < 1_000; index += 1) {
        const lease = await acquireWindowsDirectoryLease(fixture.profileLike);
        if (lease.identity.dev !== expected.dev || lease.identity.ino !== expected.ino) {
          throw new Error(`lease ${index} retained a different identity`);
        }
        await lease.release();
      }
      const elapsedMs = Math.round(performance.now() - started);
      console.log(`[lease soak] 1000 acquire/release cycles in ${elapsedMs} ms`);
      expect(elapsedMs).toBeGreaterThan(0);
    },
    600_000,
  );
});
