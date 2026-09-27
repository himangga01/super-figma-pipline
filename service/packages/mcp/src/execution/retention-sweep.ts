import type {
  OperationEvidenceReceiptV1,
  VerifiedNativeEvidenceContextV1,
  WorkspaceRoot,
} from '@sfp/shared';

import type { OperationEvidenceArtifactStore } from '../fs/operation-evidence-artifact-store.js';
import {
  sweepAvailableWorkspaces,
  type WorkspaceSweepSummary,
} from '../fs/workspace-config-store.js';
import type { NativeEvidenceArtifactPort } from './native-evidence-artifact-port.js';
import { nativeEvidenceContextHash } from './operation-evidence-projector.js';
import {
  CLEANUP_INTENT_MAX_ATTEMPTS,
  type CleanupDrainReport,
  type CleanupIntentDecision,
} from './operation-evidence-receipt-store.js';
import type { OperationRetentionScope } from './retention-scope.js';

/*
 * Leader retention sweep (LC-1, T09). Before T09 the leader awaited one sweep inside runtime
 * initialization, under one acquisition of the recipe-hold retention lock, and the first cleanup
 * intent that threw (every `snapshot` and `grounding-graph` receipt did) failed initialization
 * on every start. Now the sweep runs after initialization, each batch takes the lock on its own,
 * every cleanup intent and every workspace scan is isolated, and failures are logged.
 */
export const RETENTION_SWEEP_LIMITS = Object.freeze({
  /** Cleanup intents drained under one acquisition of the recipe-hold retention lock. */
  cleanupIntentsPerBatch: 32,
  /** The period of the sweeps that follow the startup sweep. */
  intervalMs: 86_400_000,
});

const WELL_FORMED_CODE = /^[A-Z][A-Z0-9_]{0,95}$/u;
/** A log label that never carries an error message, which can name private paths. */
const errorLabel = (error: unknown): string => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && WELL_FORMED_CODE.test(code)) return code;
  return error instanceof Error ? error.name : 'NonError';
};
const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

const DONE: CleanupIntentDecision = Object.freeze({ outcome: 'done' });
const deferred = (reasonCode: string): CleanupIntentDecision =>
  Object.freeze({ outcome: 'deferred', reasonCode });

/** The T08 cause of a registration that is not available, or undefined when it is available. */
const unavailableReason = (workspace: Readonly<WorkspaceRoot>): string | undefined => {
  if (workspace.availability === undefined || workspace.availability === 'available') {
    return undefined;
  }
  if (workspace.availability === 'legacy-unbound') return 'WORKSPACE_ROOT_UNBOUND';
  return workspace.unavailableReason ?? 'WORKSPACE_ROOT_MISSING';
};

export interface RetainedEvidenceCleanupContext {
  /** The recipe-hold snapshot of the batch that runs this cleanup. */
  isHeld(operationId: string): boolean;
  /** The workspace registrations, listed once for the batch with their T08 availability. */
  workspaces: readonly Readonly<WorkspaceRoot>[];
  artifacts: Pick<OperationEvidenceArtifactStore, 'removeLinked'>;
  nativeArtifacts: Pick<NativeEvidenceArtifactPort, 'removeLinkedManifest'>;
}

/**
 * The retention cleanup of one expired receipt's evidence:
 *
 * - Held evidence is deferred.
 * - `snapshot` and `grounding-graph` evidence is only detached: the cleanup intent completes and
 *   releases the receipt linkage, and the workspace files stay. Graph files are rewritten and
 *   depend on their snapshots, so deleting them stays the owner's decision.
 * - Result artifacts and `export` manifests are removed through their stores, as before T09. An
 *   unregistered workspace gives done, because the daemon has no authority over that directory any
 *   more. An unavailable or legacy-unbound workspace (T08) defers the cleanup until the owner
 *   rebinds or removes it. A verifiably missing operation directory is done inside the stores.
 *
 * Anything else throws, and the drain records a failed attempt.
 */
