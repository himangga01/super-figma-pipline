import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { storedChecksum, type PortalPlan, type PortalRun } from '@sfp/ir';
import { afterEach, expect, it } from 'vitest';

import { RepoReader } from '../../src/fs/repo-walk.js';
import type { NativeProfile } from '../../src/portal/native-runner.js';
import { assertPortalProfileClosure } from '../../src/portal/profile-closure.js';
import { collectPortalSourceInventory } from '../../src/portal/source-inventory.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
// Other admission layers are synthetic here; these tests isolate material byte closure.
const analysis = {
  analysisVersion: 2,
  serviceSelection: { version: 2, complete: true },
  workflowCoverage: { version: 1, complete: true },
};
const graphAnalysis = {
  analysisVersion: 2,
  issuesTruncated: false,
  connections: { issuesTruncated: false },
};
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it.each(['loader.mts', 'schema.graphql', 'asset.bin'])(
  'requires complete byte closure for %s',
  async path => {
    const fixture = await portalFixture();
    cleanups.push(fixture.cleanup);
    await writeFile(join(fixture.workspaceRoot, path), Buffer.from([0, 1, 2]));
    const sourceInventory = await collectPortalSourceInventory(
      new RepoReader({ rootDir: fixture.workspaceRoot }),
    );
    const capture = await currentCaptureFixture(fixture);
    const plan = {
      ...analysis,
      design: { capture: capture.descriptor },
      sourceAuthorityVersion: 2,
      strategy: 'legacy-portal',
      profiles: [{ role: 'target', graph: { ...graphAnalysis, files: [], sourceInventory } }],
    } as unknown as PortalPlan;
    const run = { sourceAuthorityVersion: 2, files: [] } as unknown as PortalRun;
    const profile = { sourceAuthorityVersion: 2, closure: [] } as unknown as NativeProfile;
    expect(() => assertPortalProfileClosure(plan, run, profile)).toThrow(
      'PORTAL_PROFILE_CLOSURE_INCOMPLETE',
    );
    profile.closure = sourceInventory.files;
    expect(() => assertPortalProfileClosure(plan, run, profile)).not.toThrow();
    profile.closure = [{ ...sourceInventory.files[0]!, path: path.toUpperCase() }];
    expect(() => assertPortalProfileClosure(plan, run, profile)).toThrow(
      'PORTAL_PROFILE_CLOSURE_INCOMPLETE',
    );
  },
);
it('fences missing inventory and extra candidate closure entries', async () => {
  const fixture = await portalFixture();
  cleanups.push(fixture.cleanup);
  const capture = await currentCaptureFixture(fixture);
  const plan = {
    ...analysis,
    design: { capture: capture.descriptor },
    sourceAuthorityVersion: 2,
    strategy: 'legacy-portal',
    profiles: [{ role: 'target', graph: { ...graphAnalysis, files: [] } }],
  } as unknown as PortalPlan;
  const run = { sourceAuthorityVersion: 2, files: [] } as unknown as PortalRun;
  const profile = { sourceAuthorityVersion: 2, closure: [] } as unknown as NativeProfile;
  expect(() => assertPortalProfileClosure(plan, run, profile)).toThrow(
    'PORTAL_SOURCE_INVENTORY_REQUIRED',
  );
  plan.strategy = 'blank-frontend';
  profile.closure = [{ path: 'unexpected.txt', hash: storedChecksum('extra') }];
  expect(() => assertPortalProfileClosure(plan, run, profile)).toThrow(
    'PORTAL_PROFILE_CLOSURE_UNEXPECTED',
  );
});
