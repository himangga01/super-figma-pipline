import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { canonicalJson, contentHash, PortalPlanSchema, storedChecksum } from '@sfp/ir';
import {
  canonicalFileIdentityHash,
  PortalHashSchema,
  PortalIdSchema,
  PortalWorkspaceSchema,
} from '@sfp/shared';
import { z } from 'zod';

import { parseFigmaTarget } from '../../../cli/src/figma-url.js';
import type { exportFigmaWebDocument } from '../../../cli/src/figma-web-export.js';
import { waitLogically } from '../../../cli/src/logical-wait.js';
import { PortalCaptureDescriptorSchema } from '../../../shared/src/portal-capture-source.js';
import { withRetainedDirectoryChain } from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import {
  assertPortalCaptureDescriptor,
  PortalCapturedDesignSchema,
  requireCurrentPortalCapture,
  type PortalCapturedDesign,
} from './design-capture.js';
import {
  nativeContourCaptureScope,
  type PortalNativeContourAcquisitionPort,
  type PortalNativeContourCapsule,
  type PortalNativeContourRequest,
} from './native-contours.js';
import { portalError, type PortalStore } from './store.js';

const documentLimit = 134_217_728;
const recordKind = 'native-contour-supplements';
function unproven(): never {
  throw portalError('PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN');
}
const intrinsicHash = (captured: PortalCapturedDesign) =>
  contentHash('sfp-portal-native-supplement-primary-v1', captured);
/** Immutable identity of this exact capture, not a mutable per-plan latest pointer. */
export const nativeContourSupplementId = (planId: string, captured: PortalCapturedDesign) =>
  contentHash('sfp-portal-native-supplement-record-v1', {
    planId,
    intrinsicCaptureHash: intrinsicHash(captured),
  }).slice(7);
export const PortalNativeSupplementSchema = z
  .object({
    version: z.literal(1),
    planId: PortalIdSchema,
    intrinsicCaptureHash: PortalHashSchema,
    captureDirectory: z.string().regex(/^portal\/captures\/[A-Za-z0-9_-]{1,256}$/u),
    sourceUrl: z.string().max(2048),
    fileKeyHash: PortalHashSchema,
    scopeId: z.string().min(1).max(1024),
    pageId: z.string().regex(/^\d+:\d+$/u),
    beforeContentHash: PortalHashSchema,
    afterContentHash: PortalHashSchema,
    documentHash: PortalHashSchema,
    documentBytes: z.number().int().min(12).max(documentLimit),
    capturedAt: z.iso.datetime(),
    primaryCapturedAt: z.iso.datetime(),
    captureDeadlineAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    atomic: z.literal(false),
    fullCapture: z.literal(false),
    coherenceLimit: z.literal('ordered-read-ABA-and-post-read-changes-unobservable'),
  })
  .strict();
