import { join } from 'node:path';

import { canonicalJson, contentHash } from '@sfp/ir';
import { PortalRecipeVerifiedConsumptionSchema } from '@sfp/shared';
import { z } from 'zod';

import { PortalConsumptionReportSchema } from '../../../../shared/src/portal-consumption.js';
import {
  PortalObservationIdentitySchema,
  type PortalObservationManifest,
} from '../../../../shared/src/portal-observations.js';
import type { NativeProfile, NativeRunResult } from '../native-runner.js';
import { NativePreviewReceiptSchema } from '../preview-channel.js';
import { portalError } from '../store.js';
import {
  consumptionBatch,
  consumptionBatchHash,
  verifyConsumptionObservations,
  type CoreConsumptionCompilation,
} from './core-consumption.js';

const reportSchema = z.object({
  browser: z.literal('chrome'),
  deviceScaleFactor: z.literal(1),
  manifestHash: z.string(),
  consumption: PortalConsumptionReportSchema.optional(),
  screens: z
    .array(
      z.object({
        id: z.string(),
        observation: PortalObservationIdentitySchema,
        passed: z.literal(true),
        failures: z.array(z.string()).length(0),
        oracleHash: z.string(),
        actualHash: z.string(),
      }),
    )
    .min(1)
    .max(16),
});

/** Issue acceptance only from independently checked, authenticated native worker observations. */
export function verifyCoreConsumptionExecution(
  compiled: CoreConsumptionCompilation,
  profile: NativeProfile,
  result: NativeRunResult,
  manifest: PortalObservationManifest | undefined,
  target: 'candidate' | 'applied',
  executionHash: string,
  visualVerified: boolean,
) {
  const prepared = compiled.use.prepared;
  if (!prepared || prepared.status !== 'ready' || prepared.compilationHash !== compiled.hash)
    throw portalError('PORTAL_CONSUMPTION_PREPARATION_REQUIRED');
  if (!manifest || !visualVerified) throw portalError('PORTAL_CONSUMPTION_VISUAL_PROOF_REQUIRED');
  if (
    result.profileId !== profile.id ||
    result.profileHash !== contentHash('sfp-native-profile-v1', profile) ||
    result.sourceHash !== compiled.input.run.candidateHash ||
    result.commands.length !== profile.commands.length
  )
    throw portalError('PORTAL_CONSUMPTION_EXECUTION_BINDING');
  const manifestHash = contentHash('sfp-observation-manifest-v1', manifest);
  const observed = new Set<string>();
  const screens = new Map<string, z.infer<typeof reportSchema>['screens'][number]>();
  for (const [index, command] of profile.commands.entries()) {
    const execution = result.commands[index]!;
    const commandHash = contentHash('sfp-native-command-v1', command);
    if (
      execution.commandId !== command.id ||
      execution.commandHash !== commandHash ||
      execution.status !== 'passed' ||
      execution.moduleEvidence?.protocol !== 'sfp-native-module-fence-v1' ||
      execution.launchCommandHash !==
        contentHash('sfp-native-command-v1', {
          ...command,
          args: [
            '--require',
            join(execution.moduleEvidence.directory, 'preload.cjs'),
            ...command.args,
          ],
        })
    )
      throw portalError('PORTAL_CONSUMPTION_COMMAND_BINDING');
    if (!command.preview) {
      if (execution.previewReceipt) throw portalError('PORTAL_CONSUMPTION_UNEXPECTED_RECEIPT');
      continue;
    }
    const receipt = NativePreviewReceiptSchema.parse(execution.previewReceipt);
    if (
      receipt.commandHash !== commandHash ||
      receipt.manifestHash !== manifestHash ||
      receipt.listener.endpoint !== new URL(command.preview.spec.baseUrl).origin
    )
      throw portalError('PORTAL_CONSUMPTION_RECEIPT_BINDING');
    const report = reportSchema.parse(receipt.report);
    if (report.manifestHash !== manifestHash)
      throw portalError('PORTAL_CONSUMPTION_RECEIPT_BINDING');
    const expectedScreens = command.preview.spec.screens.map(screen =>
      manifest.screens.find(value => value.id === screen.id),
    );
    if (
      expectedScreens.some(value => !value) ||
      expectedScreens.length !== report.screens.length ||
      report.screens.some(
        (screen, at) =>
          screen.id !== expectedScreens[at]!.id ||
          canonicalJson(screen.observation) !== canonicalJson(expectedScreens[at]),
      )
    )
      throw portalError('PORTAL_CONSUMPTION_SCREEN_BINDING');
    for (const screen of report.screens) {
      if (screens.has(screen.id)) throw portalError('PORTAL_CONSUMPTION_DUPLICATE_SCREEN');
      screens.set(screen.id, screen);
    }
    const checks = compiled.checks.filter(check =>
      expectedScreens.some(screen => screen!.rootNodeId === check.rootNodeId),
    );
    if (!checks.length) {
      if (command.preview.spec.consumption || report.consumption)
        throw portalError('PORTAL_CONSUMPTION_UNEXPECTED_RECEIPT');
      continue;
    }
    const expected = consumptionBatch(compiled, checks);
    if (
      !command.preview.spec.consumption ||
      canonicalJson(command.preview.spec.consumption) !== canonicalJson(expected) ||
      !report.consumption ||
      report.consumption.batchHash !== consumptionBatchHash(expected)
    )
      throw portalError('PORTAL_CONSUMPTION_BATCH_BINDING');
    const values = verifyConsumptionObservations(expected, report.consumption.observations);
    for (const checkId of values.keys()) {
      if (observed.has(checkId)) throw portalError('PORTAL_CONSUMPTION_DUPLICATE_CHECK');
      observed.add(checkId);
    }
  }
  if (observed.size !== compiled.checks.length || screens.size !== manifest.screens.length)
    throw portalError('PORTAL_CONSUMPTION_CHECK_COVERAGE');
  // One finding per authenticated screen bounds the receipt while retaining every row/check proof.
  const evidenceHash = contentHash('sfp-core-consumption-execution-v1', {
    compilationHash: compiled.hash,
    rows: compiled.pages.map(page => page.rows),
    proofs: compiled.proofs,
    manifestHash,
    target,
    executionHash,
    result,
  });
  return PortalRecipeVerifiedConsumptionSchema.parse({
    recipeAuthorityVersion: 1,
    ownerId: compiled.input.plan.ownerId,
    workspaceId: compiled.input.plan.workspaceId,
    contextHash: prepared.contextHash,
    blueprintHash: prepared.blueprintHash,
    candidateHash: prepared.candidateHash,
    declarationsHash: prepared.declarationsHash,
    target,
    verifierVersion: 'core-consumption-v1',
    resultHashes: compiled.input.plan.coreRecipes!.requiredResults.map(value => value.resultHash),
    findings: manifest.screens.map(identity => {
      const screen = screens.get(identity.id)!;
      return {
        kind: 'runtime',
        assertionId: 'core-consumption',
        observationId: identity.id,
        rootNodeId: identity.rootNodeId,
        route: identity.route,
        stateId: identity.state,
        viewport: identity.viewport,
        expectedHash: screen.oracleHash,
        actualHash: screen.actualHash,
        evidenceHash,
      };
    }),
  });
}
