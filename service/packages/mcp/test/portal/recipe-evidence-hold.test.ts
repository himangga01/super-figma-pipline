import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { canonicalJson, contentHash } from '@sfp/ir';
import {
  ALL_DATA_CLASSES,
  canonicalFileIdentityHash,
  createToolInvocationOptions,
  type RuntimeExecutionScope,
  type ActorContext,
} from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { createOperationEvidenceEndpoint } from '../../src/control/operation-evidence-endpoint.js';
import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { createOperationEvidenceProjector } from '../../src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../src/fs/operation-evidence-artifact-store.js';
import { createApprovalBroker } from '../../src/policy/approval-broker.js';
import {
  RecipeEvidenceResultSchema,
  type RecipeEvidenceBinding,
} from '../../src/portal/recipes/evidence-contract.js';
import { registerRecipeEvidenceRoutes } from '../../src/portal/recipes/evidence-control.js';
import {
  RecipeEvidenceHolds,
  recipeResultSchemaHash,
  RECIPE_EVIDENCE_HOLD_LIMITS,
} from '../../src/portal/recipes/evidence-hold.js';
import { createRecipeEvidenceOperations } from '../../src/portal/recipes/evidence-operations.js';
import { PortalStore } from '../../src/portal/store.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
import { portalFixture } from './fixtures.js';

