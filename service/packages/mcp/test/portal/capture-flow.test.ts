import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalRunSchema, storedChecksum } from '@sfp/ir';
import { PORTAL_RESULT_SCHEMAS, type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
it.each(['png', 'svg'] as const)(
  'hands server-captured values and a %s asset to the agent by immutable identity',
  async format => {
    const value = await portalFixture();
    cleanups.push(value.cleanup);
    let current = await currentCaptureFixture(value, {
      nodes: [{ id: '1:1', type: 'FRAME', width: 1440, height: 900 }],
    });
    if (format === 'svg') {
      const svg = Buffer.from(
        '\uFEFF<svg xmlns="http://www.w3.org/2000/svg"><text>원본</text></svg>',
      );
      await writeFile(join(current.captured.assetRoot, 'assets/vector.svg'), svg);
      current = await currentCaptureFixture(value, {
        nodes: [{ id: '1:1', type: 'FRAME', width: 1440, height: 900 }],
        assetRoot: current.captured.assetRoot,
        assets: [
          ...current.captured.assets,
          {
            query: { kind: 'svg', nodeId: '1:1' },
            status: 'captured',
            path: 'assets/vector.svg',
            sha256: storedChecksum(svg),
            bytes: svg.length,
          },
        ],
      });
    }
    const assetId = format === 'svg' ? 1 : 0;
    const destination = `public/hero.${format}`;
    const captured = current.captured;
    const bytes = await readFile(join(captured.assetRoot, captured.assets[assetId]!.path!));
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
    expect(plan.design).toMatchObject({
      storage: 'owner-state',
      liveVerified: true,
      complete: true,
    });
    await invoke('portal_start', { planId: plan.planId });
    const next = await invoke('portal_next', { runId: plan.planId, assetIds: [assetId] });
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
          path: destination,
          assetId,
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
          files: [{ path: destination, hash: storedChecksum(bytes) }],
          assertionIds: [],
        }),
      ),
      finished: true,
    });
    const run = await value.store.get('runs', plan.planId, PortalRunSchema);
    expect(run?.files[0]).toMatchObject({
      path: destination,
      encoding: format === 'svg' ? 'utf8' : 'base64',
      contentHash: storedChecksum(bytes),
    });
  },
  30_000,
);
it.each([5_242_881, 16_777_216])(
  'imports the %i byte original through an artifact reference without model inline bytes',
  async size => {
    const value = await portalFixture();
    cleanups.push(value.cleanup);
    const assetRoot = join(value.workspaceRoot, 'captured-assets');
    await mkdir(assetRoot);
    // A controlled PNG with trailing bytes exercises the file-size boundary, not live Figma capture.
    const seed = await currentCaptureFixture(value);
    const tiny = await readFile(join(seed.captured.assetRoot, seed.captured.assets[0]!.path!));
    const bytes = Buffer.concat([tiny, Buffer.alloc(size - tiny.length)]);
    const sha256 = storedChecksum(bytes);
    await writeFile(join(assetRoot, 'original.png'), bytes);
    const current = await currentCaptureFixture(value, {
      assetRoot,
      assets: [
        {
          query: { kind: 'png', nodeId: '1:1' },
          status: 'captured',
          path: 'original.png',
          sha256,
          bytes: size,
          exportedFrom: { nodeId: '1:1', geometryHash: storedChecksum('controlled geometry') },
        },
      ],
    });
    const coordinator = new PortalCoordinator(
      value.store,
      value.policy,
      {
        apply: vi.fn<PortalWorkPort['apply']>(),
        validate: vi.fn<PortalWorkPort['validate']>(),
        cancel: async () => {},
      },
      Date.now,
      { capture: async () => current.captured },
      undefined,
      new PortalCoreLifecycle(new CorePreparations(value)),
    );
    let step = 0;
    const invoke = async (name: PortalToolName, args: unknown) => {
      const operationId = `large-capture-${++step}`;
      const authority = await coordinator.prepare(
        name,
        args,
        actor,
        value.workspaceId,
        operationId,
      );
      authority.captureSource = current.grant;
      return PORTAL_RESULT_SCHEMAS[name].parse(
        await coordinator.execute(name, args, {
          actor,
          workspaceId: value.workspaceId,
          operationId,
          authority,
          signal: new AbortController().signal,
        }),
      ) as Record<string, any>;
    };
    const plan = await invoke('portal_plan', {
      case: 'new-blank',
      design: {
        url: current.grant.url,
        source: 'chrome',
        freshness: 'allow-pinned',
      },
    });
    await invoke('portal_start', { planId: plan.planId });
    const next = await invoke('portal_next', { runId: plan.planId, assetIds: [0] });
    expect(next.assets.contents[0]).toMatchObject({
      delivery: 'artifact-reference',
      reference: { bytes: size },
    });
    expect(next.assets.contents[0]).not.toHaveProperty('data');
    expect(next.assets.inventory[0].exportedFrom).toEqual(current.captured.assets[0]!.exportedFrom);
    await invoke('portal_submit', {
      runId: plan.planId,
      leaseId: next.lease.leaseId,
      leaseEpoch: next.lease.leaseEpoch,
      contextHash: plan.contextHash,
      blueprintHash: plan.blueprintHash,
      assets: [
        {
          path: 'public/original.png',
          assetId: 0,
          action: 'create',
          baseHash: null,
          contentHash: sha256,
        },
      ],
      coreDeclarations: next.recipes.workItems.map(
        (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
          resultId: item.resultId,
          resultHash: item.resultHash,
          outputItemId: item.id,
          kind: item.kind,
          files: [{ path: 'public/original.png', hash: sha256 }],
          assertionIds: [],
        }),
      ),
      finished: true,
    });
    const run = await value.store.get('runs', plan.planId, PortalRunSchema);
    expect(run?.files[0]).toMatchObject({
      path: 'public/original.png',
      encoding: 'base64',
      contentHash: sha256,
    });
    const stored = await value.store.get(
      'contents',
      sha256.slice(7),
      z.object({ content: z.string(), hash: z.string(), encoding: z.string() }),
    );
    const imported = Buffer.from(stored!.content, 'base64');
    expect(imported.length).toBe(size);
    expect(storedChecksum(imported)).toBe(sha256);
    expect(imported.equals(bytes)).toBe(true);
  },
  60_000,
);
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
