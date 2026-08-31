import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import {
  DurableOperationFinalizer,
  recoverDurableOperationState,
} from '../../src/execution/operation-executor.js';
import {
  OperationJournal,
  hashOperationFingerprint,
  type NewOperationRecord,
} from '../../src/execution/operation-journal.js';
import {
  createNoOutputEgressManifest,
  createOutputEgressManifest,
  createPreExecutionConsentManifest,
} from '../../src/policy/egress-policy.js';

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const domainHash = (domain: string, value: string) =>
  `sha256:${createHash('sha256')
    .update(domain, 'utf8')
    .update(Buffer.from([0]))
    .update(value, 'utf8')
    .digest('hex')}` as const;
const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const dispatchedRecord = (operationId: string): NewOperationRecord => {
  const fingerprint = {
    actorId,
    operationId,
    operationKind: 'tool' as const,
    operationName: 'create_text' as const,
    argsHash: hash('1'),
    workspaceId: null,
    fileExecutionKeyHash: null,
    targetBindingHash: null,
    captureIntentHash: hash('2'),
  };
  return {
    ...fingerprint,
    originAuthSessionId: authSessionId,
    origin: { kind: 'entry', entryPath: 'mcp-direct', authSessionId },
    issuedAt: 1_724_803_200_000,
    operationFingerprintHash: hashOperationFingerprint(fingerprint),
    resultHash: null,
    resultBytes: null,
    fileExecutionKey: null,
    pluginGeneration: null,
    policyId: 'tool:create_text:v1',
    effectSummary: ['figma-write'],
    approvalId: null,
    preExecutionConsentManifestHash: null,
    finalEgressManifestHash: null,
    operationEvidenceReceiptHash: null,
  };
};