const actor: ActorContext = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
};
const digest = (domain: string, value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256')
    .update(domain + '\0')
    .update(value)
    .digest('hex')}`;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});
async function setup(
  limits?: Partial<Record<keyof typeof RECIPE_EVIDENCE_HOLD_LIMITS, number>>,
  failArtifactPublication = false,
  outputName = 'Frame',
) {
  const fixture = await portalFixture();
  cleanup.push(fixture.cleanup);
  const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 31));
  const journal = new OperationJournal({
    stateRoot: fixture.stateRoot,
    actorId: actor.actorId,
    externallyManagedRetention: true,
  });
  const receipts = new OperationEvidenceReceiptStore({
    stateRoot: fixture.stateRoot,
    actorId: actor.actorId,
  });
  const egress = new EgressManifestStore({ stateRoot: fixture.stateRoot, actorId: actor.actorId });
  await Promise.all([journal.recover(), receipts.recover(), egress.recover(Date.now())]);
  const artifacts = new OperationEvidenceArtifactStore({
    workspacePolicy: fixture.policy,
    atomicFiles: new AtomicFileStore(),
  });
  let executions = 0;
  const output = { ok: true, nodeId: '1:2', name: outputName, type: 'FRAME' };
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async () => {
          executions++;
          return output;
        },
      },
      {
        execute: async () => {
          throw Error('UNEXPECTED_ADAPTER');
        },
      },
    ),
    durability: {
      egress,
      receipts,
      artifacts: failArtifactPublication
        ? {
            createNew: async () => {
              throw Error('fixture artifact publication failed');
            },
          }
        : artifacts,
      projector: createOperationEvidenceProjector(),
      nativeArtifacts: {
        createNativeManifest: async () => {
          throw Error('UNEXPECTED_NATIVE_ARTIFACT');
        },
      },
    },
  });
  const scope: RuntimeExecutionScope = {
    actor,
    requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
    leaderGeneration: 'generation',
    workspace: { workspaceId: fixture.workspaceId, workspaceRoot: fixture.workspaceRoot },
    target: {
      sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
      pluginGeneration: 'plugin',
      fileIdentity: { kind: 'figma-file-key', value: 'fixture' },
      fileExecutionKey: 'figma:fixture',
    },
    consent: { mode: 'local-trusted', consentId: null, allowedClasses: ALL_DATA_CLASSES },
  };
  const args = { name: 'Frame' };
  const binding = (stepId = 'create'): RecipeEvidenceBinding => ({
    version: 1,
    planHash: contentHash('fixture-plan', { scope: 'fixture' }),
    stepId,
    operationId: issuer.issue(actor.actorId),
    actorId: actor.actorId,
    authSessionId: actor.authSessionId,
    workspaceId: fixture.workspaceId,
    operationKind: 'tool',
    operationName: 'create_frame',
    targetBindingHash: digest(
      'sfp-entry-target-binding-v1',
      canonicalJson({
        targetSessionIdHash: digest('sfp-target-session-v1', scope.target.sessionId!),
        fileIdentityHash: canonicalFileIdentityHash(scope.target.fileIdentity!),
        fileExecutionKeyHash: digest('sfp-file-execution-key-v1', scope.target.fileExecutionKey!),
        pluginGeneration: scope.target.pluginGeneration,
        leaderGeneration: scope.leaderGeneration,
      }),
    ),
    argsHash: digest('sfp-parsed-args-v1', canonicalJson(args)),
    resultSchemaHash: recipeResultSchemaHash('create_frame'),
    maxResultBytes: 8_388_608,
  });
  const deps = {
    stateRoot: fixture.stateRoot,
    store: fixture.store,
    permissions: fixture.permissions,
    issuer,
    operations: journal,
    workspacePolicy: fixture.policy,
    readEvidence: createOperationEvidenceEndpoint({ operations: journal, receipts, egress }),
    hasRetainedEvidence: async (id: ActorContext['actorId'], operationId: string) =>
      (await receipts.get(id, operationId)) !== null ||
      (await egress.hasFinalizer(id, operationId)),
    ...(limits === undefined ? {} : { limits }),
  };
  const holds = new RecipeEvidenceHolds(deps);
  const second = () =>
    new RecipeEvidenceHolds({
      ...deps,
      store: new PortalStore(fixture.stateRoot, fixture.key, fixture.permissions),
    });
  const execute = (value: RecipeEvidenceBinding, captureResult = true) =>
    executor.invokeTool(
      scope,
      'create_frame',
      args,
      value.operationId,
      createToolInvocationOptions(captureResult, value.operationId, fixture.workspaceId),
    );
  const sweep = (manager = holds) =>
    manager.withRetentionSweep(async ({ isHeld }) => {
      const now = Date.now() + 31 * 86_400_000;
      const linkedAt = (operationId: string) =>
        isHeld(operationId) ? null : journal.settledAt(operationId);
      await receipts.compact({ now, linkedAt });
      await egress.compact({ now, linkedAt });
      await receipts.drainPendingArtifactCleanup(async receipt => {
        if (isHeld(receipt.operationId)) throw Error('HELD_CLEANUP_REJECTED');
        if (receipt.resultArtifact)
          await artifacts.removeLinked({
            workspaceId: fixture.workspaceId,
            operationId: receipt.operationId,
            artifact: receipt.resultArtifact,
          });
      });
    });
  return {
    ...fixture,
    issuer,
    journal,
    receipts,
    egress,
    artifacts,
    scope,
    holds,
    second,
    binding,
    execute,
    sweep,
    executions: () => executions,
  };
}

it('durably holds before dispatch and verifies actual canonical executor evidence and bytes', async () => {
  const state = await setup(),
    binding = state.binding();
  expect(await state.holds.ensureHeld(state.scope, binding)).toMatchObject({
    state: 'held',
    binding,
    verified: null,
  });
  expect(state.journal.get(binding.operationId)).toBeUndefined();
  await state.execute(binding);
  const verified = await state.holds.verifyHeld(state.scope, binding);
  expect(verified.verified).not.toBeNull();
  expect(verified.verified?.resultArtifact.resultSchemaHash).toBe(binding.resultSchemaHash);
  expect(state.executions()).toBe(1);
  await state.sweep();
  expect(await state.second().verifyHeld(state.scope, binding)).toEqual(verified);
  expect(await state.receipts.get(actor.actorId, binding.operationId)).not.toBeNull();
});

it('rejects wrong actual owner/session/workspace and changed stable-key bindings without dispatch', async () => {
  const state = await setup(),
    binding = state.binding();
  await expect(
    state.holds.ensureHeld(
      { ...state.scope, actor: { ...actor, authSessionId: `auth1_${'C'.repeat(43)}` } },
      binding,
    ),
  ).rejects.toThrow('RECIPE_HOLD_SCOPE_MISMATCH');
  await expect(
    state.holds.ensureHeld(state.scope, { ...binding, actorId: `actor1_${'D'.repeat(43)}` }),
  ).rejects.toThrow('RECIPE_HOLD_SCOPE_MISMATCH');
  await expect(
    state.holds.ensureHeld(
      { ...state.scope, workspace: { ...state.scope.workspace, workspaceId: null } },
      binding,
    ),
  ).rejects.toThrow('RECIPE_HOLD_SCOPE_MISMATCH');
  await state.holds.ensureHeld(state.scope, binding);
  await expect(
    state
      .second()
      .ensureHeld(state.scope, { ...binding, operationId: state.issuer.issue(actor.actorId) }),
  ).rejects.toThrow('RECIPE_HOLD_BINDING_CHANGED');
  await expect(
    state.second().ensureHeld(state.scope, { ...binding, argsHash: contentHash('changed', null) }),
  ).rejects.toThrow('RECIPE_HOLD_BINDING_CHANGED');
  await expect(
    state.second().ensureHeld(state.scope, { ...binding, stepId: 'other' }),
  ).rejects.toThrow('RECIPE_HOLD_OPERATION_ALREADY_BOUND');
  expect(state.executions()).toBe(0);
});

it('reserves capacity before effects, tightens to actual bytes and never evicts a held dependency', async () => {
  const state = await setup({ reservedBytesPerOwner: 8_389_632 }),
    first = state.binding('first'),
    second = state.binding('second');
  await state.holds.ensureHeld(state.scope, first);
  await expect(state.holds.ensureHeld(state.scope, second)).rejects.toThrow(
    'RECIPE_HOLD_CAPACITY_EXCEEDED',
  );
  expect(state.executions()).toBe(0);
  await state.execute(first);
  await state.holds.verifyHeld(state.scope, first);
  await state.holds.ensureHeld(state.scope, { ...second, maxResultBytes: 1024 });
  await state.holds.dependency(first, 'portal:plan:required', true);
  await expect(state.holds.release(state.scope, first)).rejects.toThrow(
    'RECIPE_HOLD_HAS_DEPENDENTS',
  );
  await state.holds.dependency(first, 'portal:plan:required', false);
  expect(await state.holds.release(state.scope, first)).toMatchObject({ state: 'released' });
  await expect(state.holds.ensureHeld(state.scope, first)).rejects.toThrow('RECIPE_HOLD_RELEASED');
});

it('serializes cross-manager capacity and compaction with no check-then-hold window', async () => {
  const state = await setup({ activeGlobal: 1 }),
    a = state.binding('a'),
    b = state.binding('b');
  const admitted = await Promise.allSettled([
    state.holds.ensureHeld(state.scope, a),
    state.second().ensureHeld(state.scope, b),
  ]);
  expect(admitted.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  const winner = admitted[0]!.status === 'fulfilled' ? a : b;
  await state.execute(winner);
  let entered!: () => void, release!: () => void;
  const inside = new Promise<void>(done => {
      entered = done;
    }),
    gate = new Promise<void>(done => {
      release = done;
    });
  const sweeping = state.holds.withRetentionSweep(async ({ isHeld }) => {
    expect(isHeld(winner.operationId)).toBe(true);
    entered();
    await gate;
  });
  await inside;
  let settled = false;
  const verifying = state
    .second()
    .verifyHeld(state.scope, winner)
    .finally(() => {
      settled = true;
    });
  await new Promise<void>(done => setTimeout(done, 25));
  expect(settled).toBe(false);
  release();
  await sweeping;
  await verifying;
  await state.sweep();
  expect(await state.receipts.get(actor.actorId, winner.operationId)).not.toBeNull();
});

it('refuses to pin an expired terminal whose receipt/artifact was already compacted', async () => {
  const state = await setup(),
    binding = state.binding();
  await state.execute(binding);
  await state.sweep();
  expect(await state.receipts.get(actor.actorId, binding.operationId)).toBeNull();
  await expect(state.holds.ensureHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_EVIDENCE_UNAVAILABLE',
  );
  expect(
    await state.holds.withRetentionSweep(async ({ isHeld }) => isHeld(binding.operationId)),
  ).toBe(false);
});

it('detects tampered signed state and changed captured result bytes', async () => {
  const state = await setup(),
    binding = state.binding();
  await state.holds.ensureHeld(state.scope, binding);
  await state.execute(binding);
  const verified = await state.holds.verifyHeld(state.scope, binding);
  await writeFile(
    join(state.workspaceRoot, verified.verified!.resultArtifact.artifactRelativePath),
    'tampered',
  );
  await expect(state.holds.verifyHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_RESULT_CHANGED',
  );
  const path = join(state.stateRoot, 'portal/recipe-holds/index.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.payload.rows[0].reservedBytes = 0;
  await writeFile(path, JSON.stringify(record));
  await expect(state.second().ensureHeld(state.scope, binding)).rejects.toThrow(
    'PORTAL_RECORD_TAMPERED',
  );
});

it('does not release pending or absent operations and rejects forged IDs before quota publication', async () => {
  const state = await setup(),
    binding = state.binding();
  await expect(
    state.holds.ensureHeld(state.scope, { ...binding, operationId: 'forged' }),
  ).rejects.toThrow('operation ID');
  await state.holds.ensureHeld(state.scope, binding);
  await expect(state.holds.release(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_OPERATION_UNSETTLED',
  );
});

it('routes real HTTP hold/verify/release through the canonical admitted service executor', async () => {
  const state = await setup({ reservedBytesPerOwner: 8_388_608 }),
    binding = state.binding();
  const operations = createRecipeEvidenceOperations(state.holds);
  const executor = new OperationExecutor({
    issuer: state.issuer,
    journal: state.journal,
    queue: new FileExecutionQueue(),
    runtimes: {},
    operations,
    durability: {
      egress: state.egress,
      receipts: state.receipts,
      artifacts: state.artifacts,
      projector: createOperationEvidenceProjector(),
      nativeArtifacts: {
        createNativeManifest: async () => {
          throw Error('UNEXPECTED_NATIVE_ARTIFACT');
        },
      },
    },
  });
  const plane = new LeaderGenerationExecutionPlane('generation', {
    closeAdmission: () => {},
    installGenerationFence: () => {},
    abortPending: async () => {},
    abortQueued: async () => {},
    markDispatchedOutcomeUnknown: async () => {},
    finalizeAndFlushEgress: async () => {},
    drainTransport: async () => true,
    forceCloseTransport: () => {},
    destroy: () => {},
    releasePort: () => {},
  });
  const approvals: string[] = [];
  const broker = createApprovalBroker({
    deliverPluginPrompt: async () => {
      throw Error('WRONG_APPROVAL_CHANNEL');
    },
    deliverControlPrompt: async prompt => {
      approvals.push(prompt.operationId);
      await broker.settleControl(
        actor,
        {
          version: 1,
          type: 'approval.decision',
          approvalId: prompt.approvalId,
          operationId: prompt.operationId,
          promptHash: prompt.promptHash,
          decision: 'approved',
        },
        'generation',
      );
    },
  });
  plane.bindInvocationService(new ToolInvocationService(executor));
  plane.bindAdmissionAuthority({
    operations,
    workspacePolicy: state.policy,
    resolveWorkspaceContext: async id => ({
      workspaceId: id,
      workspaceRoot: id === state.workspaceId ? state.workspaceRoot : null,
    }),
    targetResolver: {
      resolve: selector =>
        selector.kind === 'none'
          ? {
              sessionId: null,
              pluginGeneration: null,
              fileIdentity: null,
              fileExecutionKey: null,
              editorType: null,
              capabilities: null,
            }
          : state.scope.target,
    },
    approval: broker,
    authorizeEgress: async () => ({
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ALL_DATA_CLASSES,
    }),
    issueOperationId: id => state.issuer.issue(id),
    verifyOperationId: (id, operationId) => {
      state.issuer.verify(id, operationId);
    },
  });
  const router = new AuthenticatedControlRouter();
  registerRecipeEvidenceRoutes(router, plane);
  router.freeze();
  const handler = createControlHttpHandler({
    router,
    principalForRequest: async request => {
      if (request.headers.authorization !== 'Bearer fixture-owner')
        throw Error('FIXTURE_AUTH_REQUIRED');
      return actor;
    },
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('FIXTURE_ADDRESS');
  const call = async (action: 'hold' | 'verify' | 'release', supplied = binding) => {
    const operationId = state.issuer.issue(actor.actorId);
    const response = await fetch(
      `http://127.0.0.1:${address.port}/control/recipes/evidence/${action}`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-owner', 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
          operationId,
          serviceOperationName: `recipe.evidence.${action}`,
          rawArgs: { binding: supplied },
          workspaceId: state.workspaceId,
          targetSelector: { kind: 'none' },
        }),
      },
    );
    return { operationId, status: response.status, body: await response.json() };
  };
  try {
    const held = await call('hold');
    expect(held.status).toBe(200);
    expect(RecipeEvidenceResultSchema.parse(held.body)).toMatchObject({ state: 'held', binding });
    expect(state.journal.get(held.operationId)).toMatchObject({
      operationKind: 'service',
      operationName: 'recipe.evidence.hold',
      status: 'succeeded',
    });
    expect(approvals).toContain(held.operationId);
    await state.execute(binding);
    const verified = await call('verify');
    expect(verified.status).toBe(200);
    expect(RecipeEvidenceResultSchema.parse(verified.body).verified).not.toBeNull();
    await state.holds.dependency(binding, 'portal:required-result', true);
    expect((await call('release')).body).toMatchObject({ code: 'RECIPE_HOLD_HAS_DEPENDENTS' });
    await state.holds.dependency(binding, 'portal:required-result', false);
    expect(RecipeEvidenceResultSchema.parse((await call('release')).body).state).toBe('released');
    expect((await call('hold')).body).toMatchObject({ code: 'RECIPE_HOLD_RELEASED' });
    const small = { ...state.binding('small'), maxResultBytes: 1 };
    expect(RecipeEvidenceResultSchema.parse((await call('hold', small)).body).binding).toEqual(
      small,
    );
    expect(
      (await call('hold', { ...state.binding('over-capacity'), maxResultBytes: 1 })).body,
    ).toMatchObject({ code: 'RECIPE_HOLD_CAPACITY_EXCEEDED' });
    expect(state.executions()).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close(cause => (cause ? reject(cause) : done())),
    );
  }
});

