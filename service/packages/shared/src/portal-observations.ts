import { z } from 'zod';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const id = z.string().min(1).max(512);
const viewport = z
  .object({
    width: z.number().int().min(100).max(4096),
    height: z.number().int().min(100).max(4096),
  })
  .strict();
export const PortalRequiredInteractionSchema = z
  .object({
    id: hash,
    sourceNodeId: id,
    rootNodeId: id,
    destinationNodeId: id.nullable(),
    sourceHash: hash,
    trigger: z.enum(['click', 'hover', 'key', 'delay', 'unsupported']),
    key: z.string().max(128).nullable(),
    delayMs: z.number().min(0).max(300000).nullable(),
    action: z.enum([
      'navigate',
      'overlay',
      'swap',
      'change-state',
      'back',
      'close',
      'scroll',
      'unsupported',
    ]),
    temporal: z
      .object({
        durationMs: z.number().min(0).max(300000),
        type: id,
        easing: z.string().nullable(),
        direction: z.enum(['LEFT', 'RIGHT', 'TOP', 'BOTTOM']).nullable(),
      })
      .strict()
      .nullable(),
    required: z.literal(true),
    status: z.enum(['supported', 'blocked']),
    reason: z.string().max(512).nullable(),
    requirementIds: z.array(id).max(128),
  })
  .strict();
export type PortalRequiredInteraction = z.infer<typeof PortalRequiredInteractionSchema>;
export const PortalInteractionContractSchema = z
  .object({
    version: z.literal(1),
    captureFingerprint: hash,
    scopeHash: hash,
    interactions: z.array(PortalRequiredInteractionSchema).max(4096),
    workflows: z
      .array(
        z.object({ id, nodeIds: z.array(id).max(10000), rootIds: z.array(id).max(256) }).strict(),
      )
      .max(128),
    workflowIds: z.array(id).max(128),
    complete: z.boolean(),
    issues: z.array(z.string().max(512)).max(512),
  })
  .strict();
export type PortalInteractionContract = z.infer<typeof PortalInteractionContractSchema>;
export const PortalObservationIdentitySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    captureFingerprint: hash,
    scopeHash: hash,
    rootNodeId: id,
    route: z.string().startsWith('/').max(2048),
    state: id,
    viewport,
    deviceScaleFactor: z.literal(1),
    assertionIds: z.array(hash).max(4096),
    oracleHash: hash,
  })
  .strict();
export type PortalObservationIdentity = z.infer<typeof PortalObservationIdentitySchema>;
export const PortalObservationManifestSchema = z
  .object({
    version: z.literal(1),
    captureFingerprint: hash,
    scopeHash: hash,
    interactionContractHash: hash,
    screens: z.array(PortalObservationIdentitySchema).min(1).max(256),
    assets: z
      .array(
        z
          .object({ rootNodeId: id, oracleHash: hash, actualPath: z.string().min(1).max(2048) })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.screens.map(s => s.id)).size !== value.screens.length ||
      new Set(value.screens.map(s => s.rootNodeId)).size !== value.screens.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate observation identity or source root' });
    for (const screen of value.screens)
      if (
        screen.captureFingerprint !== value.captureFingerprint ||
        screen.scopeHash !== value.scopeHash ||
        new Set(screen.assertionIds).size !== screen.assertionIds.length
      )
        ctx.addIssue({ code: 'custom', message: 'Observation binding mismatch' });
  });
export type PortalObservationManifest = z.infer<typeof PortalObservationManifestSchema>;
