/* eslint-disable no-await-in-loop -- Each bounded attempt orders reads, exports and signed checkpoints under one coherence observation. */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import {
  contentHash,
  portalCaptureAssetFingerprint,
  portalDesignVersionFingerprint,
  storedChecksum,
} from '@sfp/ir';
import {
  canonicalFileIdentityHash,
  DesignCollectorEvidenceSchema,
  PortalHashSchema,
  PortalPathSchema,
} from '@sfp/shared';
import type { PortalCaptureFailure } from '@sfp/shared';
import { z } from 'zod';

import { AssetQuerySchema } from '../../../cli/src/asset-program.js';
import { ExistingChromeConnection, observeFigmaPage } from '../../../cli/src/browser-session.js';
import { captureBrowserAssets, captureDesignAssets } from '../../../cli/src/capture-assets.js';
import { retainChromeFailure } from '../../../cli/src/chrome-diagnostics.js';
import { readFigmaPageSnapshot, readFigmaPageAsset } from '../../../cli/src/figma-page-reader.js';
import type { FigmaTarget } from '../../../cli/src/figma-url.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { exportFigmaWebDocument } from '../../../cli/src/figma-web-export.js';
import { waitLogically } from '../../../cli/src/logical-wait.js';
import { readScripterSnapshot } from '../../../cli/src/snapshot-reader.js';
import {
  PortalCaptureDescriptorSchema,
  PortalCaptureGrantSchema,
  OfficialFigmaEndpointSchema,
  type PortalCaptureDescriptor,
  type PortalCaptureGrant,
  type PortalChromeCollector,
} from '../../../shared/src/portal-capture-source.js';
import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import { PortalCaptureError } from './capture-failure.js';
import { publishNativeContourSupplement } from './capture-native-supplement.js';
import { normalizeDesignObservation, planDesignImageReferences } from './design-normalization.js';
import { portalError, type PortalStore } from './store.js';

export const PortalCapturedAssetSchema = z
  .object({
    query: AssetQuerySchema,
    status: z.enum(['captured', 'unavailable', 'pending']),
    path: PortalPathSchema.optional(),
    sha256: PortalHashSchema.optional(),
    bytes: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
    exportedFrom: z
      .object({ nodeId: z.string().min(1).max(512), geometryHash: PortalHashSchema })
      .strict()
      .optional(),
  })
  .strict();
export const chromeCollectorProvenance = {
  collector: 'existing-chrome-scripter-v2',
  fileBasis: 'validated-tab-url',
  sessionBasis: 'service-page-object',
  generationBasis: 'collector-attempt',
  documentEpoch: 'unavailable',
  coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
} as const;
export const desktopCollectorProvenance = {
  collector: 'pinned-desktop-plugin-v2',
  fileBasis: 'admitted-file-binding',
  sessionBasis: 'authenticated-plugin-session',
  generationBasis: 'authenticated-plugin-generation',
  documentEpoch: 'unavailable',
  coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
} as const;
export const chromePageApiCollectorProvenance = {
  collector: 'existing-chrome-page-api-v1',
  fileBasis: 'runtime-file-key-and-validated-tab-url',
  sessionBasis: 'service-page-object',
  generationBasis: 'collector-attempt',
  documentEpoch: 'unavailable',
  coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
} as const;
export const officialMcpCollectorProvenance = {
  collector: 'official-mcp-fixed-plugin-read-v1',
  fileBasis: 'runtime-file-key',
  sessionBasis: 'official-mcp-client-session',
  generationBasis: 'collector-attempt',
  documentEpoch: 'unavailable',
  coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
} as const;
const provenanceSchema = <
  T extends
    | typeof chromeCollectorProvenance
    | typeof desktopCollectorProvenance
    | typeof officialMcpCollectorProvenance
    | typeof chromePageApiCollectorProvenance,
>(
  value: T,
) =>
  z
    .object({
      collector: z.literal(value.collector),
      fileBasis: z.literal(value.fileBasis),
      sessionBasis: z.literal(value.sessionBasis),
      generationBasis: z.literal(value.generationBasis),
      documentEpoch: z.literal(value.documentEpoch),
      coherenceLimit: z.literal(value.coherenceLimit),
    })
    .strict();
