import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalPlanSchema, PortalRunSchema, storedChecksum } from '@sfp/ir';
import type { ActorContext } from '@sfp/shared';

import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import { prepareNativeArtifactAuthority } from '../../src/portal/native-artifacts.js';
import { PortalNativeProfileSchema, type PortalNativeWork } from '../../src/portal/native-work.js';
import { portalFixture } from './fixtures.js';
export const profileJobActor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control' as const,
};
export async function profileJobFixture() {
  const f = await portalFixture();
  await mkdir(join(f.workspaceRoot, 'reference/server'), { recursive: true });
  await writeFile(
    join(f.workspaceRoot, 'reference/package.json'),
    '{"type":"module","dependencies":{"@react-router/dev":"8.4.0"}}',
  );
  await writeFile(join(f.workspaceRoot, 'reference/server/app.ts'), 'export const app=true;');
  await writeFile(
    join(f.workspaceRoot, 'design.json'),
    JSON.stringify({
      requestedUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      requestedNodeId: '0:1',
      nodes: [{ id: '0:1', type: 'FRAME', name: 'Synthetic profile fixture' }],
    }),
  );
  const coordinator = new PortalCoordinator(f.store, f.policy, {} as PortalWorkPort);
  let count = 0;
  const invoke = async (name: any, input: unknown) => {
    const operationId = 'profile-fixture-' + ++count,
      authority = await coordinator.prepare(
        name,
        input,
        profileJobActor,
        f.workspaceId,
        operationId,
      );
    return coordinator.execute(name, input, {
      actor: profileJobActor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    });
  };
  const summary: any = await invoke('portal_plan', {
    case: 'new-reference',
    targetPath: 'out',
    references: [{ workspaceId: f.workspaceId, rootPath: 'reference' }],
    design: { artifactPath: 'design.json', freshness: 'allow-pinned' },
  });
  await invoke('portal_start', { planId: summary.planId });
  const plan = (await f.store.get('plans', summary.planId, PortalPlanSchema))!,
    run = (await f.store.get('runs', summary.planId, PortalRunSchema))!;
  const profile = PortalNativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    ownerId: profileJobActor.actorId,
    planId: plan.planId,
    contextHash: plan.contextHash,
    purpose: 'source-preparation',
    sourcePreparation: {
      sourceId: plan.profiles[0]!.graph.sourceId,
      packageContextRoot: join(f.workspaceRoot, 'reference'),
    },
    native: {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'profile-source',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: plan.profiles[0]!.graph.sourceHash,
      closure: [{ path: 'package.json', hash: storedChecksum('{}') }],
      environment: {},
      commands: [
        {
          id: 'placeholder',
          executable: process.execPath,
          executableHash: 'sha256:' + 'a'.repeat(64),
          args: ['-e', ''],
          timeoutMs: 1000,
        },
      ],
    },
    assertions: [
      {
        commandId: 'placeholder',
        check: { id: 'placeholder', kind: 'source-scope', required: true, requirementIds: [] },
      },
    ],
  });
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r)),
    issuers = new Set<string>();
  let calls = 0,
    registers = 0;
  const work = {
    sourceProfileIssuerAvailable: (id: string) => issuers.has(id),
    retireSourceProfile: (id: string) => issuers.delete(id),
    profilePreparationRows: async (schema: any) => {
      const dir = join(f.stateRoot, 'portal/profile-preparations');
      const names = await import('node:fs/promises').then(fs => fs.readdir(dir).catch(() => []));
      const rows = [];
      for (const name of names.filter(n => n.endsWith('.json'))) {
        const r = await f.store.get('profile-preparations', name.slice(0, -5), schema);
        if (r) rows.push(r);
      }
      return rows;
    },
    sourceProfileJob: async (_p: any, signal: AbortSignal, _deadline: number, action: any) =>
      action(signal),
    prepareProfile: async (p: any, _s: AbortSignal, id: string) => {
      calls++;
      await gate;
      const native = {
        ...p.native,
        artifactAuthority: await prepareNativeArtifactAuthority(p.native),
      };
      const result = PortalNativeProfileSchema.parse({
        ...p,
        native,
        preparedContractVersion: 2,
        sourcePreparation: {
          ...p.sourcePreparation,
          preparationId: id,
          issuerDeadlineAt: run.deadlineAt,
          sourceInventoryHash: 'sha256:' + 'c'.repeat(64),
        },
      });
      issuers.add(id);
      return result;
    },
    registerProfile: async (_p: any) => {
      registers++;
      return 'a'.repeat(64);
    },
  } as unknown as PortalNativeWork;
  const { ownerId: _, ...publicProfile } = profile;
  return {
    ...f,
    plan,
    run,
    profile,
    publicProfile,
    work,
    release,
    issuers,
    calls: () => calls,
    registers: () => registers,
  };
}