const RequestSchema = z
  .object({
    ownerId: z.string().min(1).max(1024),
    workspaceId: PortalWorkspaceSchema,
    planId: PortalIdSchema,
    capture: PortalCaptureDescriptorSchema,
    primaryCapturedAt: z.iso.datetime(),
    deadlineAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const assertActive = (signal: AbortSignal, deadlineAt: number, now = Date.now()) => {
  signal.throwIfAborted();
  if (!Number.isFinite(now) || !Number.isSafeInteger(deadlineAt) || now >= deadlineAt) unproven();
};
function captureDirectory(stateRoot: string, folder: string): string {
  const path = relative(resolve(stateRoot), resolve(folder));
  if (isAbsolute(path) || path.startsWith('..')) unproven();
  const portable = path.split(sep).join('/');
  if (!/^portal\/captures\/[A-Za-z0-9_-]{1,256}$/u.test(portable)) unproven();
  return portable;
}
async function readDocument(
  stateRoot: string,
  permissions: BoundStatePermissions,
  directory: string,
  signal: AbortSignal,
  deadlineAt: number,
  now: () => number = Date.now,
): Promise<Uint8Array> {
  const folder = join(stateRoot, ...directory.split('/'));
  await permissions.verifySecure(stateRoot);
  return withRetainedDirectoryChain(stateRoot, folder, async authority => {
    await permissions.verifySecure(join(stateRoot, 'portal'));
    await permissions.verifySecure(join(stateRoot, 'portal', 'captures'));
    await permissions.verifySecure(folder);
    await permissions.verifySecure(authority.child('document.fig'));
    const reader = new RepoReader({
      rootDir: folder,
      maxFileBytes: documentLimit,
      maxTotalBytes: documentLimit,
      signal,
      beforeFileOpen: path => permissions.verifySecure(path),
    });
    const bytes = await reader.readBytes('document.fig');
    await permissions.verifySecure(authority.child('document.fig'));
    await permissions.verifySecure(folder);
    await authority.verify();
    assertActive(signal, deadlineAt, now());
    return bytes;
  });
}

/** Called only after admitted primary observations match and physical session cleanup succeeds. */
export async function publishNativeContourSupplement(input: {
  stateRoot: string;
  permissions: BoundStatePermissions;
  store: PortalStore;
  planId: string;
  url: string;
  captured: PortalCapturedDesign;
  exported: Awaited<ReturnType<typeof exportFigmaWebDocument>>;
  beforeContentHash: string;
  afterContentHash: string;
  signal: AbortSignal;
  deadlineAt: number;
}): Promise<void> {
  const { captured, exported, signal, deadlineAt } = input;
  assertActive(signal, deadlineAt);
  requireCurrentPortalCapture(captured);
  const target = parseFigmaTarget(input.url),
    binding = captured.collectorEvidence!.sourceBinding;
  if (
    binding.status !== 'observed' ||
    !['existing-chrome-scripter-v2', 'existing-chrome-page-api-v1'].includes(
      captured.collectorProvenance!.collector,
    ) ||
    binding.fileIdentityHash !== contentHash('sfp-figma-file-v1', target.fileKey) ||
    exported.source !== 'figma-web-native-export' ||
    exported.fullCapture !== false ||
    exported.requestedUrl !== target.url ||
    exported.fileKey !== target.fileKey ||
    exported.requestedNodeId !== target.nodeId ||
    exported.path !== 'document.fig' ||
    input.beforeContentHash !== captured.contentFingerprint ||
    input.afterContentHash !== input.beforeContentHash
  )
    unproven();
  const scope = nativeContourCaptureScope({
    source: { scopeId: binding.scopeId, requestedNodeId: target.nodeId },
  });
  const nativeAt = Date.parse(exported.capturedAt),
    primaryAt = Date.parse(captured.capturedAt);
  if (
    !Number.isFinite(nativeAt) ||
    !Number.isFinite(primaryAt) ||
    nativeAt > primaryAt ||
    primaryAt > Date.now()
  )
    unproven();
  const directory = captureDirectory(input.stateRoot, captured.assetRoot);
  if (!directory.startsWith(`portal/captures/${input.planId}-`)) unproven();
  const bytes = await readDocument(
    input.stateRoot,
    input.permissions,
    directory,
    signal,
    deadlineAt,
  );
  assertActive(signal, deadlineAt);
  if (bytes.length !== exported.bytes || storedChecksum(bytes) !== exported.sha256) unproven();
  const record = PortalNativeSupplementSchema.parse({
    version: 1,
    planId: input.planId,
    intrinsicCaptureHash: intrinsicHash(captured),
    captureDirectory: directory,
    sourceUrl: target.url,
    fileKeyHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: target.fileKey }),
    scopeId: binding.scopeId,
    pageId: scope.pageId,
    beforeContentHash: input.beforeContentHash,
    afterContentHash: input.afterContentHash,
    documentHash: exported.sha256,
    documentBytes: bytes.length,
    capturedAt: exported.capturedAt,
    primaryCapturedAt: captured.capturedAt,
    captureDeadlineAt: deadlineAt,
    atomic: false,
    fullCapture: false,
    coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
  });
  assertActive(signal, deadlineAt);
  // Every refresh keeps its own immutable evidence. A duplicate exact capture still fails.
  await input.store.create(
    recordKind,
    nativeContourSupplementId(input.planId, captured),
    record,
    PortalNativeSupplementSchema,
  );
  assertActive(signal, deadlineAt);
}

