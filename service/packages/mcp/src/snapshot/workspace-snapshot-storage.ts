import {
  assertLocator,
  decodeStored,
  encodeStored,
  snapshotRef,
  snapshotRelativePath,
  SnapshotLocatorSchema,
  SnapshotStorageKeySchema,
  SnapshotV1Schema,
  Sha256WireSchema,
  type SnapshotLocator,
  type SnapshotStorageKey,
  type SnapshotStoragePort,
  type SnapshotV1,
  type StoredSnapshotRef,
} from '@sfp/ir';
import { canonicalFileIdentityHash, type WorkspacePolicy } from '@sfp/shared';
import { z } from 'zod';

import { NamespaceFiles } from '../fs/namespace-files.js';

const TombstoneSchema = z
  .object({
    schemaVersion: z.literal(1),
    deleted: z.literal(true),
    locator: SnapshotLocatorSchema,
    previousChecksum: Sha256WireSchema,
    actorId: z.string().min(1),
    approvalId: z.string().min(1),
    deletedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export class WorkspaceSnapshotStorage implements SnapshotStoragePort {
  private readonly files: NamespaceFiles;
  constructor(
    policy: WorkspacePolicy,
    private readonly authorizeDelete?: (
      actorId: string,
      approvalId: string,
      locator: SnapshotLocator,
    ) => Promise<void>,
  ) {
    this.files = new NamespaceFiles(policy);
  }
  async save(inputKey: SnapshotStorageKey, input: SnapshotV1): Promise<StoredSnapshotRef> {
    const key = SnapshotStorageKeySchema.parse(inputKey),
      snapshot = SnapshotV1Schema.parse(input);
    assertLocator(key, snapshot.locator);
    if (canonicalFileIdentityHash(key.fileIdentity) !== snapshot.locator.fileIdentityHash)
      throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
    const ref = snapshotRef(snapshot);
    await this.files.create(key.workspaceId, ref.relativePath, encodeStored(snapshot));
    return ref;
  }
  async loadByLocator(input: SnapshotLocator) {
    const locator = SnapshotLocatorSchema.parse(input);
    const bytes = await this.files.read(locator.workspaceId, snapshotRelativePath(locator));
    if (bytes === null) return null;
    const decoded = decodeStored(bytes);
    const tombstone = TombstoneSchema.safeParse(decoded);
    if (tombstone.success) {
      assertLocator(locator, tombstone.data.locator);
      return null;
    }
    const snapshot = SnapshotV1Schema.parse(decoded);
    assertLocator(locator, snapshot.locator);
    return { ref: snapshotRef(snapshot), snapshot };
  }
  async list(
    workspaceId: string,
    fileIdentityHash: `sha256:${string}`,
  ): Promise<readonly StoredSnapshotRef[]> {
    const locator = SnapshotLocatorSchema.parse({
      workspaceId,
      fileIdentityHash,
      snapshotId: `sfp_snap1_${'A'.repeat(22)}`,
    });
    const directory = `.sfp/snapshots/v1/${locator.fileIdentityHash.slice(7)}`;
    const refs: StoredSnapshotRef[] = [];
    for (const name of await this.files.list(workspaceId, directory)) {
      // eslint-disable-next-line no-await-in-loop -- bounded, locator-verified history scan
      const loaded = await this.loadByLocator({ ...locator, snapshotId: name.slice(0, -5) });
      if (loaded !== null) refs.push(loaded.ref);
    }
    return refs;
  }
  async delete(locator: SnapshotLocator, actorId: string, approvalId: string): Promise<void> {
    if (this.authorizeDelete === undefined) throw new Error('SNAPSHOT_DELETE_APPROVAL_REQUIRED');
    const loaded = await this.loadByLocator(locator);
    if (loaded === null) return;
    await this.authorizeDelete(actorId, approvalId, locator);
    const tombstone = TombstoneSchema.parse({
      schemaVersion: 1,
      deleted: true,
      locator,
      previousChecksum: loaded.ref.checksum,
      actorId,
      approvalId,
      deletedAt: new Date().toISOString(),
    });
    // A CAS tombstone makes deletion atomic and prevents accidental reuse of an issued snapshot ID.
    await this.files.replace(
      locator.workspaceId,
      loaded.ref.relativePath,
      encodeStored(tombstone),
      loaded.ref.checksum,
    );
  }
}