it('lets an already-running full retention sweep win before a late hold and then rejects missing evidence', async () => {
  const state = await setup(),
    binding = state.binding();
  await state.execute(binding);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(done => {
      entered = done;
    }),
    gate = new Promise<void>(done => {
      release = done;
    });
  const sweep = state.holds.withRetentionSweep(async () => {
    entered();
    await gate;
    const now = Date.now() + 31 * 86_400_000;
    await state.receipts.compact({ now, linkedAt: id => state.journal.settledAt(id) });
    await state.egress.compact({ now, linkedAt: id => state.journal.settledAt(id) });
  });
  await started;
  let settled = false;
  const holding = state
    .second()
    .ensureHeld(state.scope, binding)
    .then(
      value => ({ value }),
      cause => ({ cause }),
    )
    .finally(() => {
      settled = true;
    });
  await new Promise<void>(done => setTimeout(done, 25));
  expect(settled).toBe(false);
  release();
  await sweep;
  expect(await holding).toMatchObject({ cause: { code: 'RECIPE_HOLD_EVIDENCE_UNAVAILABLE' } });
});

it('recovers held expired tombstones and all evidence stores while purging only unheld rows under the live snapshot', async () => {
  const state = await setup(),
    held = state.binding('held'),
    unheld = state.binding('unheld');
  await state.holds.ensureHeld(state.scope, held);
  await state.execute(held);
  await state.holds.verifyHeld(state.scope, held);
  await state.execute(unheld);
  const now = Date.now() + 31 * 86_400_000;
  const journal = new OperationJournal({
    stateRoot: state.stateRoot,
    actorId: actor.actorId,
    now: () => now,
    externallyManagedRetention: true,
  });
  const receipts = new OperationEvidenceReceiptStore({
    stateRoot: state.stateRoot,
    actorId: actor.actorId,
  });
  const egress = new EgressManifestStore({
    stateRoot: state.stateRoot,
    actorId: actor.actorId,
    now: () => now,
  });
  await Promise.all([journal.recover(), receipts.recover(), egress.recover(now)]);
  expect(journal.get(held.operationId)).toMatchObject({
    originAuthSessionId: actor.authSessionId,
    status: 'succeeded',
  });
  expect(journal.get(unheld.operationId)).toBeDefined();
  expect(await journal.purgeExpiredTombstones(now)).toBe(0);
  await expect(journal.purgeExpiredTombstones(now, { isHeld: () => false })).rejects.toThrow(
    'RECIPE_HOLD_RETENTION_SCOPE_INVALID',
  );
  const manager = new RecipeEvidenceHolds({
    stateRoot: state.stateRoot,
    store: new PortalStore(state.stateRoot, state.key, state.permissions),
    permissions: state.permissions,
    issuer: state.issuer,
    operations: journal,
    workspacePolicy: state.policy,
    now: () => now,
    readEvidence: createOperationEvidenceEndpoint({ operations: journal, receipts, egress }),
    hasRetainedEvidence: async (id, operationId) =>
      (await receipts.get(id, operationId)) !== null ||
      (await egress.hasFinalizer(id, operationId)),
  });
  let escaped: Parameters<OperationJournal['purgeExpiredTombstones']>[1];
  await manager.withRetentionSweep(async scope => {
    escaped = scope;
    const linkedAt = (id: string) => (scope.isHeld(id) ? null : journal.settledAt(id));
    await receipts.compact({ now, linkedAt });
    await egress.compact({ now, linkedAt });
    await receipts.drainPendingArtifactCleanup(async receipt => {
      if (scope.isHeld(receipt.operationId)) throw Error('HELD_CLEANUP_REJECTED');
      if (receipt.resultArtifact)
        await state.artifacts.removeLinked({
          workspaceId: state.workspaceId,
          operationId: receipt.operationId,
          artifact: receipt.resultArtifact,
        });
    });
    expect(await journal.purgeExpiredTombstones(now, scope)).toBe(1);
  });
  expect(journal.get(unheld.operationId)).toBeUndefined();
  expect(journal.get(held.operationId)).toBeDefined();
  expect((await manager.verifyHeld(state.scope, held)).verified).not.toBeNull();
  await expect(journal.purgeExpiredTombstones(now, escaped)).rejects.toThrow(
    'RECIPE_HOLD_RETENTION_SCOPE_INVALID',
  );
  await manager.release(state.scope, held);
  expect(
    await manager.withRetentionSweep(scope => journal.purgeExpiredTombstones(now, scope)),
  ).toBe(1);
});

