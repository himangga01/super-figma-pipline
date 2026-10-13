import {
  contentHash,
  PortalPlanSchema,
  PortalRunSchema,
  type PortalPlan,
  type PortalRun,
} from '@sfp/ir';

import {
  PortalNativeGeometryPageSchema,
  PortalNativeGeometryRequestSchema,
  PORTAL_NATIVE_GEOMETRY_PAGE_BYTES,
  type PortalNativeGeometryPage,
  type PortalNativeGeometryRequest,
} from '../../../shared/src/portal-native-geometry.js';
import { PortalCapturedDesignSchema, assertPortalCaptureDescriptor } from './design-capture.js';
import { normalizeDesignObservation } from './design-normalization.js';
import {
  deriveNativeContours,
  materializePreparedNativeContours,
  retirePreparedNativeContours,
  type PortalNativeContourAcquisitionPort,
  type PreparedNativeContours,
} from './native-contours.js';
import { portalError, type PortalStore } from './store.js';

function fail(code: string): never {
  throw portalError(code);
}
const assertActive = (signal: AbortSignal, deadlineAt: number, now: () => number) => {
  if (signal.aborted) fail('OPERATION_CANCELLED');
  if (now() >= deadlineAt) fail('PORTAL_BUDGET_EXHAUSTED');
};
const sourceBinding = (plan: PortalPlan, run: PortalRun) =>
  contentHash('sfp-native-geometry-current-plan-v1', {
    ownerId: plan.ownerId,
    workspaceId: plan.workspaceId,
    planId: plan.planId,
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    design: plan.design,
    runId: run.runId,
    runPlanId: run.planId,
    runOwner: run.ownerId,
    deadlineAt: run.deadlineAt,
  });
/** Lookup-only authoring facts. Public operation input/result egress gates own disclosure. */
export async function readPortalNativeGeometry(
  store: PortalStore,
  acquisition: PortalNativeContourAcquisitionPort | undefined,
  plan: PortalPlan,
  run: PortalRun,
  request: PortalNativeGeometryRequest,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<PortalNativeGeometryPage> {
  assertActive(signal, run.deadlineAt, now);
  if (!acquisition) fail('PORTAL_CAPTURE_NATIVE_SUPPLEMENT_REQUIRED');
  const paging = PortalNativeGeometryRequestSchema.parse(request);
  const boundedSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.max(1, Math.min(2147483647, run.deadlineAt - now()))),
  ]);
  let prepared: PreparedNativeContours | undefined;
  try {
    const currentPlan = await store.get('plans', plan.planId, PortalPlanSchema);
    const currentRun = await store.get('runs', run.runId, PortalRunSchema);
    const captured = await store.get('designs', plan.planId, PortalCapturedDesignSchema);
    if (
      !currentPlan ||
      !currentRun ||
      !captured ||
      currentPlan.ownerId !== run.ownerId ||
      currentPlan.workspaceId !== plan.workspaceId ||
      currentRun.ownerId !== run.ownerId ||
      currentRun.planId !== plan.planId ||
      sourceBinding(currentPlan, currentRun) !== sourceBinding(plan, run) ||
      ['cancelled', 'cancel-requested', 'completed', 'outcome-unknown'].includes(
        currentRun.state,
      ) ||
      currentPlan.design.storage !== 'owner-state' ||
      !currentPlan.design.capture
    )
      fail('PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED');
    assertPortalCaptureDescriptor(captured, currentPlan.design.capture);
    const capturedHash = contentHash('sfp-native-geometry-primary-record-v1', captured);
    const input = {
      ownerId: currentPlan.ownerId,
      workspaceId: currentPlan.workspaceId,
      planId: currentPlan.planId,
      capture: currentPlan.design.capture,
      primaryCapturedAt: captured.capturedAt,
      deadlineAt: run.deadlineAt,
    };
    assertActive(boundedSignal, run.deadlineAt, now);
    const capsule = await acquisition.read(input, boundedSignal);
    assertActive(boundedSignal, run.deadlineAt, now);
    const observation = normalizeDesignObservation(
      JSON.parse(captured.raw),
      captured.collectorEvidence,
    );
    prepared = deriveNativeContours(input, capsule, observation);
    const material = materializePreparedNativeContours(prepared);
    assertActive(boundedSignal, run.deadlineAt, now);
    const materializationHash = contentHash('sfp-native-geometry-material-v1', material);
    const facts = {
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      runId: run.runId,
      planId: input.planId,
      contextHash: currentPlan.contextHash,
      blueprintHash: currentPlan.blueprintHash,
      fileKeyHash: capsule.fileKeyHash,
      scopeId: capsule.scopeId,
      pageId: capsule.pageId,
      captureFingerprint: capsule.captureFingerprint,
      captureRawHash: captured.hash,
      captureDescriptorHash: contentHash('sfp-native-geometry-capture-v1', input.capture),
      captureRecordHash: capturedHash,
      documentHash: capsule.documentHash,
      capturedAt: capsule.capturedAt,
      primaryCapturedAt: capsule.primaryCapturedAt,
      deadlineAt: run.deadlineAt,
      materializationHash,
    };
    const bindingHash = contentHash('sfp-native-geometry-binding-v1', facts);
    if (paging.bindingHash && paging.bindingHash !== bindingHash)
      fail('PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED');
    const rows = paging.section === 'resources' ? material.resources : material.nodes;
    if (paging.offset > rows.length) fail('PORTAL_NATIVE_GEOMETRY_OFFSET_INVALID');
    const base = {
      version: 1 as const,
      supplemental: true as const,
      fullCapture: false as const,
      atomic: false as const,
      coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable' as const,
      binding: { ...facts, bindingHash },
      section: paging.section,
      offset: paging.offset,
      total: rows.length,
      totalResources: material.resources.length,
      totalNodes: material.nodes.length,
      totalGlyphs: material.nodes.reduce((sum, n) => sum + n.glyphs.length, 0),
    };
    let page = {
      ...base,
      nextOffset: paging.offset < rows.length ? paging.offset : null,
      resources: [],
      nodes: [],
    } as PortalNativeGeometryPage;
    for (
      let index = paging.offset;
      index < rows.length && index < paging.offset + paging.limit;
      index++
    ) {
      assertActive(boundedSignal, run.deadlineAt, now);
      const count = index - paging.offset + 1;
      const trial = {
        ...base,
        nextOffset: index + 1 < rows.length ? index + 1 : null,
        resources:
          paging.section === 'resources'
            ? material.resources.slice(paging.offset, paging.offset + count)
            : [],
        nodes:
          paging.section === 'nodes'
            ? material.nodes.slice(paging.offset, paging.offset + count)
            : [],
      };
      if (Buffer.byteLength(JSON.stringify(trial)) > PORTAL_NATIVE_GEOMETRY_PAGE_BYTES) {
        if (count === 1) fail('PORTAL_NATIVE_GEOMETRY_ROW_LIMIT');
        break;
      }
      page = trial;
    }
    const afterPlan = await store.get('plans', plan.planId, PortalPlanSchema);
    const afterRun = await store.get('runs', run.runId, PortalRunSchema);
    const afterCapture = await store.get('designs', plan.planId, PortalCapturedDesignSchema);
    if (
      !afterPlan ||
      !afterRun ||
      !afterCapture ||
      sourceBinding(afterPlan, afterRun) !== sourceBinding(currentPlan, currentRun) ||
      ['cancelled', 'cancel-requested', 'completed', 'outcome-unknown'].includes(afterRun.state) ||
      contentHash('sfp-native-geometry-primary-record-v1', afterCapture) !== capturedHash
    )
      fail('PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED');
    assertPortalCaptureDescriptor(afterCapture, afterPlan.design.capture);
    assertActive(boundedSignal, run.deadlineAt, now);
    return PortalNativeGeometryPageSchema.parse(page);
  } catch (error) {
    assertActive(signal, run.deadlineAt, now);
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (
      typeof code === 'string' &&
      [
        'PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED',
        'PORTAL_NATIVE_GEOMETRY_OFFSET_INVALID',
        'PORTAL_NATIVE_GEOMETRY_ROW_LIMIT',
      ].includes(code)
    )
      fail(code);
    return fail('PORTAL_NATIVE_GEOMETRY_UNPROVEN');
  } finally {
    if (prepared) retirePreparedNativeContours(prepared);
  }
}

