import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  OperationEvidenceViewV1Schema,
  parseOperationRecord,
  parseOperationTombstone,
} from '@sfp/shared';
import { z } from 'zod';

import { hashOperationFingerprint } from '../../mcp/src/execution/operation-journal.js';
import {
  readFileWithinLimit,
  withRetainedDirectoryAuthority,
  withRetainedDirectoryDescendantChain,
} from '../../mcp/src/fs/atomic-file.js';
import {
  RecipeEvidenceBindingSchema,
  RecipeEvidenceResultSchema,
} from '../../mcp/src/portal/recipes/evidence-contract.js';
import { isBoundedDesignJson } from '../../shared/src/design-observation.js';
import { RESULT_SCHEMAS } from '../../shared/src/result-schemas.js';
import { ControlClient } from './control-client.js';
import type { RecipeStepIntent } from './recipe-checkpoint.js';
import { recipeCanonical, recipeError, recipeHash, type ExecutableRecipe } from './recipe-plan.js';

export interface RecipeRetentionBinding {
  version: 1;
  planHash: string;
  stepId: string;
  operationId: string;
  actorId: string;
  authSessionId: string;
  workspaceId: string;
  targetBindingHash: string;
  argsHash: string;
  resultSchemaHash: string;
  operationKind: 'tool';
  operationName: RecipeStepIntent['operationName'];
  maxResultBytes: 8388608;
}
/** Trusted adapter to server retention, not a client-supplied held=true receipt. */
export interface RecipeEvidenceRetentionPort {
  ensureHeld(binding: RecipeRetentionBinding): Promise<void>;
  verifyHeld(binding: RecipeRetentionBinding): Promise<void>;
}
/**
 * Only these two authenticated metadata calls receive client approval; primitive approval is
 * unchanged.
 */
export function createControlRecipeRetention(
  control: Pick<ControlClient, 'invoke'>,
): RecipeEvidenceRetentionPort {
  const call = async (action: 'hold' | 'verify', input: RecipeRetentionBinding): Promise<void> => {
    const binding = RecipeEvidenceBindingSchema.parse(input);
    let response: unknown;
    try {
      response = await control.invoke({
        name: `recipe.evidence.${action}`,
        kind: 'service',
        args: { binding },
        workspaceId: binding.workspaceId,
        targetSelector: { kind: 'none' },
        approve: true,
        captureResult: false,
        timeoutMs: 180_000,
        emit: () => {},
      });
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        typeof cause.code === 'string' &&
        cause.code.startsWith('RECIPE_HOLD_')
      )
        throw cause;
      throw Object.assign(recipeError('RECIPE_RETENTION_UNAVAILABLE'), { cause });
    }
    const parsed = RecipeEvidenceResultSchema.safeParse(response);
    if (
      !parsed.success ||
      parsed.data.state !== 'held' ||
      recipeCanonical(parsed.data.binding) !== recipeCanonical(binding) ||
      parsed.data.holdId !== recipeHash(binding, 'sfp-recipe-evidence-binding-v1') ||
      (action === 'verify' && parsed.data.verified === null)
    )
      throw recipeError('RECIPE_RETENTION_INVALID');
    if (parsed.data.verified) {
      const evidence = parsed.data.verified,
        artifact = evidence.resultArtifact;
      const pathHash = createHash('sha256')
        .update('sfp-operation-evidence-path-v1\0')
        .update(binding.operationId)
        .digest('hex');
      if (
        evidence.resultBytes > binding.maxResultBytes ||
        artifact.resultSchemaHash !== binding.resultSchemaHash ||
        artifact.artifactRelativePath !== `.sfp/operation-evidence/${pathHash}/result.v1.json` ||
        evidence.resultHash !== `sha256:${artifact.artifactDigest64}`
      )
        throw recipeError('RECIPE_RETENTION_INVALID');
    }
  };
  return Object.freeze({
    ensureHeld: (binding: RecipeRetentionBinding) => call('hold', binding),
    verifyHeld: (binding: RecipeRetentionBinding) => call('verify', binding),
  });
}
export const recipeRetentionBinding = (
  plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
  intent: RecipeStepIntent,
): RecipeRetentionBinding => ({
  version: 1,
  planHash: intent.planHash,
  stepId: intent.stepId,
  operationId: intent.operationId,
  operationKind: 'tool',
  operationName: intent.operationName,
  maxResultBytes: 8388608,
  actorId: plan.authority.actorId,
  authSessionId: plan.authority.authSessionId,
  workspaceId: plan.authority.workspaceId,
  targetBindingHash: plan.authority.targetBindingHash,
  argsHash: intent.argsHash,
  resultSchemaHash: intent.resultSchemaHash,
});
const workspacesSchema = z
  .array(
    z
      .object({
        workspaceId: z.string(),
        realPath: z.string().min(1),
        rootIdentityKey: z.string().min(1),
      })
      .passthrough(),
  )
  .max(1024);
