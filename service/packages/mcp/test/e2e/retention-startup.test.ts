import { type ChildProcess, spawn } from 'node:child_process';
import { once as onExit } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';

import {
  ALL_DATA_CLASSES,
  hashEgressConfig,
  type EgressConfigV1,
  type OperationEvidenceReceiptAppendV1,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createEgressConfigStore } from '../../src/policy/policy-engine.js';
import {
  deriveOwnerActor,
  loadOrCreateOwnerPrincipalKey,
} from '../../src/security/principal-derivation.js';
import { createStatePermissions } from '../../src/security/state-permissions.js';

/*
 * T09 acceptance for LC-1 at the process level: the built daemon starts as leader over owner state
 * that holds the durable cleanup intent of a 31-day-old `snapshot.capture` receipt whose workspace
 * `.sfp` folder was deleted.
 *
 * Before T09 the leader awaited the retention sweep inside runtime initialization, and the sweep
 * threw NATIVE_ARTIFACT_IDENTITY_MISMATCH for `snapshot` evidence, so every start failed runtime
 * initialization while `/ping` stayed healthy. After T09 the sweep runs after initialization and
 * only detaches snapshot evidence, so the intent ends done.
 *
 * Seeding uses the real signed and hash-chained stores: owner principal key, workspace config and
 * the operation evidence receipt store. The receipt store's own compaction turns the receipt into
 * the cleanup intent, exactly as the leader's sweep did 30 days after the capture. Runs against
 * dist, like the other process tests, and skips when the build is missing.
 */
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');
const DAY_MS = 86_400_000;
const STARTUP_TIMEOUT_MS = process.platform === 'win32' ? 90_000 : 45_000;

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
};

const waitFor = async (predicate: () => boolean, label: string, timeoutMs: number) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
};

const temporaryBases: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = onExit(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
  for (const base of temporaryBases.splice(0)) {
    const fromTemporary = relative(resolvePath(tmpdir()), resolvePath(base));
    if (
      fromTemporary === '' ||
      fromTemporary === '..' ||
      fromTemporary.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(fromTemporary)
    )
      throw new Error('refusing to remove a test path outside the OS temporary directory');
    rmSync(base, { recursive: true, force: true });
  }
});

/** A 31-day-old `snapshot.capture` receipt as the snapshot services record it. */
const snapshotReceipt = (
  actorId: `actor1_${string}`,
  operationId: string,
  workspaceId: string,
  completedAt: number,
): OperationEvidenceReceiptAppendV1 => ({
  schemaVersion: 1,
  state: 'prepared',
  actorId,
  operationId,
  operationKind: 'service',
  operationName: 'snapshot.capture',
  argsHash: `sha256:${'a'.repeat(64)}`,
  workspaceId,
  fileExecutionKeyHash: `sha256:${'b'.repeat(64)}`,
  targetBindingHash: `sha256:${'c'.repeat(64)}`,
  captureIntentHash: `sha256:${'d'.repeat(64)}`,
  captureResult: false,
  finalizerHash: `sha256:${'e'.repeat(64)}`,
  daemonGenerationHash: `sha256:${'f'.repeat(64)}`,
  completedAt: new Date(completedAt).toISOString(),
  terminalStatus: 'succeeded',
  resultHash: `sha256:${'1'.repeat(64)}`,
  resultBytes: 2,
  resultArtifact: null,
  nativeEvidence: {
    kind: 'snapshot',
    workspaceId,
    fileIdentityHash: `sha256:${'2'.repeat(64)}`,
    snapshotId: `sfp_snap1_${'A'.repeat(22)}`,
    refRelativePath: `.sfp/snapshots/v1/${'2'.repeat(64)}/sfp_snap1_${'A'.repeat(22)}.json`,
    checksum: `sha256:${'3'.repeat(64)}`,
    fidelity: 'complete-leaf',
    artifactRelativePath: `.sfp/snapshots/v1/${'2'.repeat(64)}/sfp_snap1_${'A'.repeat(22)}.json`,
    artifactDigest64: '3'.repeat(64),
  },
});

