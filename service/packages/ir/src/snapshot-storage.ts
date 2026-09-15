import { FileIdentitySchema, type FileIdentity } from '@sfp/shared';
import { z } from 'zod';

import { SnapshotFidelitySchema, type SnapshotFidelity } from './fidelity.js';
import {
  RepoRelativePathSchema,
  Sha256WireSchema,
  SnapshotLocatorSchema,
  type SnapshotLocator,
  type SnapshotV1,
} from './snapshot-v1.js';

export interface SnapshotStorageKey extends SnapshotLocator {
  fileIdentity: FileIdentity;
}
export const SnapshotStorageKeySchema = SnapshotLocatorSchema.extend({
  fileIdentity: FileIdentitySchema,
}).strict();
export const StoredSnapshotRefSchema = SnapshotLocatorSchema.extend({
  relativePath: RepoRelativePathSchema,
  checksum: Sha256WireSchema,
  bytes: z.number().int().positive().max(33_554_432),
  fidelity: SnapshotFidelitySchema,
}).strict();
export type StoredSnapshotRef = z.infer<typeof StoredSnapshotRefSchema>;
export interface SnapshotStoragePort {
  save(key: SnapshotStorageKey, snapshot: SnapshotV1): Promise<StoredSnapshotRef>;
  loadByLocator(
    locator: SnapshotLocator,
  ): Promise<{ ref: StoredSnapshotRef; snapshot: SnapshotV1 } | null>;
  list(
    workspaceId: string,
    fileIdentityHash: `sha256:${string}`,
  ): Promise<readonly StoredSnapshotRef[]>;
  delete(locator: SnapshotLocator, actorId: string, approvalId: string): Promise<void>;
}
export type { SnapshotFidelity };
