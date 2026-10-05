import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PortalPlanSchema, PortalRunSchema, contentHash, storedChecksum } from '@sfp/ir';
import {
  PortalAcceptanceSchema,
  hashActionRequest,
  type ActorContext,
  type PortalToolName,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError, type z } from 'zod';

import { runAdminCommand } from '../../../cli/src/admin-commands.js';
import { ControlClient } from '../../../cli/src/control-client.js';
import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import {
  createPortalProfileEndpoint,
  createPortalProfilePreparationEndpoint,
} from '../../src/portal/control.js';
import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { NativePortalRunner, nativeExecutableHash } from '../../src/portal/native-runner.js';
import {
  PortalNativeProfileSchema,
  PortalNativeRegistrationSchema,
  PortalNativeWork,
  type PortalNativeProfile,
} from '../../src/portal/native-work.js';
import { portalMaterialFiles } from '../../src/portal/profile-closure.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { resolveDefaultStateRoot } from '../../src/runtime-paths.js';
import { createStatePermissions } from '../../src/security/state-permissions.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

/*
 * Public profile transport regressions for F01/M05 and retained K1 execution characterization.
 *
 * Harness: the in-process C4 harness of native-work.test.ts (portal_plan, portal_start,
 * portal_next and portal_submit through PortalCoordinator, then native work in a disposable work
 * copy). It uses the real signed PortalStore, the real control endpoints and one real `node`
 * child process started by NativePortalRunner with `windowsHide: true`. Registration tests use
 * hashed preview fixtures without launching Chrome or native commands; K1 executes Node only.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
/** The C4 (new-blank) path of the `fixture` helper in native-work.test.ts. */
const fixture = async () => {
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
    { capture: async () => capture.captured },
    undefined,
    new PortalCoreLifecycle(new CorePreparations(value)),
  );
  let operation = 0;
  const invoke = async (name: PortalToolName, input: unknown) => {
    const operationId = `native-characterization-${++operation}`;
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
  const planned = await invoke('portal_plan', {
    case: 'new-blank',
    targetPath: 'output',
    design: { freshness: 'allow-pinned' },
  });
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
      action: 'create',
      baseHash: null,
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
  return { ...value, plan, run, work, invoke, capture };
};
/**
 * The `profileFixture` of native-work.test.ts, with a 60 s command timeout instead of 5 s: under
 * the module fence the `node` start alone took about 3 s on this machine and once exceeded 5 s.
 */
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
          timeoutMs: 60_000,
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
/** The record id that `registerProfile` uses (native-work.ts:804-808). */
const profileRecordId = (profile: PortalNativeProfile) =>
  contentHash('sfp-portal-profile-key-v1', {
    planId: profile.planId,
    profileId: profile.native.id,
    candidateHash: profile.native.sourceHash,
  }).slice(7);
const registrationNonce = async (
  nonces: ReturnType<typeof createActionNonceStore>,
  profile: z.infer<typeof PortalNativeRegistrationSchema>,
) =>
  (
    await nonces.issue(
      actor,
      'portal.profile.register',
      hashActionRequest('portal.profile.register', {
        planId: profile.planId,
        profileHash: contentHash('sfp-portal-profile-request-v1', profile),
      }),
    )
  ).value;