/** Signed-state lookup only. It has no browser, transport, export or source-work capability. */
export class StoredNativeContourAcquisition implements PortalNativeContourAcquisitionPort {
  constructor(
    private readonly stateRoot: string,
    private readonly permissions: BoundStatePermissions,
    private readonly store: PortalStore,
    private readonly now: () => number = Date.now,
  ) {}
  async read(
    request: PortalNativeContourRequest,
    signal: AbortSignal,
  ): Promise<PortalNativeContourCapsule> {
    signal.throwIfAborted();
    try {
      const input = RequestSchema.parse(request);
      assertActive(signal, input.deadlineAt, this.now());
      const boundedSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(
          Math.max(1, Math.min(2_147_483_647, Math.floor(input.deadlineAt - this.now()))),
        ),
      ]);
      return await waitLogically(this.readVerified(input, boundedSignal), boundedSignal);
    } catch {
      signal.throwIfAborted();
      return unproven();
    }
  }
  private async readVerified(
    input: PortalNativeContourRequest,
    signal: AbortSignal,
  ): Promise<PortalNativeContourCapsule> {
    try {
      assertActive(signal, input.deadlineAt, this.now());
      const plan = await this.store.get('plans', input.planId, PortalPlanSchema);
      const captured = await this.store.get('designs', input.planId, PortalCapturedDesignSchema);
      if (
        !plan ||
        !captured ||
        plan.planId !== input.planId ||
        plan.ownerId !== input.ownerId ||
        plan.workspaceId !== input.workspaceId ||
        !plan.design.capture ||
        !plan.design.complete ||
        !plan.design.liveVerified ||
        plan.design.capture.source.kind !== 'chrome' ||
        canonicalJson(plan.design.capture) !== canonicalJson(input.capture)
      )
        unproven();
      assertPortalCaptureDescriptor(captured, plan.design.capture);
      const target = parseFigmaTarget(plan.design.capture.source.url);
      if (
        plan.design.storage !== 'owner-state' ||
        parseFigmaTarget(plan.design.url).url !== plan.design.capture.source.url ||
        plan.design.fileKey !== target.fileKey ||
        plan.design.nodeId !== target.nodeId ||
        plan.design.artifactPath !== `portal/designs/${plan.planId}.json` ||
        plan.design.artifactHash !== captured.hash ||
        plan.design.assetManifestHash !== plan.design.capture.assetManifestHash
      )
        unproven();
      if (captured.capturedAt !== input.primaryCapturedAt) unproven();
      const scope = nativeContourCaptureScope(plan.design.capture);
      const record = await this.store.get(
        recordKind,
        nativeContourSupplementId(input.planId, captured),
        PortalNativeSupplementSchema,
      );
      if (
        !record ||
        record.planId !== input.planId ||
        record.intrinsicCaptureHash !== intrinsicHash(captured) ||
        record.primaryCapturedAt !== captured.capturedAt ||
        record.sourceUrl !== plan.design.capture.source.url ||
        record.fileKeyHash !== plan.design.capture.source.fileKeyHash ||
        record.scopeId !== plan.design.capture.source.scopeId ||
        record.pageId !== scope.pageId ||
        record.captureDirectory !== captureDirectory(this.stateRoot, captured.assetRoot) ||
        !record.captureDirectory.startsWith(`portal/captures/${input.planId}-`) ||
        record.beforeContentHash !== plan.design.capture.contentFingerprint ||
        record.afterContentHash !== record.beforeContentHash
      )
        unproven();
      const nativeAt = Date.parse(record.capturedAt),
        primaryAt = Date.parse(captured.capturedAt);
      if (
        !Number.isFinite(nativeAt) ||
        !Number.isFinite(primaryAt) ||
        nativeAt > primaryAt ||
        primaryAt > this.now()
      )
        unproven();
      assertActive(signal, input.deadlineAt, this.now());
      const bytes = await readDocument(
        this.stateRoot,
        this.permissions,
        record.captureDirectory,
        signal,
        input.deadlineAt,
        this.now,
      );
      if (bytes.length !== record.documentBytes || storedChecksum(bytes) !== record.documentHash)
        unproven();
      const finalPlan = await this.store.get('plans', input.planId, PortalPlanSchema);
      const finalCaptured = await this.store.get(
        'designs',
        input.planId,
        PortalCapturedDesignSchema,
      );
      assertActive(signal, input.deadlineAt, this.now());
      if (
        canonicalJson(finalPlan) !== canonicalJson(plan) ||
        !finalCaptured ||
        intrinsicHash(finalCaptured) !== record.intrinsicCaptureHash
      )
        unproven();
      return {
        version: 1,
        ownerId: plan.ownerId,
        workspaceId: plan.workspaceId,
        planId: plan.planId,
        fileKeyHash: plan.design.capture.source.fileKeyHash,
        pageId: scope.pageId,
        scopeId: plan.design.capture.source.scopeId,
        captureFingerprint: plan.design.capture.designFingerprint,
        reobservedCaptureFingerprint: plan.design.capture.designFingerprint,
        capturedAt: record.capturedAt,
        primaryCapturedAt: captured.capturedAt,
        documentHash: record.documentHash,
        documentBytes: Uint8Array.from(bytes),
      };
    } catch {
      signal.throwIfAborted();
      return unproven();
    }
  }
}
