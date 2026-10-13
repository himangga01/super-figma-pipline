import { link, readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { contentHash, PortalPlanSchema, storedChecksum } from '@sfp/ir';
import { afterEach, expect, it, vi } from 'vitest';

import {
  PortalNativeSupplementSchema,
  nativeContourSupplementId,
  publishNativeContourSupplement,
  StoredNativeContourAcquisition,
} from '../../src/portal/capture-native-supplement.js';
import {
  describePortalCapture,
  PortalCapturedDesignSchema,
} from '../../src/portal/design-capture.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const planId = `sfp_portal1_${'2'.repeat(32)}`;
const ownerId = `actor1_${'a'.repeat(43)}`;
const bytes = Buffer.from('fig-kiwiOWNED');
async function fixture(publish = true) {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('REAL_NETWORK_FORBIDDEN'));
  const current = await currentCaptureFixture(f);
  const folder = join(f.stateRoot, 'portal', 'captures', planId + '-owned');
  await rename(current.captured.assetRoot, folder);
  current.captured.assetRoot = folder;
  await writeFile(join(folder, 'document.fig'), bytes);
  const exported = {
    schemaVersion: 1,
    source: 'figma-web-native-export',
    requestedUrl: current.descriptor.source.url,
    fileKey: '4IBhv1d8hEclifZQrOYxHS',
    requestedNodeId: '0:1',
    filename: 'Owned.fig',
    path: 'document.fig',
    bytes: bytes.length,
    sha256: storedChecksum(bytes),
    capturedAt: new Date(Date.parse(current.captured.capturedAt) - 1).toISOString(),
    fullCapture: false,
    limitation: 'Controlled fixture native bytes; no actual native browser export',
  };
  const publication = {
    stateRoot: f.stateRoot,
    permissions: f.permissions,
    store: f.store,
    planId,
    url: current.descriptor.source.url,
    captured: current.captured,
    exported,
    beforeContentHash: current.captured.contentFingerprint!,
    afterContentHash: current.captured.contentFingerprint!,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 300_000,
  };
  if (publish) await publishNativeContourSupplement(publication);
  await f.store.create('designs', planId, current.captured, PortalCapturedDesignSchema);
  const hash = `sha256:${'a'.repeat(64)}`;
  const plan = PortalPlanSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    planId,
    ownerId,
    workspaceId: f.workspaceId,
    createdAt: new Date().toISOString(),
    request: { case: 'new-blank' },
    requestedCase: 'new-blank',
    strategy: 'blank-frontend',
    implementationScope: 'frontend-only',
    targetPath: 'generated/owned',
    repositories: [
      {
        role: 'target',
        workspaceId: f.workspaceId,
        rootPath: '.',
        anchorPath: '.',
        canonicalPath: f.workspaceRoot,
        identity: 'owned-fixture',
        writable: true,
        sourceHash: null,
      },
    ],
    profiles: [],
    design: {
      capture: current.descriptor,
      storage: 'owner-state',
      url: current.descriptor.source.url,
      fileKey: exported.fileKey,
      nodeId: exported.requestedNodeId,
      artifactPath: `portal/designs/${planId}.json`,
      artifactHash: current.captured.hash,
      assetManifestHash: contentHash('sfp-portal-design-assets-v1', current.captured.assets),
      liveVerified: true,
      complete: true,
    },
    requirements: [
      {
        id: 'owned-local',
        description: 'Owned fixture only',
        layers: ['frontend'],
        required: true,
      },
    ],
    requiredLayers: ['frontend'],
    contextHash: hash,
    blueprintHash: hash,
    issues: [],
  });
  await f.store.create('plans', planId, plan, PortalPlanSchema);
  const request = {
    ownerId,
    workspaceId: f.workspaceId,
    planId,
    capture: current.descriptor,
    primaryCapturedAt: current.captured.capturedAt,
    deadlineAt: Date.now() + 30_000,
  };
  const port = new StoredNativeContourAcquisition(f.stateRoot, f.permissions, f.store);
  return { ...f, ...current, folder, publication, plan, request, port };
}