describe('Public prepared-profile transport', () => {
  it('round trips a ready observation profile through CLI file review, nonce confirmation and signed registration without executing commands', async () => {
    const value = await fixture();
    const artifacts = join(value.root, 'profile-artifacts');
    await mkdir(artifacts);
    const chromeExecutable = join(artifacts, 'chrome.exe');
    const validator = join(artifacts, 'validator.mjs');
    await writeFile(chromeExecutable, 'Fixture hashed artifact; never executed.');
    await writeFile(validator, 'export const fixture = true;');
    const runner = new NativePortalRunner();
    vi.spyOn(runner, 'execute').mockRejectedValue(Error('Registration executed a native command'));
    const work = new PortalNativeWork({
      ...value,
      runner,
      validatorModuleUrl: pathToFileURL(validator).href,
      chromeExecutable,
    });
    cleanups.push(() => work.close());
    const draft = await profileFixture(value);
    const oracle = value.capture.captured.assets[0]!;
    draft.native.commands[0]!.preview = {
      protocol: 'sfp-owned-preview-v1',
      spec: {
        root: '.',
        baseUrl: 'http://127.0.0.1:3456',
        allowedOrigins: [],
        assets: [],
        screens: [
          {
            id: 'screen',
            rootNodeId: '1:1',
            state: 'source:1:1',
            assertionIds: [],
            workflowAssertions: [],
            path: '/',
            oraclePath: oracle.path!,
            oracleHash: oracle.sha256!,
            viewport: { width: 100, height: 100 },
            fullPage: true,
            maxDifferenceRatio: 0.01,
            beforeActions: [],
            actions: [],
          },
        ],
      },
    };
    draft.assertions[0]!.check.kind = 'visual';
    draft.recipeUse = {
      version: 1,
      targets: [
        {
          nodeId: '1:1',
          rootNodeId: '1:1',
          selector: '[data-sfp-node="1:1"]',
          route: '/',
          state: 'source:1:1',
          phase: 'source',
        },
      ],
      components: [],
      cssVariables: [],
      assets: [],
      catalogs: [],
      reviews: [],
    };
    const blocked = await work.prepareProfile(draft);
    expect(
      blocked.recipeUse!.prepared!.requirements.every(
        row => row.code === 'PORTAL_CONSUMPTION_REVIEW_REQUIRED',
      ),
    ).toBe(true);
    draft.recipeUse.reviews = blocked.recipeUse!.prepared!.requirements.map(row => ({
      resultId: row.resultId,
      rowIds: [row.rowId],
      kind: 'strategy',
      rationale: 'The reviewed fixture implements this retained strategy in its candidate source.',
    }));
    const { ownerId: _owner, ...publicDraft } = draft;
    const nonces = createActionNonceStore({ leaderGeneration: 'public-profile-roundtrip' });
    const prepare = createPortalProfilePreparationEndpoint({ store: value.store, work });
    const register = createPortalProfileEndpoint({ store: value.store, work, nonces });
    vi.stubEnv('LOCALAPPDATA', value.root);
    vi.stubEnv('XDG_STATE_HOME', value.root);
    await createStatePermissions(resolveDefaultStateRoot()).ensureSecure(resolveDefaultStateRoot());
    vi.spyOn(ControlClient.prototype, 'request').mockImplementation(async (path, _method, body) => {
      if (path === '/control/portal/profiles/prepare')
        return prepare(actor, body, { aborted: false });
      if (path === '/control/action-nonces') {
        const request = body as { requestHash: `sha256:${string}` };
        return nonces.issue(actor, 'portal.profile.register', request.requestHash);
      }
      if (path === '/control/portal/profiles') return register(actor, body, { aborted: false });
      throw Error('Unexpected route');
    });
    const inputFile = join(value.root, 'draft-profile.json');
    await writeFile(inputFile, JSON.stringify(publicDraft));
    const review: unknown[] = [];
    await runAdminCommand(['portal', 'profile', '--args-file', inputFile], output =>
      review.push(output),
    );
    const { preparedFile } = review[0] as { preparedFile: string };
    const prepared = JSON.parse(await readFile(preparedFile, 'utf8'));
    expect(prepared.preparedContractVersion).toBe(2);
    expect(prepared.observationManifest.screens[0].rootNodeId).toBe('1:1');
    expect(prepared.recipeUse.prepared.status).toBe('ready');
    await runAdminCommand(['portal', 'profile', '--args-file', preparedFile, '--yes'], output =>
      review.push(output),
    );
    const result = review[1] as { recordId: string };
    const stored = await value.store.get('profiles', result.recordId, PortalNativeProfileSchema);
    expect(stored).toEqual({ ...prepared, ownerId: actor.actorId });
    for (const omitted of [
      'preparedContractVersion',
      'recipeUse',
      'observationManifest',
    ] as const) {
      const incomplete = structuredClone(prepared);
      delete incomplete[omitted];
      await expect(
        register(
          actor,
          { profile: incomplete, actionNonce: await registrationNonce(nonces, prepared) },
          { aborted: false },
        ),
      ).rejects.toThrow(ZodError);
    }
    // Old signed records stay readable, but cannot gain new execution under the prepared contract.
    const legacy = { ...stored!, preparedContractVersion: undefined };
    expect(PortalNativeProfileSchema.parse(legacy).native.id).toBe('node-frontend');
    await expect(work.assertRecipeRegistration(legacy)).rejects.toMatchObject({
      code: 'PORTAL_PROFILE_CONTRACT_STALE',
    });
    for (const [code, edit] of [
      [
        'ACTION_NONCE_INVALID',
        (profile: typeof prepared) => {
          profile.native.commands[0].timeoutMs++;
        },
      ],
      [
        'ACTION_NONCE_INVALID',
        (profile: typeof prepared) => {
          profile.native.environment.REVIEW_CHANGED = 'changed';
        },
      ],
      [
        'PORTAL_PROFILE_CLOSURE_INCOMPLETE',
        (profile: typeof prepared) => {
          profile.native.closure[0].hash = storedChecksum('changed');
        },
      ],
      [
        'ACTION_NONCE_INVALID',
        (profile: typeof prepared) => {
          profile.observationManifest.interactionContractHash = storedChecksum('changed');
        },
      ],
      [
        'ACTION_NONCE_INVALID',
        (profile: typeof prepared) => {
          profile.recipeUse.prepared.materialHash = storedChecksum('changed');
        },
      ],
    ] as const) {
      const changed = structuredClone(prepared);
      edit(changed);
      const nonce = await registrationNonce(nonces, prepared);
      await expect(
        register(actor, { profile: changed, actionNonce: nonce }, { aborted: false }),
      ).rejects.toMatchObject({ code });
    }
    const stale = structuredClone(prepared);
    stale.recipeUse.prepared.blueprintHash = storedChecksum('stale plan');
    await expect(
      register(
        actor,
        { profile: stale, actionNonce: await registrationNonce(nonces, stale) },
        { aborted: false },
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_CHANGED' });
  }, 120000);
  it('preserves compiled recipe use through JSON and reaches its actual consumption gate', async () => {
    // Transport must preserve blocked requirements instead of failing on a different body hash.
    const value = await fixture();
    const input = await profileFixture(value);
    const { ownerId: _ownerId, ...request } = input;
    const prepare = createPortalProfilePreparationEndpoint({
      store: value.store,
      work: value.work,
    });
    const prepared = await prepare(actor, request, { aborted: false });

    const reprepared = await value.work.prepareProfile(input);
    expect(reprepared.recipeUse?.prepared?.version).toBe('core-consumption-v1');
    expect(JSON.parse(JSON.stringify(prepared)).recipeUse).toEqual(reprepared.recipeUse);

    const nonces = createActionNonceStore({ leaderGeneration: 't06a-svc-1' });
    const register = createPortalProfileEndpoint({ store: value.store, work: value.work, nonces });
    await expect(
      register(
        actor,
        { profile: prepared, actionNonce: await registrationNonce(nonces, prepared) },
        { aborted: false },
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED' });

    // This draft has no preview command, so consumption remains honestly blocked after transport.
    expect(reprepared.recipeUse?.prepared).toMatchObject({ status: 'blocked' });
    expect(
      [...new Set(reprepared.recipeUse?.prepared?.requirements.map(row => row.code))].toSorted(),
    ).toEqual([
      'PORTAL_CONSUMPTION_OBSERVATION_REQUIRED',
      'PORTAL_CONSUMPTION_ORACLE_REQUIRED',
      'PORTAL_CONSUMPTION_REVIEW_REQUIRED',
    ]);
    const reattached = PortalNativeRegistrationSchema.parse({
      ...prepared,
      recipeUse: reprepared.recipeUse,
    });
    await expect(
      register(
        actor,
        { profile: reattached, actionNonce: await registrationNonce(nonces, reattached) },
        { aborted: false },
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED' });

    // Neither blocked attempt stored a profile.
    await expect(
      value.store.get('profiles', profileRecordId(reprepared), PortalNativeProfileSchema),
    ).resolves.toBeNull();
  }, 120_000);

  it('carries the observation manifest in the public registration contract', () => {
    expect(Object.keys(PortalNativeProfileSchema.shape)).toContain('observationManifest');
    expect(Object.keys(PortalNativeRegistrationSchema.shape)).toContain('observationManifest');
    const parsed = PortalNativeRegistrationSchema.safeParse({ observationManifest: {} });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).not.toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['observationManifest'] }),
    );
  });
});

describe('native consumption acceptance', () => {
  it('records a required failed consumption check when preparation has no verified proof', async () => {
    // K1, fixed by T14b. Seam: the real portal_validate path through PortalCoordinator into the
    // report builder at native-work.ts:671-752. SVC-1 blocks every registration path, so the
    // test seeds the signed profile record exactly as registerProfile would write it
    // (native-work.ts:804-810): the output of prepareProfile under its registration id.
    const value = await fixture();
    const profile = await value.work.prepareProfile(await profileFixture(value));
    await value.store.create(
      'profiles',
      profileRecordId(profile),
      profile,
      PortalNativeProfileSchema,
    );

    const result = await value.invoke('portal_validate', { runId: value.run.runId });
    const report = PortalAcceptanceSchema.parse(result.validation);
    // The approved native command really executed and passed in the disposable work copy.
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'build-fixture', status: 'passed' }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'native-command-sequence', status: 'passed' }),
    );

    // A successful build alone cannot attest consumption of the admitted design recipes.
    expect(report).not.toHaveProperty('recipeConsumption');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: 'core-consumption',
        required: true,
        status: 'failed',
        reason: 'PORTAL_CONSUMPTION_PREPARATION_REQUIRED',
      }),
    );
    expect(result.state).toBe('blocked');
    expect(result.issues).toContain('PORTAL_RECIPE_CONSUMPTION_REQUIRED');

    // The persisted validation evidence is the same report.
    const evidence = JSON.parse(
      await readFile(join(value.stateRoot, report.evidencePaths[0]!), 'utf8'),
    ) as { payload: { report: Record<string, unknown> } };
    expect(evidence.payload.report).not.toHaveProperty('recipeConsumption');
  }, 120_000);
});
