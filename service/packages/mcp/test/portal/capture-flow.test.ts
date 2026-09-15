import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalRunSchema, storedChecksum } from '@sfp/ir';
import { PORTAL_RESULT_SCHEMAS, type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import {
  portalDesignFingerprint,
  type PortalDesignCapturePort,
  type PortalCapturedDesign,
} from '../../src/portal/design-capture.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
it('exposes a safe unclassified capture boundary for an older capture port error', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const coordinator = new PortalCoordinator(
    value.store,
    value.policy,
    {
      apply: vi.fn<PortalWorkPort['apply']>(),
      validate: vi.fn<PortalWorkPort['validate']>(),
      cancel: async () => {},
    },
    Date.now,
    {
      capture: async () => {
        throw Object.assign(new Error('private bearer'), { code: 'private-token' });
      },
    },
    undefined,
    new PortalCoreLifecycle(new CorePreparations(value)),
  );
  const { grant } = await currentCaptureFixture(value);
  const args = { case: 'new' };
  const authority = await coordinator.prepare(
    'portal_plan',
    args,
    actor,
    value.workspaceId,
    'failed-capture',
  );
  authority.captureSource = grant;
  const plan = PORTAL_RESULT_SCHEMAS.portal_plan.parse(
    await coordinator.execute('portal_plan', args, {
      actor,
      workspaceId: value.workspaceId,
      operationId: 'failed-capture',
      authority,
      signal: new AbortController().signal,
    }),
  );
  expect(plan.design.captureFailure).toMatchObject({
    stage: 'capture',
    type: 'error',
    code: 'DESIGN_CAPTURE_FAILED',
  });
  expect(JSON.stringify(plan)).not.toMatch(/private-token|private bearer/u);
});
it('hands server-captured values and assets to the agent and imports an asset by its immutable identity', async () => {
  const value = await portalFixture();
  cleanups.push(value.cleanup);
  const current = await currentCaptureFixture(value, {
    nodes: [{ id: '1:1', type: 'FRAME', width: 1440, height: 900 }],
  });
  const captured = current.captured;
  const bytes = await readFile(join(captured.assetRoot, captured.assets[0]!.path!));
  const capture = vi.fn<PortalDesignCapturePort['capture']>(async () => captured);
  const work: PortalWorkPort = {
    apply: vi.fn<PortalWorkPort['apply']>(),
    validate: vi.fn<PortalWorkPort['validate']>(),
    cancel: async () => {},
  };
  const coordinator = new PortalCoordinator(
    value.store,
    value.policy,
    work,
    Date.now,
    { capture },
    undefined,
    new PortalCoreLifecycle(new CorePreparations(value)),
  );
  let step = 0;
  const invoke = async (name: PortalToolName, args: unknown) => {
    const operationId = `capture-${++step}`,
      authority = await coordinator.prepare(name, args, actor, value.workspaceId, operationId);
    authority.captureSource = current.grant;
    const result = await coordinator.execute(name, args, {
      actor,
      workspaceId: value.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    });
    return PORTAL_RESULT_SCHEMAS[name].parse(result) as Record<string, any>;
  };
  const plan = await invoke('portal_plan', { case: 'new' });
  expect(capture).toHaveBeenCalledWith(
    plan.planId,
    expect.stringContaining('4IBhv1d8hEclifZQrOYxHS'),
    expect.any(AbortSignal),
  );
  expect(plan.design).toMatchObject({ storage: 'owner-state', liveVerified: true, complete: true });
  await invoke('portal_start', { planId: plan.planId });
  const next = await invoke('portal_next', { runId: plan.planId, assetIds: [0] });
  expect(next.designEvidence.nodes[0].properties).toMatchObject({ width: 1440, height: 900 });
  expect(next.assets.contents[0].data).toBe(bytes.toString('base64'));
  await invoke('portal_submit', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    assets: [
      {
        path: 'public/hero.png',
        assetId: 0,
        action: 'create',
        baseHash: null,
        contentHash: storedChecksum(bytes),
      },
    ],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path: 'public/hero.png', hash: storedChecksum(bytes) }],
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const run = await value.store.get('runs', plan.planId, PortalRunSchema);
  expect(run?.files[0]).toMatchObject({
    path: 'public/hero.png',
    encoding: 'base64',
    contentHash: storedChecksum(bytes),
  });
}, 30_000);
it('compares design content and exported assets while ignoring capture timestamps', () => {
  const base = {
    raw: JSON.stringify({ nodes: [{ id: '1:1', width: 1440 }], capture: { startedAt: 'first' } }),
    hash: `sha256:${'a'.repeat(64)}`,
    assetRoot: 'fixture',
    assets: [],
    capturedAt: new Date().toISOString(),
    complete: true,
    liveVerified: true,
  } as PortalCapturedDesign;
  expect(
    portalDesignFingerprint({
      ...base,
      raw: JSON.stringify({ nodes: [{ id: '1:1', width: 1440 }], capture: { startedAt: 'later' } }),
    }),
  ).toBe(portalDesignFingerprint(base));
  expect(
    portalDesignFingerprint({
      ...base,
      raw: JSON.stringify({ nodes: [{ id: '1:1', width: 1200 }] }),
    }),
  ).not.toBe(portalDesignFingerprint(base));
});
