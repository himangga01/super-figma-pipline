import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OPERATION_EVIDENCE_LIMITS } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';

const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const receiptInput = (operationId: string, completedAt = '2026-08-31T00:00:00.000Z') => ({
  schemaVersion: 1 as const,
  state: 'prepared' as const,
  actorId,
  operationId,
  operationKind: 'tool' as const,
  operationName: 'get_selection' as const,
  argsHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
  workspaceId: null,
  fileExecutionKeyHash: null,
  targetBindingHash: null,
  captureIntentHash:
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
  captureResult: false as const,
  finalizerHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const,
  daemonGenerationHash:
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' as const,
  completedAt,
  terminalStatus: 'succeeded' as const,
  resultHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const,
  resultBytes: 2,
  resultArtifact: null,
  nativeEvidence: { kind: 'no-artifact' as const, reasonCode: 'not-native-evidence' as const },
});

describe('operation evidence receipt store', () => {
  it('reserves before runtime, prepares one hash-chained receipt, and recovers it', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-'));
    roots.push(stateRoot);
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await store.recover();
    const reservation = await store.reserveBeforeRuntime(actorId, 'operation-1', 65_536);
    const receipt = await store.prepareAndFsync(reservation.reservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId,
      operationId: 'operation-1',
      operationKind: 'tool',
      operationName: 'get_selection',
      argsHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      workspaceId: null,
      fileExecutionKeyHash: null,
      targetBindingHash: null,
      captureIntentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      captureResult: false,
      finalizerHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      daemonGenerationHash:
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      completedAt: '2026-08-31T00:00:00.000Z',
      terminalStatus: 'succeeded',
      resultHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      resultBytes: 2,
      resultArtifact: null,
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
    });

    expect(receipt.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.contentHash).not.toBe(receipt.receiptHash);
    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await restarted.recover();
    await expect(restarted.get(actorId, 'operation-1')).resolves.toEqual(receipt);
  });

  it('rejects a reservation used by another operation and never exposes an unprepared receipt', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-'));
    roots.push(stateRoot);
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await store.recover();
    const reservation = await store.reserveBeforeRuntime(actorId, 'operation-1', 1);
    await expect(store.get(actorId, 'operation-1')).resolves.toBeNull();
    await expect(
      store.prepareAndFsync(reservation.reservationId, {
        actorId,
        operationId: 'operation-2',
      } as never),
    ).rejects.toMatchObject({ code: 'EVIDENCE_RESERVATION_INVALID' });
  });

  it('publishes one immutable evidence generation at the exact threshold and restarts through its pointer', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-compact-'));
    roots.push(stateRoot);
    const limits = { ...OPERATION_EVIDENCE_LIMITS, compactAtRows: 1 };
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    await store.recover();
    const reservation = await store.reserveBeforeRuntime(actorId, 'operation-compact', 1);
    const receipt = await store.prepareAndFsync(
      reservation.reservationId,
      receiptInput('operation-compact'),
    );

    const names = await readdir(join(stateRoot, 'journal'));
    expect(names.filter(name => name.endsWith('.current'))).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.jsonl')),
    ).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.checkpoint.json')),
    ).toHaveLength(1);
    expect(
      names.filter(name => name.includes('.compact-') && name.endsWith('.anchor.json')),
    ).toHaveLength(1);

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    await restarted.recover();
    await expect(restarted.get(actorId, 'operation-compact')).resolves.toEqual(receipt);
  });

  it('rejects pointer-selected evidence generation corruption instead of falling back', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-corrupt-'));
    roots.push(stateRoot);
    const limits = { ...OPERATION_EVIDENCE_LIMITS, compactAtRows: 1 };
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    await store.recover();
    const reservation = await store.reserveBeforeRuntime(actorId, 'operation-corrupt', 1);
    await store.prepareAndFsync(reservation.reservationId, receiptInput('operation-corrupt'));
    const journal = join(stateRoot, 'journal');
    const selected = (await readdir(journal)).find(
      name => name.includes('.compact-') && name.endsWith('.jsonl'),
    ) as string;
    const bytes = await readFile(join(journal, selected));
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 1;
    await writeFile(join(journal, selected), bytes);

    await expect(
      new OperationEvidenceReceiptStore({ stateRoot, actorId, limits }).recover(),
    ).rejects.toMatchObject({
      code: 'EVIDENCE_RECEIPT_CORRUPT',
    });
  });

  it('retains unlinked prepared receipts and synchronously removes linked evidence at exact 30 days', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-retention-'));
    roots.push(stateRoot);
    const completedAt = 1_724_803_200_000;
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await store.recover();
    const linkedReservation = await store.reserveBeforeRuntime(actorId, 'operation-linked', 1);
    await store.prepareAndFsync(
      linkedReservation.reservationId,
      receiptInput('operation-linked', new Date(completedAt).toISOString()),
    );
    const preparedReservation = await store.reserveBeforeRuntime(actorId, 'operation-prepared', 1);
    await store.prepareAndFsync(
      preparedReservation.reservationId,
      receiptInput('operation-prepared', new Date(completedAt).toISOString()),
    );
    const removed: string[] = [];
    await store.compact({
      now: completedAt + 2_592_000_000,
      linkedAt: operationId => (operationId === 'operation-linked' ? completedAt : null),
      removeArtifacts: async receipt => {
        await expect(store.get(actorId, receipt.operationId)).resolves.toBeNull();
        removed.push(receipt.operationId);
      },
    });

    await expect(store.get(actorId, 'operation-linked')).resolves.toBeNull();
    await expect(store.get(actorId, 'operation-prepared')).resolves.toMatchObject({
      operationId: 'operation-prepared',
    });
    expect(removed).toEqual(['operation-linked']);
  });

  it('rejects the next reservation while exact evidence capacity is valid', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-capacity-'));
    roots.push(stateRoot);
    const limits = {
      ...OPERATION_EVIDENCE_LIMITS,
      maxRowsPerActor: 1,
      maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
      compactAtRows: 1,
    };
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    await store.recover();
    const reservation = await store.reserveBeforeRuntime(actorId, 'operation-held', 1);
    await store.prepareAndFsync(reservation.reservationId, receiptInput('operation-held'));
    await expect(store.reserveBeforeRuntime(actorId, 'operation-next', 1)).rejects.toMatchObject({
      code: 'EVIDENCE_CAPACITY_EXCEEDED',
    });
  });

  it('exposes exactly the active reservation operation IDs recovered from durable authority', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-recovery-owned-'));
    roots.push(stateRoot);
    const first = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await first.recover();
    await first.reserveBeforeRuntime(actorId, 'operation-owned-b', 1);
    const released = await first.reserveBeforeRuntime(actorId, 'operation-released', 1);
    await first.reserveBeforeRuntime(actorId, 'operation-owned-a', 1);
    await first.releaseWithoutReceipt(released.reservationId);

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await restarted.recover();
    expect(restarted.listPreRuntimeReservationOperationIds()).toEqual([
      'operation-owned-a',
      'operation-owned-b',
    ]);
  });

  it('serializes concurrent sibling receipts into one restart-valid actor chain', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-concurrent-'));
    roots.push(stateRoot);
    const store = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await store.recover();
    const [first, second] = await Promise.all([
      store.reserveBeforeRuntime(actorId, 'operation-concurrent-a', 1),
      store.reserveBeforeRuntime(actorId, 'operation-concurrent-b', 1),
    ]);
    await Promise.all([
      store.prepareAndFsync(first.reservationId, receiptInput('operation-concurrent-a')),
      store.prepareAndFsync(second.reservationId, receiptInput('operation-concurrent-b')),
    ]);

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await expect(restarted.recover()).resolves.toBeUndefined();
    await expect(restarted.get(actorId, 'operation-concurrent-a')).resolves.toBeDefined();
    await expect(restarted.get(actorId, 'operation-concurrent-b')).resolves.toBeDefined();
  });

  it('serializes the same actor path across two recovered receipt store instances', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-cross-instance-'));
    roots.push(stateRoot);
    const first = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    const second = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await Promise.all([first.recover(), second.recover()]);
    const [firstReservation, secondReservation] = await Promise.all([
      first.reserveBeforeRuntime(actorId, 'operation-instance-a', 1),
      second.reserveBeforeRuntime(actorId, 'operation-instance-b', 1),
    ]);
    await Promise.all([
      first.prepareAndFsync(firstReservation.reservationId, receiptInput('operation-instance-a')),
      second.prepareAndFsync(secondReservation.reservationId, receiptInput('operation-instance-b')),
    ]);

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await expect(restarted.recover()).resolves.toBeUndefined();
    await expect(restarted.get(actorId, 'operation-instance-a')).resolves.toBeDefined();
    await expect(restarted.get(actorId, 'operation-instance-b')).resolves.toBeDefined();
  });

  it('globally admits receipt reservations so two instances cannot overbook runtime capacity', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-global-reservation-'));
    roots.push(stateRoot);
    const limits = {
      ...OPERATION_EVIDENCE_LIMITS,
      maxRowsPerActor: 1,
      maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
    };
    const first = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    const second = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
    await Promise.all([first.recover(), second.recover()]);
    const outcomes = await Promise.allSettled([
      first.reserveBeforeRuntime(actorId, 'operation-global-a', 1),
      second.reserveBeforeRuntime(actorId, 'operation-global-b', 1),
    ]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('reclaims only proven side-effect-free crash reservations so repeated restarts do not exhaust capacity', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-orphan-reservation-'));
    roots.push(stateRoot);
    const limits = {
      ...OPERATION_EVIDENCE_LIMITS,
      maxRowsPerActor: 1,
      maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
    };
    for (let crash = 0; crash < 3; crash += 1) {
      const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
      await restarted.recoverPreRuntimeReservations(async reservation => ({
        journal: { kind: 'absent' },
        egress: {
          kind: 'pre-only',
          preExecutionManifestHash:
            reservation.operationAuthority!.preExecutionConsentManifestHash!,
        },
        receipt: { kind: 'absent' },
        finalizer: { kind: 'absent' },
        resultArtifact: { kind: 'absent' },
        nativeArtifact: { kind: 'absent' },
        settlement: {
          intent: {
            kind: 'pre-runtime-no-output',
            operationFingerprintHash: reservation.operationAuthority!.operationFingerprintHash,
            preExecutionManifestHash:
              reservation.operationAuthority!.preExecutionConsentManifestHash!,
            finalEgressManifestHash:
              'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
          settle: async () => undefined,
        },
      }));
      const operationId = `operation-crash-${crash}`;
      await expect(
        restarted.reserveBeforeRuntime(actorId, operationId, 1, {
          workspaceId: null,
          operationAuthority: {
            actorId,
            operationId,
            workspaceId: null,
            operationFingerprintHash:
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            preExecutionConsentManifestHash:
              'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          } as never,
        }),
      ).resolves.toMatchObject({ reservedBytes: 65_536 });
    }
  });

  it.each([
    'journal',
    'egress-final',
    'receipt',
    'finalizer',
    'result-artifact',
    'native-artifact',
  ] as const)(
    'retains a crash reservation when classifier reports contradictory %s state',
    async retainedField => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-retained-reservation-'));
      roots.push(stateRoot);
      const limits = {
        ...OPERATION_EVIDENCE_LIMITS,
        maxRowsPerActor: 1,
        maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
      };
      const first = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
      await first.recover();
      const operationId = 'operation-retained-crash';
      const operationFingerprintHash =
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
      const preExecutionManifestHash =
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
      const finalEgressManifestHash =
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const;
      await first.reserveBeforeRuntime(actorId, operationId, 1, {
        workspaceId: null,
        operationAuthority: {
          actorId,
          operationId,
          workspaceId: null,
          operationFingerprintHash,
          preExecutionConsentManifestHash: preExecutionManifestHash,
        } as never,
      });
      const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId, limits });
      await restarted.recoverPreRuntimeReservations(async () => ({
        journal:
          retainedField === 'journal'
            ? {
                kind: 'present',
                recordKind: 'active',
                status: 'queued',
                operationFingerprintHash,
                preExecutionManifestHash:
                  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                finalEgressManifestHash: null,
                operationEvidenceReceiptHash: null,
              }
            : { kind: 'absent' },
        egress:
          retainedField === 'egress-final'
            ? {
                kind: 'final',
                preExecutionManifestHash,
                finalEgressManifestHash,
                finalStatus: 'output',
                reasonCode: null,
              }
            : { kind: 'pre-only', preExecutionManifestHash },
        receipt: { kind: retainedField === 'receipt' ? 'present' : 'absent' },
        finalizer: {
          kind:
            retainedField === 'finalizer' || retainedField === 'egress-final'
              ? 'present'
              : 'absent',
        },
        resultArtifact: { kind: retainedField === 'result-artifact' ? 'present' : 'absent' },
        nativeArtifact: { kind: retainedField === 'native-artifact' ? 'present' : 'absent' },
        settlement: {
          intent: {
            kind: 'pre-runtime-no-output',
            operationFingerprintHash,
            preExecutionManifestHash,
            finalEgressManifestHash,
          },
          settle: async () => undefined,
        },
      }));

      await expect(
        restarted.reserveBeforeRuntime(actorId, 'operation-must-not-steal', 1, {
          workspaceId: null,
        }),
      ).rejects.toMatchObject({ code: 'EVIDENCE_CAPACITY_EXCEEDED' });
    },
  );

  it('recovers a published removal intent after restart and cleans only while the receipt stays absent', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-cleanup-restart-'));
    roots.push(stateRoot);
    const completedAt = 1_724_803_200_000;
    const first = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await first.recover();
    const reservation = await first.reserveBeforeRuntime(actorId, 'operation-cleanup', 1);
    await first.prepareAndFsync(
      reservation.reservationId,
      receiptInput('operation-cleanup', new Date(completedAt).toISOString()),
    );
    await first.compact({
      now: completedAt + 2_592_000_000,
      linkedAt: operationId => (operationId === 'operation-cleanup' ? completedAt : null),
    });

    const restarted = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await restarted.recover();
    const removed: string[] = [];
    await restarted.drainPendingArtifactCleanup(async receipt => {
      await expect(restarted.get(actorId, receipt.operationId)).resolves.toBeNull();
      removed.push(receipt.operationId);
    });

    expect(removed).toEqual(['operation-cleanup']);
    await restarted.drainPendingArtifactCleanup(async receipt => {
      removed.push(`duplicate:${receipt.operationId}`);
    });
    expect(removed).toEqual(['operation-cleanup']);
  });

  it('reserves an entire cleanup-intent batch before publication so a near-cap failure is retryable', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-receipt-intent-cap-'));
    roots.push(stateRoot);
    const completedAt = 1_724_803_200_000;
    const writer = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await writer.recover();
    for (const operationId of ['operation-cap-a', 'operation-cap-b']) {
      const reservation = await writer.reserveBeforeRuntime(actorId, operationId, 1);
      await writer.prepareAndFsync(
        reservation.reservationId,
        receiptInput(operationId, new Date(completedAt).toISOString()),
      );
    }
    const receiptBytes = (await stat(writer.logPath)).size;
    const limited = new OperationEvidenceReceiptStore({
      stateRoot,
      actorId,
      limits: { ...OPERATION_EVIDENCE_LIMITS, maxBytesPerActor: receiptBytes },
    });
    await limited.recover();

    await expect(
      limited.compact({ now: completedAt + 2_592_000_000, linkedAt: () => completedAt }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CAPACITY_EXCEEDED' });
    expect((await stat(limited.cleanupIntentPath)).size).toBe(0);
    await expect(limited.get(actorId, 'operation-cap-a')).resolves.toBeDefined();
    await expect(limited.get(actorId, 'operation-cap-b')).resolves.toBeDefined();
  });
});
