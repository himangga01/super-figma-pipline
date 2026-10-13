import { expect, it } from 'vitest';

import {
  PortalNativeGeometryPageSchema,
  PORTAL_NATIVE_GEOMETRY_PAGE_BYTES,
  type PortalNativeGeometryPage,
} from '../src/portal-native-geometry.js';
import { PortalNextArgsSchema } from '../src/portal.js';

const runId = `sfp_portal1_${'1'.repeat(32)}`;
it('admits bounded native authoring pages on the existing public next request', () => {
  expect(
    PortalNextArgsSchema.safeParse({
      runId,
      nativeGeometry: { section: 'resources', offset: 0, limit: 32 },
    }).success,
  ).toBe(true);
});
it('preserves ordinary arguments without introducing a default geometry request', () => {
  const args = PortalNextArgsSchema.parse({ runId });
  expect(Object.hasOwn(args, 'nativeGeometry')).toBe(false);
});
it.each([
  { section: 'resources', offset: 1 },
  { section: 'resources', offset: 0, limit: 65 },
  { section: 'nodes', offset: -1 },
  { section: 'resources', offset: 0, path: 'private/document.fig' },
  { section: 'resources', offset: 0, documentHash: 'sha256:' + 'a'.repeat(64) },
])('rejects unbound, oversized and caller-selected page request %j', nativeGeometry => {
  expect(PortalNextArgsSchema.safeParse({ runId, nativeGeometry }).success).toBe(false);
});
function page(): PortalNativeGeometryPage {
  const hash = 'sha256:' + 'a'.repeat(64);
  return {
    version: 1,
    supplemental: true,
    fullCapture: false,
    atomic: false,
    coherenceLimit: 'ordered-read-ABA-and-post-read-changes-unobservable',
    binding: {
      ownerId: 'fixture',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      runId,
      planId: runId,
      contextHash: hash,
      blueprintHash: hash,
      fileKeyHash: hash,
      scopeId: '{"requestedNodeId":null,"pageId":"1:0","scopeNodeId":"1:0"}',
      pageId: '1:0',
      captureFingerprint: hash,
      captureRawHash: hash,
      captureDescriptorHash: hash,
      captureRecordHash: hash,
      documentHash: hash,
      capturedAt: '2000-01-01T00:00:00.000Z',
      primaryCapturedAt: '2000-01-01T00:00:01.000Z',
      deadlineAt: 1792000000000,
      materializationHash: hash,
      bindingHash: hash,
    },
    section: 'resources',
    offset: 0,
    total: 1,
    nextOffset: null,
    totalResources: 1,
    totalNodes: 1,
    totalGlyphs: 2,
    resources: [
      {
        resourceId: hash,
        commandsHash: hash,
        rawPathHash: hash,
        pathHash: hash,
        d: 'M0 0 L1 0 L1 1 Z',
        fonts: [{ family: 'Fixture', style: 'Regular', weight: 400, digest: '0'.repeat(40) }],
      },
    ],
    nodes: [],
  };
}
it('enforces the 256KiB encoded UTF-8 page budget rather than JavaScript character count', () => {
  const value = page(),
    size = Buffer.byteLength(JSON.stringify(value));
  value.resources[0]!.d += ' '.repeat(PORTAL_NATIVE_GEOMETRY_PAGE_BYTES - size);
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(PORTAL_NATIVE_GEOMETRY_PAGE_BYTES);
  expect(PortalNativeGeometryPageSchema.safeParse(value).success).toBe(true);
  value.resources[0]!.fonts[0]!.family = '가'.repeat(512);
  value.resources[0]!.d = value.resources[0]!.d.slice(0, -(512 - 'Fixture'.length));
  expect(JSON.stringify(value).length).toBeLessThanOrEqual(PORTAL_NATIVE_GEOMETRY_PAGE_BYTES);
  expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(
    PORTAL_NATIVE_GEOMETRY_PAGE_BYTES,
  );
  expect(PortalNativeGeometryPageSchema.safeParse(value).success).toBe(false);
});
it('rejects duplicate resources, mixed sections and non-progressing continuations', () => {
  const duplicate = page();
  duplicate.resources.push({ ...duplicate.resources[0]! });
  duplicate.total = 2;
  duplicate.totalResources = 2;
  expect(PortalNativeGeometryPageSchema.safeParse(duplicate).success).toBe(false);
  const stalled = page();
  stalled.resources = [];
  stalled.nextOffset = 0;
  expect(PortalNativeGeometryPageSchema.safeParse(stalled).success).toBe(false);
  const mixed = page();
  mixed.section = 'nodes';
  expect(PortalNativeGeometryPageSchema.safeParse(mixed).success).toBe(false);
});
