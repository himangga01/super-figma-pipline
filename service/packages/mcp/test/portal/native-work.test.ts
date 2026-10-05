import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PortalPlanSchema,
  PortalRunSchema,
  storedChecksum,
  contentHash,
  portalCandidateHash,
} from '@sfp/ir';
import {
  hashActionRequest,
  NO_CAPTURE_OPTIONS,
  type RuntimeExecutionScope,
  type ActorContext,
  type PortalAcceptance,
  type PortalToolName,
} from '@sfp/shared';
import { build } from 'tsdown';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { AtomicFileStore } from '../../src/fs/atomic-file.js';
import { resolvePortalAuthority } from '../../src/portal/authority.js';
import {
  createPortalProfileEndpoint,
  createPortalProfilePreparationEndpoint,
} from '../../src/portal/control.js';
import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { PortalCapturedDesignSchema } from '../../src/portal/design-capture.js';
import {
  expandNativeEnvironment,
  prepareNativeEnvironment,
} from '../../src/portal/native-resources.js';
import { NativePortalRunner, nativeExecutableHash } from '../../src/portal/native-runner.js';
import {
  PortalNativeWork,
  PortalNativeProfileSchema,
  PortalApplyJournalSchema,
  PortalStoredValidationSchema,
} from '../../src/portal/native-work.js';
import { portalMaterialFiles } from '../../src/portal/profile-closure.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
let creationWorker: string;
beforeAll(async () => {
  if (process.platform !== 'win32') return;
  const folder = resolvePath('packages/mcp/.cache/apply-creation-worker');
  await mkdir(folder, { recursive: true });
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    `
    import {readFile} from 'node:fs/promises';
    import {PortalNativeWork} from ${JSON.stringify(resolvePath('packages/mcp/src/portal/native-work.ts'))};
    import {PortalStore} from ${JSON.stringify(resolvePath('packages/mcp/src/portal/store.ts'))};
    import {createWorkspaceConfigStore} from ${JSON.stringify(resolvePath('packages/mcp/src/fs/workspace-config-store.ts'))};
    import {createWorkspacePolicy} from ${JSON.stringify(resolvePath('packages/mcp/src/fs/workspace-policy.ts'))};
    import {fixturePermissions} from ${JSON.stringify(resolvePath('packages/mcp/test/portal/fixtures.ts'))};
    const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const permissions = fixturePermissions(value.stateRoot);
    const store = new PortalStore(value.stateRoot, Buffer.from(value.key, 'hex'), permissions);
    const workspaces = createWorkspaceConfigStore(value.stateRoot, {hasUnsettled: async()=>false}, permissions);
    const policy = createWorkspacePolicy(workspaces);
    const update = store.update.bind(store);
    store.update = async (...args) => {
      const record = await update(...args);
      if (args[0] === 'apply' && record.rootCreations?.some(row =>
        row.path === value.authority.roots[0].path &&
        (value.boundary === 'target-identity' ? !!record.targetIdentity : row.phase === value.boundary)))
        process.exit(83);
      return record;
    };
    const work = new PortalNativeWork({stateRoot:value.stateRoot, store, policy, permissions});
    await work.apply(value.plan, value.run, value.files, value.authority, new AbortController().signal);
    throw Error('apply creation boundary was not reached');
  `,
  );
  await build({
    cwd: resolvePath('packages/mcp'),
    config: false,
    entry: [entry],
    outDir: folder,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    clean: false,
    fixedExtension: true,
    deps: { alwaysBundle: ['@sfp/ir', '@sfp/shared'] },
    logLevel: 'silent',
  });
  creationWorker = join(folder, 'entry.mjs');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it('cancels source application between files and preserves the durable partial result', async () => {
  const value = await fixture();
  const authority = await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  );
  value.run.validation = await acceptanceFixture(value);
  let reached!: () => void, release!: () => void;
  const atSecond = new Promise<void>(done => {
    reached = done;
  });
  const gate = new Promise<void>(done => {
    release = done;
  });
  const original = value.policy.resolveWrite.bind(value.policy);
  let blocked = false;
  const policy = {
    ...value.policy,
    resolveWrite: async (workspaceId: string, path: string) => {
      const result = await original(workspaceId, path);
      if (
        !blocked &&
        path.endsWith('check.mjs') &&
        existsSync(join(value.workspaceRoot, 'output/src/app.js'))
      ) {
        blocked = true;
        reached();
        await gate;
      }
      return result;
    },
  };
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy,
    permissions: value.permissions,
  });
  cleanups.unshift(() => work.close());
  const applying = work.apply(
    value.plan,
    value.run,
    value.files,
    authority,
    new AbortController().signal,
  );
  const rejection = applying.then(
    () => null,
    error => error as unknown,
  );
  await atSecond;
  const cancelling = work.cancel(value.run.runId);
  release();
  const [error] = await Promise.all([rejection, cancelling]);
  expect(error).toMatchObject({ code: 'OPERATION_CANCELLED', committed: true });
  expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe(
    value.files[0]!.content,
  );
  await expect(readFile(join(value.workspaceRoot, 'output/check.mjs'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
}, 60_000);
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
it
  .runIf(process.platform === 'win32')
  .each(['intent', 'identity-bound', 'published', 'target-identity'])(
  'recovers the exact signed output creation after a real child exits at %s',
  async boundary => {
    const value = await fixture(),
      authority = await authorityFixture(value);
    value.run.validation = await acceptanceFixture(value);
    const inputPath = join(value.root, 'creation-input.json');
    await writeFile(
      inputPath,
      JSON.stringify({
        stateRoot: value.stateRoot,
        key: value.key.toString('hex'),
        plan: value.plan,
        run: value.run,
        files: value.files,
        authority,
        boundary,
      }),
    );
    const child = spawn(process.execPath, [creationWorker, inputPath], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => {
      output += String(data);
    });
    child.stderr.on('data', data => {
      output += String(data);
    });
    const exitCode = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('exit', done);
    });
    expect({ exitCode, output }).toEqual({ exitCode: 83, output: '' });
    const before = await value.store.get('apply', value.run.runId, z.any());
    expect(before.rootCreations).toHaveLength(1);
    expect(before.files.every((row: { state: string }) => row.state === 'pending')).toBe(true);
    const inspected = await value.work.reconcile(
      value.plan,
      value.run,
      authority,
      new AbortController().signal,
    );
    expect(inspected.state).toBe(boundary === 'intent' ? 'not-applied' : 'partial');
    await value.work.apply(
      value.plan,
      value.run,
      value.files,
      authority,
      new AbortController().signal,
    );
    const after = await value.store.get('apply', value.run.runId, z.any());
    expect(after.rootCreations[0]).toMatchObject({
      stagingPath: before.rootCreations[0].stagingPath,
      phase: 'published',
    });
    expect(after.targetIdentity).toBe(after.rootCreations[0].identity);
    expect(after.state).toBe('applied');
    expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe(
      value.files[0]!.content,
    );
  },
  60000,
);
it('proves a fresh rejected apply has no source effects and keeps its journal absent', async () => {
  const value = await fixture();
  const authority = await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  );
  value.run.validation = null;
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'PORTAL_VALIDATION_REQUIRED',
    committed: false,
    applyEffectDisposition: 'pre-effect-rejected',
  });
  expect(await value.store.get('apply', value.run.runId, z.unknown())).toBeNull();
  expect(existsSync(join(value.workspaceRoot, 'output'))).toBe(false);
});
it('uses the admitted effect budget after the generation deadline expires', async () => {
  const value = await fixture();
  const authority = await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  );
  value.run.deadlineAt = Date.now() - 1;
  value.run.nativeBudget = { version: 1, effect: { deadlineAt: Date.now() + 60000, attempts: 1 } };
  value.run.validation = null;
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'PORTAL_VALIDATION_REQUIRED',
    applyEffectDisposition: 'pre-effect-rejected',
  });
});
it.each(['cancelled', 'expired'] as const)(
  'proves %s admission before a fresh apply has no effects',
  async mode => {
    const value = await fixture();
    const authority = await authorityFixture(value);
    const controller = new AbortController();
    if (mode === 'cancelled')
      controller.abort(Object.assign(new Error('cancelled'), { code: 'OPERATION_CANCELLED' }));
    else value.run.deadlineAt = Date.now() - 1;
    await expect(
      value.work.apply(value.plan, value.run, value.files, authority, controller.signal),
    ).rejects.toMatchObject({
      code: mode === 'cancelled' ? 'OPERATION_CANCELLED' : 'PORTAL_BUDGET_EXHAUSTED',
      committed: false,
      applyEffectDisposition: 'pre-effect-rejected',
    });
    expect(await value.store.get('apply', value.run.runId, PortalApplyJournalSchema)).toBeNull();
    expect(existsSync(join(value.workspaceRoot, 'output'))).toBe(false);
  },
  30_000,
);
it('keeps prior signed partial apply proof when a later invocation is cancelled before admission', async () => {
  const value = await fixture();
  const authority = await authorityFixture(value);
  await value.store.create(
    'apply',
    value.run.runId,
    {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      ownerId: value.plan.ownerId,
      runId: value.run.runId,
      candidateHash: value.run.candidateHash!,
      authorityHash: authority.hash,
      state: 'applying',
      targetIdentity: null,
      files: value.run.files.map((file, index) => ({
        path: file.path,
        before: file.baseHash,
        after: file.contentHash,
        state: index === 0 ? ('written' as const) : ('pending' as const),
      })),
    },
    PortalApplyJournalSchema,
  );
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('cancelled'), { code: 'OPERATION_CANCELLED' }));
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, controller.signal),
  ).rejects.toMatchObject({
    code: 'OPERATION_CANCELLED',
    committed: true,
    applyEffectDisposition: 'partial-or-committed',
  });
  expect(
    (await value.store.get('apply', value.run.runId, PortalApplyJournalSchema))?.files[0]?.state,
  ).toBe('written');
}, 30_000);
const fixture = async (legacy = false, heavy = false, requireLive = false) => {
  const value = await portalFixture();
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
  });
  cleanups.push(async () => {
    await work.close();
    await value.cleanup();
  });
  const capture = await currentCaptureFixture(value);
  const coordinator = new PortalCoordinator(
    value.store,
    value.policy,
    work,
    Date.now,
    {
      capture: async () => capture.captured,
    },
    undefined,
    new PortalCoreLifecycle(new CorePreparations(value)),
  );
  let operation = 0;
  const invoke = async (name: PortalToolName, input: unknown) => {
    const operationId = `native-test-${++operation}`;
    const authority = await coordinator.prepare(name, input, actor, value.workspaceId, operationId);
    authority.captureSource = capture.grant;
    return coordinator.execute(name, input, {
      actor,
      workspaceId: value.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }) as Promise<Record<string, any>>;
  };
  await writeFile(
    join(value.workspaceRoot, 'design.json'),
    JSON.stringify({
      requestedUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      truncated: false,
      nodes: [{ id: '0:1' }],
    }),
  );
  if (legacy) {
    await mkdir(join(value.workspaceRoot, 'output/src'), { recursive: true });
    await mkdir(join(value.workspaceRoot, 'output/.config'));
    await writeFile(
      join(value.workspaceRoot, 'output/src/app.js'),
      'export const title = "Before";',
    );
    await writeFile(join(value.workspaceRoot, 'output/.config/backend.json'), '{"port":1234}');
    await writeFile(join(value.workspaceRoot, 'output/.gitignore'), '*.graphql\n');
    await writeFile(
      join(value.workspaceRoot, 'output/schema.graphql'),
      'type Query { health: Boolean }',
    );
    await writeFile(join(value.workspaceRoot, 'output/opaque.bin'), Buffer.from([0, 1, 2]));
    await mkdir(join(value.workspaceRoot, 'output/.git'));
    await writeFile(join(value.workspaceRoot, 'output/.env'), 'PASSWORD=excluded');
  }
  if (heavy)
    for (let index = 0; index < 8; index++)
      await writeFile(
        join(value.workspaceRoot, `output/large-${index}.bin`),
        Buffer.alloc(15 * 1024 * 1024),
      );
  let planned = await invoke('portal_plan', {
    case: legacy ? 'legacy' : 'new-blank',
    ...(legacy
      ? {
          requirements: [
            {
              id: 'portal',
              description: 'Show the portal title and preserve configuration',
              layers: ['frontend', 'configuration'],
              required: true,
              workflow: {
                status: 'confirmed',
                roles: ['visitor'],
                states: ['visible'],
                routes: ['/'],
                apiContracts: [],
                dataContracts: [],
                decisions: [
                  {
                    layer: 'frontend',
                    action: 'implement',
                    evidence: 'Update the title through the submitted source file',
                  },
                  {
                    layer: 'configuration',
                    action: 'present',
                    evidence: 'Keep all configuration and opaque source bytes intact',
                  },
                ],
              },
            },
          ],
        }
      : {}),
    targetPath: 'output',
    design: { freshness: requireLive ? 'require-live' : 'allow-pinned' },
  });
  if (legacy) {
    const draft = (await value.store.get('plans', planned.planId, PortalPlanSchema))!;
    const sourceId = planned.selectedClosure.closure[0].sourceId;
    const requirements = draft.request.requirements.map(requirement => ({
      ...requirement,
      workflow: requirement.workflow
        ? {
            ...requirement.workflow,
            decisions: requirement.workflow.decisions.map(decision =>
              decision.action === 'present'
                ? {
                    ...decision,
                    sourceEvidence: [
                      {
                        sourceId,
                        sourceIndex: 0,
                        path: '.config/backend.json',
                        hash: storedChecksum('{"port":1234}'),
                      },
                    ],
                  }
                : decision,
            ),
          }
        : undefined,
    }));
    planned = await invoke('portal_plan', { ...draft.request, requirements });
  }
  await invoke('portal_start', { planId: planned.planId });
  const next = await invoke('portal_next', { runId: planned.planId });
  const files = [
    { path: 'src/app.js', content: 'export const title = "Portal";' },
    {
      path: 'check.mjs',
      content:
        'import {readFileSync} from "node:fs"; import assert from "node:assert/strict"; assert.match(readFileSync("src/app.js", "utf8"), /Portal/); console.log("assertion passed");',
    },
  ];
  await invoke('portal_submit', {
    runId: planned.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: planned.contextHash,
    blueprintHash: planned.blueprintHash,
    files: files.map(file => ({
      ...file,
      action: legacy && file.path === 'src/app.js' ? 'replace' : 'create',
      baseHash:
        legacy && file.path === 'src/app.js'
          ? storedChecksum('export const title = "Before";')
          : null,
      contentHash: storedChecksum(file.content),
    })),
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: files.map(file => ({ path: file.path, hash: storedChecksum(file.content) })),
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const plan = (await value.store.get('plans', planned.planId, PortalPlanSchema))!;
  const run = (await value.store.get('runs', plan.planId, PortalRunSchema))!;
  return { ...value, plan, run, files, work, invoke, capture };
};
const acceptanceFixture = async (
  value: Awaited<ReturnType<typeof fixture>>,
): Promise<PortalAcceptance> => {
  const { plan, run } = value;
  const authority = await authorityFixture(value);
  const grant = await prepareNativeEnvironment(
    {
      ownerId: plan.ownerId,
      planId: plan.planId,
      native: { id: 'publication-fixture', sourceHash: run.candidateHash!, environment: {} },
    },
    value.stateRoot,
  );
  const execution = expandNativeEnvironment(grant, {
    operationId: 'publication-fixture',
    runId: run.runId,
    target: 'candidate',
    profileHash: storedChecksum('fixture'),
    repositoryHash: authority.hash,
    repositoryKey: authority.resource.key,
  });
  await value.work.environments.acquire(execution, grant, new AbortController().signal);
  const receipt = await value.work.environments.finish(execution.attemptId);
  // Synthetic acceptance isolates publication/CAS tests; it is never runtime validation evidence.
  plan.design.complete = true;
  return {
    sourceAuthorityVersion: 2,
    recipeConsumption: {
      recipeAuthorityVersion: 1,
      ownerId: plan.ownerId,
      workspaceId: plan.workspaceId,
      contextHash: plan.coreRecipes!.contextHash!,
      blueprintHash: plan.blueprintHash,
      candidateHash: run.candidateHash!,
      declarationsHash: run.coreDeclarationsHash!,
      target: 'candidate',
      verifierVersion: 'core-consumption-v1',
      resultHashes: plan.coreRecipes!.requiredResults.map(row => row.resultHash),
      findings: [
        {
          kind: 'runtime',
          assertionId: 'publication-fixture',
          observationId: 'fixture',
          rootNodeId: '1:1',
          route: '/',
          stateId: 'source:1:1',
          viewport: { width: 100, height: 100 },
          expectedHash: storedChecksum('controlled publication fixture'),
          actualHash: storedChecksum('controlled publication fixture'),
          evidenceHash: storedChecksum('controlled publication fixture'),
        },
      ],
    },
    observations: {
      version: 1,
      manifestHash: storedChecksum('fixture'),
      interactionContractHash: contentHash('sfp-interaction-contract-v1', plan.interactionContract),
      receiptHash: storedChecksum('fixture'),
      executedObservationIds: ['fixture'],
      executedAssertionIds: plan.interactionContract!.interactions.map(
        interaction => interaction.id,
      ),
      executedWorkflowIds: plan.interactionContract!.workflowIds,
    },
    capture: {
      ...value.capture.receipt,
      freshDesignFingerprint:
        plan.request.design.freshness === 'require-live'
          ? value.capture.receipt.freshDesignFingerprint
          : null,
    },
    analysisHash: contentHash('sfp-portal-analysis-receipt-v1', {
      selection: plan.serviceSelection,
      coverage: plan.workflowCoverage,
    }),
    sourceHash: run.candidateHash!,
    designHash: plan.design.artifactHash,
    environmentId: execution.attemptId,
    nativeEnvironment: {
      version: 1,
      attemptId: execution.attemptId,
      executionHash: execution.hash,
      receiptHash: contentHash('sfp-native-lifecycle-receipt-v1', receipt),
      target: 'candidate',
      disposition: 'retained-artifact',
    },
    nativeArtifactAuthority: {
      version: 1,
      moduleFenceProtocol: 'sfp-native-module-fence-v1',
      moduleEvidenceHash: storedChecksum('fixture'),
      manifestHash: storedChecksum('fixture'),
      outputReceiptHash: storedChecksum('fixture'),
    },
    runtimeVerified: true,
    liveDesignVerified: plan.request.design.freshness === 'require-live',
    evidencePaths: ['unit-test/acceptance.json'],
    checks: (
      [
        'build',
        'typecheck',
        'interaction',
        'accessibility',
        'visual',
        'independence',
        'source-scope',
      ] as const
    ).map(kind => ({
      id: kind,
      kind,
      requirementIds: plan.requirements.map(requirement => requirement.id),
      required: true,
      status: 'passed',
    })),
  };
};

const executionFixture = async (
  value: Awaited<ReturnType<typeof fixture>>,
  work: PortalNativeWork,
  target: 'candidate' | 'applied',
  profileId = 'node-frontend',
) => {
  const authority = await authorityFixture(value);
  const context = await work.prepareValidation(
    value.plan,
    value.run,
    profileId,
    target,
    `validation-${Date.now()}`,
    authority,
  );
  return {
    ...authority,
    nativeEnvironment: context,
    executionAuthorityHash: context.hash as `sha256:${string}`,
    executionResources: context.resources,
  };
};

it('executes an owner-bound native assertion in a separate work copy and keeps incomplete acceptance blocked', async () => {
  const value = await fixture();
  await expect(value.invoke('portal_validate', { runId: value.run.runId })).rejects.toMatchObject({
    code: 'PORTAL_NATIVE_PROFILE_REQUIRED',
  });
  const profile = PortalNativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    ownerId: value.plan.ownerId,
    planId: value.plan.planId,
    contextHash: value.plan.contextHash,
    native: {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'node-frontend',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: value.run.candidateHash,
      closure: value.files.map(file => ({ path: file.path, hash: storedChecksum(file.content) })),
      environment: {},
      commands: [
        {
          id: 'assert-source',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['check.mjs'],
          timeoutMs: 5000,
        },
      ],
    },
    assertions: [
      {
        commandId: 'assert-source',
        check: { id: 'build-fixture', kind: 'build', requirementIds: [], required: true },
      },
    ],
  });
  await seedBlockedExecutionProfile(value, profile);
  const result = await value.invoke('portal_validate', { runId: value.run.runId });
  expect(result.state).toBe('blocked');
  expect(result.validation.checks).toContainEqual(
    expect.objectContaining({ id: 'build-fixture', status: 'passed' }),
  );
  expect(result.issues).toContain('RUNTIME_NOT_VERIFIED');
  await expect(readFile(join(value.workspaceRoot, 'output/src/app.js'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const evidence = JSON.parse(
    await readFile(join(value.stateRoot, result.validation.evidencePaths[0]), 'utf8'),
  );
  expect(evidence.payload.commandEvidence.executionMode).toBe('native-working-copy');
  expect(evidence.payload.commandEvidence.commands[0].output).toContain('assertion passed');
}, 60_000);

it('publishes hash-bound files once and refuses to overwrite a later user edit during reconciliation', async () => {
  const value = await fixture();
  const authority = await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  );
  // This fixture isolates publication/reconciliation. It is not a real visual or runtime acceptance claim.
  value.run.validation = await acceptanceFixture(value);
  const signal = new AbortController().signal;
  expect(await value.work.apply(value.plan, value.run, value.files, authority, signal)).toEqual({
    hash: value.run.candidateHash,
  });
  expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe(
    value.files[0]!.content,
  );
  expect(await value.work.apply(value.plan, value.run, value.files, authority, signal)).toEqual({
    hash: value.run.candidateHash,
  });
  await writeFile(join(value.workspaceRoot, 'output/src/app.js'), 'user edit');
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, signal),
  ).rejects.toMatchObject({ code: 'PORTAL_APPLIED_SOURCE_CHANGED', committed: true });
  expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe('user edit');
}, 60_000);