it('does not publish a cancelled hold after waiting for the retention mutex', async () => {
  const state = await setup(),
    binding = state.binding();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(done => {
      entered = done;
    }),
    gate = new Promise<void>(done => {
      release = done;
    });
  const sweeping = state.holds.withRetentionSweep(async () => {
    entered();
    await gate;
  });
  await started;
  const controller = new AbortController();
  const hold = state
    .second()
    .ensureHeld(state.scope, binding, controller.signal)
    .then(
      value => ({ value }),
      cause => ({ cause }),
    );
  controller.abort();
  release();
  await sweeping;
  expect(await hold).toMatchObject({ cause: { name: 'AbortError' } });
  expect(
    await state.holds.withRetentionSweep(async scope => scope.isHeld(binding.operationId)),
  ).toBe(false);
  expect(state.executions()).toBe(0);
});

it('retains an actual unknown outcome after runtime completion and failed artifact publication', async () => {
  const state = await setup(undefined, true),
    binding = state.binding();
  await state.holds.ensureHeld(state.scope, binding);
  await expect(state.execute(binding)).rejects.toThrow(
    /fixture artifact publication|outcome is unknown/u,
  );
  expect(state.executions()).toBe(1);
  expect(state.journal.get(binding.operationId)?.status).toBe('outcome-unknown');
  await expect(state.second().verifyHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_OPERATION_NOT_SUCCEEDED',
  );
  await expect(state.second().release(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_OPERATION_UNSETTLED',
  );
  expect(
    await state.holds.withRetentionSweep(async scope => scope.isHeld(binding.operationId)),
  ).toBe(true);
});

it('reserves the full capture bound for small consumption ceilings before dispatch', async () => {
  const state = await setup({ reservedBytesPerOwner: 1, reservedBytesGlobal: 1 });
  const binding = { ...state.binding(), maxResultBytes: 1 };
  await expect(state.holds.ensureHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_CAPACITY_EXCEEDED',
  );
  expect(state.executions()).toBe(0);
  expect(
    await state.holds.withRetentionSweep(async scope => scope.isHeld(binding.operationId)),
  ).toBe(false);
});

it('preserves old small bindings but accounts their full bound before any new hold', async () => {
  const state = await setup({ reservedBytesPerOwner: 8_388_608 });
  const binding = { ...state.binding(), maxResultBytes: 1 };
  const held = await state.holds.ensureHeld(state.scope, binding);
  const observed = JSON.parse(
    await readFile(join(state.stateRoot, 'portal/recipe-holds/index.json'), 'utf8'),
  );
  expect(observed.payload.rows[0].reservedBytes).toBe(8_388_608);
  const schema = z.object({
    version: z.literal(1),
    revision: z.number(),
    rows: z.array(z.record(z.string(), z.unknown())),
  });
  await state.store.update('recipe-holds', 'index', schema, index => {
    index.rows[0]!.reservedBytes = 1;
    return index;
  });
  expect(await state.second().ensureHeld(state.scope, binding)).toEqual(held);
  await expect(
    state.second().ensureHeld(state.scope, { ...state.binding('second'), maxResultBytes: 1 }),
  ).rejects.toThrow('RECIPE_HOLD_CAPACITY_EXCEEDED');
  await state.execute(binding);
  await expect(state.holds.verifyHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_EVIDENCE_INVALID',
  );
  await state.sweep();
  expect(await state.receipts.get(actor.actorId, binding.operationId)).not.toBeNull();
  expect((await state.holds.release(state.scope, binding)).binding).toEqual(binding);
  expect(
    await state.second().ensureHeld(state.scope, state.binding('after-release')),
  ).toMatchObject({ state: 'held' });
});

it('rejects oversized captures before artifact publication and retains the unknown hold', async () => {
  const state = await setup(undefined, true, 'x'.repeat(8_388_608));
  const binding = state.binding();
  await state.holds.ensureHeld(state.scope, binding);
  await expect(state.execute(binding)).rejects.toMatchObject({
    code: 'EVIDENCE_CAPTURE_TOO_LARGE',
  });
  expect(state.executions()).toBe(1);
  expect(state.journal.get(binding.operationId)).toMatchObject({
    status: 'outcome-unknown',
    errorCode: 'EVIDENCE_CAPTURE_TOO_LARGE',
  });
  expect(await state.receipts.get(actor.actorId, binding.operationId)).toBeNull();
  expect(await state.egress.hasFinalizer(actor.actorId, binding.operationId)).toBe(true);
  await expect(
    readFile(
      join(
        state.workspaceRoot,
        createToolInvocationOptions(true, binding.operationId, state.workspaceId).captureIntent
          .relativePath!,
      ),
    ),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(state.second().verifyHeld(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_OPERATION_NOT_SUCCEEDED',
  );
  await expect(state.second().release(state.scope, binding)).rejects.toThrow(
    'RECIPE_HOLD_OPERATION_UNSETTLED',
  );
  await state.sweep();
  expect(
    await state.holds.withRetentionSweep(async scope => scope.isHeld(binding.operationId)),
  ).toBe(true);
  expect(await state.egress.hasFinalizer(actor.actorId, binding.operationId)).toBe(true);
});

it('does not impose the capture-artifact ceiling on operations without capture', async () => {
  const state = await setup(undefined, false, 'x'.repeat(8_388_608));
  const binding = state.binding();
  await state.execute(binding, false);
  expect(state.journal.get(binding.operationId)?.status).toBe('succeeded');
  expect((await state.receipts.get(actor.actorId, binding.operationId))?.resultArtifact).toBeNull();
});

it('captures and verifies a result exactly at the service byte ceiling', async () => {
  const overhead = Buffer.byteLength(
    canonicalJson({ ok: true, nodeId: '1:2', name: '', type: 'FRAME' }),
  );
  const state = await setup(undefined, false, 'x'.repeat(8_388_608 - overhead));
  const binding = state.binding();
  await state.holds.ensureHeld(state.scope, binding);
  await state.execute(binding);
  expect((await state.holds.verifyHeld(state.scope, binding)).verified?.resultBytes).toBe(
    8_388_608,
  );
});
