/* eslint-disable no-await-in-loop -- distinct source observations are independently verified. */
import { contentHash, storedChecksum } from '@sfp/ir';
import { PortalHashSchema, PortalPathSchema } from '@sfp/shared';
import { z } from 'zod';

import {
  PortalObservationIdentitySchema,
  type PortalObservationManifest,
  type PortalInteractionContract,
} from '../../../shared/src/portal-observations.js';
import { RepoReader } from '../fs/repo-walk.js';
import {
  portalDesignFingerprint,
  requireCurrentPortalCapture,
  type PortalCapturedDesign,
} from './design-capture.js';
import { sameObservationIdentity } from './observation-manifest.js';
import { comparePortalPng } from './preview.js';
const reportSchema = z.object({
  browser: z.literal('firefox'),
  deviceScaleFactor: z.literal(1),
  manifestHash: PortalHashSchema,
  assets: z
    .array(
      z
        .object({
          nodeId: z.string(),
          oracleHash: PortalHashSchema,
          actualHash: PortalHashSchema,
          actualPath: PortalPathSchema,
        })
        .strict(),
    )
    .max(128)
    .default([]),
  screens: z
    .array(
      z.object({
        id: z.string(),
        observation: PortalObservationIdentitySchema,
        passed: z.literal(true),
        failures: z.array(z.string()).length(0),
        oracleHash: PortalHashSchema,
        actualHash: PortalHashSchema,
        actualPath: PortalPathSchema,
        workflowReports: z
          .array(
            z
              .object({
                requirementId: z.string(),
                passed: z.literal(true),
                executedActions: z.number().int().min(2).max(128),
              })
              .strict(),
          )
          .max(128),
        interactionReports: z
          .array(
            z
              .object({
                assertionId: z.string(),
                sourceNodeId: z.string(),
                destinationNodeId: z.string().nullable(),
                passed: z.literal(true),
                temporal: z
                  .object({
                    easing: z.string().nullable(),
                    direction: z.string().nullable(),
                    durationMs: z.number(),
                    observedMs: z.number(),
                    animatedProperties: z.array(z.string()).min(1),
                  })
                  .nullable(),
                reason: z.null(),
              })
              .strict(),
          )
          .max(4096),
      }),
    )
    .min(1)
    .max(16),
});
/**
 * Compare immutable saved pixels and exact obligations. NativeWork supplies authenticated worker
 * reports, never caller stdout.
 */
