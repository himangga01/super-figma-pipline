import { z } from 'zod';

import { isBoundedDesignJson } from './design-observation.js';
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  id = z.string().min(1).max(512);
export const PortalConsumptionValueSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('color'),
      value: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('number'),
      value: z.number().finite(),
      unit: z.enum(['px', '', '%']),
    })
    .strict(),
  z.object({ kind: z.literal('text'), value: z.string().max(16384) }).strict(),
  z.object({ kind: z.literal('font'), value: z.string().min(1).max(512) }).strict(),
]);
export type ConsumptionValue = z.infer<typeof PortalConsumptionValueSchema>;
export const PortalConsumptionPropertySchema = z.enum([
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'opacity',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'font-size',
  'font-weight',
  'font-family',
  'font-style',
  'line-height',
  'letter-spacing',
  'gap',
  'row-gap',
  'column-gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'textContent',
]);
export const PortalConsumptionExpectationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('property'),
      property: PortalConsumptionPropertySchema,
      value: PortalConsumptionValueSchema,
      cssVariable: z
        .string()
        .regex(/^--[A-Za-z_][A-Za-z0-9_-]{0,127}$/u)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('asset'),
      usage: z.enum(['img', 'background-image']),
      hash,
      bytes: z.number().int().min(1).max(16777216),
    })
    .strict(),
  z.object({ kind: z.literal('component'), sourceNodeId: id }).strict(),
]);
export const PortalConsumptionCheckSchema = z
  .object({
    checkId: id,
    expectedHash: hash,
    resultId: id,
    resultHash: hash,
    rowId: id,
    rowHash: hash,
    rootNodeId: id,
    route: z.string().startsWith('/').max(2048),
    state: id,
    selector: z.string().min(1).max(2048),
    phase: z.enum(['source', 'after-actions']),
    expectation: PortalConsumptionExpectationSchema,
  })
  .strict();
export type PortalConsumptionCheck = z.infer<typeof PortalConsumptionCheckSchema>;
export const PortalConsumptionBatchSchema = z
  .object({
    version: z.literal(1),
    contextHash: hash,
    blueprintHash: hash,
    declarationsHash: hash,
    captureFingerprint: hash,
    candidateHash: hash,
    checks: z.array(PortalConsumptionCheckSchema).min(1).max(4096),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.checks.map(check => check.checkId)).size !== value.checks.length)
      ctx.addIssue({ code: 'custom', message: 'PORTAL_CONSUMPTION_DUPLICATE_CHECK' });
    if (!isBoundedDesignJson(value, 2097152, 250000))
      ctx.addIssue({ code: 'custom', message: 'PORTAL_CONSUMPTION_CAPACITY' });
  });
export type PortalConsumptionBatch = z.infer<typeof PortalConsumptionBatchSchema>;
export const PortalConsumptionActualSchema = z
  .object({
    kind: z.enum(['property', 'asset', 'component']),
    value: z.string().max(16384).nullable(),
    resourceHash: hash.nullable(),
    resourceBytes: z.number().int().min(0).max(16777216).nullable(),
    resourceUrl: z.string().max(4096).nullable(),
    fontAvailable: z.boolean().nullable(),
    sourceNodeId: id.nullable(),
    dependency: z
      .object({
        cssVariable: z.string().max(130),
        ancestorDepth: z.number().int().min(0).max(64),
        before: z.string().max(16384),
        variableBefore: z.string().max(16384),
        sentinel: z.string().max(1024),
        changed: z.string().max(16384),
        restored: z.literal(true),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PortalConsumptionActual = z.infer<typeof PortalConsumptionActualSchema>;
export const PortalConsumptionObservationSchema = z
  .object({
    checkId: id,
    expectedHash: hash,
    resultId: id,
    resultHash: hash,
    rowId: id,
    rowHash: hash,
    rootNodeId: id,
    route: z.string().max(2048),
    state: id,
    phase: z.enum(['source', 'after-actions']),
    actual: PortalConsumptionActualSchema.nullable(),
    actualHash: hash,
    passed: z.boolean(),
    reason: z.string().max(256).nullable(),
  })
  .strict();
export type PortalConsumptionObservation = z.infer<typeof PortalConsumptionObservationSchema>;
export const PortalConsumptionReportSchema = z
  .object({
    version: z.literal(1),
    batchHash: hash,
    observations: z.array(PortalConsumptionObservationSchema).max(4096),
  })
  .strict()
  .refine(
    (value): boolean => isBoundedDesignJson(value, 4194304, 300000),
    'PORTAL_CONSUMPTION_REPORT_CAPACITY',
  );
