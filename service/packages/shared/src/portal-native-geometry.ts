import { z } from 'zod';

import { PortalNativeContourExpectationSchema } from './portal-native-contours.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().min(1).max(512);
const finite = z.number().finite();
const offset = z.number().int().min(0).max(65536);
export const PORTAL_NATIVE_GEOMETRY_PAGE_BYTES = 262144;
export const PortalNativeGeometryRequestSchema = z
  .object({
    section: z.enum(['resources', 'nodes']),
    offset: offset.default(0),
    limit: z.number().int().min(1).max(64).default(32),
    bindingHash: hash.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.offset > 0 && !value.bindingHash)
      ctx.addIssue({ code: 'custom', message: 'PORTAL_NATIVE_GEOMETRY_BINDING_REQUIRED' });
  });
export type PortalNativeGeometryRequest = z.infer<typeof PortalNativeGeometryRequestSchema>;
export const PortalNativeGeometryResourceSchema = z
  .object({
    resourceId: hash,
    commandsHash: hash,
    rawPathHash: hash,
    pathHash: hash,
    d: z.string().max(1048576),
    fonts: PortalNativeContourExpectationSchema.shape.fonts,
  })
  .strict();
const PortalNativeGeometryGlyphSchema = z
  .object({
    index: z.number().int().min(0).max(65535),
    commandsBlob: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    resourceId: hash,
    transform: z.tuple([finite, finite, finite, finite, finite, finite]),
    strokeWidth: finite.min(0).max(10000),
    rotation: z.literal(0).optional(),
  })
  .strict();
export const PortalNativeGeometryNodeSchema = z
  .object({
    nodeId: id,
    characters: PortalNativeContourExpectationSchema.shape.characters,
    charactersHash: hash,
    width: PortalNativeContourExpectationSchema.shape.width,
    height: PortalNativeContourExpectationSchema.shape.height,
    layoutSize: z.object({ x: finite.positive(), y: finite.positive() }).strict(),
    nominalFontSize: PortalNativeContourExpectationSchema.shape.nominalFontSize,
    paintedFontSizes: PortalNativeContourExpectationSchema.shape.paintedFontSizes,
    fonts: PortalNativeContourExpectationSchema.shape.fonts,
    paint: PortalNativeContourExpectationSchema.shape.paint,
    glyphs: z.array(PortalNativeGeometryGlyphSchema).min(1).max(65536),
  })
  .strict();
const PortalNativeGeometryBindingSchema = z
  .object({
    ownerId: id,
    workspaceId: z.string().uuid(),
    runId: z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u),
    planId: z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u),
    contextHash: hash,
    blueprintHash: hash,
    fileKeyHash: hash,
    scopeId: z.string().min(1).max(2048),
    pageId: z.string().regex(/^\d+:\d+$/u),
    captureFingerprint: hash,
    captureRawHash: hash,
    captureDescriptorHash: hash,
    captureRecordHash: hash,
    documentHash: hash,
    capturedAt: z.iso.datetime(),
    primaryCapturedAt: z.iso.datetime(),
    deadlineAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    materializationHash: hash,
    bindingHash: hash,
  })
  .strict();
export const PortalNativeGeometryPageSchema = z
  .object({
    version: z.literal(1),
    supplemental: z.literal(true),
    fullCapture: z.literal(false),
    atomic: z.literal(false),
    coherenceLimit: z.literal('ordered-read-ABA-and-post-read-changes-unobservable'),
    binding: PortalNativeGeometryBindingSchema,
    section: z.enum(['resources', 'nodes']),
    offset,
    total: offset,
    nextOffset: offset.nullable(),
    totalResources: offset,
    totalNodes: z.number().int().min(0).max(20000),
    totalGlyphs: offset,
    resources: z.array(PortalNativeGeometryResourceSchema).max(64),
    nodes: z.array(PortalNativeGeometryNodeSchema).max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rows = value.section === 'resources' ? value.resources : value.nodes;
    const total = value.section === 'resources' ? value.totalResources : value.totalNodes;
    if (
      value.total !== total ||
      value.offset > total ||
      value.offset + rows.length > total ||
      (value.section === 'resources' ? value.nodes.length : value.resources.length) !== 0 ||
      (rows.length === 0 && value.offset < total) ||
      value.nextOffset !== (value.offset + rows.length < total ? value.offset + rows.length : null)
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_NATIVE_GEOMETRY_PAGE_INVALID' });
    if (
      new Set(value.resources.map(r => r.resourceId)).size !== value.resources.length ||
      new Set(value.nodes.map(n => n.nodeId)).size !== value.nodes.length
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_NATIVE_GEOMETRY_PAGE_DUPLICATE' });
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength > PORTAL_NATIVE_GEOMETRY_PAGE_BYTES
    )
      ctx.addIssue({ code: 'custom', message: 'PORTAL_NATIVE_GEOMETRY_PAGE_LIMIT' });
  });
export type PortalNativeGeometryResource = z.infer<typeof PortalNativeGeometryResourceSchema>;
export type PortalNativeGeometryGlyph = z.infer<typeof PortalNativeGeometryGlyphSchema>;
export type PortalNativeGeometryNode = z.infer<typeof PortalNativeGeometryNodeSchema>;
export type PortalNativeGeometryPage = z.infer<typeof PortalNativeGeometryPageSchema>;