export const cleanupRetainedEvidence = async (
  receipt: Readonly<OperationEvidenceReceiptV1>,
  context: Readonly<RetainedEvidenceCleanupContext>,
): Promise<CleanupIntentDecision> => {
  if (context.isHeld(receipt.operationId)) return deferred('RECIPE_HOLD_RETENTION_CONFLICT');
  if (receipt.workspaceId === null) {
    if (receipt.resultArtifact !== null || receipt.nativeEvidence.kind !== 'no-artifact') {
      throw Object.assign(new Error('retained evidence lacks a workspace binding'), {
        code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
      });
    }
    return DONE;
  }
  const workspaceId = receipt.workspaceId;
  const exportEvidence = receipt.nativeEvidence.kind === 'export' ? receipt.nativeEvidence : null;
  // `snapshot` and `grounding-graph` evidence is detached; `no-artifact` has nothing to remove.
  if (receipt.resultArtifact === null && exportEvidence === null) return DONE;
  const registration = context.workspaces.find(row => row.workspaceId === workspaceId);
  if (registration === undefined) return DONE;
  const unavailable = unavailableReason(registration);
  if (unavailable !== undefined) return deferred(unavailable);
  try {
    if (receipt.resultArtifact !== null) {
      await context.artifacts.removeLinked({
        workspaceId,
        operationId: receipt.operationId,
        artifact: receipt.resultArtifact,
      });
    }
    if (exportEvidence !== null) {
      const base = Object.freeze({ operationId: receipt.operationId, workspaceId });
      await context.nativeArtifacts.removeLinkedManifest({
        context: Object.freeze({
          ...base,
          contextHash: nativeEvidenceContextHash(base),
        }) as VerifiedNativeEvidenceContextV1,
        evidence: exportEvidence,
      });
    }
  } catch (error) {
    // The registration changed after this batch listed it.
    if (errorCode(error) === 'WORKSPACE_NOT_CONFIGURED') return DONE;
    if (errorCode(error) === 'WORKSPACE_ROOT_UNAVAILABLE') {
      const cause = errorCode((error as { cause?: unknown }).cause);
      return deferred(
        typeof cause === 'string' && /^WORKSPACE_ROOT_[A-Z_]{1,64}$/u.test(cause)
          ? cause
          : 'WORKSPACE_ROOT_UNAVAILABLE',
      );
    }
    throw error;
  }
  return DONE;
};

export type RetentionSweepPhase =
  | 'compaction'
  | 'cleanup-intents'
  | 'workspace-scans'
  | 'tombstone-purge';

export interface RetentionSweepDependencies {
  /**
   * Runs one batch while holding the recipe-hold retention lock, with a hold snapshot taken at
   * acquisition (RecipeEvidenceHolds.withRetentionSweep). The lock is released between batches.
   */
  withRetentionBatch<T>(work: (scope: OperationRetentionScope) => Promise<T>): Promise<T>;
  compactEvidence(now: number, scope: OperationRetentionScope): Promise<void>;
  drainCleanupIntents(
    scope: OperationRetentionScope,
    batch: Readonly<{ after: string | null; limit: number }>,
  ): Promise<CleanupDrainReport>;
  listWorkspaces(): Promise<readonly Readonly<WorkspaceRoot>[]>;
  scanWorkspace(workspace: Readonly<WorkspaceRoot>, scope: OperationRetentionScope): Promise<void>;
  purgeExpiredTombstones(now: number, scope: OperationRetentionScope): Promise<void>;
  log(line: string): void;
  now(): number;
  /** Aborts when the leader generation closes; the sweep stops at the next batch boundary. */
  signal?: AbortSignal;
}

export interface RetentionSweepSummary {
  readonly aborted: boolean;
  readonly failedPhases: readonly RetentionSweepPhase[];
  readonly cleanup: Readonly<{
    done: number;
    deferred: number;
    failed: number;
    quarantined: number;
  }>;
  readonly workspaces: WorkspaceSweepSummary;
}

/**
 * One retention sweep, in batches that each take the recipe-hold retention lock:
 *
 * 1. Receipt and egress compaction. It turns expired receipts into durable cleanup intents.
 * 2. The cleanup intents, RETENTION_SWEEP_LIMITS.cleanupIntentsPerBatch at a time.
 * 3. The orphan scan of each available workspace, one workspace per batch.
 * 4. The journal tombstone purge, only after a successful compaction, because the compaction finds
 *    expired receipts through the settlement times of those tombstones.
 *
 * A failing phase is logged and the next phase still runs. The sweep never rejects for a phase
 * failure; it stops early only when the signal aborts.
 */
