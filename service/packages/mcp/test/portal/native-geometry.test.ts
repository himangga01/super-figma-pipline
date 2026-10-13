import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';

import { storedChecksum } from '@sfp/ir';
import type { DesignObservation } from '@sfp/shared';
import { expect, it } from 'vitest';

import {
  deriveNativeContours,
  materializePreparedNativeContours,
  retirePreparedNativeContours,
  requirePreparedNativeContours,
  type PortalNativeContourRequest,
} from '../../src/portal/native-contours.js';

const kiwi = createRequire(new URL('../../../cli/package.json', import.meta.url))(
  'kiwi-schema',
) as {
  parseSchema(s: string): unknown;
  encodeBinarySchema(s: unknown): Uint8Array;
  compileSchema(s: unknown): { encodeMessage(v: unknown): Uint8Array };
};
// Constant test codec only. Production interprets the actual incoming schema as data.
const codec = kiwi.parseSchema(`
struct Id { uint sessionID; uint localID; }
struct Point { float x; float y; }
struct Transform { float m00; float m01; float m02; float m10; float m11; float m12; }
message Parent { Id guid=1; string position=2; }
message Font { string family=1; string style=2; }
message FontMeta { Font key=1; byte[] fontDigest=2; uint fontWeight=3; }
message Glyph { uint firstCharacter=1; Point position=2; float fontSize=3; uint commandsBlob=4; }
message Text { string characters=1; }
message Derived { Point layoutSize=1; Glyph[] glyphs=2; FontMeta[] fontMetaData=3; }
message Node { Id guid=1; string type=2; Parent parentIndex=3; Point size=4; Transform transform=5; Text textData=6; Derived derivedTextData=7; Font fontName=8; float fontSize=9; }
message Blob { byte[] bytes=1; }
message Message { Node[] nodeChanges=1; Blob[] blobs=2; }
`);
const font = { family: 'Fixture', style: 'Regular' },
  matrix = [
    [1, 0, 0],
    [0, 1, 0],
  ];
