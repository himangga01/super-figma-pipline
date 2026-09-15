import { randomBytes } from 'node:crypto';

import { PortalPlanSchema, contentHash } from '@sfp/ir';
import { type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { createPortalCaptureAssetHandler } from '../../../plugin/src/handlers/portal-capture-asset.js';
import { createPortalCaptureReadHandler } from '../../../plugin/src/handlers/portal-capture-read.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { McpInvocationAdapter } from '../../src/execution/mcp-invocation-adapter.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import {
  TargetResolver,
  type AuthenticatedTargetSession,
} from '../../src/execution/target-resolver.js';
import { preparePortalCaptureAuthority } from '../../src/portal/capture-admission-runtime.js';
import { createPortalCaptureRuntime } from '../../src/portal/capture-runtime.js';
import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
const actor: ActorContext = {
  actorId: ('actor1_' + 'A'.repeat(43)) as ActorContext['actorId'],
  authSessionId: ('auth1_' + 'B'.repeat(43)) as ActorContext['authSessionId'],
  entryPath: 'mcp-direct',
};
async function fixture(source: 'desktop' | 'chrome', replaceAtApproval = false) {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const now = Date.now();
  const current = await currentCaptureFixture(f);
  let calls = 0;
  const row: AuthenticatedTargetSession = {
    sessionId: Buffer.alloc(16, 1).toString('base64url'),
    pluginGeneration: 'plugin-1',
    fileIdentity: { kind: 'figma-file-key', value: '4IBhv1d8hEclifZQrOYxHS' },
    editorType: 'figma',
    capabilities: [],
    connectedSequence: 1,
    healthy: true,
  };
  const sessions = [row];
  const admission = {
    sessions: { active: () => sessions[0], list: () => sessions },
    bindingFor: async () => null,
  };
  const node = {
    id: '1:1',
    name: 'Welcome',
    type: 'FRAME',
    width: 1,
    height: 1,
    boundVariables: {},
    reactions: [],
    exportAsync: async () => new Uint8Array([1, 2, 3]),
  };
  const page = { id: '0:1', name: 'Page', type: 'PAGE', selection: [], children: [node] };
  const figma = {
    root: { name: 'Fixture' },
    currentPage: page,
    getNodeByIdAsync: async (id: string) => (id === page.id ? page : node),
    variables: {
      getLocalVariablesAsync: async () => [],
      getLocalVariableCollectionsAsync: async () => [],
    },
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
    getImageByHash: () => null,
  };
  const handlers = {
    portal_capture_read: createPortalCaptureReadHandler(
      figma as unknown as Parameters<typeof createPortalCaptureReadHandler>[0],
    ),
    portal_capture_asset: createPortalCaptureAssetHandler(
      figma as unknown as Parameters<typeof createPortalCaptureAssetHandler>[0],
    ),
  };
  const chrome = {
    capture: async () => {
      calls++;
      return current.captured;
    },
  };
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    {
      apply: async () => {
        throw Error('unused');
      },
      validate: async () => {
        throw Error('unused');
      },
      cancel: async () => {},
    },
    Date.now,
    chrome,
    undefined,
    new PortalCoreLifecycle(new CorePreparations(f)),
  );
  const runtime = createPortalCaptureRuntime({
    stateRoot: f.stateRoot,
    permissions: f.permissions,
    store: f.store,
    chrome,
    admission,
  });
  const issuer = operationIdIssuerFromKey(f.key);
  const journal = new OperationJournal({
    stateRoot: f.stateRoot,
    actorId: actor.actorId,
    now: () => now,
  });
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    now: () => now,
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async (scope, name, args, signal, _reporter, action) => {
          calls++;
          expect(scope.actor.actorId).toBe(actor.actorId);
          expect(scope.target.pluginGeneration).toBe('plugin-1');
          expect(action?.operationId).toBeTruthy();
          return handlers[name as keyof typeof handlers](args, { signal, report: () => {} });
        },
      },
      {
        execute: async (scope, name, args, signal, plugin, reporter, action) => {
          const bound = await runtime(scope, plugin, action!, reporter);
          try {
            return await coordinator.execute(name as PortalToolName, args, {
              actor: scope.actor,
              workspaceId: scope.workspace.workspaceId,
              operationId: action!.operationId,
              authority: scope.portalAuthority!,
              signal,
              ...(bound.capture ? { capture: bound.capture } : {}),
              ...(reporter ? { reporter } : {}),
            });
          } finally {
            await bound.close();
          }
        },
      },
    ),
  });
  const plane = new LeaderGenerationExecutionPlane(
    'generation-test',
    {
      closeAdmission: async () => {},
      installGenerationFence: async () => {},
      abortPending: async () => {},
      abortQueued: async () => {},
      markDispatchedOutcomeUnknown: async () => {},
      finalizeAndFlushEgress: async () => {},
      drainTransport: async () => true,
      forceCloseTransport: async () => {},
      destroy: async () => {},
      releasePort: async () => {},
    },
    () => now,
  );
  plane.bindInvocationService(new ToolInvocationService(executor));
  const approvals = vi.fn<
    () => Promise<{ approvalId: string; waitForDecision(): Promise<{ decision: 'approved' }> }>
  >(async () => {
    if (replaceAtApproval) sessions[0] = { ...row, pluginGeneration: 'replaced' };
    return {
      approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
      waitForDecision: async () => ({ decision: 'approved' as const }),
    };
  });
  plane.bindAdmissionAuthority({
    resolveToolAuthority: async input => {
      const prepared = await preparePortalCaptureAuthority(
        { ...input, name: input.name as PortalToolName },
        coordinator,
        admission,
      );
      return {
        workspace: { workspaceId: f.workspaceId, workspaceRoot: f.workspaceRoot },
        portalAuthority: prepared.authority,
        target: prepared.target,
        resolvedPaths: {},
        approvalLabel: 'Controlled capture',
      };
    },
    resolveWorkspaceContext: async () => ({
      workspaceId: f.workspaceId,
      workspaceRoot: f.workspaceRoot,
    }),
    workspacePolicy: f.policy,
    targetResolver: new TargetResolver(admission.sessions),
    approval: { request: approvals },
    authorizeEgress: async () => {
      if (replaceAtApproval) sessions[0] = { ...row, pluginGeneration: 'replaced' };
      return {
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      };
    },
    issueOperationId: id => issuer.issue(id, now),
    verifyOperationId: (id, operation) => {
      issuer.verify(id, operation, now);
    },
  });
  const args = {
    case: 'new',
    design: { source, url: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1' },
  };
  return {
    ...f,
    issuer,
    journal,
    now,
    args,
    plane,
    coordinator,
    admission,
    calls: () => calls,
    approvals,
    request: (kind: 'portal-source' | 'none' = 'portal-source') => ({
      version: 1,
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      toolName: 'portal_plan',
      rawArgs: args,
      workspaceId: f.workspaceId,
      targetSelector: { kind },
    }),
  };
}
it.each(['desktop', 'chrome'] as const)(
  'executes %s capture through canonical plane, validated runtime and signed plan',
  async source => {
    const f = await fixture(source);
    const result = (await f.plane.invokeTool(actor, f.request())) as {
      planId: string;
      design: { complete: boolean; capture?: unknown };
    };
    expect(result.design.complete).toBe(true);
    expect(result.design.capture).toBeDefined();
    expect(f.calls()).toBeGreaterThan(0);
    const signed = await f.store.get('plans', result.planId, PortalPlanSchema);
    expect(signed?.design.capture).toEqual(result.design.capture);
    expect(f.approvals).toHaveBeenCalledTimes(source === 'chrome' ? 1 : 0);
  },
);
it('rejects explicit no-target Desktop intent before capture effects', async () => {
  const f = await fixture('desktop');
  await expect(f.plane.invokeTool(actor, f.request('none'))).rejects.toMatchObject({
    code: 'TARGET_REQUIRED',
  });
  expect(f.calls()).toBe(0);
  expect(f.approvals).not.toHaveBeenCalled();
});
it.each(['leader', 'follower'] as const)(
  'MCP %s adapter preserves dynamic source intent without reading a plan or impersonating owner',
  async role => {
    const adapter = new McpInvocationAdapter({
      role,
      resolveWorkspaceId: async () => null,
      createRequestId: () => 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
    });
    const request = await adapter.fromToolCall(
      'portal_validate',
      { runId: 'sfp_portal1_' + 'a'.repeat(32), profileId: 'profile', target: 'candidate' },
      {},
    );
    expect(request.targetSelector).toEqual({ kind: 'portal-source' });
    expect(request).not.toHaveProperty('principal');
  },
);