export const runRetentionSweep = async (
  dependencies: RetentionSweepDependencies,
): Promise<RetentionSweepSummary> => {
  const now = dependencies.now();
  const stopped = (): boolean => dependencies.signal?.aborted === true;
  const failedPhases: RetentionSweepPhase[] = [];
  const cleanup = { done: 0, deferred: 0, failed: 0, quarantined: 0 };
  let workspaces: WorkspaceSweepSummary = Object.freeze({ scanned: [], skipped: [], failed: [] });

  let compacted = false;
  if (!stopped()) {
    try {
      await dependencies.withRetentionBatch(scope => dependencies.compactEvidence(now, scope));
      compacted = true;
    } catch (error) {
      failedPhases.push('compaction');
      dependencies.log(
        `[retention] evidence compaction failed (${errorLabel(error)}); the sweep continues`,
      );
    }
  }

  const deferrals = new Map<
    string,
    { workspaceId: string | null; reasonCode: string; count: number }
  >();
  try {
    let after: string | null = null;
    /* eslint-disable no-await-in-loop -- each batch releases the lock before the next one */
    while (!stopped()) {
      const cursor: string | null = after;
      const report: CleanupDrainReport = await dependencies.withRetentionBatch(scope =>
        dependencies.drainCleanupIntents(scope, {
          after: cursor,
          limit: RETENTION_SWEEP_LIMITS.cleanupIntentsPerBatch,
        }),
      );
      for (const result of report.results) {
        if (result.outcome === 'done') cleanup.done += 1;
        else if (result.outcome === 'deferred') {
          cleanup.deferred += 1;
          const key = `${result.workspaceId ?? ''}\0${result.reasonCode}`;
          const row = deferrals.get(key) ?? {
            workspaceId: result.workspaceId,
            reasonCode: result.reasonCode,
            count: 0,
          };
          row.count += 1;
          deferrals.set(key, row);
        } else if (result.outcome === 'failed') {
          cleanup.failed += 1;
          dependencies.log(
            `[retention] cleanup intent ${result.operationId} for workspace ${result.workspaceId ?? '(none)'} failed (${result.errorCode}; attempt ${result.attempts} of ${CLEANUP_INTENT_MAX_ATTEMPTS}); it is retried by the next sweep`,
          );
        } else {
          cleanup.quarantined += 1;
          dependencies.log(
            `[retention] cleanup intent ${result.operationId} for workspace ${result.workspaceId ?? '(none)'} is quarantined after ${result.attempts} failed attempts (${result.errorCode}); its evidence is left in place for manual cleanup`,
          );
        }
      }
      if (report.next === null) break;
      if (cursor !== null && report.next <= cursor) {
        throw Object.assign(new Error('cleanup intent cursor did not advance'), {
          code: 'RETENTION_CURSOR_STALLED',
        });
      }
      after = report.next;
    }
    /* eslint-enable no-await-in-loop */
  } catch (error) {
    failedPhases.push('cleanup-intents');
    dependencies.log(
      `[retention] cleanup intent drain failed (${errorLabel(error)}); the sweep continues`,
    );
  }
  for (const { workspaceId, reasonCode, count } of deferrals.values()) {
    const held = reasonCode === 'RECIPE_HOLD_RETENTION_CONFLICT';
    dependencies.log(
      `[retention] ${count} cleanup ${count === 1 ? 'intent' : 'intents'} for workspace ${workspaceId ?? '(none)'} ${count === 1 ? 'is' : 'are'} deferred (${reasonCode}) ${
        held
          ? `while recipe evidence holds retain ${count === 1 ? 'it' : 'them'}`
          : 'until it is available again, rebound or removed'
      }`,
    );
  }

  if (!stopped()) {
    try {
      workspaces = await sweepAvailableWorkspaces(
        await dependencies.listWorkspaces(),
        dependencies.log,
        async workspace => {
          await dependencies.withRetentionBatch(scope =>
            dependencies.scanWorkspace(workspace, scope),
          );
        },
        dependencies.signal,
      );
    } catch (error) {
      failedPhases.push('workspace-scans');
      dependencies.log(
        `[retention] workspace listing failed (${errorLabel(error)}); no workspace was scanned`,
      );
    }
  }

  if (!stopped()) {
    if (!compacted) {
      failedPhases.push('tombstone-purge');
      dependencies.log('[retention] tombstone purge skipped because evidence compaction failed');
    } else {
      try {
        await dependencies.withRetentionBatch(scope =>
          dependencies.purgeExpiredTombstones(now, scope),
        );
      } catch (error) {
        failedPhases.push('tombstone-purge');
        dependencies.log(`[retention] tombstone purge failed (${errorLabel(error)})`);
      }
    }
  }

  const aborted = stopped();
  dependencies.log(
    `[retention] sweep finished: cleanup done=${cleanup.done} deferred=${cleanup.deferred} failed=${cleanup.failed} quarantined=${cleanup.quarantined}; workspaces scanned=${workspaces.scanned.length} skipped=${workspaces.skipped.length} failed=${workspaces.failed.length}${
      failedPhases.length > 0 ? `; failed phases ${failedPhases.join(', ')}` : ''
    }${aborted ? '; stopped early because the leader generation closed' : ''}`,
  );
  return Object.freeze({
    aborted,
    failedPhases: Object.freeze(failedPhases),
    cleanup: Object.freeze(cleanup),
    workspaces,
  });
};

export interface RetentionSchedule {
  stop(): void;
}

/**
 * Starts the sweeps of one leader runtime once its initialization has returned: the startup sweep
 * on the next timer turn, then one sweep per interval. Scheduling never waits for a sweep, and a
 * failed sweep is only logged, so initialization and tool calls do not depend on retention.
 */
export const scheduleRetentionSweeps = (
  retention: { sweep(): Promise<void> },
  log: (line: string) => void,
  intervalMs: number = RETENTION_SWEEP_LIMITS.intervalMs,
): RetentionSchedule => {
  const run = (trigger: 'startup' | 'scheduled'): void => {
    void retention.sweep().catch((error: unknown) => {
      // Demotion closes the generation's retention; that is not a sweep failure.
      if (errorCode(error) === 'LEADER_GENERATION_CLOSED') return;
      log(`[retention] ${trigger} sweep failed (${errorLabel(error)})`);
    });
  };
  const startup = setTimeout(() => run('startup'), 0);
  const interval = setInterval(() => run('scheduled'), intervalMs);
  startup.unref();
  interval.unref();
  return Object.freeze({
    stop: () => {
      clearTimeout(startup);
      clearInterval(interval);
    },
  });
};