const CollectorProvenanceSchema = z.union([
  provenanceSchema(chromeCollectorProvenance),
  provenanceSchema(desktopCollectorProvenance),
  provenanceSchema(chromePageApiCollectorProvenance),
  provenanceSchema(officialMcpCollectorProvenance).extend({
    endpoint: OfficialFigmaEndpointSchema,
  }),
]);
export type PortalCollectorProvenance = z.infer<typeof CollectorProvenanceSchema>;
export const PortalCapturedDesignSchema = z
  .object({
    captureVersion: z.literal(2).optional(),
    collectorEvidence: DesignCollectorEvidenceSchema.optional(),
    collectorProvenance: CollectorProvenanceSchema.optional(),
    contentFingerprint: PortalHashSchema.optional(),
    contractFingerprint: PortalHashSchema.optional(),
    sourceFingerprint: PortalHashSchema.optional(),
    assetFingerprint: PortalHashSchema.optional(),
    raw: z.string().max(16_777_216),
    hash: PortalHashSchema,
    assetRoot: z.string().min(1),
    assets: z.array(PortalCapturedAssetSchema).max(100_000),
    capturedAt: z.iso.datetime(),
    complete: z.boolean(),
    liveVerified: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fields = [
      value.collectorEvidence,
      value.collectorProvenance,
      value.contentFingerprint,
      value.contractFingerprint,
      value.sourceFingerprint,
      value.assetFingerprint,
    ];
    if (
      value.captureVersion === 2
        ? fields.some(field => field === undefined)
        : fields.some(field => field !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_CAPTURE_VERSION_EVIDENCE_REQUIRED' });
  });
export const PortalCaptureAttemptSchema = z
  .object({
    attemptVersion: z.literal(1),
    sourceObservation: z
      .object({
        phase: z.literal('selected-source'),
        provenance: CollectorProvenanceSchema,
        sessionId: z.string().min(1).max(1024),
        generation: z.string().min(1).max(1024),
        fileKeyHash: PortalHashSchema,
        requestedNodeId: z.string().max(512).nullable(),
      })
      .strict()
      .optional(),
    planId: z.string().min(1).max(128),
    sourceUrl: z.string().max(2048),
    raw: z.string().max(16_777_216),
    assetRoot: z.string().min(1),
    assets: z.array(PortalCapturedAssetSchema).max(100_000),
    beforeHash: PortalHashSchema,
    afterHash: PortalHashSchema.optional(),
    outcome: z.enum(['started', 'assets-exported', 'changed', 'observed']),
    atomic: z.literal(false),
    limit: z.literal('ordered-read-ABA-and-post-read-changes-unobservable'),
    capturedAt: z.iso.datetime(),
  })
  .strict();
export type PortalCapturedDesign = z.infer<typeof PortalCapturedDesignSchema>;
export const PORTAL_CAPTURE_LIMITS = {
  attempts: 2,
  batches: 512,
  assetBytes: 536_870_912,
  records: 100_000,
} as const;
/** Legacy records are readable but never satisfy current collector proof. */
export function requireCurrentPortalCapture(captured: PortalCapturedDesign): void {
  PortalCapturedDesignSchema.parse(captured);
  if (captured.captureVersion !== 2 || !captured.collectorEvidence || !captured.complete)
    throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
  if (storedChecksum(captured.raw) !== captured.hash)
    throw portalError('PORTAL_CAPTURE_EVIDENCE_CHANGED');
  if (
    captured.assets.length === 0 ||
    captured.assets.some(
      asset => asset.status !== 'captured' || !asset.path || !asset.sha256 || !asset.bytes,
    ) ||
    captured.assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0) >
      PORTAL_CAPTURE_LIMITS.assetBytes ||
    new Set(captured.assets.map(asset => JSON.stringify(asset.query))).size !==
      captured.assets.length
  )
    throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
  const observation = normalizeDesignObservation(
    JSON.parse(captured.raw),
    captured.collectorEvidence,
  );
  const observedSource =
    captured.collectorProvenance!.collector === chromePageApiCollectorProvenance.collector
      ? 'chrome-page-api'
      : captured.collectorProvenance!.collector === chromeCollectorProvenance.collector
        ? 'chrome'
        : captured.collectorProvenance!.collector === desktopCollectorProvenance.collector
          ? 'desktop'
          : 'official-mcp';
  if (observation.source !== observedSource) throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
  if (
    observation.contentHash !== captured.contentFingerprint ||
    observation.coherence.status !== 'observed' ||
    observation.coherence.outcome !== 'matched' ||
    observation.sourceBinding.status !== 'observed' ||
    observation.capabilities.some(capability => !['complete', 'empty'].includes(capability.status))
  )
    throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
  const fingerprints = captureFingerprints(
    observation,
    captured.assets,
    captured.collectorProvenance!,
  );
  if (
    fingerprints.contractFingerprint !== captured.contractFingerprint ||
    fingerprints.sourceFingerprint !== captured.sourceFingerprint ||
    fingerprints.assetFingerprint !== captured.assetFingerprint
  )
    throw portalError('PORTAL_CAPTURE_EVIDENCE_CHANGED');
}
const captureFingerprints = (
  observation: ReturnType<typeof normalizeDesignObservation>,
  assets: PortalCapturedDesign['assets'],
  provenance: PortalCollectorProvenance,
) => ({
  contractFingerprint: contentHash('sfp-portal-capture-contract-v2', {
    collector: provenance,
    observationVersion: observation.observationVersion,
    capabilities: observation.capabilities,
    bindings: observation.bindings,
    interactions: observation.interactions,
    components: observation.nodes.map(node => ({
      id: node.id,
      api: node.properties.componentApi ?? null,
      definitions: node.properties.componentPropertyDefinitions ?? null,
    })),
    imageUsages: planDesignImageReferences(observation),
  }),
  sourceFingerprint: contentHash(
    'sfp-portal-capture-source-v2',
    observation.sourceBinding.status === 'observed'
      ? {
          fileIdentityHash: observation.sourceBinding.fileIdentityHash,
          scopeId: observation.sourceBinding.scopeId,
          method: observation.sourceBinding.method,
        }
      : null,
  ),
  assetFingerprint: portalCaptureAssetFingerprint(assets),
});
export interface PortalDesignCapturePort {
  capture(planId: string, url: string, signal: AbortSignal): Promise<PortalCapturedDesign>;
}
type NativeSupplementOptions = {
  nativeContourSupplement?: boolean;
  nativeContourUnavailable?: 'fail' | 'retain-primary';
};
export const portalDesignFingerprint = (captured: PortalCapturedDesign): string => {
  if (captured.captureVersion === 2) return portalDesignVersionFingerprint(captured);
  const value = JSON.parse(captured.raw) as Record<string, unknown>;
  const { capture: _capture, warnings: _warnings, ...design } = value;
  return contentHash('sfp-portal-design-version-v1', {
    design,
    assets: captured.assets.map(asset => ({
      query: asset.query,
      status: asset.status,
      sha256: asset.sha256 ?? null,
    })),
  });
};

export interface PortalCaptureSession {
  target: Readonly<FigmaTarget>;
  sessionId: string;
  generation: string;
  bindingMethod: 'file-key' | 'owner-confirmed-document';
  provenance: PortalCollectorProvenance;
  ready(): Promise<void>;
  read(options: {
    signal: AbortSignal;
    deadlineAt: number;
    diagnosticsFolder?: string;
  }): ReturnType<typeof readScripterSnapshot>;
  assets(
    nodes: Awaited<ReturnType<typeof readScripterSnapshot>>['nodes'],
    folder: string,
    options: Parameters<typeof captureBrowserAssets>[4],
  ): ReturnType<typeof captureBrowserAssets>;
  nativeExport?(
    folder: string,
    options: { signal: AbortSignal; deadlineAt: number },
  ): ReturnType<typeof exportFigmaWebDocument>;
  close(): Promise<void>;
}
export interface PortalCaptureTransport {
  open(url: string, signal: AbortSignal, deadlineAt?: number): Promise<PortalCaptureSession>;
  close(): Promise<void>;
}
/** Same bounded coherence/asset persistence for admitted Desktop and retained Chrome transports. */
export class CoherentDesignCapture implements PortalDesignCapturePort {
  private readonly lifetime = new AbortController();
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(
    private readonly stateRoot: string,
    private readonly permissions: BoundStatePermissions,
    private readonly transport: PortalCaptureTransport,
    private readonly store?: PortalStore,
    private readonly options: NativeSupplementOptions = {},
  ) {
    if (options.nativeContourSupplement && !store)
      throw portalError('PORTAL_CAPTURE_NATIVE_SUPPLEMENT_STORE_REQUIRED');
  }
  async close(): Promise<void> {
    this.lifetime.abort(portalError('OPERATION_CANCELLED'));
    await this.transport.close();
    await Promise.allSettled(this.tails.values());
  }
  async capture(planId: string, url: string, signal: AbortSignal): Promise<PortalCapturedDesign> {
    const key = new URL(url).pathname.split('/')[2]!;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const logicalSignal = AbortSignal.any([signal, this.lifetime.signal]);
    const task = previous.catch(() => {}).then(() => this.read(planId, url, logicalSignal));
    this.tails.set(key, task);
    const settled = () => {
      if (this.tails.get(key) === task) this.tails.delete(key);
    };
    void task.then(settled, settled);
    return waitLogically(task, logicalSignal);
  }
  private async read(
    planId: string,
    url: string,
    signal: AbortSignal,
  ): Promise<PortalCapturedDesign> {
    signal.throwIfAborted();
    const deadlineAt = Date.now() + 300_000;
    const assertActive = () => {
      signal.throwIfAborted();
      if (Date.now() >= deadlineAt) throw portalError('PORTAL_CAPTURE_COHERENCE_BUDGET');
    };
    let stage: PortalCaptureFailure['stage'] = 'connection';
    let startedAt = Date.now();
    const enter = (next: PortalCaptureFailure['stage']) => {
      assertActive();
      stage = next;
      startedAt = Date.now();
    };
    let session: PortalCaptureSession | undefined;
    let primaryFailure = false;
    let captured: PortalCapturedDesign | undefined;
    let nativeSupplement:
      | {
          exported: Awaited<ReturnType<typeof exportFigmaWebDocument>>;
          beforeContentHash: string;
          afterContentHash: string;
        }
      | undefined;
    let cleanupFailure: PortalCaptureError | undefined;
    try {
      session = await this.transport.open(url, signal, deadlineAt);
      enter('readiness');
      await session.ready();
      enter('state-preparation');
      const folderRoot = join(this.stateRoot, 'portal', 'captures');
      await this.permissions.verifySecure(this.stateRoot);
      const newFolder = async () =>
        withRetainedDirectoryChain(
          this.stateRoot,
          folderRoot,
          async () => {
            await this.permissions.ensureSecure(join(this.stateRoot, 'portal'));
            await this.permissions.ensureSecure(folderRoot);
            const created = await mkdtemp(join(folderRoot, `${planId}-`));
            await this.permissions.ensureSecure(created);
            return created;
          },
          { createMissing: true },
        );
      const target = parseFigmaTarget(url);
      if (session.target.nodeId !== target.nodeId || session.target.fileKey !== target.fileKey)
        throw portalError('PORTAL_CHROME_DESIGN_CHANGED');
      const progressId = (
        session.provenance.collector === officialMcpCollectorProvenance.collector
          ? contentHash('sfp-portal-official-mcp-capture-progress-v1', {
              url: target.url,
              provenance: session.provenance,
            })
          : session.provenance.collector === chromePageApiCollectorProvenance.collector
            ? contentHash('sfp-portal-chrome-page-api-capture-progress-v1', target.url)
            : contentHash('sfp-portal-capture-progress-v1', target.url)
      ).slice(7);
      enter('checkpoint-read');
      const old = await this.store?.get('capture-progress', progressId, PortalCapturedDesignSchema);
      // Checkpoints are inspection history. Every attempt exports fresh visual observations.
      let result: PortalCapturedDesign | undefined;
      let retainedAttemptBytes = 0;
      for (let attempt = 0; attempt < PORTAL_CAPTURE_LIMITS.attempts; attempt++) {
        signal.throwIfAborted();
        if (Date.now() >= deadlineAt) throw portalError('PORTAL_CAPTURE_COHERENCE_BUDGET');
        const folder = await newFolder();
        try {
          enter('snapshot');
          const snapshot = await session.read({ signal, deadlineAt, diagnosticsFolder: folder });
          assertActive();
          const raw = JSON.stringify(snapshot);
          const before = normalizeDesignObservation(snapshot);
          const attemptId = randomUUID();
          const attemptRecord = PortalCaptureAttemptSchema.parse({
            attemptVersion: 1,
            sourceObservation: {
              phase: 'selected-source',
              provenance: session.provenance,
              sessionId: session.sessionId,
              generation: session.generation,
              fileKeyHash: canonicalFileIdentityHash({
                kind: 'figma-file-key',
                value: target.fileKey,
              }),
              requestedNodeId: target.nodeId,
            },
            planId,
            sourceUrl: target.url,
            raw,
            assetRoot: folder,
            assets: [],
            beforeHash: before.contentHash,
            outcome: 'started',
            atomic: false,
            limit: 'ordered-read-ABA-and-post-read-changes-unobservable',
            capturedAt: new Date().toISOString(),
          });
          assertActive();
          await this.store?.create(
            'capture-attempts',
            attemptId,
            attemptRecord,
            PortalCaptureAttemptSchema,
          );
          const remainingAssetBytes = PORTAL_CAPTURE_LIMITS.assetBytes - retainedAttemptBytes;
          if (remainingAssetBytes <= 0) throw portalError('PORTAL_CAPTURE_ASSET_LIMIT');
          enter('assets');
          let assets = await session.assets(snapshot.nodes, folder, {
            signal,
            deadlineAt,
            maxAssets: 256,
            maxTotalBytes: remainingAssetBytes,
            renderingComplete: !snapshot.truncated,
          });
          for (
            let batch = 1;
            assets.some(asset => asset.status === 'pending') &&
            batch < PORTAL_CAPTURE_LIMITS.batches &&
            Date.now() < deadlineAt;
            batch++
          ) {
            signal.throwIfAborted();
            const completed = assets.filter(asset => asset.status === 'captured').length;
            assets = await session.assets(snapshot.nodes, folder, {
              signal,
              deadlineAt,
              maxAssets: 256,
              maxTotalBytes: remainingAssetBytes,
              renderingComplete: !snapshot.truncated,
              previous: assets,
              retryUnavailable: false,
            });
            if (assets.filter(asset => asset.status === 'captured').length <= completed) break;
          }
          enter('schema');
          const parsedAttemptAssets = z
            .array(PortalCapturedAssetSchema)
            .max(PORTAL_CAPTURE_LIMITS.records)
            .parse(assets);
          retainedAttemptBytes += parsedAttemptAssets.reduce(
            (sum, asset) => sum + (asset.bytes ?? 0),
            0,
          );
          if (retainedAttemptBytes > PORTAL_CAPTURE_LIMITS.assetBytes)
            throw portalError('PORTAL_CAPTURE_ASSET_LIMIT');
          assertActive();
          await this.store?.update(
            'capture-attempts',
            attemptId,
            PortalCaptureAttemptSchema,
            () => ({
              ...attemptRecord,
              assets: parsedAttemptAssets,
              outcome: 'assets-exported' as const,
            }),
          );
          let nativeExport: Awaited<ReturnType<typeof exportFigmaWebDocument>> | undefined;
          if (this.options.nativeContourSupplement) {
            if (
              !session.nativeExport ||
              (session.provenance.collector !== chromeCollectorProvenance.collector &&
                session.provenance.collector !== chromePageApiCollectorProvenance.collector)
            )
              throw portalError('PORTAL_CAPTURE_NATIVE_SUPPLEMENT_REQUIRED');
            enter('assets');
            let unavailable = false;
            try {
              nativeExport = await session.nativeExport(folder, { signal, deadlineAt });
            } catch (cause) {
              assertActive();
              // Only a confirmed disabled Save action may leave the primary collector usable.
              // Timeouts, wrong targets, cancellation and uncertain cleanup remain failures.
              if (
                this.options.nativeContourUnavailable !== 'retain-primary' ||
                !(cause instanceof Error) ||
                cause.message !== 'FIGMA_WEB_EXPORT_UNAVAILABLE'
              )
                throw cause;
              unavailable = true;
            }
            assertActive();
            if (!unavailable && !nativeExport)
              throw portalError('PORTAL_CAPTURE_NATIVE_SUPPLEMENT_REQUIRED');
            if (nativeExport) {
              if (
                !Number.isSafeInteger(nativeExport.bytes) ||
                nativeExport.bytes < 12 ||
                nativeExport.bytes > 134_217_728
              )
                throw portalError('PORTAL_CAPTURE_NATIVE_SUPPLEMENT_REQUIRED');
              retainedAttemptBytes += nativeExport.bytes;
              if (retainedAttemptBytes > PORTAL_CAPTURE_LIMITS.assetBytes)
                throw portalError('PORTAL_CAPTURE_ASSET_LIMIT');
              await this.permissions.ensureSecure(join(folder, 'document.fig'));
              await this.permissions.verifySecure(join(folder, 'document.fig'));
            }
            assertActive();
          }
          enter('snapshot');
          const afterSnapshot = await session.read({
            signal,
            deadlineAt,
            diagnosticsFolder: folder,
          });
          assertActive();
          const after = normalizeDesignObservation(afterSnapshot);
          const changed =
            before.contentHash !== after.contentHash ||
            snapshot.observation?.contentHash !== afterSnapshot.observation?.contentHash;
          assertActive();
          await this.store?.update(
            'capture-attempts',
            attemptId,
            PortalCaptureAttemptSchema,
            () => ({
              ...attemptRecord,
              assets: parsedAttemptAssets,
              afterHash: after.contentHash,
              outcome: changed ? ('changed' as const) : ('observed' as const),
            }),
          );
          if (changed) {
            if (attempt + 1 === PORTAL_CAPTURE_LIMITS.attempts)
              throw portalError('PORTAL_CAPTURE_CONTENT_CHANGED');
            continue;
          }
          enter('final-readiness');
          await session.ready();
          enter('schema');
          const parsedAssets = z
            .array(PortalCapturedAssetSchema)
            .max(PORTAL_CAPTURE_LIMITS.records)
            .parse(assets);
          if (
            parsedAssets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0) >
            PORTAL_CAPTURE_LIMITS.assetBytes
          )
            throw portalError('PORTAL_CAPTURE_ASSET_LIMIT');
          const readComplete =
            snapshot.observation?.readComplete === true &&
            afterSnapshot.observation?.readComplete === true;
          const capabilities = before.capabilities.map(capability => {
            const catalog = snapshot.observation?.capabilities.find(
              item => item.name === capability.name,
            );
            const nodeSurface = ['bindings', 'componentApis', 'interactions'].includes(
              capability.name,
            );
            const observedNodes =
              nodeSurface &&
              before.nodes.every(node => {
                const observed = node.properties.collectorCapabilities;
                return (
                  observed &&
                  typeof observed === 'object' &&
                  !Array.isArray(observed) &&
                  ['observed', 'not-applicable'].includes(String(observed[capability.name]))
                );
              });
            const supported =
              readComplete &&
              (capability.name === 'tree' ||
                (!!catalog && ['complete', 'empty'].includes(catalog.status)) ||
                observedNodes);
            // The normalizer already marks malformed/unsupported per-property semantics partial.
            const hasIssue = before.issues.length > 0;
            return {
              name: capability.name,
              status:
                supported && !hasIssue
                  ? capability.retainedCount
                    ? ('complete' as const)
                    : ('empty' as const)
                  : catalog?.status === 'unsupported' || (nodeSurface && !observedNodes)
                    ? ('unsupported' as const)
                    : catalog?.status === 'failed'
                      ? ('failed' as const)
                      : ('partial' as const),
              count: supported && !hasIssue ? capability.retainedCount : null,
            };
          });
          const collectorEvidence = DesignCollectorEvidenceSchema.parse({
            evidenceVersion: 1,
            contentHash: before.contentHash,
            capabilities,
            coherence: {
              status: 'observed',
              atomic: false,
              method: 'content-reobservation',
              before: before.contentHash,
              after: after.contentHash,
              contentHash: before.contentHash,
              outcome: 'matched',
            },
            sourceBinding: {
              status: 'observed',
              fileIdentityHash: contentHash('sfp-figma-file-v1', target.fileKey),
              scopeId: JSON.stringify({
                requestedNodeId: target.nodeId,
                pageId: snapshot.pageId,
                scopeNodeId: snapshot.scopeNodeId,
              }),
              sessionId: session.sessionId,
              generation: session.generation,
              method: session.bindingMethod,
            },
          });
          const normalized = normalizeDesignObservation(snapshot, collectorEvidence);
          result = PortalCapturedDesignSchema.parse({
            captureVersion: 2,
            collectorProvenance: session.provenance,
            collectorEvidence,
            contentFingerprint: before.contentHash,
            ...captureFingerprints(normalized, parsedAssets, session.provenance),
            raw,
            hash: storedChecksum(raw),
            assetRoot: folder,
            assets: parsedAssets,
            capturedAt: new Date().toISOString(),
            complete:
              readComplete &&
              normalized.nodes.length > 0 &&
              normalized.capabilities.every(item => ['complete', 'empty'].includes(item.status)) &&
              assets.length > 0 &&
              assets.every(asset => asset.status === 'captured'),
            liveVerified: true,
          });
          if (nativeExport)
            nativeSupplement = {
              exported: nativeExport,
              beforeContentHash: before.contentHash,
              afterContentHash: after.contentHash,
            };
          break;
        } catch (error) {
          signal.throwIfAborted();
          if (
            attempt + 1 < PORTAL_CAPTURE_LIMITS.attempts &&
            error instanceof Error &&
            error.message === 'BROWSER_CONTENT_CHANGED'
          )
            continue;
          throw error;
        }
      }
      if (!result) throw portalError('PORTAL_CAPTURE_COHERENCE_BUDGET');
      assertActive();
      if (this.store) {
        enter('checkpoint-publication');
        if (old)
          await this.store.update(
            'capture-progress',
            progressId,
            PortalCapturedDesignSchema,
            () => result,
          );
        else
          await this.store.create(
            'capture-progress',
            progressId,
            result,
            PortalCapturedDesignSchema,
          );
      }
      assertActive();
      captured = result;
    } catch (cause) {
      primaryFailure = true;
      if (signal.aborted) throw signal.reason;
      throw new PortalCaptureError(stage, cause, startedAt);
    } finally {
      const cleanupStartedAt = Date.now();
      try {
        await session?.close();
      } catch (cause) {
        if (!primaryFailure && !signal.aborted)
          cleanupFailure = new PortalCaptureError('cleanup', cause, cleanupStartedAt);
      }
    }
    if (cleanupFailure) throw cleanupFailure;
    assertActive();
    if (nativeSupplement && captured!.complete) {
      const publicationStartedAt = Date.now();
      try {
        await publishNativeContourSupplement({
          stateRoot: this.stateRoot,
          permissions: this.permissions,
          store: this.store!,
          planId,
          url,
          captured: captured!,
          ...nativeSupplement,
          signal,
          deadlineAt,
        });
        assertActive();
      } catch (cause) {
        signal.throwIfAborted();
        throw new PortalCaptureError('checkpoint-publication', cause, publicationStartedAt);
      }
    }
    return captured!;
  }
}