it('refuses target publication without complete acceptance and preserves an existing output collision', async () => {
  const value = await fixture();
  const authority = await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  );
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_VALIDATION_REQUIRED' });
  value.run.validation = await acceptanceFixture(value);
  await writeFile(join(value.workspaceRoot, 'output'), 'existing user file');
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_INVALID' });
  expect(await readFile(join(value.workspaceRoot, 'output'), 'utf8')).toBe('existing user file');
}, 60_000);
const profileFixture = async (value: Awaited<ReturnType<typeof fixture>>) =>
  PortalNativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    ownerId: value.plan.ownerId,
    planId: value.plan.planId,
    contextHash: value.plan.contextHash,
    native: {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'node-frontend',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: value.run.candidateHash,
      closure: [...portalMaterialFiles(value.plan, value.run)].map(([path, hash]) => ({
        path,
        hash,
      })),
      environment: {},
      commands: [
        {
          id: 'assert-source',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['check.mjs'],
          timeoutMs: 5000,
        },
      ],
    },
    assertions: [
      {
        commandId: 'assert-source',
        check: { id: 'build-fixture', kind: 'build', requirementIds: [], required: true },
      },
    ],
  });
const authorityFixture = async (value: Awaited<ReturnType<typeof fixture>>) => ({
  ...(await resolvePortalAuthority(
    value.policy,
    value.workspaceId,
    value.plan.request,
    value.plan.planId,
    value.plan.implementationScope,
    value.plan,
  )),
  captureSource: value.capture.grant,
});

