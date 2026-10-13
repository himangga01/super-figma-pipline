import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';

import { storedChecksum } from '@sfp/ir';
import type { DesignObservation } from '@sfp/shared';
import { expect, it } from 'vitest';

import type { PortalCaptureDescriptor } from '../../../shared/src/portal-capture-source.js';
import { PortalConsumptionExpectationSchema } from '../../../shared/src/portal-consumption.js';
import type { PortalObservationManifest } from '../../../shared/src/portal-observations.js';
import { PortalRecipeUseSchema } from '../../../shared/src/portal-recipe-use.js';
import {
  deriveNativeContours,
  matchesNativeContours,
  nativeContourCaptureScope,
  normalizeNativeContourPath,
  requirePreparedNativeContours,
  type PortalNativeContourCapsule,
  type PortalNativeContourRequest,
} from '../../src/portal/native-contours.js';
import {
  compileCoreConsumption,
  type CoreConsumptionInput,
} from '../../src/portal/recipes/core-consumption.js';
import { coreHash } from '../../src/portal/recipes/core-source.js';

const kiwi = createRequire(new URL('../../../cli/package.json', import.meta.url))(
  'kiwi-schema',
) as {
  parseSchema(value: string): unknown;
  encodeBinarySchema(schema: unknown): Uint8Array;
  compileSchema(schema: unknown): { encodeMessage(value: unknown): Uint8Array };
};
// The constant test codec is compiled only in tests. Production interprets incoming schema as data.
const schema = kiwi.parseSchema(`
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
const id = (localID: number) => ({ sessionID: 1, localID });
const pathBytes = () => {
  const values = [
    { op: 0, values: [] },
    { op: 1, values: [0, 0] },
    { op: 2, values: [1, 0] },
    { op: 2, values: [1, 1] },
    { op: 0, values: [] },
  ];
  return Buffer.concat(
    values.map(x => {
      const b = Buffer.alloc(1 + x.values.length * 4);
      b[0] = x.op;
      x.values.forEach((v, n) => b.writeFloatLE(v, 1 + n * 4));
      return b;
    }),
  );
};
function fixture(commands: Uint8Array = pathBytes()) {
  const font = { family: 'Fixture', style: 'Regular' };
  const message = {
    nodeChanges: [
      { guid: id(0), type: 'CANVAS' },
      {
        guid: id(1),
        type: 'TEXT',
        parentIndex: { guid: id(0), position: '!' },
        size: { x: 10, y: 12 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fontName: font,
        fontSize: 10,
        textData: { characters: 'A' },
        derivedTextData: {
          layoutSize: { x: 10, y: 12 },
          glyphs: [{ firstCharacter: 0, position: { x: 0, y: 10 }, fontSize: 14, commandsBlob: 0 }],
          fontMetaData: [{ key: font, fontDigest: new Uint8Array(20), fontWeight: 400 }],
        },
      },
    ],
    blobs: [{ bytes: commands }],
  };
  const chunks = [
    deflateRawSync(kiwi.encodeBinarySchema(schema)),
    deflateRawSync(kiwi.compileSchema(schema).encodeMessage(message)),
  ];
  const header = Buffer.alloc(12);
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
  const request: PortalNativeContourRequest = {
    ownerId: 'owner',
    workspaceId: 'workspace',
    planId: 'plan',
    deadlineAt: Date.now() + 60000,
    primaryCapturedAt: '2000-01-01T00:00:01.000Z',
    capture: {
      designFingerprint: fingerprint,
      source: { scopeId, fileKeyHash: storedChecksum('file'), requestedNodeId: null },
    } as PortalCaptureDescriptor,
  };
  const capsule: PortalNativeContourCapsule = {
    version: 1,
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
          characters: 'A',
          width: 10,
          height: 12,
          fontSize: 10,
          opacity: 1,
          textDecoration: 'NONE',
          relativeTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
          absoluteTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ],
          fontName: font,
          textSegments: [
            { start: 0, end: 1, characters: 'A', fontName: font, fontWeight: 400, fontSize: 10 },
          ],
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
          strokes: [],
          effects: [],
        },
      },
    ],
  } as unknown as DesignObservation;
  return { request, capsule, observation };
}
it('derives expected contours from actual native encoded bytes and retains separate nominal and painted sizes', () => {
  const f = fixture(),
    prepared = deriveNativeContours(f.request, f.capsule, f.observation),
    e = prepared.records.get('1:1')!;
  expect(requirePreparedNativeContours(prepared)).toBe(prepared);
  expect(e.nominalFontSize).toBe(10);
  expect(e.paintedFontSizes).toEqual([14]);
  expect(e.paths[0]!.pathHash).toBe(storedChecksum('M0 0 L1 0 L1 1 Z'));
  expect(e.paths[0]!.commandsHash).toBe(storedChecksum(pathBytes()));
  expect(PortalConsumptionExpectationSchema.parse(e).kind).toBe('native-contour');
  expect(() => requirePreparedNativeContours({ ...prepared })).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
  );
});
it.each([
  'owner',
  'workspace',
  'plan',
  'file',
  'page',
  'scope',
  'capture',
  'reobserved',
  'bytes',
  'time',
  'primary',
  'deadline',
  'characters',
  'dimensions',
  'font',
  'hierarchy',
  'scale',
])('refuses unbound or changed source %s', kind => {
  const f = fixture();
  if (kind === 'owner') f.capsule.ownerId += 'x';
  if (kind === 'workspace') f.capsule.workspaceId += 'x';
  if (kind === 'plan') f.capsule.planId += 'x';
  if (kind === 'file') f.capsule.fileKeyHash = storedChecksum('other');
  if (kind === 'page') f.capsule.pageId = '1:9';
  if (kind === 'scope') f.capsule.scopeId += ' ';
  if (kind === 'capture') f.capsule.captureFingerprint = storedChecksum('other');
  if (kind === 'reobserved') f.capsule.reobservedCaptureFingerprint = storedChecksum('other');
  if (kind === 'bytes') f.capsule.documentHash = storedChecksum('other');
  if (kind === 'time') f.capsule.capturedAt = '2001-01-01T00:00:00Z';
  if (kind === 'primary') f.capsule.primaryCapturedAt = '2001-01-01T00:00:00Z';
  if (kind === 'deadline') f.request.deadlineAt = Date.now() - 1;
  const p = f.observation.nodes[0]!.properties;
  if (kind === 'characters') p.characters = 'B';
  if (kind === 'dimensions') p.width = 11;
  if (kind === 'font')
    (p.textSegments as Array<{ fontName: { family: string } }>)[0]!.fontName.family = 'Other';
  if (kind === 'hierarchy') f.observation.nodes[0]!.parentId = 'outside';
  if (kind === 'scale')
    p.absoluteTransform = [
      [2, 0, 0],
      [0, 1, 0],
    ];
  expect(() => deriveNativeContours(f.request, f.capsule, f.observation)).toThrow(
    /PORTAL_CONSUMPTION_NATIVE/u,
  );
});
it('normalizes native no-op closes only and rejects malformed command streams', () => {
  expect(normalizeNativeContourPath('Z Z M0 0 L1 1 Z')).toBe('M0 0 L1 1 Z');
  expect(normalizeNativeContourPath('Z Z')).toBe('');
  for (const path of ['L0 0', 'M0', 'M0 0 L1', 'M0 0 LNaN 1', 'm0 0', 'M0 0 1 1', 'M0 0 <script>'])
    expect(() => normalizeNativeContourPath(path)).toThrow(
      'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
    );
});
it('fails closed on malformed actual encoded native commands and ambiguous live font ranges', () => {
  for (const commands of [new Uint8Array([99]), new Uint8Array([1, 0])]) {
    const f = fixture(commands);
    expect(() => deriveNativeContours(f.request, f.capsule, f.observation)).toThrow(
      /FIGMA_NATIVE_PATH/u,
    );
  }
  const f = fixture();
  (f.observation.nodes[0]!.properties.textSegments as unknown[]).push({ start: 1, end: 2 });
  expect(() => deriveNativeContours(f.request, f.capsule, f.observation)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  );
});
it('accepts a top-level mixed sentinel only with one complete source-observed range matching the native font', () => {
  const f = fixture();
  f.observation.nodes[0]!.properties.fontName = 'mixed';
  expect(
    deriveNativeContours(f.request, f.capsule, f.observation).records.get('1:1')!.fonts[0]!.family,
  ).toBe('Fixture');
  f.observation.nodes[0]!.properties.fontName = 'unavailable';
  expect(() => deriveNativeContours(f.request, f.capsule, f.observation)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  );
});
it('accepts an exact subset scope and refuses unrelated captured nodes', () => {
  const f = fixture(),
    scopeId = JSON.stringify({ requestedNodeId: '1:1', pageId: '1:0', scopeNodeId: '1:1' });
  f.request.capture.source.scopeId = scopeId;
  f.request.capture.source.requestedNodeId = '1:1';
  f.capsule.scopeId = scopeId;
  expect(nativeContourCaptureScope(f.request.capture).pageId).toBe('1:0');
  expect(deriveNativeContours(f.request, f.capsule, f.observation).records.size).toBe(1);
  f.observation.nodes.push({ ...f.observation.nodes[0]!, id: 'outside' });
  expect(() => deriveNativeContours(f.request, f.capsule, f.observation)).toThrow(
    'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN',
  );
});
it('retains old recipe input shape and requires explicit source-contour opt-in', () => {
  expect(PortalRecipeUseSchema.parse({ version: 1 }).nativeContours).toBeUndefined();
  expect(() =>
    PortalRecipeUseSchema.parse({
      version: 1,
      nativeContours: [
        { nodeId: '1:1', representation: 'native-contour', documentHash: 'caller-proof' },
      ],
    }),
  ).toThrow(/Unrecognized key/u);
});
it('receipt comparison rejects forged geometry, paint, effects or accessible characters despite a caller success flag', () => {
  const f = fixture(),
    e = deriveNativeContours(f.request, f.capsule, f.observation).records.get('1:1')!;
  const actual = {
    nodeId: e.nodeId,
    accessibleText: e.characters,
    width: e.width,
    height: e.height,
    opacity: 1,
    filter: 'none',
    visible: true as const,
    paths: e.paths.map(p => ({
      pathHash: p.pathHash,
      transform: p.transform,
      fill: e.paint.fill,
      stroke: 'none',
      strokeWidth: 1,
      fillOpacity: 1,
      strokeOpacity: 1,
      paintOrder: 'stroke',
    })),
  };
  expect(matchesNativeContours(e, actual)).toBe(true);
  for (const kind of ['path', 'transform', 'fill', 'stroke', 'opacity', 'filter', 'text']) {
    const a = structuredClone(actual);
    if (kind === 'path') a.paths[0]!.pathHash = storedChecksum('fake');
    if (kind === 'transform') a.paths[0]!.transform[0] = 13;
    if (kind === 'fill') a.paths[0]!.fill = 'rgb(255, 0, 0)';
    if (kind === 'stroke') a.paths[0]!.stroke = 'rgb(0, 0, 0)';
    if (kind === 'opacity') a.opacity = 0.1;
    if (kind === 'filter') a.filter = 'blur(1px)';
    if (kind === 'text') a.accessibleText = 'B';
    expect(matchesNativeContours(e, a)).toBe(false);
  }
});
it('compiler blocks explicit contours without trusted source and replaces painted text CSS checks with independently derived geometry', () => {
  const f = fixture(),
    hash = storedChecksum('compiler'),
    node = f.observation.nodes[0]!;
  const input = {
    observation: f.observation,
    plan: {
      ownerId: 'owner',
      blueprintHash: hash,
      design: { capture: f.request.capture },
      coreRecipes: { contextHash: hash },
      profiles: [],
    },
    run: { candidateHash: hash, coreDeclarationsHash: hash },
    materialHash: hash,
    files: new Map(),
    pages: [
      {
        workItemId: 'work',
        resultId: 'result',
        resultHash: hash,
        pageHash: hash,
        files: [],
        assertionIds: [],
        page: {
          rows: [
            {
              kind: 'scope',
              id: 'row',
              nodeId: node.id,
              propertiesHash: coreHash(node.properties),
            },
          ],
        },
      },
    ],
  } as unknown as CoreConsumptionInput;
  const use = {
    version: 1,
    nativeContours: [{ nodeId: node.id, representation: 'native-contour' }],
  };
  const manifest = {
    screens: [{ rootNodeId: node.id, route: '/', state: 'source:' + node.id }],
    assets: [],
  } as unknown as PortalObservationManifest;
  const blocked = compileCoreConsumption(input, use, manifest);
  expect(
    blocked.use.prepared!.requirements.some(
      r => r.code === 'PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED',
    ),
  ).toBe(true);
  const compiled = compileCoreConsumption(
    { ...input, nativeContours: deriveNativeContours(f.request, f.capsule, f.observation) },
    use,
    manifest,
  );
  expect(compiled.use.prepared!.status).toBe('ready');
  expect(compiled.checks.filter(c => c.expectation.kind === 'native-contour')).toHaveLength(1);
  expect(
    compiled.checks.some(
      c =>
        c.expectation.kind === 'property' &&
        ['font-size', 'font-family', 'font-weight', 'textContent'].includes(c.expectation.property),
    ),
  ).toBe(false);
  const normal = compileCoreConsumption(input, { version: 1 }, manifest);
  expect(
    normal.use.prepared!.requirements.some(r => r.code.startsWith('PORTAL_CONSUMPTION_NATIVE')),
  ).toBe(false);
  expect(() =>
    compileCoreConsumption(
      input,
      { version: 1, nativeContours: [{ nodeId: 'outside', representation: 'native-contour' }] },
      manifest,
    ),
  ).toThrow('PORTAL_CONSUMPTION_BINDING_UNUSED');
});