it('rejects Desktop target generation replacement while consent is being resolved before any plugin effect', async () => {
  const f = await fixture('desktop', true);
  await expect(f.plane.invokeTool(actor, f.request())).rejects.toMatchObject({
    code: 'PORTAL_CAPTURE_TARGET_CHANGED',
  });
  expect(f.calls()).toBe(0);
});

it('resumes a reserved failed plan through a new canonical operation and current session admission', async () => {
  const f = await fixture('chrome');
  const firstId = f.issuer.issue(actor.actorId, f.now),
    planId =
      'sfp_portal1_' +
      contentHash('sfp-portal-plan-id-v1', { owner: actor.actorId, operationId: firstId }).slice(
        7,
        39,
      );
  const create = f.store.create.bind(f.store);
  let interrupted = false;
  vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
    if (args[0] === 'plans' && !interrupted) {
      interrupted = true;
      throw Error('plan publication interrupted');
    }
    return create(...args);
  });
  await expect(
    f.plane.invokeTool(actor, { ...f.request(), operationId: firstId }),
  ).rejects.toBeInstanceOf(Error);
  expect(interrupted).toBe(true);
  expect(f.journal.get(firstId)?.status).toBe('failed');
  const calls = f.calls();
  vi.restoreAllMocks();
  const currentActor = {
    ...actor,
    authSessionId: ('auth1_' + 'C'.repeat(43)) as ActorContext['authSessionId'],
  };
  const secondId = f.issuer.issue(currentActor.actorId, f.now);
  const result = (await f.plane.invokeTool(currentActor, {
    ...f.request(),
    requestId: 'sfp_req1_' + randomBytes(16).toString('base64url'),
    operationId: secondId,
    rawArgs: { ...f.args, resumePlanId: planId },
  })) as { planId: string; coreRecipes: { status: string } };
  expect(result.planId).toBe(planId);
  expect(result.coreRecipes.status).toBe('ready');
  expect(f.calls()).toBe(calls);
  expect(f.journal.get(secondId)).toMatchObject({
    status: 'succeeded',
    originAuthSessionId: currentActor.authSessionId,
  });
  expect(f.journal.get(firstId)?.status).toBe('failed');
  const stored = await f.store.get('plans', planId, PortalPlanSchema);
  expect(stored?.request).not.toHaveProperty('resumePlanId');
  const invoke = (principal: ActorContext, rawArgs: unknown) =>
    f.plane.invokeTool(principal, {
      ...f.request(),
      requestId: 'sfp_req1_' + randomBytes(16).toString('base64url'),
      operationId: f.issuer.issue(principal.actorId, f.now),
      rawArgs,
    });
  await expect(
    invoke(currentActor, { ...f.args, resumePlanId: planId, stack: 'vue-vite' }),
  ).rejects.toThrow('PORTAL_CORE_RESUME_REQUEST_CHANGED');
  const other = { ...actor, actorId: ('actor1_' + 'D'.repeat(43)) as ActorContext['actorId'] };
  await expect(invoke(other, { ...f.args, resumePlanId: planId })).rejects.toMatchObject({
    code: 'CORE_PREPARATION_INTENT_NOT_FOUND',
  });
  await expect(
    invoke(currentActor, { ...f.args, resumePlanId: 'sfp_portal1_' + 'f'.repeat(32) }),
  ).rejects.toThrow('CORE_PREPARATION_INTENT_NOT_FOUND');
  const call = (toolName: string, rawArgs: unknown) =>
    f.plane.invokeTool(currentActor, {
      ...f.request(),
      toolName,
      rawArgs,
      targetSelector: { kind: 'none' },
      requestId: 'sfp_req1_' + randomBytes(16).toString('base64url'),
      operationId: f.issuer.issue(currentActor.actorId, f.now),
    });
  await call('portal_start', { planId });
  await call('portal_cancel', { runId: planId });
  await expect(invoke(currentActor, { ...f.args, resumePlanId: planId })).rejects.toThrow(
    'PORTAL_CORE_INTENT_CANCELLED',
  );
}, 60000);