/** Isolate native staging/report guards below registration; this cannot prove public acceptance. */
const seedBlockedExecutionProfile = async (
  value: Awaited<ReturnType<typeof fixture>>,
  input: Awaited<ReturnType<typeof profileFixture>>,
  work = value.work,
) => {
  const profile = await work.prepareProfile(input);
  expect(profile.recipeUse?.prepared?.status).toBe('blocked');
  await expect(work.registerProfile(profile)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED',
  });
  await value.store.create(
    'profiles',
    contentHash('sfp-portal-profile-key-v1', {
      planId: profile.planId,
      profileId: profile.native.id,
      candidateHash: profile.native.sourceHash,
    }).slice(7),
    profile,
    PortalNativeProfileSchema,
  );
  return profile;
};

/** Mirror the coordinator's signed transition after controlled publication-only acceptance. */
const recordControlledApply = async (value: Awaited<ReturnType<typeof fixture>>) => {
  value.run.appliedHash = value.run.candidateHash;
  value.run.state = 'applied-awaiting-validation';
  await value.store.update('runs', value.run.runId, PortalRunSchema, () => value.run);
};

it('stages all material legacy inputs while omitting excluded metadata and credentials', async () => {
  const value = await fixture(true);
  await seedBlockedExecutionProfile(value, await profileFixture(value));
  const report = await value.work.validate(
    value.plan,
    value.run,
    value.files,
    new AbortController().signal,
    'candidate',
    'node-frontend',
    await executionFixture(value, value.work, 'candidate'),
  );
  expect(report.sourceAuthorityVersion).toBe(2);
  const evidence = JSON.parse(
    await readFile(join(value.stateRoot, report.evidencePaths[0]!), 'utf8'),
  ).payload;
  expect(await readFile(join(evidence.workPath, 'opaque.bin'))).toEqual(Buffer.from([0, 1, 2]));
  expect(await readFile(join(evidence.workPath, 'schema.graphql'), 'utf8')).toContain('health');
  expect(existsSync(join(evidence.workPath, '.env'))).toBe(false);
  expect(existsSync(join(evidence.workPath, '.git'))).toBe(false);
  expect(evidence.commandEvidence.commands[0].status).toBe('passed');
}, 60000);
it.each(['change', 'add', 'remove'] as const)(
  'blocks %s of an original included input after planning',
  async mutation => {
    const value = await fixture(true);
    await seedBlockedExecutionProfile(value, await profileFixture(value));
    if (mutation === 'remove') await unlink(join(value.workspaceRoot, 'output/schema.graphql'));
    else
      await writeFile(
        join(
          value.workspaceRoot,
          mutation === 'add' ? 'output/loader.mts' : 'output/schema.graphql',
        ),
        'changed',
      );
    await expect(
      value.work.validate(
        value.plan,
        value.run,
        value.files,
        new AbortController().signal,
        'candidate',
        'node-frontend',
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_CHANGED' });
  },
  60000,
);
it.each(['change', 'add', 'remove'] as const)(
  'rejects an untouched actual target %s while native validation is paused',
  async mutation => {
    const value = await fixture(true),
      authority = await authorityFixture(value);
    value.run.validation = await acceptanceFixture(value);
    await value.work.apply(
      value.plan,
      value.run,
      value.files,
      authority,
      new AbortController().signal,
    );
    await recordControlledApply(value);
    await seedBlockedExecutionProfile(value, await profileFixture(value));
    let reached!: () => void, release!: () => void;
    const atNative = new Promise<void>(resolve => {
      reached = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    class Runner extends NativePortalRunner {
      override async execute(...args: Parameters<NativePortalRunner['execute']>) {
        reached();
        await gate;
        return super.execute(...args);
      }
    }
    const work = new PortalNativeWork({
      stateRoot: value.stateRoot,
      store: value.store,
      policy: value.policy,
      permissions: value.permissions,
      runner: new Runner(),
    });
    cleanups.unshift(() => work.close());
    const validating = work.validate(
      value.plan,
      value.run,
      value.files,
      new AbortController().signal,
      'applied',
      'node-frontend',
      await executionFixture(value, work, 'applied'),
    );
    const outcome = validating.catch(error => error);
    await atNative;
    const path = join(value.workspaceRoot, 'output/.config/backend.json');
    if (mutation === 'remove') await unlink(path);
    else
      await writeFile(
        mutation === 'add' ? join(value.workspaceRoot, 'output/new.mts') : path,
        'user change',
      );
    release();
    expect(await outcome).toMatchObject({ code: 'PORTAL_APPLIED_SOURCE_CHANGED' });
    expect(existsSync(path)).toBe(mutation !== 'remove');
  },
  60000,
);
it('retains a partial journal and rejects continuation after an untouched baseline change', async () => {
  const value = await fixture(true),
    authority = await authorityFixture(value);
  value.run.validation = await acceptanceFixture(value);
  const original = value.store.update.bind(value.store);
  const spy = vi.spyOn(value.store, 'update').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'apply' && (result as any).files[0].state === 'written')
      throw Object.assign(new Error('interrupted'), { code: 'OPERATION_CANCELLED' });
    return result;
  });
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ committed: true });
  spy.mockRestore();
  const before = await value.store.get('apply', value.run.runId, z.any());
  expect(before.files.map((file: any) => file.state)).toEqual(['written', 'pending']);
  await writeFile(join(value.workspaceRoot, 'output/.config/backend.json'), 'user change');
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_APPLIED_SOURCE_CHANGED', committed: true });
  expect(await value.store.get('apply', value.run.runId, z.any())).toEqual(before);
  expect(
    (await value.work.reconcile(value.plan, value.run, authority, new AbortController().signal))
      .state,
  ).toBe('conflict');
  expect(await readFile(join(value.workspaceRoot, 'output/.config/backend.json'), 'utf8')).toBe(
    'user change',
  );
  expect(existsSync(join(value.workspaceRoot, 'output/check.mjs'))).toBe(false);
}, 60000);
it.each(['preimage', 'postimage'] as const)(
  'reconciles journal intent against an actual %s',
  async image => {
    const value = await fixture(true),
      authority = await authorityFixture(value);
    value.run.validation = await acceptanceFixture(value);
    const original = value.store.update.bind(value.store);
    const spy = vi.spyOn(value.store, 'update').mockImplementation(async (...args) => {
      if (
        image === 'postimage' &&
        args[0] === 'apply' &&
        (await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')) ===
          value.files[0]!.content
      )
        throw Object.assign(new Error('interrupted'), { code: 'OPERATION_CANCELLED' });
      const result = await original(...args);
      if (
        image === 'preimage' &&
        args[0] === 'apply' &&
        (result as any).files[0].state === 'intent'
      )
        throw Object.assign(new Error('interrupted'), { code: 'OPERATION_CANCELLED' });
      return result;
    });
    await expect(
      value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
    ).rejects.toMatchObject({ committed: image === 'postimage' });
    spy.mockRestore();
    expect((await value.store.get('apply', value.run.runId, z.any())).files[0].state).toBe(
      'intent',
    );
    expect(
      (await value.work.reconcile(value.plan, value.run, authority, new AbortController().signal))
        .state,
    ).toBe(image === 'preimage' ? 'not-applied' : 'partial');
    expect(
      await value.work.apply(
        value.plan,
        value.run,
        value.files,
        authority,
        new AbortController().signal,
      ),
    ).toEqual({ hash: value.run.candidateHash });
  },
  60000,
);
it('keeps signed legacy profiles and apply records inspectable without granting current execution', async () => {
  const value = await fixture(),
    authority = await authorityFixture(value);
  const profile = await profileFixture(value);
  delete profile.sourceAuthorityVersion;
  delete profile.native.sourceAuthorityVersion;
  expect(PortalNativeProfileSchema.parse(profile).sourceAuthorityVersion).toBeUndefined();
  await expect(value.work.registerProfile(profile)).rejects.toMatchObject({
    code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED',
  });
  const key = contentHash('sfp-portal-profile-key-v1', {
    planId: value.plan.planId,
    profileId: profile.native.id,
    candidateHash: value.run.candidateHash,
  }).slice(7);
  await value.store.create('profiles', key, profile, PortalNativeProfileSchema);
  await expect(
    value.work.validate(
      value.plan,
      value.run,
      value.files,
      new AbortController().signal,
      'candidate',
      'node-frontend',
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED' });
  value.run.validation = await acceptanceFixture(value);
  await value.work.apply(
    value.plan,
    value.run,
    value.files,
    authority,
    new AbortController().signal,
  );
  await value.store.update('apply', value.run.runId, z.any(), record => {
    delete record.sourceAuthorityVersion;
    return record;
  });
  delete value.plan.sourceAuthorityVersion;
  delete value.run.sourceAuthorityVersion;
  const before = await value.store.get('apply', value.run.runId, z.any());
  expect(
    (await value.work.reconcile(value.plan, value.run, authority, new AbortController().signal))
      .state,
  ).toBe('applied');
  expect(await value.store.get('apply', value.run.runId, z.any())).toEqual(before);
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_SOURCE_AUTHORITY_REPLAN_REQUIRED' });
}, 60000);
it.each(['quarantined', 'published-linked'] as const)(
  'recovers a current signed intent after native CAS is %s',
  async boundary => {
    const value = await fixture(true),
      authority = await authorityFixture(value);
    value.run.validation = await acceptanceFixture(value);
    const original = value.store.update.bind(value.store);
    const spy = vi.spyOn(value.store, 'update').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === 'apply' && (result as any).files[0].state === 'intent')
        throw Object.assign(new Error('interrupted'), { code: 'OPERATION_CANCELLED' });
      return result;
    });
    await expect(
      value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    spy.mockRestore();
    const fail = async () => {
      throw new Error('test interrupted CAS boundary');
    };
    const atomic = new AtomicFileStore({
      maxReplaceBytes: 16_777_216,
      ...(boundary === 'quarantined'
        ? { afterReplaceQuarantineFsync: fail }
        : { afterReplacePublishFsync: fail }),
    });
    await expect(
      atomic.replace(
        join(value.workspaceRoot, 'output/src/app.js'),
        Buffer.from(value.files[0]!.content),
        { destructiveApproved: true, expectedDigest64: value.run.files[0]!.baseHash!.slice(7) },
      ),
    ).rejects.toMatchObject({ committed: true });
    const observed = await value.work.reconcile(
      value.plan,
      value.run,
      authority,
      new AbortController().signal,
    );
    expect(observed.state).toBe('partial');
    expect(observed.files[0]!.state).toBe('recoverable');
    expect(
      await value.work.apply(
        value.plan,
        value.run,
        value.files,
        authority,
        new AbortController().signal,
      ),
    ).toEqual({ hash: value.run.candidateHash });
    expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe(
      value.files[0]!.content,
    );
  },
  60000,
);
it('binds a newly created target identity and rejects a same-byte directory replacement', async () => {
  const value = await fixture(),
    authority = await authorityFixture(value);
  value.run.validation = await acceptanceFixture(value);
  await value.work.apply(
    value.plan,
    value.run,
    value.files,
    authority,
    new AbortController().signal,
  );
  const journal = await value.store.get('apply', value.run.runId, z.any());
  expect(journal.targetIdentity).toMatch(/^\d+:\d+$/u);
  await rename(join(value.workspaceRoot, 'output'), join(value.workspaceRoot, 'previous-output'));
  await mkdir(join(value.workspaceRoot, 'output/src'), { recursive: true });
  for (const file of value.files)
    await writeFile(join(value.workspaceRoot, 'output', file.path), file.content);
  await expect(
    value.work.apply(value.plan, value.run, value.files, authority, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_APPLIED_TARGET_IDENTITY_CHANGED', committed: true });
  expect(await value.store.get('apply', value.run.runId, z.any())).toEqual(journal);
}, 60000);
it('accounts verified recovery backups separately from a material tree near the source byte cap', async () => {
  const value = await fixture(true, true),
    authority = await authorityFixture(value);
  const content = 'x'.repeat(15 * 1024 * 1024),
    contentDigest = storedChecksum(content);
  value.files.push({ path: 'large-0.bin', content });
  value.run.files.push({
    path: 'large-0.bin',
    action: 'replace',
    baseHash: storedChecksum(Buffer.alloc(15 * 1024 * 1024)),
    contentHash: contentDigest,
    encoding: 'utf8',
    artifact: { path: 'contents/large-fixture.json', hash: contentDigest, bytes: content.length },
  });
  value.run.candidateHash = portalCandidateHash(
    value.run.files,
    value.plan,
    value.run.coreDeclarations,
  );
  value.run.validation = await acceptanceFixture(value);
  expect(value.plan.profiles[0]!.graph.sourceInventory!.totalBytes).toBeGreaterThan(
    120 * 1024 * 1024,
  );
  expect(
    await value.work.apply(
      value.plan,
      value.run,
      value.files,
      authority,
      new AbortController().signal,
    ),
  ).toEqual({ hash: value.run.candidateHash });
  // Included source remains about 120 MiB; the retained 15 MiB preimage is separately verified.
  expect(
    await value.work.apply(
      value.plan,
      value.run,
      value.files,
      authority,
      new AbortController().signal,
    ),
  ).toEqual({ hash: value.run.candidateHash });
}, 90000);
it('reports a replacement-row user edit as conflict while preserving its retained backup', async () => {
  const value = await fixture(true),
    authority = await authorityFixture(value);
  value.run.validation = await acceptanceFixture(value);
  await value.work.apply(
    value.plan,
    value.run,
    value.files,
    authority,
    new AbortController().signal,
  );
  await writeFile(join(value.workspaceRoot, 'output/src/app.js'), 'user edit');
  expect(
    await value.work.reconcile(value.plan, value.run, authority, new AbortController().signal),
  ).toMatchObject({
    state: 'conflict',
    files: expect.arrayContaining([{ path: 'src/app.js', state: 'conflict' }]),
  });
  expect(await readFile(join(value.workspaceRoot, 'output/src/app.js'), 'utf8')).toBe('user edit');
}, 60000);

it('prepares owner-scoped artifact authority and rejects stale approval and missing consumption', async () => {
  const value = await fixture();
  const input = await profileFixture(value);
  const { ownerId: _owner, ...raw } = input;
  const prepare = createPortalProfilePreparationEndpoint({ store: value.store, work: value.work });
  await expect(
    prepare({ ...actor, actorId: `actor1_${'b'.repeat(43)}` }, raw, { aborted: false }),
  ).rejects.toMatchObject({ code: 'PORTAL_PLAN_NOT_FOUND' });
  const profile = await prepare(actor, raw, { aborted: false });
  expect(profile.native.artifactAuthority?.version).toBe(1);
  const nonces = createActionNonceStore({ leaderGeneration: 'artifact-test' }),
    register = createPortalProfileEndpoint({ store: value.store, work: value.work, nonces });
  const hash = hashActionRequest('portal.profile.register', {
    planId: profile.planId,
    profileHash: contentHash('sfp-portal-profile-request-v1', profile),
  });
  const nonce = await nonces.issue(actor, 'portal.profile.register', hash);
  const changed = structuredClone(profile);
  changed.native.commands[0]!.timeoutMs++;
  await expect(
    register(actor, { profile: changed, actionNonce: nonce.value }, { aborted: false }),
  ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
  await expect(
    register(actor, { profile, actionNonce: nonce.value }, { aborted: false }),
  ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED' });
  expect(
    await value.store.get(
      'profiles',
      contentHash('sfp-portal-profile-key-v1', {
        planId: profile.planId,
        profileId: profile.native.id,
        candidateHash: profile.native.sourceHash,
      }).slice(7),
      PortalNativeProfileSchema,
    ),
  ).toBeNull();
}, 60000);
it('binds daemon-injected browser and effective configuration before approval', async () => {
  const value = await fixture();
  const browserRoot = join(value.workspaceRoot, 'browser');
  await mkdir(browserRoot);
  const executable = join(browserRoot, 'chrome.exe');
  await writeFile(executable, 'browser-fixture');
  await writeFile(join(browserRoot, 'resources.bin'), 'resources');
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
    chromeExecutable: executable,
  });
  cleanups.push(() => work.close());
  const profile = await work.prepareProfile(await profileFixture(value));
  expect(profile.native.environment.SFP_PORTAL_CHROME_EXECUTABLE).toBe(executable);
  await writeFile(join(browserRoot, 'resources.bin'), 'replacement');
  await expect(work.registerProfile(profile)).rejects.toMatchObject({
    code: 'PORTAL_ARTIFACT_CHANGED',
  });
  const changedServer = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
  });
  cleanups.push(() => changedServer.close());
  const refreshed = await work.prepareProfile(await profileFixture(value));
  await expect(changedServer.registerProfile(refreshed)).rejects.toMatchObject({
    code: 'PORTAL_ENVIRONMENT_GRANT_CHANGED',
  });
}, 60000);
it('prepares the actual installed validator bundle and pnpm-backed transitive packages', async () => {
  const value = await fixture();
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
    validatorModuleUrl: pathToFileURL(resolvePath('packages/mcp/dist/portal-validation.mjs')).href,
  });
  cleanups.push(() => work.close());
  const profile = await work.prepareProfile(await profileFixture(value));
  expect(
    profile.native.artifactAuthority!.artifacts.some(artifact =>
      artifact.declaration.root.includes('playwright-core'),
    ),
  ).toBe(true);
  expect(
    profile.native.artifactAuthority!.artifacts.some(
      artifact => artifact.declaration.kind === 'service-bundle',
    ),
  ).toBe(true);
  await expect(work.registerProfile(profile)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED',
  });
}, 90000);
it('refuses previously source-versioned acceptance without separate artifact authority', async () => {
  const value = await fixture();
  value.run.validation = await acceptanceFixture(value);
  delete value.run.validation.nativeArtifactAuthority;
  await expect(
    value.work.apply(
      value.plan,
      value.run,
      value.files,
      await authorityFixture(value),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_VALIDATION_REQUIRED' });
}, 60000);

it('keeps a failed unasserted native step from authorizing completion', async () => {
  const value = await fixture();
  const profile = await profileFixture(value);
  profile.native.commands.push({
    ...profile.native.commands[0]!,
    id: 'fails-after-assertion',
    args: ['-e', 'process.exit(9)'],
  });
  await seedBlockedExecutionProfile(value, profile);
  const result = await value.invoke('portal_validate', {
    runId: value.run.runId,
    profileId: profile.native.id,
  });
  expect(result.validation.checks).toContainEqual(
    expect.objectContaining({ id: 'native-command-sequence', required: true, status: 'failed' }),
  );
  expect(result.state).toBe('blocked');
}, 60000);

it.each(['source-unavailable', 'command-failed'] as const)(
  'retains failed native feedback: %s',
  async failure => {
    const value = await fixture(false, false, true);
    const capture = vi.fn<() => Promise<never>>(async () => {
      throw Object.assign(new Error('Unavailable'), { code: 'CHROME_CONNECTION_REQUIRED' });
    });
    const work = new PortalNativeWork({
      stateRoot: value.stateRoot,
      store: value.store,
      policy: value.policy,
      permissions: value.permissions,
      designCapture: { capture },
    });
    cleanups.unshift(() => work.close());
    const profile = await profileFixture(value);
    if (failure === 'command-failed')
      profile.native.commands.push({
        ...profile.native.commands[0]!,
        id: 'failed-command',
        args: ['-e', 'process.exit(9)'],
      });
    await seedBlockedExecutionProfile(value, profile, work);
    const report = await work.validate(
      value.plan,
      value.run,
      value.files,
      new AbortController().signal,
      'candidate',
      'node-frontend',
      await executionFixture(value, work, 'candidate'),
    );
    expect(report.liveDesignVerified).toBe(false);
    expect(report.capture?.freshDesignFingerprint).toBeNull();
    const failedCheck =
      failure === 'source-unavailable'
        ? { id: 'native-design-freshness', reason: 'PORTAL_LIVE_DESIGN_REFRESH_FAILED' }
        : { id: 'native-command-sequence' };
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        ...failedCheck,
        status: 'failed',
        required: true,
      }),
    );
    expect(capture).toHaveBeenCalledTimes(failure === 'source-unavailable' ? 1 : 0);
    expect(report.evidencePaths).toHaveLength(1);
    const evidenceId = report.evidencePaths[0]!.split('/').at(-1)!.replace('.json', '');
    const stored = await value.store.get('validation', evidenceId, PortalStoredValidationSchema);
    expect(stored?.commandEvidence).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ commandId: 'assert-source', status: 'passed' }),
      ]),
    });
  },
  60000,
);

