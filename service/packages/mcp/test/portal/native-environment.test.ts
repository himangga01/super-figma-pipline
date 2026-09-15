import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { contentHash } from '@sfp/ir';
import { afterEach, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { NativeEnvironmentLifecycle } from '../../src/portal/native-lifecycle.js';
import { nativeProcessControl } from '../../src/portal/native-process-control.js';
import {
  expandNativeEnvironment,
  observeSqlite,
  prepareNativeEnvironment,
  verifyNativeEnvironment,
} from '../../src/portal/native-resources.js';
import { PortalStore } from '../../src/portal/store.js';
import { windowsJobCommand } from '../../src/portal/windows-job.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const fixture = async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  return f;
};
const profile = () => ({
  ownerId: 'actor',
  planId: 'plan',
  native: { id: 'test', sourceHash: contentHash('source', 'test'), environment: {} },
});
const expansion = (
  grant: Awaited<ReturnType<typeof prepareNativeEnvironment>>,
  operationId: string,
) =>
  expandNativeEnvironment(grant, {
    operationId,
    runId: operationId,
    target: 'candidate',
    profileHash: contentHash('profile', 'test'),
    repositoryHash: contentHash('repo', 'test'),
    repositoryKey: 'portal:repo:test',
  });
it('canonical SQLite identity survives creation and rejects aliases and hardlinks', async () => {
  const f = await fixture(),
    path = join(f.workspaceRoot, 'store.sqlite');
  const before = await observeSqlite(path);
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE test(value TEXT)');
  db.close();
  expect((await observeSqlite(path)).key).toBe(before.key);
  expect((await observeSqlite(process.platform === 'win32' ? path.toUpperCase() : path)).key).toBe(
    before.key,
  );
  const alias = join(f.workspaceRoot, 'alias.sqlite');
  await link(path, alias);
  await expect(observeSqlite(alias)).rejects.toThrow('PORTAL_SQLITE_FILE_INVALID');
  await unlink(alias);
  await expect(observeSqlite('file:' + path + '?mode=rwc')).rejects.toThrow(
    'PORTAL_SQLITE_LOCAL_PATH_REQUIRED',
  );
});
it.runIf(process.platform === 'win32')(
  'prepares read-only grants and detects configuration and ancestor replacement',
  async () => {
    const f = await fixture(),
      p = profile();
    const grant = await prepareNativeEnvironment(p, f.stateRoot);
    expect(grant.grants[0]?.declaration.provider).toBe('owned-sqlite');
    await expect(
      verifyNativeEnvironment(
        {
          ...p,
          native: { ...p.native, environment: { CHANGED: 'yes' }, environmentAuthority: grant },
        },
        f.stateRoot,
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_GRANT_CHANGED');
    await verifyNativeEnvironment(
      { ...p, native: { ...p.native, environmentAuthority: grant } },
      f.stateRoot,
    );
    const old = join(f.root, 'old-state');
    await rename(f.stateRoot, old);
    await mkdir(f.stateRoot);
    await expect(
      verifyNativeEnvironment(
        { ...p, native: { ...p.native, environmentAuthority: grant } },
        f.stateRoot,
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_GRANT_CHANGED');
  },
);
it.runIf(process.platform === 'win32')(
  'provisions real SQLite and retains durable data across a reconstructed lifecycle',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'one');
    const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    const db = new DatabaseSync(execution.environment.SFP_PORTAL_SQLITE_PATH!);
    db.exec("CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES ('retained')");
    db.close();
    const receipt = await manager.finish(execution.attemptId);
    const reopened = new DatabaseSync(execution.environment.SFP_PORTAL_SQLITE_PATH!);
    expect(reopened.prepare('SELECT body FROM notes').get()?.body).toBe('retained');
    reopened.close();
    const reconstructed = new NativeEnvironmentLifecycle(
      new PortalStore(f.stateRoot, f.key, f.permissions),
      f.stateRoot,
      f.permissions,
    );
    await reconstructed.verifyReceipt(
      execution.attemptId,
      'actor',
      contentHash('sfp-native-lifecycle-receipt-v1', receipt),
    );
    await expect(
      reconstructed.acquire(execution, grant, new AbortController().signal),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ATTEMPT_REPLAY');
    expect(expansion(grant, 'two').directory).not.toBe(execution.directory);
  },
  20000,
);
it.runIf(process.platform === 'win32')(
  'keeps a shared database quarantined across restart when broker stop proof is missing',
  async () => {
    const f = await fixture(),
      p = {
        ...profile(),
        native: {
          ...profile().native,
          resources: [
            {
              id: 'shared',
              provider: 'shared-sqlite' as const,
              path: join(f.workspaceRoot, 'shared.sqlite'),
              binding: 'DATABASE_PATH',
              actions: ['read', 'write', 'create'] as Array<'read' | 'write' | 'create'>,
            },
          ],
        },
      };
    const grant = await prepareNativeEnvironment(p, f.stateRoot),
      one = expansion(grant, 'one');
    const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(one, grant, new AbortController().signal);
    await manager.beforeLaunch(one.attemptId, 'start', 'token', contentHash('exe', 'test'));
    await manager.permit(one.attemptId, 'token', process.pid, 'not-the-real-birth');
    await expect(manager.finish(one.attemptId)).rejects.toThrow('PORTAL_NATIVE_CLEANUP_UNKNOWN');
    const reconstructed = new NativeEnvironmentLifecycle(
      new PortalStore(f.stateRoot, f.key, f.permissions),
      f.stateRoot,
      f.permissions,
    );
    await expect(
      reconstructed.acquire(expansion(grant, 'two'), grant, new AbortController().signal),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_RESOURCE_QUARANTINED');
    const record = await reconstructed.inspect(one.attemptId, 'actor');
    await expect(
      reconstructed.reconcile(
        one.attemptId,
        'actor',
        contentHash('sfp-native-lifecycle-receipt-v1', record),
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_MANUAL_RECONCILIATION_REQUIRED');
    expect(process.pid).toBeGreaterThan(0);
  },
  20000,
);
it.runIf(process.platform === 'win32')(
  'broker waits for persisted permission, drains a descendant, and retains a signed stop receipt',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'broker');
    const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    const marker = join(execution.directory, 'started');
    const controller = new AbortController();
    let reached!: () => void, release!: () => void;
    const atPermit = new Promise<void>(resolve => {
        reached = resolve;
      }),
      gate = new Promise<void>(resolve => {
        release = resolve;
      });
    const originalPermit = manager.permit.bind(manager);
    manager.permit = async (...args) => {
      reached();
      await gate;
      return originalPermit(...args);
    };
    const control = await nativeProcessControl(
      manager,
      execution.attemptId,
      'command',
      contentHash('exe', 'test'),
      controller.signal,
    );
    const script = join(f.workspaceRoot, 'run.cjs');
    await writeFile(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ok');require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref();`,
    );
    const broker = windowsJobCommand(
      process.env.SystemRoot!,
      process.execPath,
      [script],
      f.workspaceRoot,
      8000,
      control.pipeName,
      control.token,
    );
    const child = spawn(broker.executable, broker.args, {
      env: { SystemRoot: process.env.SystemRoot, SFP_NATIVE_JOB_DATA: broker.data },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    control.spawned(child.pid);
    let output = '';
    child.stdout.on('data', value => (output += value));
    child.stderr.on('data', value => {
      output += value;
    });
    const killTimer = setTimeout(() => child.kill(), 12000);
    child.once('close', () => clearTimeout(killTimer));
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await atPermit;
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    release();
    const code = await closed;
    try {
      expect(output).toBe('');
      expect(code).toBe(0);
      await control.finish();
      expect(await readFile(marker, 'utf8')).toBe('ok');
      const receipt = await manager.finish(execution.attemptId);
      expect(receipt.processes[0]?.state).toBe('stopped');
    } finally {
      control.close();
    }
  },
  30000,
);

it
  .runIf(process.platform === 'win32')
  .each(['failed', 'timeout', 'cancelled', 'before-permit', 'parent-eof'] as const)(
  'releases only after real broker tree-stop proof for %s commands',
  async mode => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, mode);
    const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    const controller = new AbortController(),
      marker = join(execution.directory, 'marker');
    const control = await nativeProcessControl(
      manager,
      execution.attemptId,
      'command',
      contentHash('exe', 'test'),
      controller.signal,
    );
    if (mode === 'before-permit') control.stop();
    const source =
      mode === 'failed'
        ? 'process.exit(7)'
        : `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000);`;
    const script = join(f.workspaceRoot, 'process.cjs');
    await writeFile(script, source);
    const broker = windowsJobCommand(
      process.env.SystemRoot!,
      process.execPath,
      [script],
      f.workspaceRoot,
      mode === 'timeout' ? 200 : 8000,
      control.pipeName,
      control.token,
    );
    const child = spawn(broker.executable, broker.args, {
      env: { SystemRoot: process.env.SystemRoot, SFP_NATIVE_JOB_DATA: broker.data },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    control.spawned(child.pid);
    const timer = setTimeout(() => child.kill(), 15000);
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    try {
      if (mode === 'cancelled' || mode === 'parent-eof') {
        const until = Date.now() + 10000;
        while (Date.now() < until) {
          if (
            await readFile(marker).then(
              () => true,
              () => false,
            )
          )
            break;
          await delay(20);
        }
        await readFile(marker, 'utf8');
        if (mode === 'parent-eof') child.stdin.end();
        else controller.abort();
      }
      const code = await closed;
      expect(code).toBe(mode === 'failed' ? 7 : mode === 'before-permit' ? 125 : 124);
      await control.finish();
      const markerExists = await readFile(marker).then(
        () => true,
        () => false,
      );
      expect(mode === 'before-permit' && markerExists).toBe(false);
      const receipt = await manager.finish(execution.attemptId);
      expect(receipt.state).toBe('released');
      expect(receipt.processes[0]?.proof).toBe('windows-owned-job-active-members-one-v1');
    } finally {
      clearTimeout(timer);
      control.close();
    }
  },
  30000,
);
it.runIf(process.platform === 'win32')(
  'rejects modified admission bodies and same-path owned directory swaps',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'swap'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await expect(
      manager.acquire(
        { ...execution, directory: f.workspaceRoot },
        grant,
        new AbortController().signal,
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ADMISSION_CHANGED');
    await manager.acquire(execution, grant, new AbortController().signal);
    await rename(execution.directory, execution.directory + '-retained');
    await mkdir(execution.directory);
    await expect(manager.finish(execution.attemptId)).rejects.toThrow(
      'PORTAL_ENVIRONMENT_DIRECTORY_CHANGED',
    );
    expect((await manager.inspect(execution.attemptId, 'actor')).state).toBe('quarantined');
  },
);
it.runIf(process.platform === 'win32')(
  'reconciles only exact inspected receipts with already durable stop evidence',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'reconcile'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    await manager.quarantine(execution.attemptId, 'interrupted-release');
    const inspected = await manager.inspect(execution.attemptId, 'actor');
    await expect(
      manager.reconcile(
        execution.attemptId,
        'other',
        contentHash('sfp-native-lifecycle-receipt-v1', inspected),
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ATTEMPT_NOT_FOUND');
    await expect(
      manager.reconcile(execution.attemptId, 'actor', contentHash('wrong', 'test')),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_INSPECTION_CHANGED');
    expect(
      (
        await manager.reconcile(
          execution.attemptId,
          'actor',
          contentHash('sfp-native-lifecycle-receipt-v1', inspected),
        )
      ).state,
    ).toBe('released');
  },
);

it.runIf(process.platform === 'win32')(
  'queues canonical shared databases, cancels only a waiter, and lets an independent database progress',
  async () => {
    const f = await fixture(),
      shared = join(f.workspaceRoot, 'shared.sqlite'),
      other = join(f.workspaceRoot, 'other.sqlite');
    for (const path of [shared, other]) {
      const db = new DatabaseSync(path);
      db.exec('CREATE TABLE values_table(value TEXT)');
      db.close();
    }
    const prepared = async (path: string) =>
      prepareNativeEnvironment(
        {
          ...profile(),
          native: {
            ...profile().native,
            resources: [
              {
                id: 'shared',
                provider: 'shared-sqlite' as const,
                path,
                binding: 'DATABASE_PATH',
                actions: ['read', 'write'],
              },
            ],
          },
        },
        f.stateRoot,
      );
    const grant = await prepared(shared),
      otherGrant = await prepared(other),
      first = expansion(grant, 'owner'),
      second = expansion(grant, 'waiter'),
      third = expansion(otherGrant, 'independent');
    const queue = new FileExecutionQueue(),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
      }),
      ready = new Promise<void>(resolve => {
        acquired = resolve;
      });
    const owner = queue.runResources(first.resources, async () => {
      await manager.acquire(first, grant, new AbortController().signal);
      acquired();
      await gate;
      return manager.finish(first.attemptId);
    });
    await ready;
    const cancellation = new AbortController();
    let dispatched = false;
    const waiter = queue.runResources(
      second.resources.toReversed(),
      async () => {
        dispatched = true;
        return manager.acquire(second, grant, cancellation.signal);
      },
      cancellation.signal,
    );
    const rejected = waiter.catch(error => error);
    cancellation.abort(new Error('cancel-waiter'));
    expect((await rejected).message).toBe('cancel-waiter');
    expect(dispatched).toBe(false);
    expect((await manager.inspect(first.attemptId, 'actor')).state).toBe('ready');
    await queue.runResources(third.resources, async () => {
      await manager.acquire(third, otherGrant, new AbortController().signal);
      await manager.finish(third.attemptId);
    });
    release();
    expect((await owner).state).toBe('released');
    const reopened = new DatabaseSync(shared);
    expect(reopened.prepare('SELECT count(*) AS count FROM values_table').get()?.count).toBe(0);
    reopened.close();
  },
);

it.runIf(process.platform === 'win32')(
  'quarantines a real created directory when its identity persistence is interrupted',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'creation-gap'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    const update = f.store.update.bind(f.store);
    vi.spyOn(f.store, 'update').mockImplementation((kind, id, schema, change) =>
      update(kind, id, schema, async value => {
        const next = await change(value);
        if (
          kind === 'environment-attempts' &&
          (next as { state?: string; directoryIdentity?: string }).state === 'creating' &&
          (next as { directoryIdentity?: string }).directoryIdentity
        )
          throw Error('identity-persistence-interrupted');
        return next;
      }),
    );
    await expect(manager.acquire(execution, grant, new AbortController().signal)).rejects.toThrow(
      'identity-persistence-interrupted',
    );
    const reconstructed = new NativeEnvironmentLifecycle(
        new PortalStore(f.stateRoot, f.key, f.permissions),
        f.stateRoot,
        f.permissions,
      ),
      record = await reconstructed.inspect(execution.attemptId, 'actor');
    expect(record.state).toBe('quarantined');
    expect(record.directoryIdentity).toBeNull();
    await expect(
      reconstructed.reconcile(
        execution.attemptId,
        'actor',
        contentHash('sfp-native-lifecycle-receipt-v1', record),
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_DIRECTORY_CHANGED');
  },
);
it.runIf(process.platform === 'win32')(
  'persists the full supported 32-command lifecycle beyond 64 CAS generations',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'capacity'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    // This exercises actual signed-store/CAS capacity. Synthetic process receipts isolate the
    // persistence limit; real Windows ownership and stop proofs are covered by broker tests above.
    for (let i = 0; i < 32; i++) {
      await manager.beforeLaunch(
        execution.attemptId,
        `command-${i}`,
        `token-${i}`,
        contentHash('exe', 'test'),
      );
      await manager.permit(execution.attemptId, `token-${i}`, 123, 'fixture-birth');
      await manager.stopped(execution.attemptId, `token-${i}`, 123, 'fixture-birth');
    }
    const receipt = await manager.finish(execution.attemptId);
    expect(receipt.state).toBe('released');
    expect(receipt.processes).toHaveLength(32);
  },
  60000,
);

it.runIf(process.platform === 'win32')(
  'keeps lost real broker stop evidence quarantined across manager reconstruction',
  async () => {
    const f = await fixture(),
      p = {
        ...profile(),
        native: {
          ...profile().native,
          resources: [
            {
              id: 'shared',
              provider: 'shared-sqlite' as const,
              path: join(f.workspaceRoot, 'lost.sqlite'),
              binding: 'DATABASE_PATH',
              actions: ['read', 'write', 'create'] as Array<'read' | 'write' | 'create'>,
            },
          ],
        },
      },
      grant = await prepareNativeEnvironment(p, f.stateRoot),
      execution = expansion(grant, 'broker-loss'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    const marker = join(execution.directory, 'running'),
      script = join(f.workspaceRoot, 'loss.cjs');
    await writeFile(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000);`,
    );
    const control = await nativeProcessControl(
      manager,
      execution.attemptId,
      'command',
      contentHash('exe', 'test'),
      new AbortController().signal,
    );
    const broker = windowsJobCommand(
      process.env.SystemRoot!,
      process.execPath,
      [script],
      f.workspaceRoot,
      10000,
      control.pipeName,
      control.token,
    );
    const child = spawn(broker.executable, broker.args, {
      env: { SystemRoot: process.env.SystemRoot, SFP_NATIVE_JOB_DATA: broker.data },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    control.spawned(child.pid);
    const closed = new Promise<void>((resolve, reject) => {
      child.once('close', () => resolve());
      child.once('error', reject);
    });
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        if (
          await readFile(marker).then(
            () => true,
            () => false,
          )
        )
          break;
        await delay(20);
      }
      expect(await readFile(marker, 'utf8')).toBe('started');
      child.kill();
      await closed;
      await expect(control.finish()).rejects.toThrow('PORTAL_NATIVE_CLEANUP_UNKNOWN');
      await expect(manager.finish(execution.attemptId)).rejects.toThrow(
        'PORTAL_NATIVE_CLEANUP_UNKNOWN',
      );
      const reconstructed = new NativeEnvironmentLifecycle(
        new PortalStore(f.stateRoot, f.key, f.permissions),
        f.stateRoot,
        f.permissions,
      );
      expect((await reconstructed.inspect(execution.attemptId, 'actor')).state).toBe('quarantined');
      await expect(
        reconstructed.acquire(expansion(grant, 'conflict'), grant, new AbortController().signal),
      ).rejects.toThrow('PORTAL_ENVIRONMENT_RESOURCE_QUARANTINED');
    } finally {
      clearTimeout(timer);
      control.close();
    }
  },
  30000,
);

const concurrentEnvironment = async () => {
  const f = await fixture(),
    p = {
      ...profile(),
      native: {
        ...profile().native,
        resources: [
          {
            id: 'shared',
            provider: 'shared-sqlite' as const,
            path: join(f.workspaceRoot, 'race.sqlite'),
            binding: 'DATABASE_PATH',
            actions: ['read', 'write', 'create'] as Array<'read' | 'write' | 'create'>,
          },
        ],
      },
    },
    grant = await prepareNativeEnvironment(p, f.stateRoot),
    execution = expansion(grant, 'race');
  const manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions),
    other = new NativeEnvironmentLifecycle(
      new PortalStore(f.stateRoot, f.key, f.permissions),
      f.stateRoot,
      f.permissions,
    );
  await manager.acquire(execution, grant, new AbortController().signal);
  return { ...f, grant, execution, manager, other };
};
it.runIf(process.platform === 'win32')(
  'a durable cleanup claim prevents a cross-manager launch during filesystem verification',
  async () => {
    const f = await concurrentEnvironment();
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(r => {
        reached = r;
      }),
      gate = new Promise<void>(r => {
        release = r;
      });
    const port = f.manager as unknown as { verifyDirectories: (record: unknown) => Promise<void> },
      verify = port.verifyDirectories.bind(f.manager);
    port.verifyDirectories = async record => {
      await verify(record);
      reached();
      await gate;
    };
    const finishing = f.manager.finish(f.execution.attemptId);
    await ready;
    await expect(
      f.other.beforeLaunch(f.execution.attemptId, 'next', 'token', contentHash('exe', 'test')),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ATTEMPT_STATE');
    release();
    const record = await finishing;
    expect(record.state).toBe('released');
    expect(record.executionClosed).toBe(true);
    expect(record.processes).toHaveLength(0);
  },
);
it.runIf(process.platform === 'win32')(
  'a launch paused before CAS cannot reopen a cross-manager released attempt',
  async () => {
    const f = await concurrentEnvironment();
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(r => {
        reached = r;
      }),
      gate = new Promise<void>(r => {
        release = r;
      });
    const port = f.manager as unknown as { verifyDirectories: (record: unknown) => Promise<void> },
      verify = port.verifyDirectories.bind(f.manager);
    port.verifyDirectories = async record => {
      await verify(record);
      reached();
      await gate;
    };
    const launching = f.manager
      .beforeLaunch(f.execution.attemptId, 'next', 'token', contentHash('exe', 'test'))
      .catch(error => error);
    await ready;
    await f.other.finish(f.execution.attemptId);
    release();
    expect(await launching).toMatchObject({ code: 'PORTAL_ENVIRONMENT_ATTEMPT_CHANGED' });
    await expect(f.manager.permit(f.execution.attemptId, 'token', 123, 'birth')).rejects.toThrow(
      'PORTAL_ENVIRONMENT_PROCESS_PROOF_REQUIRED',
    );
    const record = await f.other.inspect(f.execution.attemptId, 'actor');
    expect(record.state).toBe('released');
    expect(record.processes).toHaveLength(0);
  },
);
it.runIf(process.platform === 'win32')(
  'owner reconciliation rejects a live attempt even between stopped commands',
  async () => {
    const f = await concurrentEnvironment();
    await f.manager.beforeLaunch(
      f.execution.attemptId,
      'first',
      'token',
      contentHash('exe', 'test'),
    );
    await f.manager.permit(f.execution.attemptId, 'token', 123, 'fixture-birth');
    await f.manager.stopped(f.execution.attemptId, 'token', 123, 'fixture-birth');
    const record = await f.manager.inspect(f.execution.attemptId, 'actor');
    await expect(
      f.other.reconcile(
        f.execution.attemptId,
        'actor',
        contentHash('sfp-native-lifecycle-receipt-v1', record),
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_EXECUTION_ACTIVE');
    expect((await f.other.inspect(f.execution.attemptId, 'actor')).revision).toBe(record.revision);
    await f.manager.beforeLaunch(
      f.execution.attemptId,
      'second',
      'second-token',
      contentHash('exe', 'test'),
    );
    await expect(
      f.other.acquire(expansion(f.grant, 'conflict'), f.grant, new AbortController().signal),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_RESOURCE_QUARANTINED');
  },
);
it.runIf(process.platform === 'win32')(
  'reconciles an interrupted claim release with exact revision and closed execution proof',
  async () => {
    const f = await concurrentEnvironment(),
      original = f.store.update.bind(f.store);
    let failed = false;
    vi.spyOn(f.store, 'update').mockImplementation((kind, id, schema, change) =>
      original(kind, id, schema, async value => {
        const next = await change(value);
        if (
          !failed &&
          kind === 'environment-resources' &&
          (next as { state?: string }).state === 'released'
        ) {
          failed = true;
          throw Error('release-interrupted');
        }
        return next;
      }),
    );
    await expect(f.manager.finish(f.execution.attemptId)).rejects.toThrow('release-interrupted');
    const record = await f.other.inspect(f.execution.attemptId, 'actor');
    expect(record.executionClosed).toBe(true);
    expect(record.state).toBe('quarantined');
    const recovered = await f.other.reconcile(
      f.execution.attemptId,
      'actor',
      contentHash('sfp-native-lifecycle-receipt-v1', record),
    );
    expect(recovered.state).toBe('released');
    expect(
      (
        await f.other.acquire(
          expansion(f.grant, 'after-recovery'),
          f.grant,
          new AbortController().signal,
        )
      ).state,
    ).toBe('ready');
  },
);
it.runIf(process.platform === 'win32')(
  'broker exit waits for durable stop receipt acknowledgment',
  async () => {
    const f = await fixture(),
      grant = await prepareNativeEnvironment(profile(), f.stateRoot),
      execution = expansion(grant, 'ack'),
      manager = new NativeEnvironmentLifecycle(f.store, f.stateRoot, f.permissions);
    await manager.acquire(execution, grant, new AbortController().signal);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(r => {
        reached = r;
      }),
      gate = new Promise<void>(r => {
        release = r;
      }),
      stopped = manager.stopped.bind(manager);
    manager.stopped = async (...args) => {
      reached();
      await gate;
      return stopped(...args);
    };
    const control = await nativeProcessControl(
      manager,
      execution.attemptId,
      'command',
      contentHash('exe', 'test'),
      new AbortController().signal,
    );
    const script = join(f.workspaceRoot, 'ack.cjs');
    await writeFile(script, 'process.exit(7)');
    const broker = windowsJobCommand(
        process.env.SystemRoot!,
        process.execPath,
        [script],
        f.workspaceRoot,
        8000,
        control.pipeName,
        control.token,
      ),
      child = spawn(broker.executable, broker.args, {
        env: { SystemRoot: process.env.SystemRoot, SFP_NATIVE_JOB_DATA: broker.data },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    control.spawned(child.pid);
    const closed = new Promise<number | null>((resolve, reject) => {
        child.once('close', resolve);
        child.once('error', reject);
      }),
      timer = setTimeout(() => child.kill(), 15000);
    try {
      await ready;
      expect(await Promise.race([closed.then(() => true), delay(300).then(() => false)])).toBe(
        false,
      );
      expect((await manager.inspect(execution.attemptId, 'actor')).processes[0]?.state).toBe(
        'permitted',
      );
      release();
      expect(await closed).toBe(7);
      await control.finish();
      expect((await manager.finish(execution.attemptId)).state).toBe('released');
    } finally {
      release();
      clearTimeout(timer);
      control.close();
    }
  },
  30000,
);

it.runIf(process.platform === 'win32')(
  'a permitted cross-manager launch wins over a stale finisher before cleanup CAS',
  async () => {
    const f = await concurrentEnvironment(),
      update = f.store.update.bind(f.store);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(r => {
        reached = r;
      }),
      gate = new Promise<void>(r => {
        release = r;
      });
    vi.spyOn(f.store, 'update').mockImplementationOnce(async (...args) => {
      reached();
      await gate;
      return update(...args);
    });
    const finishing = f.manager.finish(f.execution.attemptId).catch(error => error);
    await ready;
    await f.other.beforeLaunch(
      f.execution.attemptId,
      'winner',
      'winner-token',
      contentHash('exe', 'test'),
    );
    await f.other.permit(f.execution.attemptId, 'winner-token', 123, 'fixture-birth');
    release();
    expect(await finishing).toMatchObject({ code: 'PORTAL_ENVIRONMENT_ATTEMPT_CHANGED' });
    const record = await f.other.inspect(f.execution.attemptId, 'actor');
    expect(record.state).toBe('running');
    expect(record.executionClosed).toBe(false);
    expect(record.processes[0]?.state).toBe('permitted');
    await expect(
      f.other.acquire(expansion(f.grant, 'conflict'), f.grant, new AbortController().signal),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_RESOURCE_QUARANTINED');
  },
);
it.runIf(process.platform === 'win32')(
  'reconciliation rejects a changed inspected revision before claiming cleanup',
  async () => {
    const f = await concurrentEnvironment();
    await f.manager.quarantine(f.execution.attemptId, 'first');
    const record = await f.other.inspect(f.execution.attemptId, 'actor');
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(r => {
        reached = r;
      }),
      gate = new Promise<void>(r => {
        release = r;
      }),
      inspect = f.manager.inspect.bind(f.manager);
    vi.spyOn(f.manager, 'inspect').mockImplementationOnce(async (...args) => {
      const value = await inspect(...args);
      reached();
      await gate;
      return value;
    });
    const reconciling = f.manager
      .reconcile(
        f.execution.attemptId,
        'actor',
        contentHash('sfp-native-lifecycle-receipt-v1', record),
      )
      .catch(error => error);
    await ready;
    await f.other.quarantine(f.execution.attemptId, 'second');
    release();
    expect(await reconciling).toMatchObject({ code: 'PORTAL_ENVIRONMENT_INSPECTION_CHANGED' });
    expect((await f.other.inspect(f.execution.attemptId, 'actor')).reason).toBe('second');
  },
);
