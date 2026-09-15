import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import {
  assertPortalCaptureDescriptor,
  describePortalCapture,
  portalDesignFingerprint,
  verifyPortalCaptureFiles,
} from '../../src/portal/design-capture.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it('validates current descriptors but compares fresh observations semantically rather than original attempt identity', async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const first = await currentCaptureFixture(f),
    fresh = await currentCaptureFixture(f);
  assertPortalCaptureDescriptor(first.captured, first.descriptor);
  expect(first.descriptor.evidenceHash).not.toBe(fresh.descriptor.evidenceHash);
  expect(first.descriptor.rawHash).not.toBe(fresh.descriptor.rawHash);
  expect(portalDesignFingerprint(first.captured)).toBe(portalDesignFingerprint(fresh.captured));
  expect(() => assertPortalCaptureDescriptor(fresh.captured, first.descriptor)).toThrow(
    'PORTAL_CAPTURE_EVIDENCE_CHANGED',
  );
  expect(describePortalCapture(fresh.captured, first.descriptor.source).source).toEqual(
    first.descriptor.source,
  );
});
it('rejects legacy flags, changed raw and wrong admitted scope', async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const current = await currentCaptureFixture(f);
  expect(() =>
    assertPortalCaptureDescriptor(
      { ...current.captured, raw: current.captured.raw + ' ' },
      current.descriptor,
    ),
  ).toThrow('PORTAL_CAPTURE_EVIDENCE_CHANGED');
  expect(() => assertPortalCaptureDescriptor(current.captured, undefined)).toThrow(
    'PORTAL_CAPTURE_CURRENT_REQUIRED',
  );
  expect(() =>
    describePortalCapture(current.captured, {
      kind: 'chrome',
      url: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=9-9',
    }),
  ).toThrow('PORTAL_CAPTURE_SCOPE_MISMATCH');
});
it('supports a requested frame without confusing its ID with the fixture page', async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const current = await currentCaptureFixture(f, {
    nodes: [{ id: '0:1', name: 'Welcome', type: 'FRAME' }],
  });
  expect(current.captured.complete).toBe(true);
  assertPortalCaptureDescriptor(current.captured, current.descriptor);
});

it('rejects changed original asset bytes even when signed manifest metadata still matches', async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const current = await currentCaptureFixture(f);
  await verifyPortalCaptureFiles(current.captured);
  await writeFile(
    join(current.captured.assetRoot, current.captured.assets[0]!.path!),
    Buffer.from([1, 2, 3]),
  );
  await expect(verifyPortalCaptureFiles(current.captured)).rejects.toThrow(
    'PORTAL_CAPTURE_ASSET_CHANGED',
  );
});