export class ControlRecipeClient {
  readonly control: ControlClient;
  private readonly retention: RecipeEvidenceRetentionPort;
  constructor(
    options: { stateRoot?: string; port?: number; credentialHash: string },
    retention?: RecipeEvidenceRetentionPort,
  ) {
    this.control = new ControlClient({
      ...options,
      expectedCredentialHash: options.credentialHash,
    });
    this.retention = retention ?? createControlRecipeRetention(this.control);
  }
  async assertCurrent(plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>): Promise<void> {
    const status = await this.control.status(),
      authority = plan.authority,
      plugin = status.activePlugin;
    if (
      status.leaderGeneration !== authority.leaderGeneration ||
      status.role !== 'leader' ||
      status.pairedPluginCount !== 1 ||
      !plugin ||
      plugin.sessionId !== authority.sessionId ||
      plugin.pluginGenerationHash !== authority.pluginGenerationHash ||
      plugin.fileIdentityHash !== authority.fileIdentityHash ||
      (await this.control.credentialHash()) !== authority.credentialHash
    )
      throw recipeError('RECIPE_AUTHORITY_CHANGED');
  }
  async reserve(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    intent: RecipeStepIntent,
  ): Promise<void> {
    if (!this.retention) throw recipeError('RECIPE_RETENTION_UNAVAILABLE');
    await this.retention.ensureHeld(recipeRetentionBinding(plan, intent));
  }
  async invoke(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    step: { id?: string; tool: RecipeStepIntent['operationName'] },
    intent: RecipeStepIntent,
    options: { approve: boolean; signal?: AbortSignal },
  ): Promise<void> {
    if (intent.operationName !== step.tool) throw recipeError('RECIPE_OPERATION_BINDING_MISMATCH');
    await this.assertCurrent(plan);
    await this.control.invoke({
      name: step.tool,
      kind: 'tool',
      args: intent.args,
      workspaceId: plan.authority.workspaceId,
      targetSelector: { kind: 'session', sessionId: plan.authority.sessionId },
      approve: options.approve,
      captureResult: true,
      operationId: intent.operationId,
      ...(options.signal ? { signal: options.signal } : {}),
      emit: () => {},
    });
  }
  async recover(
    plan: Pick<ExecutableRecipe, 'intentId' | 'authority'>,
    step: { id?: string; tool: RecipeStepIntent['operationName'] },
    intent: RecipeStepIntent,
  ): Promise<{ result: unknown; receiptHash: string }> {
    await this.assertCurrent(plan);
    if (!this.retention) throw recipeError('RECIPE_RETENTION_UNAVAILABLE');
    await this.retention.verifyHeld(recipeRetentionBinding(plan, intent));
    const rawOperation = await this.control.request(
      `/control/operations/${encodeURIComponent(intent.operationId)}`,
    );
    const operation =
      rawOperation !== null &&
      typeof rawOperation === 'object' &&
      Object.hasOwn(rawOperation, 'sequence')
        ? parseOperationRecord(rawOperation)
        : parseOperationTombstone(rawOperation);
    const a = plan.authority;
    if (
      operation.actorId !== a.actorId ||
      operation.originAuthSessionId !== a.authSessionId ||
      operation.operationId !== intent.operationId ||
      operation.operationKind !== 'tool' ||
      operation.operationName !== step.tool ||
      operation.operationName !== intent.operationName ||
      operation.argsHash !== intent.argsHash ||
      operation.workspaceId !== a.workspaceId ||
      operation.targetBindingHash !== a.targetBindingHash ||
      operation.leaderGeneration !== a.leaderGeneration ||
      operation.origin.kind !== 'entry' ||
      operation.origin.entryPath !== 'control' ||
      hashOperationFingerprint(operation) !== operation.operationFingerprintHash
    )
      throw recipeError('RECIPE_OPERATION_BINDING_MISMATCH');
    if (operation.status !== 'succeeded')
      throw recipeError(`RECIPE_OPERATION_${operation.status.toUpperCase().replaceAll('-', '_')}`);
    const evidence = OperationEvidenceViewV1Schema.parse(
      await this.control.request(
        `/control/operations/${encodeURIComponent(intent.operationId)}/evidence`,
      ),
    );
    const receipt = evidence.receipt,
      projection = evidence.statusProjection,
      finalizer = evidence.finalizerProjection;
    if (
      !receipt ||
      !receipt.captureResult ||
      !receipt.resultArtifact ||
      !finalizer ||
      receipt.terminalStatus !== 'succeeded' ||
      projection.status !== 'succeeded' ||
      projection.operationId !== intent.operationId ||
      projection.operationFingerprintHash !== operation.operationFingerprintHash ||
      projection.operationKind !== 'tool' ||
      projection.operationName !== step.tool ||
      receipt.operationId !== intent.operationId ||
      receipt.operationKind !== 'tool' ||
      receipt.operationName !== step.tool ||
      receipt.argsHash !== intent.argsHash ||
      receipt.fileExecutionKeyHash !== operation.fileExecutionKeyHash ||
      receipt.captureIntentHash !== operation.captureIntentHash ||
      receipt.targetBindingHash !== a.targetBindingHash ||
      receipt.workspaceId !== a.workspaceId ||
      receipt.resultHash !== operation.resultHash ||
      receipt.resultHash !== projection.resultHash ||
      ('resultBytes' in operation && receipt.resultBytes !== operation.resultBytes) ||
      receipt.resultBytes > 8388608 ||
      receipt.contentHash !== operation.operationEvidenceReceiptHash ||
      receipt.contentHash !== projection.operationEvidenceReceiptHash ||
      receipt.finalizerHash !== operation.finalEgressManifestHash ||
      receipt.finalizerHash !== projection.finalEgressManifestHash ||
      receipt.finalizerHash !== finalizer.manifestHash ||
      finalizer.resultHash !== receipt.resultHash ||
      finalizer.finalStatus !== 'output' ||
      receipt.daemonGenerationHash !==
        `sha256:${createHash('sha256').update('sfp-daemon-generation-v1').update('\0').update(a.leaderGeneration).digest('hex')}` ||
      receipt.resultArtifact.resultSchemaHash !== intent.resultSchemaHash ||
      receipt.resultHash !== `sha256:${receipt.resultArtifact.artifactDigest64}`
    )
      throw recipeError('RECIPE_RECEIPT_INVALID');
    const { contentHash: observedContentHash, ...receiptContent } = receipt;
    if (
      recipeHash(
        { ...receiptContent, state: 'prepared', actorId: a.actorId },
        'sfp-operation-evidence-content-v1',
      ) !== observedContentHash
    )
      throw recipeError('RECIPE_RECEIPT_CONTENT_MISMATCH');
    const pathHash = createHash('sha256')
      .update('sfp-operation-evidence-path-v1')
      .update('\0')
      .update(intent.operationId)
      .digest('hex');
    const relativePath = `.sfp/operation-evidence/${pathHash}/result.v1.json`;
    if (receipt.resultArtifact.artifactRelativePath !== relativePath)
      throw recipeError('RECIPE_ARTIFACT_PATH_INVALID');
    const workspace = workspacesSchema
      .parse(await this.control.request('/control/workspaces'))
      .find(row => row.workspaceId === a.workspaceId);
    if (!workspace) throw recipeError('RECIPE_WORKSPACE_UNAVAILABLE');
    const rootIdentity = await lstat(workspace.realPath, { bigint: true });
    if (
      `${rootIdentity.dev}:${rootIdentity.ino}:${rootIdentity.birthtimeNs}` !==
      workspace.rootIdentityKey
    )
      throw recipeError('RECIPE_WORKSPACE_CHANGED');
    const rootNumeric = await lstat(workspace.realPath);
    if (
      rootNumeric.dev !== Number(rootIdentity.dev) ||
      rootNumeric.ino !== Number(rootIdentity.ino)
    )
      throw recipeError('RECIPE_WORKSPACE_CHANGED');
    const bytes = await withRetainedDirectoryAuthority(
      workspace.realPath,
      rootNumeric,
      async root => {
        const retainedIdentity = await lstat(workspace.realPath, { bigint: true });
        if (
          retainedIdentity.dev !== rootIdentity.dev ||
          retainedIdentity.ino !== rootIdentity.ino ||
          retainedIdentity.birthtimeNs !== rootIdentity.birthtimeNs
        )
          throw recipeError('RECIPE_WORKSPACE_CHANGED');
        return withRetainedDirectoryDescendantChain(
          workspace.realPath,
          root,
          dirname(join(workspace.realPath, relativePath)),
          directory => readFileWithinLimit(directory.child('result.v1.json'), receipt.resultBytes),
        );
      },
    );
    if (
      bytes.byteLength !== receipt.resultBytes ||
      createHash('sha256').update(bytes).digest('hex') !== receipt.resultArtifact.artifactDigest64
    )
      throw recipeError('RECIPE_ARTIFACT_HASH_MISMATCH');
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isBoundedDesignJson(raw, 8388608, 200000)) throw recipeError('RECIPE_RESULT_LIMIT');
    const result = RESULT_SCHEMAS[step.tool]!.parse(raw);
    if (
      !Buffer.from(recipeCanonical(result)).equals(bytes) ||
      recipeHash(result) !== receipt.resultHash
    )
      throw recipeError('RECIPE_RESULT_NOT_CANONICAL');
    await this.retention.verifyHeld(recipeRetentionBinding(plan, intent));
    await this.assertCurrent(plan);
    return { result, receiptHash: receipt.contentHash };
  }
}
