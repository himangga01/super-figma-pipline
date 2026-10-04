/* eslint-disable no-await-in-loop -- each authenticated artifact is independently bounded and verified */
import { basename, dirname, isAbsolute, join } from 'node:path';

import { canonicalJson, contentHash, storedChecksum } from '@sfp/ir';
import { PortalAcceptanceSchema, PortalPathSchema } from '@sfp/shared';
import { z } from 'zod';

import {
  PortalObservationIdentitySchema,
  PortalPixelComparisonModeSchema,
  type PortalObservationManifest,
} from '../../../shared/src/portal-observations.js';
import { readFileWithinLimit, withRetainedDirectoryChain } from '../fs/atomic-file.js';
import type { NativeRunResult } from './native-runner.js';
import { NativePreviewReceiptSchema } from './preview-channel.js';
import { portalError } from './store.js';

const reportSchema = z.object({
  browser: z.literal('chrome'),
  manifestHash: z.string(),
  screens: z
    .array(
      z.object({
        id: z.string(),
        observation: PortalObservationIdentitySchema,
        passed: z.boolean(),
        failures: z.array(z.string()),
        ratio: z.number(),
        strictRatio: z.number().min(0).max(1).optional(),
        comparisonMode: PortalPixelComparisonModeSchema.optional(),
        oracleHash: z.string(),
        actualHash: z.string(),
        actualPath: z.string(),
        diffPath: z.string().nullable(),
        diffHash: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(16),
});

/** Repair feedback is authenticated worker data; it never supplies a passing acceptance gate. */
export async function nativePreviewFeedback(
  result: NativeRunResult,
  manifest: PortalObservationManifest | undefined,
  workPath: string,
  signal: AbortSignal,
) {
  const reports = [];
  if (!isAbsolute(workPath)) throw portalError('PORTAL_PREVIEW_FEEDBACK_ARTIFACT_BINDING');
  let artifactBytes = 0;
  const artifact = async (path: string, expectedPath: string, expectedHash?: string) => {
    signal.throwIfAborted();
    if (!PortalPathSchema.safeParse(path).success || path !== expectedPath)
      throw portalError('PORTAL_PREVIEW_FEEDBACK_ARTIFACT_BINDING');
    const absolute = join(workPath, ...path.split('/'));
    try {
      const bytes = await withRetainedDirectoryChain(workPath, dirname(absolute), held =>
        readFileWithinLimit(held.child(basename(absolute)), 16_777_216),
      );
      artifactBytes += bytes.length;
      if (artifactBytes > 134_217_728 || (expectedHash && storedChecksum(bytes) !== expectedHash))
        throw portalError('PORTAL_PREVIEW_FEEDBACK_ARTIFACT_CHANGED');
    } catch (error) {
      if (signal.aborted) throw error;
      throw portalError('PORTAL_PREVIEW_FEEDBACK_ARTIFACT_CHANGED');
    }
    return path;
  };
  for (const command of result.commands) {
    if (!command.previewReceipt) continue;
    if (!manifest) throw portalError('PORTAL_PREVIEW_FEEDBACK_BINDING');
    const receipt = NativePreviewReceiptSchema.parse(command.previewReceipt);
    const report = reportSchema.parse(receipt.report);
    const manifestHash = contentHash('sfp-observation-manifest-v1', manifest);
    if (
      receipt.commandHash !== command.commandHash ||
      receipt.manifestHash !== manifestHash ||
      report.manifestHash !== manifestHash
    )
      throw portalError('PORTAL_PREVIEW_FEEDBACK_BINDING');
    const ids = new Set<string>();
    for (const screen of report.screens) {
      const expected = manifest.screens.find(value => value.id === screen.id);
      if (
        !expected ||
        canonicalJson(screen.observation) !== canonicalJson(expected) ||
        ids.has(screen.id) ||
        screen.oracleHash !== expected.oracleHash ||
        (screen.comparisonMode ?? 'rgba-v1') !== (expected.comparisonMode ?? 'rgba-v1') ||
        (expected.comparisonMode === 'pixelmatch-7.2-v1' && screen.strictRatio === undefined)
      )
        throw portalError('PORTAL_PREVIEW_FEEDBACK_BINDING');
      ids.add(screen.id);
    }
    const screens = [];
    for (const screen of report.screens) {
      const prefix = `.sfp-native-preview/${command.commandId}/${screen.id}`;
      const actualPath = await artifact(
        screen.actualPath,
        `${prefix}.actual.png`,
        screen.actualHash,
      );
      if (screen.diffPath !== null && typeof screen.diffHash !== 'string')
        throw portalError('PORTAL_PREVIEW_FEEDBACK_BINDING');
      const diffPath =
        screen.diffPath === null
          ? null
          : await artifact(screen.diffPath, `${prefix}.diff.png`, screen.diffHash!);
      screens.push({
        observationId: screen.id,
        rootNodeId: screen.observation.rootNodeId,
        route: screen.observation.route,
        state: screen.observation.state,
        viewport: screen.observation.viewport,
        passed: screen.passed,
        failures: screen.failures,
        differenceRatio: screen.ratio,
        ...(screen.strictRatio === undefined ? {} : { strictDifferenceRatio: screen.strictRatio }),
        ...(screen.comparisonMode === undefined ? {} : { comparisonMode: screen.comparisonMode }),
        oracleHash: screen.oracleHash,
        actualHash: screen.actualHash,
        diffHash: screen.diffHash ?? null,
        actualPath,
        diffPath,
      });
    }
    reports.push({
      commandId: command.commandId,
      commandStatus: command.status,
      receiptHash: contentHash('sfp-owned-preview-receipt-v1', receipt),
      screens,
    });
  }
  return PortalAcceptanceSchema.shape.previewFeedback.parse({
    version: 1,
    artifactRoot: workPath,
    reports,
  });
}