describe.skipIf(!existsSync(DIST_ENTRY))('LC-1 acceptance (built dist)', () => {
  it(
    'starts the leader over a 31-day-old snapshot cleanup intent whose .sfp folder was deleted, serves /control/status and a tool call, and ends the intent done',
    async () => {
      const stateBase = mkdtempSync(join(tmpdir(), 'sfp-lc1-start-'));
      temporaryBases.push(stateBase);
      const port = await freePort();
      const environment: Record<string, string | undefined> = {
        ...process.env,
        FIGWRIGHT_PORT: String(port),
        TEMP: stateBase,
        TMP: stateBase,
        TMPDIR: stateBase,
      };
      let stateRoot: string;
      if (process.platform === 'win32') {
        environment.LOCALAPPDATA = stateBase;
        stateRoot = join(stateBase, 'SuperFigmaPipeline');
      } else if (process.platform === 'darwin') {
        environment.HOME = stateBase;
        const applicationSupport = join(stateBase, 'Library', 'Application Support');
        mkdirSync(applicationSupport, { recursive: true, mode: 0o700 });
        stateRoot = join(applicationSupport, 'SuperFigmaPipeline');
      } else {
        environment.XDG_STATE_HOME = stateBase;
        stateRoot = join(stateBase, 'super-figma-pipeline');
      }
      mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
      const permissions = createStatePermissions(stateRoot, {
        environment,
        ...(process.platform === 'darwin' ? { homeDirectory: stateBase } : {}),
      });
      await permissions.ensureSecure(stateRoot);
      await permissions.verifySecure(stateRoot);

      // Owner egress, so that an ordinary tool call can succeed (as in the MCP wire test).
      const egress = createEgressConfigStore(stateRoot, permissions);
      const configuredEgress = {
        schemaVersion: 1 as const,
        mode: 'local-trusted' as const,
        allowedClasses: ALL_DATA_CLASSES,
        consentId: null,
        configuredAt: '2026-08-31T00:00:00.000Z',
        expiresAt: null,
      };
      await egress.save(
        { ...configuredEgress, configHash: hashEgressConfig(configuredEgress) } as EgressConfigV1,
        (await egress.load()).config.configHash,
      );

      // The owner principal the daemon derives its receipt actor from.
      const ownerActorId = deriveOwnerActor(
        await loadOrCreateOwnerPrincipalKey({ stateRoot, permissions }),
        'control',
      );

      // A registered, available workspace whose `.sfp` folder is deleted after the capture.
      const workspaceRoot = join(stateBase, 'workspace');
      mkdirSync(workspaceRoot);
      const workspaces = createWorkspaceConfigStore(
        stateRoot,
        { hasUnsettled: async () => false },
        permissions,
      );
      const { workspaceId } = await workspaces.add(ownerActorId, workspaceRoot);
      const snapshotDirectory = join(workspaceRoot, '.sfp', 'snapshots', 'v1', '2'.repeat(64));
      mkdirSync(snapshotDirectory, { recursive: true });

      // The receipt store's own compaction, 31 days after completion, records the durable cleanup
      // intent and removes the receipt: the state every later leader start drained.
      const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId: ownerActorId });
      await receipts.recover();
      const operationId = 'lc1-acceptance-snapshot-capture';
      const completedAt = Date.now() - 31 * DAY_MS;
      const reservation = await receipts.reserveBeforeRuntime(ownerActorId, operationId, 1, {
        workspaceId,
      });
      await receipts.prepareAndFsync(
        reservation.reservationId,
        snapshotReceipt(ownerActorId, operationId, workspaceId, completedAt),
      );
      await receipts.compact({
        now: completedAt + 31 * DAY_MS,
        linkedAt: id => (id === operationId ? completedAt : null),
      });
      await expect(receipts.get(ownerActorId, operationId)).resolves.toBeNull();
      expect(statSync(receipts.cleanupIntentPath).size).toBeGreaterThan(0);
      rmSync(join(workspaceRoot, '.sfp'), { recursive: true, force: true });

      const child = spawn(process.execPath, [DIST_ENTRY], {
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      children.push(child);
      child.stdin?.on('error', () => {});
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      let stdout = '';
      const responses = new Map<number, Record<string, unknown>>();
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        for (let newline = stdout.indexOf('\n'); newline !== -1; newline = stdout.indexOf('\n')) {
          const line = stdout.slice(0, newline).trim();
          stdout = stdout.slice(newline + 1);
          if (line === '') continue;
          const message = JSON.parse(line) as { id?: number } & Record<string, unknown>;
          if (typeof message.id === 'number') responses.set(message.id, message);
        }
      });
      let nextId = 1;
      const call = async (method: string, params: Record<string, unknown>) => {
        const id = nextId++;
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        await waitFor(() => responses.has(id), `${method} response\nstderr:\n${stderr}`, 45_000);
        return responses.get(id) as { result?: Record<string, unknown>; error?: unknown };
      };

      await waitFor(
        () => stderr.includes('ready as leader'),
        `leader ready\nstderr:\n${stderr}`,
        30_000,
      );
      const initialized = await call('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'sfp-lc1-acceptance', version: '0' },
      });
      expect(initialized.result).toBeDefined();
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );

      // `/ping` answers without the leader runtime; it looked healthy under LC-1 too.
      expect((await fetch(`http://127.0.0.1:${port}/ping`)).ok).toBe(true);
      // `/control/status` needs the leader runtime, so it proves that initialization completed.
      const credentials = JSON.parse(readFileSync(join(stateRoot, 'leader-auth.json'), 'utf8')) as {
        generation: string;
        controlToken: string;
      };
      const status = await fetch(`http://127.0.0.1:${port}/control/status`, {
        headers: {
          authorization: `Bearer ${credentials.controlToken}`,
          'x-sfp-leader-generation': credentials.generation,
        },
      });
      expect(status.status, `control status\nstderr:\n${stderr}`).toBe(200);
      expect(await status.json()).toMatchObject({ role: 'leader' });

      // An ordinary tool call runs through the same leader runtime.
      const ping = await call('tools/call', { name: 'ping', arguments: {} });
      const content = ping.result?.content as { type: string; text: string }[] | undefined;
      expect(ping.result?.isError, `ping\nstderr:\n${stderr}`).not.toBe(true);
      expect(JSON.parse(content?.[0]?.text ?? '{}')).toMatchObject({
        ok: true,
        server: { role: 'leader' },
      });

      // The startup sweep runs after initialization and detaches the snapshot evidence: the intent
      // ends done and the drained cleanup log is truncated.
      await waitFor(
        () => stderr.includes('[retention] sweep finished'),
        `retention sweep\nstderr:\n${stderr}`,
        45_000,
      );
      expect(statSync(receipts.cleanupIntentPath).size).toBe(0);
      expect(stderr).toMatch(/\[retention\] sweep finished: cleanup done=1 /u);
      expect(stderr).not.toContain('leader runtime initialization failed');
      expect(stderr).not.toContain('NATIVE_ARTIFACT_IDENTITY_MISMATCH');

      const exited = onExit(child, 'exit');
      child.stdin?.end();
      const [code] = (await exited) as [number | null];
      expect(code).toBe(0);

      // A restarted store has nothing left to drain.
      const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId: ownerActorId });
      await restarted.recover();
      const visited: string[] = [];
      await restarted.drainPendingArtifactCleanup(async receipt => {
        visited.push(receipt.operationId);
      });
      expect(visited).toEqual([]);
    },
    STARTUP_TIMEOUT_MS,
  );
});
