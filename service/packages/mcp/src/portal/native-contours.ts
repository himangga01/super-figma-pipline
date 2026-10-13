import { contentHash, storedChecksum } from '@sfp/ir';
import type { DesignObservation } from '@sfp/shared';
import { z } from 'zod';

import { decodeFigmaNativeDocument } from '../../../cli/src/figma-native-document.js';
import { decodeNativePath } from '../../../cli/src/figma-native-geometry.js';
import { normalizeFigmaNativeNodes } from '../../../cli/src/figma-native-nodes.js';
import type { PortalCaptureDescriptor } from '../../../shared/src/portal-capture-source.js';
import {
  PortalNativeContourExpectationSchema,
  type PortalNativeContourExpectation,
  type PortalNativeContourActual,
} from '../../../shared/src/portal-native-contours.js';
import {
  PortalNativeGeometryResourceSchema,
  PortalNativeGeometryNodeSchema,
  type PortalNativeGeometryResource,
  type PortalNativeGeometryNode,
  type PortalNativeGeometryGlyph,
} from '../../../shared/src/portal-native-geometry.js';
import { portalError } from './store.js';

export interface PortalNativeContourRequest {
  ownerId: string;
  workspaceId: string;
  planId: string;
  capture: PortalCaptureDescriptor;
  primaryCapturedAt: string;
  deadlineAt: number;
}
/** Supplied exclusively by the registered service capture boundary, never a public JSON argument. */
export interface PortalNativeContourCapsule {
  version: 1;
  ownerId: string;
  workspaceId: string;
  planId: string;
  fileKeyHash: string;
  pageId: string;
  scopeId: string;
  captureFingerprint: string;
  reobservedCaptureFingerprint: string;
  capturedAt: string;
  primaryCapturedAt: string;
  documentHash: string;
  documentBytes: Uint8Array;
}
export interface PortalNativeContourAcquisitionPort {
  /** Lookup only. Export/reobservation happens in the previously admitted coherent capture. */
  read(
    request: PortalNativeContourRequest,
    signal: AbortSignal,
  ): Promise<PortalNativeContourCapsule>;
}
type Row = Record<string, unknown>;
const row = (v: unknown): Row =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
const list = (v: unknown): Row[] => (Array.isArray(v) ? v.map(row) : []);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const near = (a: unknown, b: unknown) =>
  finite(a) && finite(b) && Math.abs(a - b) <= Math.max(0.0001, Math.abs(b) * 1e-7);
function reject(code = 'PORTAL_CONSUMPTION_NATIVE_SOURCE_UNPROVEN'): never {
  throw portalError(code);
}
const scopeSchema = z
  .object({
    requestedNodeId: z.string().min(1).max(512).nullable(),
    pageId: z.string().regex(/^\d+:\d+$/u),
    scopeNodeId: z.string().min(1).max(512),
  })
  .strict();
export function nativeContourCaptureScope(capture: {
  source: Pick<PortalCaptureDescriptor['source'], 'scopeId' | 'requestedNodeId'>;
}) {
  let value: unknown;
  try {
    value = JSON.parse(capture.source.scopeId);
  } catch {
    return reject();
  }
  const parsed = scopeSchema.safeParse(value);
  if (!parsed.success) return reject();
  const scope = parsed.data;
  if (
    scope.requestedNodeId !== capture.source.requestedNodeId ||
    scope.scopeNodeId !== (scope.requestedNodeId ?? scope.pageId)
  )
    reject();
  return scope;
}
const identity = (v: unknown) =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every(r => Array.isArray(r) && r.length === 3 && r.every(finite)) &&
  near(v[0][0], 1) &&
  near(v[0][1], 0) &&
  near(v[1][0], 0) &&
  near(v[1][1], 1);
