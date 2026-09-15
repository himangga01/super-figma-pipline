import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalRunSchema, contentHash, storedChecksum } from '@sfp/ir';
import { type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';

import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import {
  loadCoreConsumptionInput,
  verifyCoreCatalogExport,
} from '../../src/portal/recipes/consumption-input.js';
import {
  PortalCoreLifecycle,
  coreDeclarationsHash,
} from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
async function fixture(legacy = false) {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const captured = await currentCaptureFixture(f, {
    nodes: [{ id: '0:1', name: 'Welcome', type: 'FRAME' }],
  });
  const lifecycle = new PortalCoreLifecycle(new CorePreparations(f));
  const unused = async (): Promise<never> => {
    throw Error('This fixture does not run native work');
  };
  const work: PortalWorkPort = { apply: unused, validate: unused, cancel: async () => {} };
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    work,
    Date.now,
    { capture: async () => captured.captured },
    undefined,
    lifecycle,
  );
  let sequence = 0;
  const invoke = async (name: PortalToolName, args: unknown) => {
    const operationId = 'consumption-' + ++sequence;
    const authority = await coordinator.prepare(name, args, actor, f.workspaceId, operationId);
    authority.captureSource = captured.grant;
    return coordinator.execute(name, args, {
      actor,
      authority,
      operationId,
      workspaceId: f.workspaceId,
      signal: new AbortController().signal,
    }) as Promise<Record<string, any>>;
  };
  const legacyContent = 'export function Card(){return <main>Welcome</main>}';
  if (legacy) {
    await mkdir(join(f.workspaceRoot, 'legacy/src'), { recursive: true });
    await writeFile(
      join(f.workspaceRoot, 'legacy/package.json'),
      '{"dependencies":{"react":"19.2.8"}}',
    );
    await writeFile(join(f.workspaceRoot, 'legacy/src/Card.tsx'), legacyContent);
  }
  let plan = await invoke(
    'portal_plan',
    legacy ? { case: 'legacy', targetPath: 'legacy', services: ['.'] } : { case: 'new-blank' },
  );
  if (legacy) {
    const selected = plan.selectedClosure.selected[0];
    const requirements = plan.requirements.map((requirement: any) => ({
      ...requirement,
      workflow: {
        status: 'confirmed',
        roles: ['visitor'],
        states: ['loading', 'ready', 'error'],
        routes: ['/'],
        apiContracts: [],
        dataContracts: [],
        decisions: requirement.layers.map((layer: string) => ({
          layer,
          action: 'present',
          evidence: 'Use the existing source component for the overview',
          sourceEvidence: [
            {
              sourceId: selected.sourceId,
              sourceIndex: 0,
              path: 'src/Card.tsx',
              hash: storedChecksum(legacyContent),
            },
          ],
        })),
      },
    }));
    plan = await invoke('portal_plan', {
      case: 'legacy',
      targetPath: 'legacy',
      services: ['.'],
      requirements,
    });
  }
  await invoke('portal_start', { planId: plan.planId });
  const next = await invoke('portal_next', { runId: plan.planId });
  const path = 'src/main.ts',
    content = 'export const message = "Welcome";',
    hash = storedChecksum(content);
  const coreDeclarations = next.recipes.workItems.map((item: any) => ({
    resultId: item.resultId,
    resultHash: item.resultHash,
    outputItemId: item.id,
    kind: item.kind,
    files: [
      { path, hash },
      ...(legacy ? [{ path: 'src/Card.tsx', hash: storedChecksum(legacyContent) }] : []),
    ],
    assertionIds: [],
  }));
  const result = await invoke('portal_submit', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    blueprintHash: plan.blueprintHash,
    contextHash: plan.contextHash,
    files: [{ path, content, contentHash: hash, baseHash: null, action: 'create' }],
    coreDeclarations,
    finished: true,
  });
  const request = {
    ownerId: actor.actorId,
    planId: plan.planId as string,
    candidateHash: result.candidateHash as string,
  };
  return { ...f, lifecycle, invoke, request, path, content, hash };
}

it('loads only actual owner-bound required pages and declared signed candidate bytes', async () => {
  const f = await fixture();
  const input = await loadCoreConsumptionInput(f, f.request);
  expect(input.plan.coreRecipes?.status).toBe('ready');
  expect(input.pages.length).toBe(input.run.coreDeclarations!.length);
  expect(input.files.get(f.path)?.bytes.toString()).toBe(f.content);
  expect(input.materialHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  await expect(loadCoreConsumptionInput(f, { ...f.request, ownerId: 'other' })).rejects.toThrow(
    'OWNER_MISMATCH',
  );
  await expect(
    loadCoreConsumptionInput(f, { ...f.request, candidateHash: contentHash('other', {}) }),
  ).rejects.toThrow('CANDIDATE_CHANGED');
});
it('refuses a changed declaration even if its signed container and declaration hash are valid', async () => {
  const f = await fixture();
  await f.store.update('runs', f.request.planId, PortalRunSchema, run => {
    run.coreDeclarations![0]!.kind = 'token';
    run.coreDeclarationsHash = coreDeclarationsHash(run.coreDeclarations);
    return run;
  });
  await expect(loadCoreConsumptionInput(f, f.request)).rejects.toThrow('DECLARATIONS_CHANGED');
});
it('rehashes actual stored content and never trusts its declared hash alone', async () => {
  const f = await fixture();
  await f.store.update(
    'contents',
    f.hash.slice(7),
    z.object({ content: z.string(), hash: z.string(), encoding: z.string() }),
    value => ({ ...value, content: 'Changed bytes' }),
  );
  await expect(loadCoreConsumptionInput(f, f.request)).rejects.toThrow('FILE_CHANGED');
});
it('does not count copied runtime rows as catalog export proof', async () => {
  const f = await fixture();
  const input = await loadCoreConsumptionInput(f, f.request);
  const page = input.pages.find(candidate =>
    candidate.page.rows.some(row => row.kind === 'scope'),
  )!;
  const row = page.page.rows.find(candidate => candidate.kind === 'scope')!;
  expect(() => verifyCoreCatalogExport(page, row.id, f.path, input.files)).toThrow('CATALOG_KIND');
});

it('reads unchanged eligible legacy files without requiring them to be submitted again', async () => {
  const f = await fixture(true);
  const input = await loadCoreConsumptionInput(f, f.request);
  expect(input.run.files.some(file => file.path === 'src/Card.tsx')).toBe(false);
  expect(input.files.get('src/Card.tsx')?.bytes.toString()).toContain('function Card');
  await writeFile(join(f.workspaceRoot, 'legacy/src/Card.tsx'), 'export const changed=true;');
  await expect(loadCoreConsumptionInput(f, f.request)).rejects.toThrow('FILE_CHANGED');
});
