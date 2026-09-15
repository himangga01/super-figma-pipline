import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { canonicalJson, contentHash } from '@sfp/ir';
import {
  createToolInvocationOptions,
  OPERATION_CAPTURE_MAX_BYTES,
  type ActorContext,
  type OperationEvidenceViewV1,
  type OperationRecord,
  type OperationTombstone,
  type RuntimeExecutionScope,
  type WorkspacePolicy,
} from '@sfp/shared';
import { z } from 'zod';

import { RESULT_SCHEMAS } from '../../../../shared/src/result-schemas.js';
import type { OperationIdIssuer } from '../../execution/operation-id.js';
import {
  withOperationRetentionScope,
  type OperationRetentionScope,
} from '../../execution/retention-scope.js';
import { withCanonicalPathMutex, withRetainedDirectoryChain } from '../../fs/atomic-file.js';
import { RepoReader } from '../../fs/repo-walk.js';
import type { BoundStatePermissions } from '../../security/state-permissions.js';
import { PortalStore } from '../store.js';
import {
  RecipeEvidenceBindingSchema,
  RecipeEvidenceResultSchema,
  RecipeEvidenceVerifiedSchema,
  type RecipeEvidenceBinding,
  type RecipeEvidenceResult,
} from './evidence-contract.js';

type Scope = Pick<RuntimeExecutionScope, 'actor' | 'workspace'>;
type Cancellation = Pick<AbortSignal, 'throwIfAborted'>;
type Journal = { get(operationId: string): OperationRecord | OperationTombstone | undefined };
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const error = (code: string) => Object.assign(new Error(code), { code });
const bindingHash = (binding: RecipeEvidenceBinding) =>
  contentHash('sfp-recipe-evidence-binding-v1', binding);
const stableKey = (binding: RecipeEvidenceBinding) =>
  contentHash('sfp-recipe-evidence-key-v1', {
    actorId: binding.actorId,
    planHash: binding.planHash,
    stepId: binding.stepId,
  });
export const recipeResultSchemaHash = (
  operationName: RecipeEvidenceBinding['operationName'],
): `sha256:${string}` => {
  const schema = RESULT_SCHEMAS[operationName];
  if (!schema) throw error('RECIPE_HOLD_RESULT_SCHEMA_MISSING');
  return `sha256:${createHash('sha256').update('sfp-result-schema-v1\0').update(canonicalJson(schema.toJSONSchema())).digest('hex')}`;
};
export const RECIPE_EVIDENCE_HOLD_LIMITS = Object.freeze({
  activePerOwner: 1024,
  activeGlobal: 2048,
  rowsPerOwner: 2048,
  rowsGlobal: 4096,
  reservedBytesPerOwner: 2_147_483_648,
  reservedBytesGlobal: 4_294_967_296,
  dependenciesPerHold: 128,
});
const RowSchema = z
  .object({
    holdId: hash,
    key: hash,
    binding: RecipeEvidenceBindingSchema,
    state: z.enum(['held', 'released']),
    reservedBytes: z.number().int().min(0).max(8_388_608),
    createdAt: z.iso.datetime(),
    releasedAt: z.iso.datetime().nullable(),
    verified: RecipeEvidenceVerifiedSchema.nullable(),
    dependencies: z
      .array(z.string().min(1).max(256))
      .max(RECIPE_EVIDENCE_HOLD_LIMITS.dependenciesPerHold),
  })
  .strict();
const IndexSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    rows: z.array(RowSchema).max(RECIPE_EVIDENCE_HOLD_LIMITS.rowsGlobal),
  })
  .strict()
  .superRefine((index, ctx) => {
    if (
      new Set(index.rows.map(row => row.key)).size !== index.rows.length ||
      new Set(index.rows.map(row => row.binding.operationId)).size !== index.rows.length
    )
      ctx.addIssue({ code: 'custom', message: 'RECIPE_HOLD_INDEX_DUPLICATE' });
    for (const row of index.rows)
      if (
        row.holdId !== bindingHash(row.binding) ||
        row.key !== stableKey(row.binding) ||
        new Set(row.dependencies).size !== row.dependencies.length ||
        (row.state === 'released' &&
          (row.dependencies.length > 0 || row.reservedBytes !== 0 || row.releasedAt === null)) ||
        (row.state === 'held' &&
          (row.releasedAt !== null ||
            (row.verified !== null
              ? row.reservedBytes !== row.verified.resultBytes
              : row.reservedBytes !== OPERATION_CAPTURE_MAX_BYTES &&
                row.reservedBytes !== row.binding.maxResultBytes)))
      )
        ctx.addIssue({ code: 'custom', message: 'RECIPE_HOLD_INDEX_INVALID' });
  });