/** External Playwright/Scripter retains the selected existing Chrome page. */
export class ExistingChromeDesignCapture extends CoherentDesignCapture {
  private readonly chromeConnection: ExistingChromeConnection;
  readonly pageApiCapture: CoherentDesignCapture;
  constructor(
    stateRoot: string,
    permissions: BoundStatePermissions,
    store?: PortalStore,
    configuration: NativeSupplementOptions = {},
  ) {
    const chrome = new ExistingChromeConnection();
    const unsettledClosures = new Set<Promise<void>>();
    const nativeWork = new Set<Promise<unknown>>();
    let nativeCleanupFailure = false;
    const assertReleased = () => {
      if (unsettledClosures.size || nativeWork.size || nativeCleanupFailure)
        throw portalError('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
    };
    const closeSession = async (session: { close(): Promise<void> }, deadlineAt: number) => {
      const pending = Promise.resolve().then(() => session.close());
      unsettledClosures.add(pending);
      // Only confirmed success clears the fence. A rejected detach remains unconfirmed.
      void pending.then(
        () => unsettledClosures.delete(pending),
        () => {},
      );
      const remaining = Math.min(5_000, deadlineAt - Date.now());
      if (remaining <= 0) throw portalError('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
      try {
        await waitLogically(pending, AbortSignal.timeout(remaining));
      } catch {
        throw portalError('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
      }
    };
    const ids = new WeakMap<object, string>();
    const trackNative = <T>(pending: Promise<T>, cleanup = false): Promise<T> => {
      nativeWork.add(pending);
      void pending.then(
        () => nativeWork.delete(pending),
        () => {
          nativeWork.delete(pending);
          if (cleanup) nativeCleanupFailure = true;
        },
      );
      return pending;
    };
    const nativeExportFor =
      (session: {
        page: Parameters<typeof exportFigmaWebDocument>[0];
        target: Readonly<FigmaTarget>;
      }) =>
      (folder: string, captureOptions: { signal: AbortSignal; deadlineAt: number }) =>
        trackNative(
          exportFigmaWebDocument(session.page, session.target, folder, {
            ...captureOptions,
            sourceWork: trackNative,
          }),
        );
    const closeAfterNative = async (session: { close(): Promise<void> }, deadlineAt: number) => {
      const unconfirmed = nativeWork.size > 0 || nativeCleanupFailure;
      await closeSession(session, deadlineAt);
      if (unconfirmed || nativeWork.size || nativeCleanupFailure)
        throw portalError('PORTAL_CAPTURE_CLEANUP_UNCONFIRMED');
    };
    super(
      stateRoot,
      permissions,
      {
        close: () => chrome.close(),
        open: async (url, signal, deadlineAt = Date.now() + 300_000) => {
          assertReleased();
          const remaining = deadlineAt - Date.now();
          if (remaining <= 0) throw portalError('PORTAL_CAPTURE_COHERENCE_BUDGET');
          const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
          const session = await chrome.open({ url }, boundedSignal);
          let id = ids.get(session.page);
          if (!id) {
            id = 'collector-page:' + randomUUID();
            ids.set(session.page, id);
          }
          return {
            target: session.target,
            sessionId: id,
            generation: 'collector-attempt:' + randomUUID(),
            bindingMethod: 'file-key',
            provenance: chromeCollectorProvenance,
            ready: async () => {
              boundedSignal.throwIfAborted();
              if (
                (
                  await waitLogically(
                    observeFigmaPage(session.page, session.target, {
                      signal: boundedSignal,
                      deadlineAt,
                    }),
                    boundedSignal,
                  )
                ).status !== 'ready'
              )
                throw portalError('PORTAL_CHROME_DESIGN_CHANGED');
              boundedSignal.throwIfAborted();
            },
            read: async options => {
              try {
                return await readScripterSnapshot(
                  session.page,
                  session.target,
                  { nodeId: session.target.nodeId, depth: 40, maxNodes: 2000 },
                  options,
                );
              } catch (error) {
                if (options.diagnosticsFolder)
                  await retainChromeFailure(session.page, options.diagnosticsFolder, error);
                throw error;
              }
            },
            assets: (nodes, folder, options) =>
              captureBrowserAssets(session.page, session.target, nodes, folder, options),
            ...(configuration.nativeContourSupplement
              ? { nativeExport: nativeExportFor(session) }
              : {}),
            close: () => closeAfterNative(session, deadlineAt),
          };
        },
      },
      store,
      configuration,
    );
    this.chromeConnection = chrome;
    const pageApiIds = new WeakMap<object, string>();
    this.pageApiCapture = new CoherentDesignCapture(
      stateRoot,
      permissions,
      {
        // The existing Chrome owner closes this shared connection once after both ports abort.
        close: async () => {},
        open: async (url, signal, deadlineAt = Date.now() + 300_000) => {
          assertReleased();
          const remaining = deadlineAt - Date.now();
          if (remaining <= 0) throw portalError('PORTAL_CAPTURE_COHERENCE_BUDGET');
          const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
          const session = await chrome.open({ url }, boundedSignal);
          let id = pageApiIds.get(session.page);
          if (!id) {
            id = 'collector-page-api:' + randomUUID();
            pageApiIds.set(session.page, id);
          }
          return {
            target: session.target,
            sessionId: id,
            generation: 'collector-attempt:' + randomUUID(),
            bindingMethod: 'file-key',
            provenance: chromePageApiCollectorProvenance,
            ready: async () => {
              boundedSignal.throwIfAborted();
              if (
                (
                  await waitLogically(
                    observeFigmaPage(session.page, session.target, {
                      signal: boundedSignal,
                      deadlineAt,
                    }),
                    boundedSignal,
                  )
                ).status !== 'ready'
              )
                throw portalError('PORTAL_CHROME_DESIGN_CHANGED');
              boundedSignal.throwIfAborted();
            },
            read: options =>
              readFigmaPageSnapshot(
                session.page,
                session.target,
                {
                  nodeId: session.target.nodeId,
                  depth: 40,
                  maxNodes: 2000,
                },
                options,
              ),
            assets: (nodes, folder, options) =>
              captureDesignAssets(
                nodes,
                folder,
                query => readFigmaPageAsset(session.page, session.target, query, options),
                options,
              ),
            ...(configuration.nativeContourSupplement
              ? { nativeExport: nativeExportFor(session) }
              : {}),
            close: () => closeAfterNative(session, deadlineAt),
          };
        },
      },
      store,
      configuration,
    );
  }
  override async close(): Promise<void> {
    const results = await Promise.allSettled([this.pageApiCapture.close(), super.close()]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  connectionState() {
    return this.chromeConnection.state();
  }
}

export function describePortalCapture(
  captured: PortalCapturedDesign,
  source: {
    kind: PortalCaptureGrant['kind'];
    url: string;
    collector?: PortalChromeCollector | undefined;
  },
  grant?: PortalCaptureGrant,
): PortalCaptureDescriptor {
  requireCurrentPortalCapture(captured);
  const target = parseFigmaTarget(source.url),
    binding = captured.collectorEvidence!.sourceBinding;
  const collector = source.collector ?? (grant?.kind === 'chrome' ? grant.collector : undefined);
  if (source.kind !== 'chrome' && collector !== undefined)
    throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
  if (
    binding.status !== 'observed' ||
    binding.fileIdentityHash !== contentHash('sfp-figma-file-v1', target.fileKey)
  )
    throw portalError('PORTAL_CAPTURE_SOURCE_MISMATCH');
  const scope = JSON.parse(binding.scopeId) as Record<string, unknown>;
  if (
    scope.requestedNodeId !== target.nodeId ||
    (target.nodeId !== null && scope.scopeNodeId !== target.nodeId)
  )
    throw portalError('PORTAL_CAPTURE_SCOPE_MISMATCH');
  if (
    captured.collectorProvenance!.collector !==
    (source.kind === 'desktop'
      ? desktopCollectorProvenance.collector
      : source.kind === 'official-mcp'
        ? officialMcpCollectorProvenance.collector
        : collector === 'page-api'
          ? chromePageApiCollectorProvenance.collector
          : chromeCollectorProvenance.collector)
  )
    throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
  const admission =
    grant ??
    (source.kind === 'chrome'
      ? PortalCaptureGrantSchema.parse({
          version: 1,
          kind: 'chrome',
          phase: 'requested-source',
          binding: 'selected-page-after-approved-connection',
          url: target.url,
          fileKeyHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }),
          requestedNodeId: target.nodeId,
          ...(collector ? { collector } : {}),
        })
      : undefined);
  if (
    !admission ||
    admission.kind !== source.kind ||
    admission.url !== target.url ||
    admission.requestedNodeId !== target.nodeId ||
    admission.fileKeyHash !==
      canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey })
  )
    throw portalError('PORTAL_CAPTURE_ADMISSION_REQUIRED');
  if (
    admission.kind === 'chrome' &&
    (admission.collector ?? 'scripter') !== (collector ?? 'scripter')
  )
    throw portalError('PORTAL_CAPTURE_COLLECTOR_MISMATCH');
  if (
    admission.kind === 'official-mcp' &&
    (captured.collectorProvenance?.collector !== officialMcpCollectorProvenance.collector ||
      !('endpoint' in captured.collectorProvenance) ||
      captured.collectorProvenance.endpoint !== admission.endpoint)
  )
    throw portalError('PORTAL_CAPTURE_TARGET_CHANGED');
  if (
    admission.kind === 'desktop' &&
    (admission.sessionId !== binding.sessionId ||
      admission.pluginGeneration !== binding.generation ||
      admission.bindingMethod !== binding.method)
  )
    throw portalError('PORTAL_CAPTURE_TARGET_CHANGED');
  return PortalCaptureDescriptorSchema.parse({
    version: 2,
    admission,
    rawHash: captured.hash,
    assetManifestHash: contentHash('sfp-portal-design-assets-v1', captured.assets),
    contentFingerprint: captured.contentFingerprint,
    sourceFingerprint: captured.sourceFingerprint,
    contractFingerprint: captured.contractFingerprint,
    assetFingerprint: captured.assetFingerprint,
    evidenceHash: contentHash('sfp-portal-original-capture-evidence-v1', {
      admission,
      evidence: captured.collectorEvidence,
      provenance: captured.collectorProvenance,
    }),
    designFingerprint: portalDesignFingerprint(captured),
    source: {
      kind: source.kind,
      ...(source.kind === 'chrome' && collector ? { collector } : {}),
      url: target.url,
      fileKeyHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }),
      requestedNodeId: target.nodeId,
      scopeId: binding.scopeId,
      bindingMethod: binding.method,
    },
  });
}
export function assertPortalCaptureDescriptor(
  captured: PortalCapturedDesign,
  descriptor: PortalCaptureDescriptor | undefined,
): void {
  if (!descriptor) throw portalError('PORTAL_CAPTURE_CURRENT_REQUIRED');
  const actual = describePortalCapture(captured, descriptor.source, descriptor.admission);
  if (JSON.stringify(actual) !== JSON.stringify(PortalCaptureDescriptorSchema.parse(descriptor)))
    throw portalError('PORTAL_CAPTURE_EVIDENCE_CHANGED');
}
export function assertPortalCapturedGrant(
  captured: PortalCapturedDesign,
  grant: PortalCaptureGrant,
): void {
  const descriptor = describePortalCapture(captured, { kind: grant.kind, url: grant.url }, grant);
  if (
    descriptor.source.fileKeyHash !== grant.fileKeyHash ||
    descriptor.source.requestedNodeId !== grant.requestedNodeId
  )
    throw portalError('PORTAL_CAPTURE_SOURCE_MISMATCH');
  const binding = captured.collectorEvidence!.sourceBinding;
  if (
    grant.kind === 'desktop' &&
    (binding.status !== 'observed' ||
      binding.sessionId !== grant.sessionId ||
      binding.generation !== grant.pluginGeneration ||
      binding.method !== grant.bindingMethod)
  )
    throw portalError('PORTAL_CAPTURE_TARGET_CHANGED');
}

/** Verify original bytes, not just signed manifest metadata; retained root remains immutable. */
export async function verifyPortalCaptureFiles(
  captured: PortalCapturedDesign,
  signal?: AbortSignal,
): Promise<void> {
  requireCurrentPortalCapture(captured);
  const reader = new RepoReader({
    rootDir: captured.assetRoot,
    maxFileBytes: 16_777_216,
    maxTotalBytes: PORTAL_CAPTURE_LIMITS.assetBytes,
    ...(signal ? { signal } : {}),
  });
  const seen = new Map<string, { hash: string; bytes: number }>();
  for (const asset of captured.assets) {
    signal?.throwIfAborted();
    let observed = seen.get(asset.path!);
    if (!observed) {
      const bytes = await reader.readBytes(asset.path!);
      observed = { hash: storedChecksum(bytes), bytes: bytes.length };
      seen.set(asset.path!, observed);
    }
    if (observed.hash !== asset.sha256 || observed.bytes !== asset.bytes)
      throw portalError('PORTAL_CAPTURE_ASSET_CHANGED');
  }
}