it.each(['unchanged', 'changed'] as const)(
  'rechecks an admitted applied target after a suspended freshness capture: %s',
  async state => {
    const value = await fixture(true, false, true),
      authority = await authorityFixture(value);
    value.run.validation = await acceptanceFixture(value);
    await value.work.apply(
      value.plan,
      value.run,
      value.files,
      authority,
      new AbortController().signal,
    );
    const fresh = await currentCaptureFixture(value);
    expect(fresh.descriptor.evidenceHash).not.toBe(value.capture.descriptor.evidenceHash);
    expect(fresh.descriptor.designFingerprint).toBe(value.capture.descriptor.designFingerprint);
    let reached!: () => void, release!: () => void;
    const atCapture = new Promise<void>(done => {
        reached = done;
      }),
      gate = new Promise<void>(done => {
        release = done;
      });
    const work = new PortalNativeWork({
      stateRoot: value.stateRoot,
      store: value.store,
      policy: value.policy,
      permissions: value.permissions,
      designCapture: {
        capture: async () => {
          reached();
          await gate;
          return fresh.captured;
        },
      },
    });
    cleanups.unshift(() => work.close());
    await recordControlledApply(value);
    await seedBlockedExecutionProfile(value, await profileFixture(value), work);
    const outcome = work
      .validate(
        value.plan,
        value.run,
        value.files,
        new AbortController().signal,
        'applied',
        'node-frontend',
        await executionFixture(value, work, 'applied'),
      )
      .catch(error => error);
    await atCapture;
    if (state === 'changed')
      await writeFile(
        join(value.workspaceRoot, 'output/.config/backend.json'),
        'changed while refreshing',
      );
    release();
    expect(await outcome).toMatchObject(
      state === 'changed'
        ? { code: 'PORTAL_APPLIED_SOURCE_CHANGED' }
        : {
            liveDesignVerified: true,
            capture: {
              version: 2,
              originalDescriptorHash: value.capture.receipt.originalDescriptorHash,
              freshDesignFingerprint: fresh.descriptor.designFingerprint,
            },
          },
    );
    const original = await value.store.get(
      'designs',
      value.plan.planId,
      PortalCapturedDesignSchema,
    );
    expect(original?.assetRoot).toBe(value.capture.captured.assetRoot);
    expect(original?.raw).toBe(value.capture.captured.raw);
  },
  60000,
);