/** Empty leading native closes are no-ops; coordinates and interior contours remain unchanged. */
export function normalizeNativeContourPath(value: string): string {
  if (typeof value !== 'string' || value.length > 1_048_576) reject();
  const pattern = /[MLQCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu;
  const tokens = [...value.matchAll(pattern)];
  if (value.replace(pattern, '').replace(/\s/gu, '') !== '') reject();
  const count: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  let at = 0,
    first = -1;
  while (at < tokens.length) {
    const command = tokens[at++]!;
    if (!Object.hasOwn(count, command[0])) reject();
    if (first < 0) {
      if (command[0] === 'Z') continue;
      if (command[0] !== 'M') reject();
      first = command.index;
    }
    for (let n = 0; n < count[command[0]]!; n++) {
      const token = tokens[at++];
      if (!token || Object.hasOwn(count, token[0]) || !Number.isFinite(Number(token[0]))) reject();
    }
  }
  return first < 0 ? '' : value.slice(first).trim();
}
const color = (v: unknown, opacity: unknown = 1) => {
  const c = row(v);
  if (
    !['r', 'g', 'b'].every(k => finite(c[k]) && Number(c[k]) >= 0 && Number(c[k]) <= 1) ||
    !finite(opacity) ||
    opacity < 0 ||
    opacity > 1
  )
    reject();
  const alpha = (finite(c.a) ? c.a : 1) * opacity;
  if (alpha < 0 || alpha > 1) reject();
  const rgb = ['r', 'g', 'b'].map(k => Math.round(Number(c[k]) * 255)).join(', ');
  return alpha === 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Number(alpha.toFixed(3))})`;
};
const solid = (v: unknown) => {
  const paints = list(v).filter(p => p.visible !== false);
  if (paints.length !== 1 || paints[0]!.type !== 'SOLID') reject();
  return color(paints[0]!.color, paints[0]!.opacity ?? 1);
};
const trusted = new WeakSet<object>();
interface PreparedNativeContourMaterial {
  readonly resources: PortalNativeGeometryResource[];
  readonly nodes: PortalNativeGeometryNode[];
}
const materials = new WeakMap<
  object,
  { proofHash: string; value: PreparedNativeContourMaterial }
>();
const preparedProof = (value: PreparedNativeContours) =>
  contentHash('sfp-native-contour-material-proof-v1', {
    documentHash: value.documentHash,
    captureFingerprint: value.captureFingerprint,
    records: [...value.records.entries()],
  });
const freezeMaterial = (value: unknown): void => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeMaterial(child);
    Object.freeze(value);
  }
};
export interface PreparedNativeContours {
  readonly documentHash: string;
  readonly captureFingerprint: string;
  readonly records: ReadonlyMap<string, PortalNativeContourExpectation>;
}
export function requirePreparedNativeContours(
  value: PreparedNativeContours | undefined,
): PreparedNativeContours {
  if (!value || !trusted.has(value)) reject('PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED');
  return value;
}
/**
 * Internal read of the same independently validated decoder issuance; never a JSON authority
 * setter.
 */
export function materializePreparedNativeContours(
  value: PreparedNativeContours,
): PreparedNativeContourMaterial {
  requirePreparedNativeContours(value);
  const held = materials.get(value);
  if (!held || held.proofHash !== preparedProof(value))
    reject('PORTAL_CONSUMPTION_NATIVE_AUTHORITY_REQUIRED');
  if (Buffer.byteLength(JSON.stringify(held.value)) > 25165824)
    reject('PORTAL_CONSUMPTION_NATIVE_CAPACITY');
  return held.value;
}
/** Retire an ephemeral read issuance after paging, including failed/cancelled publication. */
export function retirePreparedNativeContours(value: PreparedNativeContours): void {
  materials.delete(value);
  trusted.delete(value);
}
/** Hash and decode the independently acquired native bytes, then join to the retained live capture. */
export function deriveNativeContours(
  request: PortalNativeContourRequest,
  capsule: PortalNativeContourCapsule,
  observation: DesignObservation,
  now = Date.now(),
): PreparedNativeContours {
  if (now >= request.deadlineAt || !Number.isFinite(request.deadlineAt))
    reject('PORTAL_CONSUMPTION_NATIVE_DEADLINE');
  const capture = request.capture;
  const scope = nativeContourCaptureScope(capture);
  if (
    capsule.version !== 1 ||
    capsule.ownerId !== request.ownerId ||
    capsule.workspaceId !== request.workspaceId ||
    capsule.planId !== request.planId ||
    capsule.fileKeyHash !== capture.source.fileKeyHash ||
    capsule.pageId !== scope.pageId ||
    capsule.scopeId !== capture.source.scopeId ||
    capsule.captureFingerprint !== capture.designFingerprint ||
    capsule.reobservedCaptureFingerprint !== capture.designFingerprint ||
    capsule.primaryCapturedAt !== request.primaryCapturedAt ||
    !Number.isFinite(Date.parse(request.primaryCapturedAt)) ||
    Date.parse(request.primaryCapturedAt) > now ||
    !Number.isFinite(Date.parse(capsule.capturedAt)) ||
    Date.parse(capsule.capturedAt) > Date.parse(request.primaryCapturedAt) ||
    !(capsule.documentBytes instanceof Uint8Array) ||
    capsule.documentBytes.byteLength > 134_217_728 ||
    storedChecksum(capsule.documentBytes) !== capsule.documentHash
  )
    reject();
  const decoded = decodeFigmaNativeDocument(Buffer.from(capsule.documentBytes));
  const effective = new Map<string, { effective: Readonly<Row>; normalized: Readonly<Row> }>();
  const native = normalizeFigmaNativeNodes(decoded.message, capsule.pageId, entry => {
    if (effective.has(entry.nodeId) || effective.size >= 20000) reject();
    effective.set(entry.nodeId, entry);
  });
  let flat = new Map<string, { parentId: string | null; node: Row }>();
  const visit = (n: Row, parentId: string | null) => {
    if (typeof n.id !== 'string' || flat.has(n.id)) reject();
    flat.set(n.id, { parentId, node: n });
    for (const c of list(n.children)) visit(c, n.id);
  };
  for (const n of native.nodes) visit(n, null);
  if (scope.scopeNodeId !== scope.pageId) {
    const scoped = flat.get(scope.scopeNodeId);
    if (!scoped) reject();
    flat = new Map();
    visit(scoped.node, null);
  }
  const api = new Map(observation.nodes.map(n => [n.id, n]));
  if (
    flat.size !== api.size ||
    [...api].some(
      ([id, n]) =>
        !flat.has(id) ||
        flat.get(id)!.parentId !== n.parentId ||
        JSON.stringify(list(flat.get(id)!.node.children).map(c => c.id)) !==
          JSON.stringify(n.childIds),
    )
  )
    reject();
  const records = new Map<string, PortalNativeContourExpectation>();
  const resourceRows = new Map<string, PortalNativeGeometryResource>();
  const materialNodes: PortalNativeGeometryNode[] = [];
  let totalGlyphs = 0,
    totalPathBytes = 0,
    totalExpectedBytes = 0;
  for (const [id, entry] of effective) {
    if (!flat.has(id)) continue;
    const n = api.get(id);
    if (!n) reject();
    const p = n.properties,
      data = row(entry.effective.derivedTextData ?? entry.effective.textData);
    if (
      typeof p.characters !== 'string' ||
      p.characters !== entry.normalized.characters ||
      p.textDecoration !== 'NONE' ||
      !near(row(data.layoutSize).x, p.width) ||
      !near(row(data.layoutSize).y, p.height) ||
      !near(entry.normalized.width, p.width) ||
      !near(entry.normalized.height, p.height)
    )
      reject();
    const characters = p.characters;
    let ancestor: typeof n | undefined = n;
    const seen = new Set<string>();
    while (ancestor) {
      if (
        seen.has(ancestor.id) ||
        seen.size > 128 ||
        !identity(ancestor.properties.relativeTransform) ||
        !identity(ancestor.properties.absoluteTransform)
      )
        reject();
      seen.add(ancestor.id);
      ancestor = ancestor.parentId ? api.get(ancestor.parentId) : undefined;
    }
    const segments = list(p.textSegments),
      fonts = list(data.fontMetaData);
    if (
      segments.length !== 1 ||
      segments[0]!.start !== 0 ||
      segments[0]!.end !== characters.length ||
      segments[0]!.characters !== characters ||
      fonts.length !== 1
    )
      reject();
    const font = fonts[0]!,
      key = row(font.key),
      segment = segments[0]!,
      digest = font.fontDigest;
    if (
      !near(segment.fontSize, p.fontSize) ||
      (p.fontName !== 'mixed' &&
        (row(p.fontName).family !== row(segment.fontName).family ||
          row(p.fontName).style !== row(segment.fontName).style)) ||
      (p.fontWeight !== undefined && p.fontWeight !== segment.fontWeight)
    )
      reject();
    if (
      !(digest instanceof Uint8Array) ||
      digest.length !== 20 ||
      key.family !== row(segment.fontName).family ||
      key.style !== row(segment.fontName).style ||
      font.fontWeight !== segment.fontWeight
    )
      reject();
    const strokes = list(p.strokes).filter(s => s.visible !== false),
      stroke = strokes.length ? solid(strokes) : 'none';
    if (
      strokes.length &&
      (!finite(p.strokeWeight) ||
        p.strokeAlign !== 'OUTSIDE' ||
        (p.strokeJoin !== undefined && p.strokeJoin !== 'MITER') ||
        (p.strokeCap !== undefined && p.strokeCap !== 'NONE') ||
        (Array.isArray(p.dashPattern) && p.dashPattern.length))
    )
      reject();
    const effects = list(p.effects)
      .filter(e => e.visible !== false)
      .map(e => {
        const offset = row(e.offset);
        if (
          e.type !== 'DROP_SHADOW' ||
          !finite(e.radius) ||
          e.radius < 0 ||
          !finite(offset.x) ||
          !finite(offset.y) ||
          (e.spread !== undefined && e.spread !== 0)
        )
          reject();
        return `drop-shadow(${color(e.color)} ${offset.x}px ${offset.y}px ${e.radius / 2}px)`;
      });
    const sizes = new Set<number>(),
      indices = new Set<number>();
    if (
      !Array.isArray(data.glyphs) ||
      data.glyphs.length > 65536 ||
      (totalGlyphs += data.glyphs.length) > 65536
    )
      reject('PORTAL_CONSUMPTION_NATIVE_CAPACITY');
    const materialGlyphs: PortalNativeGeometryGlyph[] = [];
    const materialFonts = [
      {
        family: key.family,
        style: key.style,
        weight: font.fontWeight,
        digest: Buffer.from(digest).toString('hex'),
      },
    ];
    const paths = list(data.glyphs).flatMap(g => {
      const position = row(g.position),
        blob = g.commandsBlob,
        index = g.firstCharacter,
        size = g.fontSize;
      if (
        !Number.isInteger(blob) ||
        Number(blob) < 0 ||
        !Number.isInteger(index) ||
        Number(index) < 0 ||
        Number(index) >= characters.length ||
        indices.has(Number(index)) ||
        !finite(position.x) ||
        !finite(position.y) ||
        !finite(size) ||
        size <= 0 ||
        size > 10000 ||
        (g.rotation !== undefined && g.rotation !== 0)
      )
        reject();
      indices.add(Number(index));
      sizes.add(size);
      const bytes = decoded.message.blobs;
      const command = Array.isArray(bytes) ? row(bytes[Number(blob)]).bytes : undefined;
      if (!(command instanceof Uint8Array) || command.length > 1_048_576) reject();
      const raw = decodeNativePath(command);
      if (!raw) reject();
      const d = normalizeNativeContourPath(raw);
      if ((totalPathBytes += Buffer.byteLength(d)) > 16_777_216)
        reject('PORTAL_CONSUMPTION_NATIVE_CAPACITY');
      const geometry = PortalNativeGeometryResourceSchema.parse({
        resourceId: contentHash('sfp-native-geometry-resource-v1', {
          commandsHash: storedChecksum(command),
          rawPathHash: storedChecksum(raw),
          pathHash: storedChecksum(d),
          fonts: materialFonts,
        }),
        commandsHash: storedChecksum(command),
        rawPathHash: storedChecksum(raw),
        pathHash: storedChecksum(d),
        d,
        fonts: materialFonts,
      });
      resourceRows.set(geometry.resourceId, geometry);
      materialGlyphs.push({
        index: Number(index),
        commandsBlob: Number(blob),
        resourceId: geometry.resourceId,
        transform: [size, 0, 0, -size, position.x, position.y],
        strokeWidth: strokes.length ? (2 * Number(p.strokeWeight)) / size : 0,
        ...(g.rotation === 0 ? { rotation: 0 } : {}),
      });
      return d
        ? [
            {
              index: Number(index),
              commandsHash: storedChecksum(command),
              pathHash: storedChecksum(d),
              transform: [size, 0, 0, -size, position.x, position.y] as [
                number,
                number,
                number,
                number,
                number,
                number,
              ],
              strokeWidth: strokes.length ? (2 * Number(p.strokeWeight)) / size : 0,
            },
          ]
        : [];
    });
    const expected = PortalNativeContourExpectationSchema.parse({
      kind: 'native-contour',
      version: 1,
      nodeId: id,
      documentHash: capsule.documentHash,
      captureFingerprint: capture.designFingerprint,
      fileKeyHash: capsule.fileKeyHash,
      pageId: capsule.pageId,
      characters: p.characters,
      charactersHash: storedChecksum(p.characters),
      width: p.width,
      height: p.height,
      nominalFontSize: p.fontSize,
      paintedFontSizes: [...sizes],
      fonts: [
        {
          family: key.family,
          style: key.style,
          weight: font.fontWeight,
          digest: Buffer.from(digest).toString('hex'),
        },
      ],
      paths,
      paint: {
        fill: solid(p.fills),
        stroke,
        opacity: p.opacity ?? 1,
        filter: effects.join(' ') || 'none',
        paintOrder: 'stroke fill',
      },
    });
    if ((totalExpectedBytes += Buffer.byteLength(JSON.stringify(expected))) > 2_097_152)
      reject('PORTAL_CONSUMPTION_NATIVE_CAPACITY');
    records.set(id, expected);
    materialNodes.push(
      PortalNativeGeometryNodeSchema.parse({
        nodeId: expected.nodeId,
        characters: expected.characters,
        charactersHash: expected.charactersHash,
        width: expected.width,
        height: expected.height,
        layoutSize: { x: row(data.layoutSize).x, y: row(data.layoutSize).y },
        nominalFontSize: expected.nominalFontSize,
        paintedFontSizes: expected.paintedFontSizes,
        fonts: expected.fonts,
        paint: expected.paint,
        glyphs: materialGlyphs,
      }),
    );
  }
  if (records.size !== [...api.values()].filter(n => n.properties.type === 'TEXT').length) reject();
  const prepared = Object.freeze({
    documentHash: capsule.documentHash,
    captureFingerprint: capture.designFingerprint,
    records,
  });
  trusted.add(prepared);
  const material = {
    resources: [...resourceRows.values()].toSorted((a, b) =>
      a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0,
    ),
    nodes: materialNodes.toSorted((a, b) =>
      a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
    ),
  };
  freezeMaterial(material);
  materials.set(prepared, { proofHash: preparedProof(prepared), value: material });
  return prepared;
}
/** Receipt verification repeats the comparison instead of trusting a worker's passed flag. */
export function matchesNativeContours(
  expected: PortalNativeContourExpectation,
  actual: PortalNativeContourActual,
): boolean {
  return (
    actual.visible &&
    actual.nodeId === expected.nodeId &&
    actual.accessibleText === expected.characters &&
    near(actual.width, expected.width) &&
    near(actual.height, expected.height) &&
    near(actual.opacity, expected.paint.opacity) &&
    actual.filter === expected.paint.filter &&
    actual.paths.length === expected.paths.length &&
    actual.paths.every((p, i) => {
      const e = expected.paths[i]!;
      return (
        p.pathHash === e.pathHash &&
        p.transform.every((v, n) => near(v, e.transform[n])) &&
        p.fill === expected.paint.fill &&
        p.stroke === expected.paint.stroke &&
        (expected.paint.stroke === 'none' ||
          (near(p.strokeWidth, e.strokeWidth) &&
            ['stroke', 'stroke fill'].includes(p.paintOrder))) &&
        p.fillOpacity === 1 &&
        p.strokeOpacity === 1
      );
    })
  );
}