type Index = z.infer<typeof IndexSchema>;
type Row = z.infer<typeof RowSchema>;
interface Dependencies {
  stateRoot: string;
  store: PortalStore;
  permissions: BoundStatePermissions;
  issuer: OperationIdIssuer;
  operations: Journal;
  workspacePolicy: WorkspacePolicy;
  readEvidence(
    actor: Readonly<ActorContext>,
    operationId: string,
  ): Promise<Readonly<OperationEvidenceViewV1>>;
  hasRetainedEvidence(actorId: ActorContext['actorId'], operationId: string): Promise<boolean>;
  now?: () => number;
  limits?: Partial<Record<keyof typeof RECIPE_EVIDENCE_HOLD_LIMITS, number>>;
}
/** Every mutation and complete retention sweep uses the same durable state-root mutex. */
export class RecipeEvidenceHolds {
  private readonly limits: Readonly<Record<keyof typeof RECIPE_EVIDENCE_HOLD_LIMITS, number>>;
  constructor(private readonly dependencies: Dependencies) {
    this.limits = Object.freeze(
      Object.fromEntries(
        Object.entries(RECIPE_EVIDENCE_HOLD_LIMITS).map(([key, value]) => {
          const provided =
            dependencies.limits?.[key as keyof typeof RECIPE_EVIDENCE_HOLD_LIMITS] ?? value;
          if (!Number.isSafeInteger(provided) || provided < 1 || provided > value)
            throw error('RECIPE_HOLD_LIMIT_INVALID');
          return [key, provided];
        }),
      ) as Record<keyof typeof RECIPE_EVIDENCE_HOLD_LIMITS, number>,
    );
  }
  private now() {
    return new Date((this.dependencies.now ?? Date.now)()).toISOString();
  }
  private async locked<T>(
    work: (index: Index, save: () => Promise<void>) => Promise<T>,
    signal?: Cancellation,
  ): Promise<T> {
    signal?.throwIfAborted();
    const root = resolve(this.dependencies.stateRoot);
    await this.dependencies.permissions.verifySecure(root);
    return withRetainedDirectoryChain(root, root, async authority =>
      withCanonicalPathMutex(
        join(root, '.recipe-evidence-retention'),
        async () => {
          signal?.throwIfAborted();
          const current = await this.dependencies.store.get('recipe-holds', 'index', IndexSchema);
          const index = current ?? { version: 1 as const, revision: 0, rows: [] };
          const save = async () => {
            signal?.throwIfAborted();
            index.revision++;
            try {
              if (current)
                await this.dependencies.store.update(
                  'recipe-holds',
                  'index',
                  IndexSchema,
                  stored => {
                    if (stored.revision !== index.revision - 1)
                      throw error('RECIPE_HOLD_REVISION_CHANGED');
                    return index;
                  },
                );
              else
                await this.dependencies.store.create('recipe-holds', 'index', index, IndexSchema);
            } catch (cause) {
              if ((cause as { code?: string }).code === 'REPLACE_RETAINED_CAPACITY_EXCEEDED')
                throw Object.assign(error('RECIPE_HOLD_HISTORY_CAPACITY_EXCEEDED'), { cause });
              throw cause;
            }
          };
          const result = await work(index, save);
          await authority.verify();
          return result;
        },
        {
          filesystemTarget: authority.child('.recipe-evidence-retention'),
          retainedParentAuthority: true,
        },
      ),
    );
  }
  private scope(scope: Scope, input: unknown): RecipeEvidenceBinding {
    const binding = RecipeEvidenceBindingSchema.parse(input);
    if (
      binding.actorId !== scope.actor.actorId ||
      binding.authSessionId !== scope.actor.authSessionId ||
      binding.workspaceId !== scope.workspace.workspaceId
    )
      throw error('RECIPE_HOLD_SCOPE_MISMATCH');
    return binding;
  }
  private current(row: Row | undefined, binding: RecipeEvidenceBinding): Row {
    if (!row) throw error('RECIPE_HOLD_NOT_FOUND');
    if (row.holdId !== bindingHash(binding)) throw error('RECIPE_HOLD_BINDING_CHANGED');
    if (row.state !== 'held') throw error('RECIPE_HOLD_RELEASED');
    return row;
  }
  private operation(binding: RecipeEvidenceBinding) {
    const operation = this.dependencies.operations.get(binding.operationId);
    if (
      operation &&
      (operation.actorId !== binding.actorId ||
        operation.originAuthSessionId !== binding.authSessionId ||
        operation.workspaceId !== binding.workspaceId ||
        operation.operationKind !== binding.operationKind ||
        operation.operationName !== binding.operationName ||
        operation.argsHash !== binding.argsHash ||
        operation.targetBindingHash !== binding.targetBindingHash)
    )
      throw error('RECIPE_HOLD_OPERATION_MISMATCH');
    return operation;
  }
  private response(row: Row): RecipeEvidenceResult {
    return RecipeEvidenceResultSchema.parse({
      version: 1,
      holdId: row.holdId,
      binding: row.binding,
      state: row.state,
      verified: row.verified,
    });
  }
  // A smaller declared ceiling controls consumption, not the service capture allocation.
  // Old unverified rows retain their binding but count the full bound before new admission.
  private capacity(index: Index, binding: RecipeEvidenceBinding): void {
    const owned = index.rows.filter(row => row.binding.actorId === binding.actorId),
      active = index.rows.filter(row => row.state === 'held'),
      ownedActive = owned.filter(row => row.state === 'held');
    if (
      index.rows.length >= this.limits.rowsGlobal ||
      owned.length >= this.limits.rowsPerOwner ||
      active.length >= this.limits.activeGlobal ||
      ownedActive.length >= this.limits.activePerOwner ||
      active.reduce(
        (sum, row) => sum + (row.verified?.resultBytes ?? OPERATION_CAPTURE_MAX_BYTES),
        0,
      ) +
        OPERATION_CAPTURE_MAX_BYTES >
        this.limits.reservedBytesGlobal ||
      ownedActive.reduce(
        (sum, row) => sum + (row.verified?.resultBytes ?? OPERATION_CAPTURE_MAX_BYTES),
        0,
      ) +
        OPERATION_CAPTURE_MAX_BYTES >
        this.limits.reservedBytesPerOwner
    )
      throw error('RECIPE_HOLD_CAPACITY_EXCEEDED');
  }
  private async verified(
    actor: Readonly<ActorContext>,
    binding: RecipeEvidenceBinding,
  ): Promise<NonNullable<Row['verified']>> {
    const operation = this.operation(binding);
    if (!operation || operation.status !== 'succeeded')
      throw error('RECIPE_HOLD_OPERATION_NOT_SUCCEEDED');
    if (binding.resultSchemaHash !== recipeResultSchemaHash(binding.operationName))
      throw error('RECIPE_HOLD_SCHEMA_CHANGED');
    let view: Readonly<OperationEvidenceViewV1>;
    try {
      view = await this.dependencies.readEvidence(actor, binding.operationId);
    } catch (cause) {
      throw Object.assign(error('RECIPE_HOLD_EVIDENCE_UNAVAILABLE'), { cause });
    }
    const receipt = view.receipt,
      artifact = receipt?.resultArtifact;
    const expectedPath = createToolInvocationOptions(true, binding.operationId, binding.workspaceId)
      .captureIntent.relativePath;
    if (
      !view.serverVerified ||
      view.statusProjection.status !== 'succeeded' ||
      !receipt ||
      !artifact ||
      !receipt.captureResult ||
      receipt.resultHash === null ||
      receipt.argsHash !== binding.argsHash ||
      receipt.workspaceId !== binding.workspaceId ||
      receipt.targetBindingHash !== binding.targetBindingHash ||
      receipt.operationName !== binding.operationName ||
      receipt.operationKind !== 'tool' ||
      artifact.resultSchemaHash !== binding.resultSchemaHash ||
      artifact.artifactRelativePath !== expectedPath ||
      receipt.resultBytes > binding.maxResultBytes ||
      !view.finalizerProjection ||
      !view.statusProjection.operationEvidenceReceiptHash ||
      !view.statusProjection.finalEgressManifestHash
    )
      throw error('RECIPE_HOLD_EVIDENCE_INVALID');
    const policy = this.dependencies.workspacePolicy;
    if (!policy.resolveRoot) throw error('RECIPE_HOLD_WORKSPACE_REQUIRED');
    const root = await policy.resolveRoot(binding.workspaceId);
    const bytes = await new RepoReader({
      rootDir: root,
      workspaceId: binding.workspaceId,
      workspacePolicy: policy,
      maxFileBytes: binding.maxResultBytes,
      maxTotalBytes: binding.maxResultBytes,
    }).readBytes(artifact.artifactRelativePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      bytes.length !== receipt.resultBytes ||
      digest !== artifact.artifactDigest64 ||
      `sha256:${digest}` !== receipt.resultHash
    )
      throw error('RECIPE_HOLD_RESULT_CHANGED');
    const schema = RESULT_SCHEMAS[binding.operationName]!;
    let parsed: unknown;
    try {
      parsed = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (cause) {
      throw Object.assign(error('RECIPE_HOLD_RESULT_INVALID'), { cause });
    }
    if (canonicalJson(parsed) !== bytes.toString('utf8'))
      throw error('RECIPE_HOLD_RESULT_NOT_CANONICAL');
    return {
      receiptHash: view.statusProjection.operationEvidenceReceiptHash,
      finalizerHash: view.statusProjection.finalEgressManifestHash,
      resultHash: receipt.resultHash,
      resultBytes: receipt.resultBytes,
      resultArtifact: artifact,
    };
  }
  async ensureHeld(
    scope: Scope,
    input: unknown,
    signal?: Cancellation,
  ): Promise<RecipeEvidenceResult> {
    const binding = this.scope(scope, input);
    return await this.locked(async (index, save) => {
      if (
        !scope.workspace.workspaceRoot ||
        !this.dependencies.workspacePolicy.resolveRoot ||
        resolve(scope.workspace.workspaceRoot) !==
          resolve(await this.dependencies.workspacePolicy.resolveRoot(binding.workspaceId))
      )
        throw error('RECIPE_HOLD_WORKSPACE_MISMATCH');
      const previous = index.rows.find(row => row.key === stableKey(binding));
      if (previous) {
        this.current(previous, binding);
        const operation = this.operation(binding);
        if (operation && !['pending-approval', 'queued', 'dispatched'].includes(operation.status)) {
          const fresh = await this.verified(scope.actor, binding);
          if (previous.verified && canonicalJson(previous.verified) !== canonicalJson(fresh))
            throw error('RECIPE_HOLD_SETTLED_EVIDENCE_CHANGED');
        }
        return this.response(previous);
      }
      this.dependencies.issuer.verify(
        scope.actor.actorId,
        binding.operationId,
        (this.dependencies.now ?? Date.now)(),
      );
      if (index.rows.some(row => row.binding.operationId === binding.operationId))
        throw error('RECIPE_HOLD_OPERATION_ALREADY_BOUND');
      if (recipeResultSchemaHash(binding.operationName) !== binding.resultSchemaHash)
        throw error('RECIPE_HOLD_SCHEMA_CHANGED');
      const operation = this.operation(binding);
      let verified: Row['verified'] = null;
      if (operation && !['pending-approval', 'queued', 'dispatched'].includes(operation.status))
        verified = await this.verified(scope.actor, binding);
      if (
        !operation &&
        (await this.dependencies.hasRetainedEvidence(scope.actor.actorId, binding.operationId))
      )
        throw error('RECIPE_HOLD_ORPHAN_EVIDENCE');
      this.capacity(index, binding);
      const row: Row = {
        key: stableKey(binding),
        holdId: bindingHash(binding),
        binding,
        state: 'held',
        reservedBytes: verified?.resultBytes ?? OPERATION_CAPTURE_MAX_BYTES,
        verified,
        dependencies: [],
        createdAt: this.now(),
        releasedAt: null,
      };
      index.rows.push(row);
      await save();
      return this.response(row);
    }, signal);
  }
  async verifyHeld(
    scope: Scope,
    input: unknown,
    signal?: Cancellation,
  ): Promise<RecipeEvidenceResult> {
    const binding = this.scope(scope, input);
    return await this.locked(async (index, save) => {
      const row = this.current(
        index.rows.find(item => item.key === stableKey(binding)),
        binding,
      );
      const verified = await this.verified(scope.actor, binding);
      if (row.verified && canonicalJson(row.verified) !== canonicalJson(verified))
        throw error('RECIPE_HOLD_SETTLED_EVIDENCE_CHANGED');
      if (!row.verified || row.reservedBytes !== verified.resultBytes) {
        row.verified = verified;
        row.reservedBytes = verified.resultBytes;
        await save();
      }
      return this.response(row);
    }, signal);
  }
  async release(
    scope: Scope,
    input: unknown,
    signal?: Cancellation,
  ): Promise<RecipeEvidenceResult> {
    const binding = this.scope(scope, input);
    return await this.locked(async (index, save) => {
      const row = index.rows.find(item => item.key === stableKey(binding));
      if (!row) throw error('RECIPE_HOLD_NOT_FOUND');
      if (row.holdId !== bindingHash(binding)) throw error('RECIPE_HOLD_BINDING_CHANGED');
      if (row.dependencies.length) throw error('RECIPE_HOLD_HAS_DEPENDENTS');
      const operation = this.operation(binding);
      if (
        !operation ||
        ['pending-approval', 'queued', 'dispatched', 'outcome-unknown'].includes(operation.status)
      )
        throw error('RECIPE_HOLD_OPERATION_UNSETTLED');
      if (row.state !== 'released') {
        row.state = 'released';
        row.reservedBytes = 0;
        row.releasedAt = this.now();
        await save();
      }
      return this.response(row);
    }, signal);
  }
  /** Internal server integration only: no route accepts dependency additions/removals from JSON. */
  async dependency(bindingInput: unknown, referenceId: string, add: boolean): Promise<void> {
    const binding = RecipeEvidenceBindingSchema.parse(bindingInput);
    if (!referenceId || referenceId.length > 256) throw error('RECIPE_HOLD_DEPENDENCY_INVALID');
    await this.locked(async (index, save) => {
      const row = this.current(
        index.rows.find(item => item.key === stableKey(binding)),
        binding,
      );
      const present = row.dependencies.includes(referenceId);
      if (present === add) return;
      if (add) {
        if (row.dependencies.length >= this.limits.dependenciesPerHold)
          throw error('RECIPE_HOLD_DEPENDENCY_LIMIT');
        row.dependencies.push(referenceId);
        row.dependencies = row.dependencies.toSorted();
      } else row.dependencies = row.dependencies.filter(value => value !== referenceId);
      await save();
    });
  }
  /** Keep the lock until receipt/finalizer compaction, pending cleanup and orphan scans all finish. */
  withRetentionSweep<T>(sweep: (holds: OperationRetentionScope) => Promise<T>): Promise<T> {
    return this.locked(async index => {
      const held = new Set(
        index.rows.filter(row => row.state === 'held').map(row => row.binding.operationId),
      );
      return withOperationRetentionScope(held, sweep);
    });
  }
}