it('looks up exact signed primary and native bytes without any browser or network action', async () => {
  const f = await fixture();
  const record = await f.store.get(
    'native-contour-supplements',
    nativeContourSupplementId(planId, f.captured),
    PortalNativeSupplementSchema,
  );
  const capsule = await f.port.read(f.request, new AbortController().signal);
  expect(capsule).toMatchObject({
    ownerId,
    workspaceId: f.workspaceId,
    planId,
    scopeId: f.descriptor.source.scopeId,
    pageId: '0:1',
    captureFingerprint: f.descriptor.designFingerprint,
    reobservedCaptureFingerprint: f.descriptor.designFingerprint,
    primaryCapturedAt: f.captured.capturedAt,
    capturedAt: record!.capturedAt,
    documentHash: storedChecksum(bytes),
  });
  expect(Buffer.from(capsule.documentBytes)).toEqual(bytes);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  capsule.documentBytes[0] = 0;
  expect(
    Buffer.from((await f.port.read(f.request, new AbortController().signal)).documentBytes),
  ).toEqual(bytes);
});

it.each([
  ['encoded colon', 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0%3A1'],
  ['literal colon', 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0:1'],
  [
    'alternate host, slug and tracking',
    'https://figma.com/design/4IBhv1d8hEclifZQrOYxHS/Owned?node-id=0-1&mode=design#viewer',
  ],
])(
  'reads the same signed native supplement for supported equivalent URL form %s',
  async (_label, url) => {
    const f = await fixture();
    const id = nativeContourSupplementId(planId, f.captured);
    const record = await f.store.get(
      'native-contour-supplements',
      id,
      PortalNativeSupplementSchema,
    );
    await f.store.update('plans', planId, PortalPlanSchema, plan => ({
      ...plan,
      design: { ...plan.design, url },
    }));
    const capsule = await f.port.read(f.request, new AbortController().signal);
    expect(capsule).toMatchObject({
      ownerId,
      workspaceId: f.workspaceId,
      planId,
      scopeId: f.descriptor.source.scopeId,
      primaryCapturedAt: f.captured.capturedAt,
      documentHash: storedChecksum(bytes),
    });
    expect(Buffer.from(capsule.documentBytes)).toEqual(bytes);
    expect(
      await f.store.get('native-contour-supplements', id, PortalNativeSupplementSchema),
    ).toEqual(record);
    expect(await readFile(join(f.folder, 'document.fig'))).toEqual(bytes);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);
it.each([
  ['foreign file', 'https://www.figma.com/design/Foreign4IBhv1d8hEclifZQ?node-id=0%3A1'],
  ['foreign node', 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0%3A2'],
  ['missing node', 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS'],
  ['foreign host', 'https://example.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0%3A1'],
])(
  'refuses a signed plan URL targeting %s without borrowing the retained supplement',
  async (_label, url) => {
    const f = await fixture();
    await f.store.update('plans', planId, PortalPlanSchema, plan => ({
      ...plan,
      design: { ...plan.design, url },
    }));
    await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
      code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);
it('requires a fresh admitted capture when the signed native supplement is missing', async () => {
  const f = await fixture(false);
  await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('uses the signed plan actual admission for omitted and explicit scripter collectors', async () => {
  const f = await fixture();
  if (f.descriptor.admission.kind !== 'chrome') throw new Error('OWNED_CHROME_FIXTURE_REQUIRED');
  const admission = {
    ...f.descriptor.admission,
    kind: 'chrome' as const,
    collector: 'scripter' as const,
  };
  const capture = describePortalCapture(
    f.captured,
    { kind: 'chrome', collector: 'scripter', url: f.descriptor.source.url },
    admission,
  );
  expect(capture.evidenceHash).not.toBe(f.descriptor.evidenceHash);
  await f.store.update('plans', planId, PortalPlanSchema, plan => ({
    ...plan,
    design: { ...plan.design, capture },
  }));
  const result = await f.port.read({ ...f.request, capture }, new AbortController().signal);
  expect(result.captureFingerprint).toBe(capture.designFingerprint);
  expect(result.scopeId).toBe(capture.source.scopeId);
});

it.each(['owner', 'workspace', 'plan', 'scope', 'primary-time'] as const)(
  'rejects a mismatched %s lookup binding',
  async kind => {
    const f = await fixture();
    const request = structuredClone(f.request);
    if (kind === 'owner') request.ownerId += '-other';
    if (kind === 'workspace') request.workspaceId = '00000000-0000-4000-8000-000000000002';
    if (kind === 'plan') request.planId = `sfp_portal1_${'3'.repeat(32)}`;
    if (kind === 'scope')
      request.capture.source.scopeId = JSON.stringify({
        requestedNodeId: '0:1',
        pageId: '9:9',
        scopeNodeId: '0:1',
      });
    if (kind === 'primary-time')
      request.primaryCapturedAt = new Date(Date.parse(request.primaryCapturedAt) - 1).toISOString();
    await expect(f.port.read(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
    });
  },
);

it('rejects a newer signed capture even when its design fingerprint and descriptor stay equal', async () => {
  const f = await fixture();
  const time = new Date(Date.parse(f.captured.capturedAt) + 1).toISOString();
  await f.store.update('designs', planId, PortalCapturedDesignSchema, current => ({
    ...current,
    capturedAt: time,
  }));
  await expect(
    f.port.read({ ...f.request, primaryCapturedAt: time }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN' });
});

it.each(['changed-bytes', 'missing-bytes', 'hardlink'] as const)(
  'rejects %s without accepting metadata as byte proof',
  async kind => {
    const f = await fixture();
    const file = join(f.folder, 'document.fig');
    if (kind === 'changed-bytes') await writeFile(file, Buffer.from('fig-kiwiOTHER'));
    if (kind === 'missing-bytes') await rename(file, join(f.folder, 'retained-missing.fig'));
    if (kind === 'hardlink') await link(file, join(f.folder, 'alias.fig'));
    await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
      code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
    });
  },
);

it('rejects unsigned supplement edits and never follows their substituted path', async () => {
  const f = await fixture();
  const path = join(
    f.stateRoot,
    'portal',
    'native-contour-supplements',
    nativeContourSupplementId(planId, f.captured) + '.json',
  );
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  envelope.payload.captureDirectory = 'portal/captures/substituted';
  await writeFile(path, JSON.stringify(envelope));
  await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  });
});

it('rechecks signed plan ownership after protected bytes are read', async () => {
  const f = await fixture();
  let changed = false;
  vi.spyOn(f.permissions, 'verifySecure').mockImplementation(async path => {
    if (!changed && path.endsWith('document.fig')) {
      changed = true;
      await f.store.update('plans', planId, PortalPlanSchema, plan => ({
        ...plan,
        ownerId: ownerId + '-replacement',
      }));
    }
  });
  await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  });
  expect(changed).toBe(true);
});

it('honors cancellation during protected read and expiry before any document access', async () => {
  const f = await fixture();
  const controller = new AbortController(),
    reason = Object.assign(new Error('OPERATION_CANCELLED'), { code: 'OPERATION_CANCELLED' });
  let reads = 0;
  vi.spyOn(f.permissions, 'verifySecure').mockImplementation(async path => {
    if (path.endsWith('document.fig')) {
      reads++;
      controller.abort(reason);
    }
  });
  await expect(
    f.port.read({ ...f.request, deadlineAt: Date.now() - 1 }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN' });
  expect(reads).toBe(0);
  await expect(f.port.read(f.request, controller.signal)).rejects.toBe(reason);
});

it('cancels a held read promptly and cannot deliver a capsule after the physical read resumes', async () => {
  const f = await fixture();
  let entered = false,
    release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.spyOn(f.permissions, 'verifySecure').mockImplementation(async path => {
    if (path.endsWith('document.fig')) {
      entered = true;
      await gate;
    }
  });
  const controller = new AbortController(),
    reason = new Error('OPERATION_CANCELLED');
  const outcome = f.port.read(f.request, controller.signal).then(
    value => ({ value, error: null }),
    error => ({ value: null, error }),
  );
  await vi.waitFor(() => expect(entered).toBe(true));
  controller.abort(reason);
  const result = await outcome;
  expect(result.error).toBe(reason);
  expect(result.value).toBeNull();
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('refuses native timestamps after the primary observation and never overwrites a retained supplement', async () => {
  const f = await fixture(false);
  await expect(
    publishNativeContourSupplement({
      ...f.publication,
      exported: {
        ...f.publication.exported,
        capturedAt: new Date(Date.parse(f.captured.capturedAt) + 1).toISOString(),
      },
    }),
  ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN' });
  expect(
    await f.store.get(
      'native-contour-supplements',
      nativeContourSupplementId(planId, f.captured),
      PortalNativeSupplementSchema,
    ),
  ).toBeNull();
  await publishNativeContourSupplement(f.publication);
  const before = await readFile(
    join(
      f.stateRoot,
      'portal',
      'native-contour-supplements',
      nativeContourSupplementId(planId, f.captured) + '.json',
    ),
  );
  await expect(publishNativeContourSupplement(f.publication)).rejects.toBeInstanceOf(Error);
  expect(
    await readFile(
      join(
        f.stateRoot,
        'portal',
        'native-contour-supplements',
        nativeContourSupplementId(planId, f.captured) + '.json',
      ),
    ),
  ).toEqual(before);
});

it('keeps each same-plan intrinsic capture immutable and selects only the current signed primary', async () => {
  const f = await fixture();
  const firstId = nativeContourSupplementId(planId, f.captured);
  const firstPath = join(f.stateRoot, 'portal', 'native-contour-supplements', firstId + '.json');
  const firstBytes = await readFile(firstPath);
  const fresh = structuredClone(f.captured);
  fresh.assetRoot = f.folder + '-fresh';
  fresh.capturedAt = new Date().toISOString();
  await mkdir(fresh.assetRoot);
  await writeFile(join(fresh.assetRoot, 'document.fig'), bytes);
  const freshPublication = {
    ...f.publication,
    captured: fresh,
    exported: {
      ...f.publication.exported,
      capturedAt: new Date(Date.parse(fresh.capturedAt) - 1).toISOString(),
    },
  };
  await publishNativeContourSupplement(freshPublication);
  const freshId = nativeContourSupplementId(planId, fresh);
  expect(freshId).not.toBe(firstId);
  const stillOriginal = await f.port.read(f.request, new AbortController().signal);
  expect(stillOriginal.primaryCapturedAt).toBe(f.captured.capturedAt);
  await expect(
    f.port.read(
      { ...f.request, primaryCapturedAt: fresh.capturedAt },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN' });
  await f.store.update('designs', planId, PortalCapturedDesignSchema, () => fresh);
  const selected = await f.port.read(
    { ...f.request, primaryCapturedAt: fresh.capturedAt },
    new AbortController().signal,
  );
  expect(selected.primaryCapturedAt).toBe(fresh.capturedAt);
  await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  });
  expect(await readFile(firstPath)).toEqual(firstBytes);
  expect(
    await f.store.get('native-contour-supplements', freshId, PortalNativeSupplementSchema),
  ).not.toBeNull();
});

it('rejects replaced capture-directory identity after protected bytes have been read', async () => {
  const f = await fixture();
  let touches = 0,
    replaced = false;
  vi.spyOn(f.permissions, 'verifySecure').mockImplementation(async path => {
    if (path.endsWith('document.fig') && ++touches === 3) {
      await rename(f.folder, f.folder + '-retained');
      await mkdir(f.folder);
      await writeFile(join(f.folder, 'document.fig'), bytes);
      replaced = true;
    }
  });
  await expect(f.port.read(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  });
  expect(replaced).toBe(true);
});