export async function verifyPortalVisualEvidence(
  captured: PortalCapturedDesign | null,
  output: string,
  workPath: string,
  signal: AbortSignal,
  publishedFiles: ReadonlyMap<string, string> = new Map(),
  manifest?: PortalObservationManifest,
  contract?: PortalInteractionContract,
): Promise<boolean> {
  if (!captured || !manifest || !contract || Buffer.byteLength(output) > 16777216) return false;
  try {
    requireCurrentPortalCapture(captured);
    if (
      manifest.captureFingerprint !== portalDesignFingerprint(captured) ||
      manifest.scopeHash !== contract.scopeHash ||
      contract.captureFingerprint !== manifest.captureFingerprint ||
      manifest.interactionContractHash !== contentHash('sfp-interaction-contract-v1', contract) ||
      !contract.complete
    )
      return false;
    const manifestHash = contentHash('sfp-observation-manifest-v1', manifest);
    const reports = output
      .split(/\r?\n/u)
      .filter(line => line.startsWith('SFP_PREVIEW_REPORT:'))
      .map(line => reportSchema.parse(JSON.parse(line.slice('SFP_PREVIEW_REPORT:'.length))));
    if (
      !reports.length ||
      reports.length > 32 ||
      reports.some(report => report.manifestHash !== manifestHash)
    )
      return false;
    const screens = reports.flatMap(report => report.screens),
      copiedAssets = reports.flatMap(report => report.assets);
    if (
      screens.length !== manifest.screens.length ||
      copiedAssets.length !== manifest.assets.length ||
      new Set(screens.map(screen => screen.id)).size !== screens.length ||
      new Set(screens.map(screen => screen.actualPath)).size !== screens.length ||
      new Set(copiedAssets.map(asset => asset.nodeId)).size !== copiedAssets.length
    )
      return false;
    const workflows = screens.flatMap(screen => screen.workflowReports);
    if (
      workflows.length !== contract.workflowIds.length ||
      new Set(workflows.map(value => value.requirementId)).size !== workflows.length ||
      contract.workflowIds.some(id => !workflows.some(value => value.requirementId === id))
    )
      return false;
    const oracles = captured.assets.filter(asset => asset.query.kind === 'png');
    if (oracles.length !== screens.length + copiedAssets.length) return false;
    const assets = new RepoReader({
      rootDir: captured.assetRoot,
      signal,
      maxFileBytes: 16777216,
      maxTotalBytes: 536870912,
    });
    const actuals = new RepoReader({
      rootDir: workPath,
      signal,
      maxFileBytes: 16777216,
      maxTotalBytes: 536870912,
    });
    for (const expected of manifest.screens) {
      signal.throwIfAborted();
      const screen = screens.find(value => value.id === expected.id),
        oracle = oracles.find(
          asset => asset.query.kind === 'png' && asset.query.nodeId === expected.rootNodeId,
        );
      if (
        !screen ||
        !oracle?.path ||
        oracle.sha256 !== expected.oracleHash ||
        screen.oracleHash !== expected.oracleHash ||
        !sameObservationIdentity(screen.observation, expected) ||
        !screen.actualPath.startsWith('.sfp-native-preview/')
      )
        return false;
      const obligations = contract.interactions.filter(
        value => value.rootNodeId === expected.rootNodeId,
      );
      if (
        screen.interactionReports.length !== obligations.length ||
        new Set(screen.interactionReports.map(value => value.assertionId)).size !==
          obligations.length
      )
        return false;
      for (const required of obligations) {
        const actual = screen.interactionReports.find(value => value.assertionId === required.id);
        if (
          !actual ||
          actual.sourceNodeId !== required.sourceNodeId ||
          actual.destinationNodeId !== required.destinationNodeId ||
          (required.temporal &&
            (!actual.temporal ||
              actual.temporal.durationMs !== required.temporal.durationMs ||
              (required.temporal.easing !== null &&
                actual.temporal.easing !== required.temporal.easing) ||
              (required.temporal.direction !== null &&
                actual.temporal.direction !== required.temporal.direction)))
        )
          return false;
      }
      const [left, right] = await Promise.all([
        assets.readBytes(oracle.path),
        actuals.readBytes(screen.actualPath),
      ]);
      if (storedChecksum(left) !== oracle.sha256 || storedChecksum(right) !== screen.actualHash)
        return false;
      const comparison = comparePortalPng(left, right);
      if (!comparison.sameDimensions || comparison.ratio > 0.03) return false;
    }
    for (const expected of manifest.assets) {
      const asset = copiedAssets.find(value => value.nodeId === expected.rootNodeId),
        oracle = oracles.find(
          value => value.query.kind === 'png' && value.query.nodeId === expected.rootNodeId,
        );
      if (
        !asset ||
        !oracle?.path ||
        asset.oracleHash !== expected.oracleHash ||
        oracle.sha256 !== expected.oracleHash ||
        asset.actualPath !== expected.actualPath ||
        publishedFiles.get(asset.actualPath) !== asset.actualHash ||
        asset.actualHash !== oracle.sha256
      )
        return false;
      const [left, right] = await Promise.all([
        assets.readBytes(oracle.path),
        actuals.readBytes(asset.actualPath),
      ]);
      if (
        storedChecksum(left) !== expected.oracleHash ||
        storedChecksum(right) !== expected.oracleHash
      )
        return false;
    }
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
