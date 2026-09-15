import {
  canonicalFileIdentityHash,
  FileIdentitySchema,
  GetDesignContextResultSchema,
} from '@sfp/shared';
import { z } from 'zod';

import { contentHash } from './canonical-json.js';
import { SnapshotFidelitySchema } from './fidelity.js';

export const Sha256WireSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const SnapshotIdSchema = z.string().regex(/^sfp_snap1_[A-Za-z0-9_-]{21}[AQgw]$/u);
export const RepoRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    value =>
      !value.startsWith('/') &&
      // eslint-disable-next-line no-control-regex -- reject or escape unsafe control characters
      !/[\\:\u0000-\u001f]/u.test(value) &&
      value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
  );
export const SnapshotLocatorSchema = z
  .object({
    workspaceId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
    fileIdentityHash: Sha256WireSchema,
    snapshotId: SnapshotIdSchema,
  })
  .strict();
export type SnapshotLocator = z.infer<typeof SnapshotLocatorSchema>;

const SnapshotShape = z
  .object({
    schemaVersion: z.literal(1),
    locator: SnapshotLocatorSchema,
    connector: z
      .object({
        protocolVersion: z.string().min(1).max(128),
        productVersion: z.string().min(1).max(128),
        sessionId: z.string().min(1).max(256),
        pluginGeneration: z.string().min(1).max(256),
        fileIdentity: FileIdentitySchema,
        fileName: z.string().max(1024),
        editorType: z.string().min(1).max(64),
      })
      .strict(),
    target: z.object({ nodeIds: z.array(z.string().min(1).max(512)).min(1).max(256) }).strict(),
    observed: GetDesignContextResultSchema,
    fidelity: SnapshotFidelitySchema,
    capturedAt: z.iso.datetime({ offset: true }),
    contentHash: Sha256WireSchema,
    extensions: z.record(z.string().max(128), z.unknown()),
  })
  .strict();
type SnapshotShape = z.infer<typeof SnapshotShape>;
export const hashSnapshot = (
  snapshot: Pick<SnapshotShape, 'connector' | 'target' | 'observed' | 'fidelity'>,
): `sha256:${string}` =>
  contentHash('sfp-snapshot-content-v1', {
    fileIdentity: snapshot.connector.fileIdentity,
    target: snapshot.target,
    observed: snapshot.observed,
    fidelity: snapshot.fidelity,
  });
export const SnapshotV1Schema = SnapshotShape.superRefine((snapshot, ctx) => {
  if (snapshot.connector.fileIdentity.kind === 'unstable-readonly')
    ctx.addIssue({ code: 'custom', message: 'stable snapshot identity required' });
  if (
    canonicalFileIdentityHash(snapshot.connector.fileIdentity) !== snapshot.locator.fileIdentityHash
  )
    ctx.addIssue({ code: 'custom', path: ['locator'], message: 'snapshot identity mismatch' });
  if (new Set(snapshot.target.nodeIds).size !== snapshot.target.nodeIds.length)
    ctx.addIssue({ code: 'custom', path: ['target'], message: 'duplicate target IDs' });
  if (hashSnapshot(snapshot) !== snapshot.contentHash)
    ctx.addIssue({
      code: 'custom',
      path: ['contentHash'],
      message: 'snapshot content hash mismatch',
    });
});
export type SnapshotV1 = z.infer<typeof SnapshotV1Schema>;
export const SnapshotCaptureArgsSchema = z
  .object({
    nodeIds: z
      .array(z.string().trim().min(1).max(512))
      .min(1)
      .max(256)
      .refine(ids => new Set(ids).size === ids.length, 'duplicate node IDs'),
  })
  .strict();

export const snapshotRelativePath = (input: unknown, graph = false): string => {
  const locator = SnapshotLocatorSchema.parse(input);
  return `.sfp/${graph ? 'grounding-graphs' : 'snapshots'}/v1/${locator.fileIdentityHash.slice(7)}/${locator.snapshotId}.json`;
};
