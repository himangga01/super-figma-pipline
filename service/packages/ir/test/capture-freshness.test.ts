import { expect, it } from 'vitest';

import {
  type PortalCaptureDescriptor,
  type PortalCaptureReexportProof,
} from '../../shared/src/portal-capture-source.js';
import { contentHash } from '../src/canonical-json.js';
import { portalCaptureFreshnessMatches } from '../src/capture-freshness.js';

const hash = (value: string) => `sha256:${value.repeat(64)}`;
const designHash = (d: PortalCaptureDescriptor) =>
  contentHash('sfp-portal-design-version-v2', {
    content: d.contentFingerprint,
    contracts: d.contractFingerprint,
    source: d.sourceFingerprint,
    assets: d.assetFingerprint,
  });
const fixture = (kind: 'png' | 'svg' = 'png') => {
  const assets: PortalCaptureReexportProof['assets'] = [
    {
      query: { kind, nodeId: '1:1' },
      originalHash: hash('1'),
      originalBytes: 101,
      freshHash: hash('2'),
      freshBytes: 102,
      exportedFrom: null,
      png: {
        width: 200,
        height: 100,
        changedPixels: 1,
        maxRgbDelta: 1,
        alphaChanged: false,
        originalPixelsHash: hash('3'),
        freshPixelsHash: hash('4'),
      },
    },
  ];
  const assetHash = (fresh: boolean) =>
    contentHash(
      'sfp-portal-capture-assets-v2',
      assets.map(a => ({
        query: a.query,
        status: 'captured',
        sha256: fresh ? a.freshHash : a.originalHash,
        bytes: fresh ? a.freshBytes : a.originalBytes,
        exportedFrom: a.exportedFrom,
      })),
    );
  const url = 'https://www.figma.com/design/captureFixtureKey?node-id=0-1';
  const original: PortalCaptureDescriptor = {
    version: 2,
    admission: {
      version: 1,
      kind: 'chrome',
      url,
      fileKeyHash: hash('a'),
      requestedNodeId: '0:1',
      phase: 'requested-source',
      binding: 'selected-page-after-approved-connection',
    },
    rawHash: hash('b'),
    assetManifestHash: hash('c'),
    contentFingerprint: hash('d'),
    sourceFingerprint: hash('e'),
    contractFingerprint: hash('f'),
    assetFingerprint: assetHash(false),
    evidenceHash: hash('a'),
    designFingerprint: hash('b'),
    source: {
      kind: 'chrome',
      url,
      fileKeyHash: hash('a'),
      requestedNodeId: '0:1',
      scopeId: '0:1',
      bindingMethod: 'file-key',
    },
  };
  original.designFingerprint = designHash(original);
  const fresh = { ...structuredClone(original), assetFingerprint: assetHash(true) };
  fresh.designFingerprint = designHash(fresh);
  return {
    original,
    receipt: {
      version: 2 as const,
      originalDescriptorHash: contentHash('sfp-portal-capture-descriptor-v2', original),
      freshDesignFingerprint: fresh.designFingerprint,
      reexport: {
        version: 1 as const,
        policy: 'same-facts-png-quantization-v1' as const,
        freshDescriptor: fresh,
        assets,
      },
    },
  };
};

it('keeps distinct original/fresh fingerprints and accepts only a bound re-export proof', () => {
  const { original, receipt } = fixture();
  expect(receipt.freshDesignFingerprint).not.toBe(original.designFingerprint);
  expect(portalCaptureFreshnessMatches(original, receipt)).toBe(true);
  expect(portalCaptureFreshnessMatches(original, { ...receipt, reexport: undefined })).toBe(false);
  expect(
    portalCaptureFreshnessMatches(original, { ...receipt, originalDescriptorHash: hash('0') }),
  ).toBe(false);
});

it.each(['contentFingerprint', 'contractFingerprint', 'sourceFingerprint'] as const)(
  'rejects changed %s even with otherwise valid raster evidence',
  field => {
    const { original, receipt } = fixture();
    receipt.reexport.freshDescriptor[field] = hash('0');
    receipt.reexport.freshDescriptor.designFingerprint = designHash(
      receipt.reexport.freshDescriptor,
    );
    receipt.freshDesignFingerprint = receipt.reexport.freshDescriptor.designFingerprint;
    expect(portalCaptureFreshnessMatches(original, receipt)).toBe(false);
  },
);

it('rejects foreign scope, changed non-PNG assets, missing rows and forged metrics', () => {
  const wrongScope = fixture();
  wrongScope.receipt.reexport.freshDescriptor.source.scopeId = '2:2';
  expect(portalCaptureFreshnessMatches(wrongScope.original, wrongScope.receipt)).toBe(false);
  const svg = fixture('svg');
  expect(portalCaptureFreshnessMatches(svg.original, svg.receipt)).toBe(false);
  const missing = fixture();
  missing.receipt.reexport.assets = [];
  expect(portalCaptureFreshnessMatches(missing.original, missing.receipt)).toBe(false);
  const changedHash = fixture();
  changedHash.receipt.reexport.assets[0]!.freshHash = hash('9');
  expect(portalCaptureFreshnessMatches(changedHash.original, changedHash.receipt)).toBe(false);
  const tooMany = fixture();
  tooMany.receipt.reexport.assets[0]!.png!.changedPixels = 3;
  expect(portalCaptureFreshnessMatches(tooMany.original, tooMany.receipt)).toBe(false);
});
