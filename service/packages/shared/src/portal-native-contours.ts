import { z } from 'zod';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const finite = z.number().finite();
const PortalNativeContourPathSchema = z
  .object({
    index: z.number().int().min(0).max(65535),
    commandsHash: hash,
    pathHash: hash,
    transform: z.tuple([finite, finite, finite, finite, finite, finite]),
    strokeWidth: finite.min(0).max(10000),
  })
  .strict();
const PortalNativeContourPaintSchema = z
  .object({
    fill: z.string().max(256),
    stroke: z.string().max(256),
    opacity: finite.min(0).max(1),
    filter: z.string().max(4096),
    paintOrder: z.literal('stroke fill'),
  })
  .strict();
/** A service-derived painted representation. Nominal API font CSS is separately retained. */
export const PortalNativeContourExpectationSchema = z
  .object({
    kind: z.literal('native-contour'),
    version: z.literal(1),
    nodeId: z.string().min(1).max(512),
    documentHash: hash,
    captureFingerprint: hash,
    fileKeyHash: hash,
    pageId: z.string().min(1).max(512),
    characters: z.string().min(1).max(16384),
    charactersHash: hash,
    width: finite.positive().max(100000),
    height: finite.positive().max(100000),
    nominalFontSize: finite.positive(),
    paintedFontSizes: z.array(finite.positive()).min(1).max(64),
    fonts: z
      .array(
        z
          .object({
            family: z.string().min(1).max(512),
            style: z.string().min(1).max(512),
            weight: finite,
            digest: z.string().regex(/^[a-f0-9]{40}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    paths: z.array(PortalNativeContourPathSchema).min(1).max(65536),
    paint: PortalNativeContourPaintSchema,
  })
  .strict();
export type PortalNativeContourExpectation = z.infer<typeof PortalNativeContourExpectationSchema>;
export const PortalNativeContourActualSchema = z
  .object({
    nodeId: z.string().min(1).max(512),
    accessibleText: z.string().min(1).max(16384),
    width: finite.positive().max(100000),
    height: finite.positive().max(100000),
    paths: z
      .array(
        z
          .object({
            pathHash: hash,
            transform: z.tuple([finite, finite, finite, finite, finite, finite]),
            fill: z.string().max(256),
            stroke: z.string().max(256),
            strokeWidth: finite.min(0).max(10000),
            fillOpacity: finite.min(0).max(1),
            strokeOpacity: finite.min(0).max(1),
            paintOrder: z.string().max(64),
          })
          .strict(),
      )
      .min(1)
      .max(65536),
    opacity: finite.min(0).max(1),
    filter: z.string().max(4096),
    visible: z.literal(true),
  })
  .strict();
export type PortalNativeContourActual = z.infer<typeof PortalNativeContourActualSchema>;
