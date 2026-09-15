import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WindowsBoundaryProbePool,
  spawnWindowsBoundaryProbeProcess,
} from '../../src/fs/windows-boundary-probe-worker.js';

const pools: WindowsBoundaryProbePool[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map(pool => pool.close()));
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..')) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

const childScript = String.raw`
  const readline = require('node:readline');
  const mode = process.env.SFP_BOUNDARY_TEST_MODE;
  const input = readline.createInterface({ input: process.stdin });
  process.stdout.write('READY\n');
  input.on('line', line => {
    const request = JSON.parse(line);
    if (mode === 'malformed') return process.stdout.write('{not-json\n');
    if (mode === 'null') return process.stdout.write('null\n');
    if (mode === 'exit') return process.exit(13);
    if (mode === 'hang') return;
    const respond = () => {
      if (mode === 'error') {
        process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: 'path unavailable' }) + '\n');
        return;
      }
      let records = request.paths.map(path => ({
        path, attributes: 16,
        ...(request.kind === 'acl' && mode !== 'missing-sddl' ? { sddl: 'D:P(A;;FA;;;SY)' } : {}),
      }));
      if (mode === 'wrong-count') records.push(records[0]);
      if (mode === 'wrong-path') records[0].path += '-different';
      if (mode === 'oversized-sddl') records[0].sddl = 'x'.repeat(4096);
      process.stdout.write(JSON.stringify({ id: mode === 'wrong-owner' ? 'unowned' : request.id, ok: true, records }) + '\n');
    };
    if (mode === 'slow') setTimeout(respond, 120);
    else respond();
  });
  if (mode === 'delayed-exit') setInterval(() => {}, 1000);
`;

const noReadChildScript = String.raw`
  process.stdout.write('READY\n');
  process.stdin.pause();
  setInterval(() => {}, 1000);
`;

const spawnTestChild = (mode: string): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, ['-e', childScript], {
    env: { ...process.env, SFP_BOUNDARY_TEST_MODE: mode },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

const neverExitingStartupChild = (): ChildProcessWithoutNullStreams => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => true,
    ref: () => undefined,
    unref: () => undefined,
  });
  return child as unknown as ChildProcessWithoutNullStreams;
};

const createPool = (
  spawnChild: () => ChildProcessWithoutNullStreams,
  overrides: ConstructorParameters<typeof WindowsBoundaryProbePool>[0] = {},
): WindowsBoundaryProbePool => {
  const pool = new WindowsBoundaryProbePool({
    spawnChild,
    requestTimeoutMs: 250,
    queueTimeoutMs: 250,
    idleTimeoutMs: 1_000,
    shutdownTimeoutMs: 250,
    forceKillTimeoutMs: 250,
    ...overrides,
  });
  pools.push(pool);
  return pool;
};