it('rejects a validator dependency replacement without changing its entrypoint', async () => {
  const value = await fixture(),
    bundle = join(value.workspaceRoot, 'validator');
  await mkdir(bundle);
  const entry = join(bundle, 'validator.mjs');
  await writeFile(entry, 'export {check} from "./dependency.mjs";');
  await writeFile(join(bundle, 'dependency.mjs'), 'export const check=()=>true;');
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
    validatorModuleUrl: pathToFileURL(entry).href,
  });
  cleanups.unshift(() => work.close());
  const profile = await work.prepareProfile(await profileFixture(value));
  await writeFile(join(bundle, 'dependency.mjs'), 'export const check=()=>false;');
  await expect(work.registerProfile(profile)).rejects.toMatchObject({
    code: 'PORTAL_ARTIFACT_CHANGED',
  });
}, 60000);

it('executes the actual bound validator import through native module evidence', async () => {
  const value = await fixture();
  const work = new PortalNativeWork({
    stateRoot: value.stateRoot,
    store: value.store,
    policy: value.policy,
    permissions: value.permissions,
    validatorModuleUrl: pathToFileURL(resolvePath('packages/mcp/dist/portal-validation.mjs')).href,
  });
  cleanups.unshift(() => work.close());
  const profile = await profileFixture(value);
  profile.native.commands[0]!.args = [
    '-e',
    'import(process.env.SFP_PORTAL_VALIDATOR_URL).then(module=>{if(typeof module.assertNativePortalPreview!=="function")process.exit(1)})',
  ];
  await seedBlockedExecutionProfile(value, profile, work);
  const report = await work.validate(
    value.plan,
    value.run,
    value.files,
    new AbortController().signal,
    'candidate',
    profile.native.id,
    await executionFixture(value, work, 'candidate', profile.native.id),
  );
  expect(report.checks).toContainEqual(
    expect.objectContaining({ id: 'native-command-sequence', status: 'passed' }),
  );
  expect(report.nativeArtifactAuthority?.moduleFenceProtocol).toBe('sfp-native-module-fence-v1');
}, 60000);