const glyphPath = Buffer.concat(
  [
    { op: 0, v: [] },
    { op: 1, v: [0, 0] },
    { op: 2, v: [1, 0] },
    { op: 2, v: [1, 1] },
    { op: 0, v: [] },
  ].map(x => {
    const b = Buffer.alloc(1 + x.v.length * 4);
    b[0] = x.op;
    x.v.forEach((v, i) => b.writeFloatLE(v, 1 + i * 4));
    return b;
  }),
);
function fixture(duplicate = false) {
  const message = {
    nodeChanges: [
      { guid: { sessionID: 1, localID: 0 }, type: 'CANVAS' },
      {
        guid: { sessionID: 1, localID: 1 },
        type: 'TEXT',
        parentIndex: { guid: { sessionID: 1, localID: 0 }, position: '!' },
        size: { x: 10, y: 12 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fontName: font,
        fontSize: 10,
        textData: { characters: 'A ' },
        derivedTextData: {
          layoutSize: { x: 10, y: 12 },
          glyphs: [
            { firstCharacter: 0, position: { x: 0, y: 10 }, fontSize: 14, commandsBlob: 0 },
            { firstCharacter: 1, position: { x: 14, y: 10 }, fontSize: 14, commandsBlob: 1 },
          ],
          fontMetaData: [{ key: font, fontDigest: new Uint8Array(20), fontWeight: 400 }],
        },
      },
    ],
    blobs: [{ bytes: glyphPath }, { bytes: Buffer.from([0]) }],
  };
  const chars = duplicate ? 'AA ' : 'A ';
  if (duplicate) {
    const text = message.nodeChanges[1]!;
    text.textData!.characters = chars;
    text.derivedTextData!.glyphs = [
      { firstCharacter: 0, position: { x: 0, y: 10 }, fontSize: 14, commandsBlob: 0 },
      { firstCharacter: 1, position: { x: 14, y: 10 }, fontSize: 14, commandsBlob: 0 },
      { firstCharacter: 2, position: { x: 28, y: 10 }, fontSize: 14, commandsBlob: 1 },
    ];
  }
  const chunks = [
      deflateRawSync(kiwi.encodeBinarySchema(codec)),
      deflateRawSync(kiwi.compileSchema(codec).encodeMessage(message)),
    ],
    header = Buffer.alloc(12);
  header.write('fig-kiwi');
  header.writeUInt32LE(106, 8);
  const bytes = Buffer.concat([
    header,
    ...chunks.flatMap(c => {
      const n = Buffer.alloc(4);
      n.writeUInt32LE(c.length);
      return [n, c];
    }),
  ]);
  const fingerprint = storedChecksum('capture'),
    scopeId = JSON.stringify({ requestedNodeId: null, pageId: '1:0', scopeNodeId: '1:0' });
  const request = {
    ownerId: 'owner',
    workspaceId: 'workspace',
    planId: 'plan',
    deadlineAt: Date.now() + 60000,
    primaryCapturedAt: '2000-01-01T00:00:01.000Z',
    capture: {
      designFingerprint: fingerprint,
      source: { scopeId, fileKeyHash: storedChecksum('file'), requestedNodeId: null },
    },
  } as PortalNativeContourRequest;
  const capsule = {
    version: 1 as const,
    ownerId: 'owner',
    workspaceId: 'workspace',
    planId: 'plan',
    pageId: '1:0',
    scopeId,
    fileKeyHash: request.capture.source.fileKeyHash,
    captureFingerprint: fingerprint,
    reobservedCaptureFingerprint: fingerprint,
    capturedAt: '2000-01-01T00:00:00.000Z',
    primaryCapturedAt: request.primaryCapturedAt,
    documentHash: storedChecksum(bytes),
    documentBytes: bytes,
  };
  const observation = {
    nodes: [
      {
        id: '1:1',
        parentId: null,
        childIds: [],
        properties: {
          type: 'TEXT',
          characters: chars,
          width: 10,
          height: 12,
          relativeTransform: matrix,
          absoluteTransform: matrix,
          textDecoration: 'NONE',
          fontSize: 10,
          fontName: font,
          fontWeight: 400,
          textSegments: [
            {
              start: 0,
              end: chars.length,
              characters: chars,
              fontName: font,
              fontWeight: 400,
              fontSize: 10,
            },
          ],
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokes: [],
          effects: [],
          opacity: 1,
        },
      },
    ],
  } as unknown as DesignObservation;
  return { request, capsule, observation };
}
it('materializes actual decoded path bytes and keeps empty-space placements distinct from painted expectations', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation),
    material = materializePreparedNativeContours(prepared);
  expect(prepared.records.get('1:1')!.paths).toHaveLength(1);
  expect(material.nodes[0]!.glyphs).toHaveLength(2);
  const glyph = material.nodes[0]!.glyphs[0]!,
    space = material.nodes[0]!.glyphs[1]!;
  expect(glyph.transform).toEqual([14, 0, 0, -14, 0, 10]);
  expect(space.transform).toEqual([14, 0, 0, -14, 14, 10]);
  expect(material.resources.find(r => r.resourceId === space.resourceId)!.d).toBe('');
  const path = material.resources.find(r => r.resourceId === glyph.resourceId)!;
  expect(path.d).toBe('M0 0 L1 0 L1 1 Z');
  expect(path.pathHash).toBe(storedChecksum(path.d));
  expect(path.commandsHash).toBe(storedChecksum(glyphPath));
  expect(material.nodes[0]).toMatchObject({
    characters: 'A ',
    nominalFontSize: 10,
    paintedFontSizes: [14],
    fonts: [{ family: 'Fixture', style: 'Regular', weight: 400, digest: '0'.repeat(40) }],
  });
  expect(Object.isFrozen(material.nodes[0]!.glyphs)).toBe(true);
});
it('rejects forged and JSON-cloned prepared objects without using metadata as authority', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation);
  expect(() => materializePreparedNativeContours({ ...prepared })).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
  expect(() => materializePreparedNativeContours(structuredClone(prepared))).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
});
it('rejects changed prepared expectations rather than attaching raw d to mutated source metadata', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation);
  prepared.records.get('1:1')!.paths[0]!.transform[0] = 99;
  expect(() => materializePreparedNativeContours(prepared)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
});
it('rejects rekeyed retained records even when their expectation values are unchanged', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation);
  const records = prepared.records as Map<
    string,
    NonNullable<ReturnType<typeof prepared.records.get>>
  >;
  const original = records.get('1:1')!;
  records.delete('1:1');
  records.set('1:2', original);
  expect(() => materializePreparedNativeContours(prepared)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
});
it('retires the private decoder issuance so neither material nor expected authority can be revived', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation);
  retirePreparedNativeContours(prepared);
  expect(() => materializePreparedNativeContours(prepared)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
  expect(() => requirePreparedNativeContours(prepared)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
});
it('deduplicates repeated actual commands without collapsing distinct glyph positions or empty spaces', () => {
  const f = fixture(true),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation),
    material = materializePreparedNativeContours(prepared),
    glyphs = material.nodes[0]!.glyphs;
  expect(material.resources).toHaveLength(2);
  expect(glyphs).toHaveLength(3);
  expect(glyphs[0]!.resourceId).toBe(glyphs[1]!.resourceId);
  expect(glyphs[0]!.transform).not.toEqual(glyphs[1]!.transform);
  expect(glyphs[2]!.resourceId).not.toBe(glyphs[0]!.resourceId);
});
it.each(['ownerId', 'workspaceId', 'planId', 'scopeId', 'documentHash'] as const)(
  'rejects a changed %s native source binding before material issuance',
  key => {
    const f = fixture();
    expect(() =>
      deriveNativeContours(f.request, { ...f.capsule, [key]: 'changed' }, f.observation),
    ).toThrow('PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN');
  },
);