/** Repeat current signed identity immediately before the surrounding public context publishes. */
export async function assertPortalNativeGeometryBinding(
  store: PortalStore,
  binding: PortalNativeGeometryPage['binding'],
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<void> {
  assertActive(signal, binding.deadlineAt, now);
  const plan = await store.get('plans', binding.planId, PortalPlanSchema);
  const run = await store.get('runs', binding.runId, PortalRunSchema);
  const captured = await store.get('designs', binding.planId, PortalCapturedDesignSchema);
  if (
    !plan ||
    !run ||
    !captured ||
    plan.ownerId !== binding.ownerId ||
    run.ownerId !== binding.ownerId ||
    plan.workspaceId !== binding.workspaceId ||
    run.planId !== binding.planId ||
    plan.contextHash !== binding.contextHash ||
    plan.blueprintHash !== binding.blueprintHash ||
    run.deadlineAt !== binding.deadlineAt ||
    ['cancelled', 'cancel-requested', 'completed', 'outcome-unknown'].includes(run.state) ||
    !plan.design.capture ||
    plan.design.capture.designFingerprint !== binding.captureFingerprint ||
    plan.design.capture.source.scopeId !== binding.scopeId ||
    plan.design.capture.source.fileKeyHash !== binding.fileKeyHash ||
    contentHash('sfp-native-geometry-capture-v1', plan.design.capture) !==
      binding.captureDescriptorHash ||
    captured.hash !== binding.captureRawHash ||
    captured.capturedAt !== binding.primaryCapturedAt ||
    contentHash('sfp-native-geometry-primary-record-v1', captured) !== binding.captureRecordHash
  )
    fail('PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED');
  assertPortalCaptureDescriptor(captured, plan.design.capture);
  assertActive(signal, binding.deadlineAt, now);
}