it('public portal_cancel settles a native validation still waiting in the executor queue', async () => {
  const value = await fixture();
  await seedBlockedExecutionProfile(value, await profileFixture(value));
  const queue = new FileExecutionQueue(),
    issuer = operationIdIssuerFromKey(Buffer.alloc(32, 47));
  const journal = new OperationJournal({ stateRoot: value.stateRoot, actorId: actor.actorId });
  await journal.recover();
  const coordinator: PortalCoordinator = new PortalCoordinator(
    value.store,
    value.policy,
    value.work,
    Date.now,
    undefined,
    (principal, runId) => executor.cancelPendingPortalRun(principal, runId),
    new PortalCoreLifecycle(new CorePreparations(value)),
  );
  let dispatched = false;
  const executor: OperationExecutor = new OperationExecutor({
    issuer,
    journal,
    queue,
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async () => {
          throw Error('No plugin access');
        },
      },
      {
        execute: async (scope, name, args, signal, _plugin, _reporter, action) => {
          if (name === 'portal_validate') dispatched = true;
          return coordinator.execute(name as PortalToolName, args, {
            actor: scope.actor,
            workspaceId: value.workspaceId,
            operationId: action!.operationId,
            authority: scope.portalAuthority!,
            signal,
          });
        },
      },
    ),
  });
  const operationId = issuer.issue(actor.actorId, Date.now()),
    args = { runId: value.run.runId, profileId: 'node-frontend', target: 'candidate' as const };
  const authority = await coordinator.prepare(
    'portal_validate',
    args,
    actor,
    value.workspaceId,
    operationId,
  );
  const scoped = (
    requestId: `sfp_req1_${string}`,
    portalAuthority: typeof authority,
  ): RuntimeExecutionScope => ({
    requestId,
    leaderGeneration: 'generation-test',
    actor,
    workspace: { workspaceId: value.workspaceId, workspaceRoot: value.workspaceRoot },
    target: {
      sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
      pluginGeneration: 'plugin-g1',
      fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
      fileExecutionKey: 'figma:file-a',
    },
    consent: {
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
    },
    portalAuthority,
  });
  let release!: () => void,
    ownerFinished = false;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const incumbent = queue.runResources(authority.executionResources!, async () => {
    await gate;
    ownerFinished = true;
  });
  const validation = executor.invokeTool(
    scoped('sfp_req1_AAAAAAAAAAAAAAAAAAAAAA', authority),
    'portal_validate',
    args,
    operationId,
    NO_CAPTURE_OPTIONS,
  );
  const rejected = validation.catch(error => error);
  await vi.waitFor(() => expect(journal.get(operationId)?.status).toBe('queued'));
  const cancelId = issuer.issue(actor.actorId, Date.now()),
    cancelArgs = { runId: value.run.runId };
  const cancelAuthority = await coordinator.prepare(
    'portal_cancel',
    cancelArgs,
    actor,
    value.workspaceId,
    cancelId,
  );
  const result = (await executor.invokeTool(
    scoped('sfp_req1_BBBBBBBBBBBBBBBBBBBBBB', cancelAuthority),
    'portal_cancel',
    cancelArgs,
    cancelId,
    NO_CAPTURE_OPTIONS,
  )) as { state: string };
  expect(result.state).toBe('cancelled');
  expect(await rejected).toMatchObject({ code: 'OPERATION_CANCELLED' });
  expect(dispatched).toBe(false);
  expect(ownerFinished).toBe(false);
  expect(journal.get(operationId)?.status).toBe('rejected');
  release();
  await incumbent;
}, 20000);
