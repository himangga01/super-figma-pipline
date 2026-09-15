import type { PortalPlan, PortalRun } from '@sfp/ir';
import {
  assertCurrentPortalSourceAuthority,
  assertCurrentPortalAnalysis,
  PortalSourceInventorySchema,
  type PortalSourceInventory,
} from '@sfp/shared';

import { PortalCaptureDescriptorSchema } from '../../../shared/src/portal-capture-source.js';
import type { NativeProfile } from './native-runner.js';
import { portalError } from './store.js';

export const requirePortalInventory = (
  profile: PortalPlan['profiles'][number],
): PortalSourceInventory => {
  const inventory = profile.graph.sourceInventory;
  if (!inventory) throw portalError('PORTAL_SOURCE_INVENTORY_REQUIRED');
  const parsed = PortalSourceInventorySchema.parse(inventory);
  if (!parsed.complete) throw portalError('PORTAL_SOURCE_INVENTORY_INCOMPLETE');
  if (new Set(parsed.files.map(file => file.path.toLowerCase())).size !== parsed.files.length)
    throw portalError('PORTAL_SOURCE_INVENTORY_ALIAS');
  return parsed;
};
export const portalBaselineFiles = (plan: PortalPlan): Map<string, string> => {
  assertCurrentPortalSourceAuthority(plan);
  const expected = new Map<string, string>();
  if (plan.strategy === 'legacy-portal') {
    const targets = plan.profiles.filter(entry => entry.role === 'target');
    if (targets.length !== 1) throw portalError('PORTAL_SOURCE_INVENTORY_REQUIRED');
    for (const file of requirePortalInventory(targets[0]!).files)
      expected.set(file.path, file.hash);
  }
  return expected;
};
/** Complete material project source; external executables/provisioning are separate authority. */
export const portalMaterialFiles = (plan: PortalPlan, run: PortalRun): Map<string, string> => {
  assertCurrentPortalSourceAuthority(plan, run);
  const expected = portalBaselineFiles(plan);
  for (const file of run.files) {
    if (
      [...expected.keys()].some(
        path => path !== file.path && path.toLowerCase() === file.path.toLowerCase(),
      )
    )
      throw portalError('PORTAL_CANDIDATE_PATH_ALIAS');
    expected.set(file.path, file.contentHash);
  }
  return expected;
};
export const assertPortalMaterialFiles = (
  expected: Map<string, string>,
  actual: Pick<PortalSourceInventory, 'complete' | 'files'>,
  code: string,
): void => {
  if (
    !actual.complete ||
    actual.files.length !== expected.size ||
    actual.files.some(file => expected.get(file.path) !== file.hash)
  )
    throw portalError(code);
};
/** Bind exactly the final baseline plus replacements/creates, including opaque and ignored inputs. */
export const assertPortalProfileClosure = (
  plan: PortalPlan,
  run: PortalRun,
  profile: NativeProfile,
): void => {
  assertCurrentPortalSourceAuthority(plan, run, profile);
  assertCurrentPortalAnalysis(plan);
  if (!PortalCaptureDescriptorSchema.safeParse(plan.design.capture).success)
    throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
  const expected = portalMaterialFiles(plan, run);
  for (const [path, hash] of expected)
    if (!profile.closure.some(file => file.path === path && file.hash === hash))
      throw portalError('PORTAL_PROFILE_CLOSURE_INCOMPLETE');
  if (
    profile.closure.length !== expected.size ||
    profile.closure.some(file => !expected.has(file.path))
  )
    throw portalError('PORTAL_PROFILE_CLOSURE_UNEXPECTED');
};