describe('bounded persistent Windows boundary probe worker', () => {
  it.runIf(process.platform === 'win32')(
    'loads native ACL commands despite an incompatible inherited module path',
    async () => {
      const container = await mkdtemp(join(tmpdir(), 'sfp-native-acl-module-'));
      temporaryRoots.push(container);
      const module = join(container, 'Microsoft.PowerShell.Security');
      await mkdir(module);
      await writeFile(
        join(module, 'Microsoft.PowerShell.Security.psm1'),
        "function Get-Acl { throw 'incompatible caller module' }; Export-ModuleMember -Function Get-Acl",
        'utf8',
      );
      const original = process.env.PSModulePath;
      const pool = createPool(
        () => {
          process.env.PSModulePath = container;
          try {
            return spawnWindowsBoundaryProbeProcess();
          } finally {
            if (original === undefined) delete process.env.PSModulePath;
            else process.env.PSModulePath = original;
          }
        },
        { requestTimeoutMs: 2_000 },
      );
      const result = await pool.inspectAcl(container);
      expect(result.path).toBe(container);
      expect(result.sddl).toContain('D:');
      expect(process.env.PSModulePath).toBe(original);
    },
  );
  it.runIf(process.platform === 'win32')(
    'reuses one real PowerShell worker while freshly inspecting every request',
    async () => {
      const container = await mkdtemp(join(tmpdir(), 'sfp-boundary-worker-'));
      temporaryRoots.push(container);
      const candidate = join(container, 'candidate');
      const target = join(container, 'target');
      await mkdir(candidate);
      await mkdir(target);
      let spawns = 0;
      const pool = createPool(
        () => {
          spawns += 1;
          return spawnWindowsBoundaryProbeProcess();
        },
        { requestTimeoutMs: 2_000 },
      );

      const ordinary = await pool.inspect([candidate]);
      expect(ordinary).toEqual([{ path: candidate, attributes: expect.any(Number) }]);
      expect(ordinary[0]!.attributes & 0x400).toBe(0);

      await rm(candidate, { recursive: true });
      await symlink(target, candidate, 'junction');
      const replaced = await pool.inspect([candidate]);
      expect(replaced[0]!.attributes & 0x400).toBe(0x400);
      expect(spawns).toBe(1);
    },
  );

  it.runIf(process.platform === 'win32')(
    'shares one worker across fresh boundary and ACL reads after an ACL mutation',
    async () => {
      const container = await mkdtemp(join(tmpdir(), 'sfp-state-worker-'));
      temporaryRoots.push(container);
      let spawns = 0;
      const pool = createPool(
        () => {
          spawns += 1;
          return spawnWindowsBoundaryProbeProcess();
        },
        { requestTimeoutMs: 2_000 },
      );
      const before = await pool.inspectAcl(container);
      expect(before.path).toBe(container);
      expect(typeof before.sddl).toBe('string');
      await new Promise<void>((resolve, reject) => {
        execFile(
          'icacls.exe',
          [container, '/grant', '*S-1-1-0:(R)'],
          { windowsHide: true },
          error => {
            if (error !== null) reject(error);
            else resolve();
          },
        );
      });
      await expect(pool.inspect([container, container])).resolves.toEqual([
        { path: container, attributes: expect.any(Number) },
        { path: container, attributes: expect.any(Number) },
      ]);
      const after = await pool.inspectAcl(container);
      expect(after.sddl).not.toBe(before.sddl);
      expect(after.sddl).toContain('WD');
      expect(spawns).toBe(1);
    },
  );

  it.each(['missing-sddl', 'wrong-count', 'wrong-path', 'wrong-owner', 'oversized-sddl'])(
    'rejects an invalid ACL response (%s) and retires its worker',
    async mode => {
      let spawns = 0;
      const pool = createPool(() => spawnTestChild(++spawns === 1 ? mode : 'normal'), {
        maxLineBytes: 1024,
      });
      await expect(pool.inspectAcl('C:\\state')).rejects.toMatchObject({
        code: 'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
      });
      await expect(pool.inspect(['C:\\state'])).resolves.toEqual([
        { path: 'C:\\state', attributes: 16 },
      ]);
      expect(spawns).toBe(2);
    },
  );

  it('serializes mixed boundary and ACL requests through the same bounded queue', async () => {
    let spawns = 0;
    const pool = createPool(() => {
      spawns += 1;
      return spawnTestChild('normal');
    });
    const results = await Promise.all([
      pool.inspect(['C:\\ancestor', 'C:\\state']),
      pool.inspectAcl('C:\\state'),
      pool.inspect(['C:\\state']),
    ]);
    expect(results[0]).toHaveLength(2);
    expect(results[1]).toEqual({ path: 'C:\\state', attributes: 16, sddl: 'D:P(A;;FA;;;SY)' });
    expect(results[2]).toEqual([{ path: 'C:\\state', attributes: 16 }]);
    expect(spawns).toBe(1);
  });

  it('rejects malformed output, retires the child, and recovers on the next request', async () => {
    let spawns = 0;
    const pool = createPool(() => spawnTestChild(++spawns === 1 ? 'malformed' : 'normal'));

    await expect(pool.inspect(['C:\\first'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
    });
    await expect(pool.inspect(['C:\\second'])).resolves.toEqual([
      { path: 'C:\\second', attributes: 16 },
    ]);
    expect(spawns).toBe(2);
  });

  it('rejects a JSON null response, retires the child, and recovers without an uncaught exception', async () => {
    let spawns = 0;
    const pool = createPool(() => spawnTestChild(++spawns === 1 ? 'null' : 'normal'));

    await expect(pool.inspect(['C:\\first'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_PROTOCOL_INVALID',
    });
    await expect(pool.inspect(['C:\\second'])).resolves.toEqual([
      { path: 'C:\\second', attributes: 16 },
    ]);
    expect(spawns).toBe(2);
  });

  it('keeps a healthy worker after a bounded probe error response', async () => {
    let spawns = 0;
    const pool = createPool(() => {
      spawns += 1;
      return spawnTestChild('error');
    });

    await expect(pool.inspect(['C:\\missing'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_PROBE_FAILED',
    });
    await expect(pool.inspect(['C:\\still-missing'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_PROBE_FAILED',
    });
    expect(spawns).toBe(1);
  });

  it.each(['hang', 'exit'])(
    'bounds %s failure, awaits retirement, and starts a healthy replacement',
    async mode => {
      let spawns = 0;
      const pool = createPool(
        () => spawnTestChild(++spawns === 1 ? mode : 'normal'),
        mode === 'hang' ? { requestTimeoutMs: 40 } : {},
      );

      await expect(pool.inspect(['C:\\first'])).rejects.toMatchObject({
        code: mode === 'hang' ? 'WINDOWS_BOUNDARY_TIMEOUT' : 'WINDOWS_BOUNDARY_WORKER_EXITED',
      });
      await expect(pool.inspect(['C:\\second'])).resolves.toEqual([
        { path: 'C:\\second', attributes: 16 },
      ]);
      expect(spawns).toBe(2);
    },
  );

  it('serializes requests and expires queued work at its own deadline', async () => {
    const pool = createPool(() => spawnTestChild('slow'), {
      requestTimeoutMs: 250,
      queueTimeoutMs: 40,
    });

    const first = pool.inspect(['C:\\first']);
    const second = pool.inspect(['C:\\second']);
    await expect(second).rejects.toMatchObject({ code: 'WINDOWS_BOUNDARY_QUEUE_TIMEOUT' });
    await expect(first).resolves.toEqual([{ path: 'C:\\first', attributes: 16 }]);
  });

  it('rejects requests above the pending and command byte caps without hanging', async () => {
    const pool = createPool(() => spawnTestChild('hang'), {
      maxPending: 1,
      maxCommandBytes: 128,
      requestTimeoutMs: 60,
    });

    await expect(pool.inspect([`C:\\${'x'.repeat(256)}`])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_REQUEST_TOO_LARGE',
    });
    const first = pool.inspect(['C:\\first']);
    await expect(pool.inspect(['C:\\second'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_QUEUE_FULL',
    });
    await expect(first).rejects.toMatchObject({ code: 'WINDOWS_BOUNDARY_TIMEOUT' });
  });

  it('observes the response rejection while a real pipe write is blocked by backpressure', async () => {
    const unhandled: unknown[] = [];
    const rejectionHandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const onHandled = (promise: unknown) => rejectionHandled.push(promise);
    process.on('unhandledRejection', onUnhandled);
    process.on('rejectionHandled', onHandled);
    let backpressured = false;
    const pool = createPool(
      () => {
        const child = spawn(process.execPath, ['-e', noReadChildScript], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = ((...args: Parameters<typeof child.stdin.write>) => {
          const accepted = write(...args);
          if (!accepted) backpressured = true;
          return accepted;
        }) as typeof child.stdin.write;
        return child;
      },
      { requestTimeoutMs: 40 },
    );

    try {
      await expect(pool.inspect([`C:\\${'x'.repeat(240_000)}`])).rejects.toMatchObject({
        code: 'WINDOWS_BOUNDARY_TIMEOUT',
      });
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(backpressured).toBe(true);
      expect(unhandled).toEqual([]);
      expect(rejectionHandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      process.removeListener('rejectionHandled', onHandled);
    }
  });

  it('waits for an asynchronously invalidated idle worker to exit before replacement', async () => {
    const events: string[] = [];
    let spawns = 0;
    let firstChild: ChildProcessWithoutNullStreams | undefined;
    const pool = createPool(() => {
      spawns += 1;
      if (spawns > 1) {
        events.push('second-spawn');
        return spawnTestChild('normal');
      }
      const child = spawnTestChild('delayed-exit');
      firstChild = child;
      child.once('exit', () => events.push('first-exit'));
      const kill = child.kill.bind(child);
      child.kill = ((signal?: NodeJS.Signals | number) => {
        setTimeout(() => kill(signal), 80);
        return true;
      }) as typeof child.kill;
      return child;
    });

    await pool.inspect(['C:\\first']);
    firstChild!.emit('error', new Error('idle worker failure'));
    await pool.inspect(['C:\\second']);
    events.push('second-completed');

    expect(events).toEqual(['first-exit', 'second-spawn', 'second-completed']);
  });

  it('retains startup ownership and blocks replacement when termination cannot be confirmed', async () => {
    let spawns = 0;
    const pool = createPool(
      () => {
        spawns += 1;
        return neverExitingStartupChild();
      },
      { requestTimeoutMs: 15, shutdownTimeoutMs: 10, forceKillTimeoutMs: 10 },
    );

    await expect(pool.inspect(['C:\\first'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_TERMINATION_UNCONFIRMED',
    });
    await expect(pool.inspect(['C:\\second'])).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_TERMINATION_UNCONFIRMED',
    });
    expect(spawns).toBe(1);
    await expect(pool.close()).rejects.toMatchObject({
      code: 'WINDOWS_BOUNDARY_TERMINATION_UNCONFIRMED',
    });
    pools.splice(pools.indexOf(pool), 1);
  });

  it('ends an idle worker and lazily replaces it for later work', async () => {
    const children: ChildProcessWithoutNullStreams[] = [];
    const pool = createPool(
      () => {
        const child = spawnTestChild('normal');
        children.push(child);
        return child;
      },
      { idleTimeoutMs: 20 },
    );

    await pool.inspect(['C:\\first']);
    await Promise.race([
      once(children[0]!, 'exit'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('idle child did not exit')), 500),
      ),
    ]);
    await expect(pool.inspect(['C:\\second'])).resolves.toEqual([
      { path: 'C:\\second', attributes: 16 },
    ]);
    expect(children).toHaveLength(2);
  });
});