describe('durable operation finalizer', () => {
  it('orders artifact, prepared receipt, matching finalizer, terminal fsync, then frame', async () => {
    const events: string[] = [];
    const finalizer = new DurableOperationFinalizer({
      artifacts: {
        createNew: async () => {
          events.push('artifact-fsync');
          return {
            artifactRelativePath: '.sfp/operation-evidence/a/result.v1.json',
            artifactDigest64: 'a'.repeat(64),
            resultSchemaHash: hash('b'),
          };
        },
      },
      receipts: {
        prepareAndFsync: async (_reservationId, receipt) => {
          events.push('receipt-fsync');
          return {
            ...receipt,
            previousReceiptHash: null,
            contentHash: hash('c'),
            receiptHash: hash('d'),
          } as never;
        },
      },
      egress: {
        finalize: async (_reservation, manifest) => {
          events.push('finalizer-fsync');
          return { finalManifestHash: manifest.manifestHash, finalized: true as const };
        },
      },
      journal: {
        transition: async (_operationId, status, patch) => {
          events.push('terminal-fsync');
          return { status, ...patch } as never;
        },
      },
      emitTerminal: async () => {
        events.push('terminal-frame');
      },
    });

    await finalizer.succeed({
      actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      operationId: 'operation-1',
      operationKind: 'tool',
      operationName: 'get_selection',
      argsHash: hash('1'),
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
      fileExecutionKeyHash: null,
      targetBindingHash: null,
      captureIntentHash: hash('2'),
      captureIntent: {
        captureResult: true,
        relativePath: '.sfp/operation-evidence/a/result.v1.json',
      } as never,
      canonicalRedactedBytes: Buffer.from('{}'),
      resultSchemaHash: hash('b'),
      resultHash: hash('a'),
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
      daemonGenerationHash: hash('3'),
      evidenceReservationId: 'evidence-reservation-1',
      egressReservation: { preManifestHash: hash('4') } as never,
      outputManifest: { finalStatus: 'output', manifestHash: hash('5') } as never,
      completedAt: '2026-08-31T00:00:00.000Z',
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      result: {},
    });

    expect(events).toEqual([
      'artifact-fsync',
      'receipt-fsync',
      'finalizer-fsync',
      'terminal-fsync',
      'terminal-frame',
    ]);
  });

  it('never upgrades a receipt without a matching finalizer to succeeded', async () => {
    const transition = vi.fn<() => Promise<never>>(
      async () => ({ status: 'outcome-unknown' }) as never,
    );
    const finalizer = new DurableOperationFinalizer({
      artifacts: { createNew: vi.fn<() => never>() },
      receipts: { prepareAndFsync: vi.fn<() => never>() },
      egress: { finalize: vi.fn<() => never>() },
      journal: { transition },
      emitTerminal: vi.fn<() => never>(),
    });

    await finalizer.recoverDispatched({
      operationId: 'operation-1',
      preparedReceipt: { finalizerHash: hash('a'), terminalStatus: 'succeeded' } as never,
      verifiedFinalizer: null,
    });

    expect(transition).toHaveBeenCalledWith('operation-1', 'outcome-unknown', {
      errorCode: 'EVIDENCE_FINALIZER_MISSING',
      resultHash: null,
      resultBytes: null,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: null,
    });
  });

  it.each(['succeeded', 'failed'] as const)(
    'recovers a matching prepared receipt/finalizer as %s after a durable generation fence',
    async terminalStatus => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-finalizer-recovery-'));
      roots.push(stateRoot);
      const now = 1_724_803_200_000;
      const operationId = `operation-${terminalStatus}`;
      const journal = new OperationJournal({ stateRoot, actorId, now: () => now });
      const egress = new EgressManifestStore({ stateRoot, actorId, now: () => now });
      const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
      await Promise.all([journal.recover(), egress.recover(now), receipts.recover()]);
      const pre = createPreExecutionConsentManifest({
        consentId: null,
        mode: 'local-trusted',
        inputClasses: ['public'],
        possibleResultClasses: ['public'],
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
        inputBytes: 2,
        inputTokens: 1,
      });
      const reservation = await egress.reservePre(
        actorId,
        'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
        operationId,
        pre,
      );
      await journal.appendInitial(dispatchedRecord(operationId), 'queued', {
        leaderGeneration: 'generation-1',
      });
      await journal.transition(
        operationId,
        'dispatched',
        {
          preExecutionConsentManifestHash: pre.manifestHash,
        },
        { expectedLeaderGeneration: 'generation-1' },
      );
      const resultHash = hash('a');
      const finalManifest =
        terminalStatus === 'succeeded'
          ? createOutputEgressManifest({
              preExecutionManifestHash: pre.manifestHash,
              resultClasses: ['public'],
              outputBytes: 2,
              outputTokens: 1,
              redactedFieldCount: 0,
              resultHash,
              resultBytes: 2,
              payloadHash: resultHash,
            })
          : createNoOutputEgressManifest({
              preExecutionManifestHash: pre.manifestHash,
              reasonCode: 'runtime-failed',
            });
      const evidenceReservation = await receipts.reserveBeforeRuntime(actorId, operationId, 1);
      await receipts.prepareAndFsync(evidenceReservation.reservationId, {
        schemaVersion: 1,
        state: 'prepared',
        actorId,
        operationId,
        operationKind: 'tool',
        operationName: 'create_text',
        argsHash: hash('1'),
        workspaceId: null,
        fileExecutionKeyHash: null,
        targetBindingHash: null,
        captureIntentHash: hash('2'),
        captureResult: false,
        finalizerHash: finalManifest.manifestHash,
        daemonGenerationHash: domainHash('sfp-daemon-generation-v1', 'generation-1'),
        completedAt: new Date(now).toISOString(),
        terminalStatus,
        resultHash: terminalStatus === 'succeeded' ? resultHash : null,
        resultBytes: terminalStatus === 'succeeded' ? 2 : 0,
        resultArtifact: null,
        nativeEvidence:
          terminalStatus === 'succeeded'
            ? { kind: 'no-artifact', reasonCode: 'not-native-evidence' }
            : { kind: 'no-artifact', reasonCode: 'operation-failed' },
      } as never);
      await egress.finalize(reservation, finalManifest);
      await journal.fenceLeaderGeneration('generation-1');

      const restartedJournal = new OperationJournal({ stateRoot, actorId, now: () => now + 1 });
      const restartedEgress = new EgressManifestStore({ stateRoot, actorId, now: () => now + 1 });
      const restartedReceipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
      const finalizer = new DurableOperationFinalizer({
        artifacts: { createNew: vi.fn<() => never>() },
        receipts: restartedReceipts,
        egress: restartedEgress,
        journal: restartedJournal,
        emitTerminal: vi.fn<() => never>(),
      });
      const phases: string[] = [];
      await recoverDurableOperationState({
        actorId,
        now: now + 1,
        egress: restartedEgress,
        receipts: restartedReceipts,
        journal: restartedJournal,
        finalizer,
        onPhase: phase => phases.push(phase),
      });

      expect(phases).toEqual(['egress', 'receipts', 'journal', 'reconcile']);
      expect(restartedJournal.get(operationId)).toMatchObject({
        status: terminalStatus,
        resultHash: terminalStatus === 'succeeded' ? resultHash : null,
        operationEvidenceReceiptHash: expect.stringMatching(/^sha256:/u),
        finalEgressManifestHash: finalManifest.manifestHash,
      });
      const secondRestart = new OperationJournal({ stateRoot, actorId, now: () => now + 2 });
      await secondRestart.recover();
      expect(secondRestart.get(operationId)).toMatchObject({
        status: terminalStatus,
        finalEgressManifestHash: finalManifest.manifestHash,
      });
    },
  );

  it('settles a receipt without a matching finalizer as outcome-unknown with a null receipt link', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-finalizer-missing-'));
    roots.push(stateRoot);
    const now = 1_724_803_200_000;
    const operationId = 'operation-missing-finalizer';
    const journal = new OperationJournal({ stateRoot, actorId, now: () => now });
    const egress = new EgressManifestStore({ stateRoot, actorId, now: () => now });
    const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    await Promise.all([journal.recover(), egress.recover(now), receipts.recover()]);
    const pre = createPreExecutionConsentManifest({
      consentId: null,
      mode: 'local-trusted',
      inputClasses: ['public'],
      possibleResultClasses: ['public'],
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      inputBytes: 2,
      inputTokens: 1,
    });
    await egress.reservePre(actorId, 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA', operationId, pre);
    await journal.appendInitial(dispatchedRecord(operationId), 'queued', {
      leaderGeneration: 'generation-1',
    });
    await journal.transition(
      operationId,
      'dispatched',
      {
        preExecutionConsentManifestHash: pre.manifestHash,
      },
      { expectedLeaderGeneration: 'generation-1' },
    );
    const evidenceReservation = await receipts.reserveBeforeRuntime(actorId, operationId, 1);
    await receipts.prepareAndFsync(evidenceReservation.reservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId,
      operationId,
      operationKind: 'tool',
      operationName: 'create_text',
      argsHash: hash('1'),
      workspaceId: null,
      fileExecutionKeyHash: null,
      targetBindingHash: null,
      captureIntentHash: hash('2'),
      captureResult: false,
      finalizerHash: hash('f'),
      daemonGenerationHash: domainHash('sfp-daemon-generation-v1', 'generation-1'),
      completedAt: new Date(now).toISOString(),
      terminalStatus: 'succeeded',
      resultHash: hash('a'),
      resultBytes: 2,
      resultArtifact: null,
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
    });
    await journal.fenceLeaderGeneration('generation-1');

    const restartedJournal = new OperationJournal({ stateRoot, actorId, now: () => now + 1 });
    const restartedEgress = new EgressManifestStore({ stateRoot, actorId, now: () => now + 1 });
    const restartedReceipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
    const finalizer = new DurableOperationFinalizer({
      artifacts: { createNew: vi.fn<() => never>() },
      receipts: restartedReceipts,
      egress: restartedEgress,
      journal: restartedJournal,
      emitTerminal: vi.fn<() => never>(),
    });
    await recoverDurableOperationState({
      actorId,
      now: now + 1,
      egress: restartedEgress,
      receipts: restartedReceipts,
      journal: restartedJournal,
      finalizer,
    });

    expect(restartedJournal.get(operationId)).toMatchObject({
      status: 'outcome-unknown',
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: null,
    });
  });

  it.each([
    ['actorId', 'actor1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
    ['operationName', 'delete_nodes'],
    ['argsHash', hash('4')],
    ['captureIntentHash', hash('5')],
    ['daemonGenerationHash', hash('6')],
  ] as const)(
    'never repairs success when receipt %s differs from the dispatched journal identity',
    async (field, value) => {
      const transition = vi.fn<() => Promise<never>>(async () => ({}) as never);
      const finalizer = new DurableOperationFinalizer({
        artifacts: { createNew: vi.fn<() => never>() },
        receipts: { prepareAndFsync: vi.fn<() => never>() },
        egress: { finalize: vi.fn<() => never>() },
        journal: { transition },
        emitTerminal: vi.fn<() => never>(),
      });
      const record = {
        ...dispatchedRecord('operation-identity'),
        status: 'dispatched',
        leaderGeneration: 'generation-1',
        preExecutionConsentManifestHash: hash('7'),
      } as never;
      const receipt = {
        schemaVersion: 1,
        state: 'prepared',
        actorId,
        operationId: 'operation-identity',
        operationKind: 'tool',
        operationName: 'create_text',
        argsHash: hash('1'),
        workspaceId: null,
        fileExecutionKeyHash: null,
        targetBindingHash: null,
        captureIntentHash: hash('2'),
        captureResult: false,
        finalizerHash: hash('8'),
        daemonGenerationHash: hash('3'),
        completedAt: new Date(1_724_803_200_000).toISOString(),
        previousReceiptHash: null,
        contentHash: hash('9'),
        receiptHash: hash('a'),
        terminalStatus: 'succeeded',
        resultHash: hash('b'),
        resultBytes: 2,
        resultArtifact: null,
        nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
        [field]: value,
      } as never;
      await finalizer.recoverDispatched({
        operationId: 'operation-identity',
        record,
        preparedReceipt: receipt,
        verifiedFinalizer: {
          finalStatus: 'output',
          manifestHash: hash('8'),
          preExecutionManifestHash: hash('7'),
          resultHash: hash('b'),
          reasonCode: null,
        },
      });

      expect(transition).toHaveBeenCalledWith(
        'operation-identity',
        'outcome-unknown',
        expect.objectContaining({ operationEvidenceReceiptHash: null }),
      );
    },
  );
});
