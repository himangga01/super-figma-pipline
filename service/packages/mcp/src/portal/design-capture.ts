/* eslint-disable no-await-in-loop -- Each bounded attempt orders reads, exports and signed checkpoints under one coherence observation. */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
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
import { captureBrowserAssets } from '../../../cli/src/capture-assets.js';
import type { FigmaTarget } from '../../../cli/src/figma-url.js';
import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import { waitLogically } from '../../../cli/src/logical-wait.js';
import { readScripterSnapshot } from '../../../cli/src/snapshot-reader.js';
import {
  PortalCaptureDescriptorSchema,
  PortalCaptureGrantSchema,
  type PortalCaptureDescriptor,
  type PortalCaptureGrant,
} from '../../../shared/src/portal-capture-source.js';
import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import { PortalCaptureError } from './capture-failure.js';
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
const provenanceSchema = <
  T extends typeof chromeCollectorProvenance | typeof desktopCollectorProvenance,
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
  assetFingerprint: contentHash(
    'sfp-portal-capture-assets-v2',
    assets.map(asset => ({
      query: asset.query,
      status: asset.status,
      sha256: asset.sha256 ?? null,
      bytes: asset.bytes ?? null,
      exportedFrom: asset.exportedFrom ?? null,
    })),
  ),
});
export interface PortalDesignCapturePort {
  capture(planId: string, url: string, signal: AbortSignal): Promise<PortalCapturedDesign>;
}
export const portalDesignFingerprint = (captured: PortalCapturedDesign): string => {
  if (captured.captureVersion === 2)
    return contentHash('sfp-portal-design-version-v2', {
      content: captured.contentFingerprint,
      contracts: captured.contractFingerprint,
      source: captured.sourceFingerprint,
      assets: captured.assetFingerprint,
    });
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
  }): ReturnType<typeof readScripterSnapshot>;
  assets(
    nodes: Awaited<ReturnType<typeof readScripterSnapshot>>['nodes'],
    folder: string,
    options: Parameters<typeof captureBrowserAssets>[4],
  ): ReturnType<typeof captureBrowserAssets>;
  close(): Promise<void>;
}
export interface PortalCaptureTransport {
  open(url: string, signal: AbortSignal): Promise<PortalCaptureSession>;
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
  ) {}
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
    let stage: PortalCaptureFailure['stage'] = 'connection';
    let startedAt = Date.now();
    const enter = (next: PortalCaptureFailure['stage']) => {
      signal.throwIfAborted();
      stage = next;
      startedAt = Date.now();
    };
    let session: PortalCaptureSession | undefined;
    let primaryFailure = false;
    let captured: PortalCapturedDesign | undefined;
    let cleanupFailure: PortalCaptureError | undefined;
    try {
      session = await this.transport.open(url, signal);
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
      const deadlineAt = Date.now() + 300_000;
      const target = parseFigmaTarget(url);
      if (session.target.nodeId !== target.nodeId || session.target.fileKey !== target.fileKey)
        throw portalError('PORTAL_CHROME_DESIGN_CHANGED');
      const progressId = contentHash('sfp-portal-capture-progress-v1', target.url).slice(7);
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
          const snapshot = await session.read({ signal, deadlineAt });
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
          enter('snapshot');
          const afterSnapshot = await session.read({ signal, deadlineAt });
          const after = normalizeDesignObservation(afterSnapshot);
          const changed =
            before.contentHash !== after.contentHash ||
            snapshot.observation?.contentHash !== afterSnapshot.observation?.contentHash;
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
    return captured!;
  }
}

/** External Playwright/Scripter retains the selected existing Chrome page. */
export class ExistingChromeDesignCapture extends CoherentDesignCapture {
  private readonly chromeConnection: ExistingChromeConnection;
  constructor(stateRoot: string, permissions: BoundStatePermissions, store?: PortalStore) {
    const chrome = new ExistingChromeConnection();
    const ids = new WeakMap<object, string>();
    super(
      stateRoot,
      permissions,
      {
        close: () => chrome.close(),
        open: async (url, signal) => {
          const session = await chrome.open({ url }, signal);
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
              if ((await observeFigmaPage(session.page, session.target)).status !== 'ready')
                throw portalError('PORTAL_CHROME_DESIGN_CHANGED');
            },
            read: options =>
              readScripterSnapshot(
                session.page,
                session.target,
                { nodeId: session.target.nodeId, depth: 40, maxNodes: 2000 },
                options,
              ),
            assets: (nodes, folder, options) =>
              captureBrowserAssets(session.page, session.target, nodes, folder, options),
            close: () => session.close(),
          };
        },
      },
      store,
    );
    this.chromeConnection = chrome;
  }
  connectionState() {
    return this.chromeConnection.state();
  }
}

export function describePortalCapture(
  captured: PortalCapturedDesign,
  source: { kind: 'chrome' | 'desktop'; url: string },
  grant?: PortalCaptureGrant,
): PortalCaptureDescriptor {
  requireCurrentPortalCapture(captured);
  const target = parseFigmaTarget(source.url),
    binding = captured.collectorEvidence!.sourceBinding;
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
