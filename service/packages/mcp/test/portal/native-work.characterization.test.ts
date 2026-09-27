import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PortalPlanSchema, PortalRunSchema, contentHash, storedChecksum } from '@sfp/ir';
import {
  PortalAcceptanceSchema,
  hashActionRequest,
  type ActorContext,
  type PortalToolName,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import {
  createPortalProfileEndpoint,
  createPortalProfilePreparationEndpoint,
} from '../../src/portal/control.js';
import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { nativeExecutableHash } from '../../src/portal/native-runner.js';
import {
  PortalNativeProfileSchema,
  PortalNativeRegistrationSchema,
  PortalNativeWork,
  type PortalNativeProfile,
} from '../../src/portal/native-work.js';
import { portalMaterialFiles } from '../../src/portal/profile-closure.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

/*
 * T06a characterizations of findings K1 and SVC-1 (remediation plan section 3.1).
 * SVC-1 is fixed by task T13; K1 is fixed by task T14b. Each test asserts the current defective
 * outcome and must be flipped by the task named in its title.
 *
 * Harness: the in-process C4 harness of native-work.test.ts (portal_plan, portal_start,
 * portal_next and portal_submit through PortalCoordinator, then native work in a disposable work
 * copy). It uses the real signed PortalStore, the real control endpoints and one real `node`
 * child process started by NativePortalRunner with `windowsHide: true`. It has no live Figma
 * capture, no Firefox preview and no observation manifest.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
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
  return { ...value, plan, run, work, invoke };
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

describe('SVC-1 characterization (flip in T13)', () => {
  it('SVC-1 characterization: registering the profile returned by portal.profile.prepare fails with PORTAL_PROFILE_PREPARATION_CHANGED (flip in T13)', async () => {
    // SVC-1, fixed by T13. Seam: the real prepare and register control endpoints
    // (control.ts:74-98 and 31-72) in front of assertPreparedProfile (native-work.ts:976-985).
    const value = await fixture();
    const input = await profileFixture(value);
    const { ownerId: _ownerId, ...request } = input;
    const prepare = createPortalProfilePreparationEndpoint({
      store: value.store,
      work: value.work,
    });
    const prepared = await prepare(actor, request, { aborted: false });

    // Registration re-runs prepareProfile and compares content hashes. That re-preparation always
    // carries a compiled `recipeUse`; the prepare endpoint's output drops it (control.ts:89-97).
    const reprepared = await value.work.prepareProfile(input);
    expect(reprepared.recipeUse?.prepared?.version).toBe('core-consumption-v1');
    expect(prepared).not.toHaveProperty('recipeUse');

    const nonces = createActionNonceStore({ leaderGeneration: 't06a-svc-1' });
    const register = createPortalProfileEndpoint({ store: value.store, work: value.work, nonces });
    await expect(
      register(
        actor,
        { profile: prepared, actionNonce: await registrationNonce(nonces, prepared) },
        { aborted: false },
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_CHANGED' });

    // `recipeUse` is the only difference. A caller that bypasses the endpoint to re-attach it
    // passes the hash comparison and reaches the consumption gate (native-work.ts:791-795). This
    // C4 profile has no preview command, so its consumption preparation is blocked and the second
    // code of SVC-1 appears. The owner cannot see these requirements, because prepare drops them.
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

    // Neither attempt stored a profile.
    await expect(
      value.store.get('profiles', profileRecordId(reprepared), PortalNativeProfileSchema),
    ).resolves.toBeNull();
  }, 120_000);

  it('SVC-1 characterization: the registration schema cannot carry the observationManifest that preparation adds (flip in T13)', () => {
    // SVC-1, fixed by T13. For preview profiles, prepareProfile derives an observation manifest
    // (native-work.ts:891-901, returned at 974) and the stored profile schema keeps it, but the
    // strict registration schema has no such field (native-work.ts:164-175), so a prepared
    // preview profile can never hash-match on registration.
    expect(Object.keys(PortalNativeProfileSchema.shape)).toContain('observationManifest');
    expect(Object.keys(PortalNativeRegistrationSchema.shape)).not.toContain('observationManifest');
    const parsed = PortalNativeRegistrationSchema.safeParse({ observationManifest: {} });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['observationManifest'] }),
    );
  });
});

describe('K1 characterization (flip in T14b)', () => {
  it('K1 characterization: native validation emits no recipeConsumption receipt and no consumption check, so the run blocks with PORTAL_RECIPE_CONSUMPTION_REQUIRED (flip in T14b)', async () => {
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

    // Current behavior: the report carries no consumption evidence of any kind. T14b must add
    // either a verified `recipeConsumption` receipt or a failed required `core-consumption` check.
    expect(report).not.toHaveProperty('recipeConsumption');
    expect(report.checks.filter(check => /consumption/iu.test(check.id))).toEqual([]);
    expect(result.state).toBe('blocked');
    expect(result.issues).toContain('PORTAL_RECIPE_CONSUMPTION_REQUIRED');

    // The persisted validation evidence is the same report.
    const evidence = JSON.parse(
      await readFile(join(value.stateRoot, report.evidencePaths[0]!), 'utf8'),
    ) as { payload: { report: Record<string, unknown> } };
    expect(evidence.payload.report).not.toHaveProperty('recipeConsumption');
  }, 120_000);

  it('K1 characterization: verifyConsumptionObservations has no production caller (flip in T14b)', async () => {
    // K1, fixed by T14b, which must call it from validation after assertPreparedProfile.
    const sourceRoot = resolve(import.meta.dirname, '../../src');
    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
    const callers: string[] = [];
    for (const entry of entries.filter(value => value.isFile() && value.name.endsWith('.ts'))) {
      const path = join(entry.parentPath, entry.name);
      const source = await readFile(path, 'utf8');
      const calls = source.match(/verifyConsumptionObservations\s*\(/gu) ?? [];
      const definitions = source.match(/function verifyConsumptionObservations\s*\(/gu) ?? [];
      if (calls.length > definitions.length) callers.push(path);
    }
    expect(callers).toEqual([]);
  });
});
