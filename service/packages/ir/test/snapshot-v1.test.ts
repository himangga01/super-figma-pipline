import { canonicalFileIdentityHash, type FileIdentity } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  decodeStored,
  encodeStored,
  hashSnapshot,
  snapshotRelativePath,
  SnapshotV1Schema,
  SnapshotStore,
  snapshotRef,
  type SnapshotStoragePort,
} from '../src/index.js';

const identity: FileIdentity = { kind: 'figma-file-key', value: 'file-key-fixture' };
const snapshot = () => {
  const value = {
    schemaVersion: 1 as const,
    locator: {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      fileIdentityHash: canonicalFileIdentityHash(identity),
      snapshotId: `sfp_snap1_${'A'.repeat(22)}`,
    },
    connector: {
      protocolVersion: '0.1.0',
      productVersion: '0.1.0',
      sessionId: 'session',
      pluginGeneration: 'generation',
      fileIdentity: identity,
      fileName: 'Fixture',
      editorType: 'figma',
    },
    target: { nodeIds: ['1:1'] },
    observed: { nodes: [{ id: '1:1', name: 'Frame', type: 'FRAME', width: 100 }] },
    fidelity: {
      detail: 'full' as const,
      truncated: false,
      omitted: [],
      unsupported: [],
      visitedCount: 1,
      expandedSections: [],
      completeLeafSections: [
        { nodeId: '1:1', planPath: ['1:1'], order: 0, depth: 0, status: 'complete-leaf' as const },
      ],
      issues: [],
    },
    capturedAt: '2026-09-06T00:00:00Z',
    extensions: {},
    contentHash: '',
  };
  value.contentHash = hashSnapshot(value);
  return SnapshotV1Schema.parse(value);
};

describe('snapshot identity, fidelity and storage contract', () => {
  it('hashes observed content independent of key order, capture time and snapshot ID', () => {
    const first = snapshot();
    const second = {
      ...first,
      capturedAt: '2026-09-07T00:00:00Z',
      locator: { ...first.locator, snapshotId: `sfp_snap1_${'B'.repeat(21)}A` },
      observed: { nodes: [{ width: 100, type: 'FRAME', name: 'Frame', id: '1:1' }] },
    };
    expect(hashSnapshot(second)).toBe(first.contentHash);
    expect(SnapshotV1Schema.safeParse(second).success).toBe(true);
  });
  it('rejects identity tampering and incomplete fidelity labelled as complete', () => {
    const value = snapshot();
    expect(
      SnapshotV1Schema.safeParse({
        ...value,
        locator: { ...value.locator, fileIdentityHash: `sha256:${'a'.repeat(64)}` },
      }).success,
    ).toBe(false);
    const incomplete = { ...value, fidelity: { ...value.fidelity, omitted: ['1:2'] } };
    incomplete.contentHash = hashSnapshot(incomplete);
    expect(SnapshotV1Schema.safeParse(incomplete).success).toBe(false);
  });
  it('uses only the verified digest in filesystem-neutral relative paths', () => {
    const value = snapshot();
    expect(snapshotRelativePath(value.locator)).toBe(
      `.sfp/snapshots/v1/${value.locator.fileIdentityHash.slice(7)}/${value.locator.snapshotId}.json`,
    );
    expect(() =>
      snapshotRelativePath({ ...value.locator, fileIdentityHash: 'sha256:C:escape' }),
    ).toThrow(/Invalid|SNAPSHOT|JSON/u);
    expect(() => snapshotRelativePath({ ...value.locator, snapshotId: '../escape' })).toThrow(
      /Invalid|SNAPSHOT|JSON/u,
    );
  });
  it('rejects noncanonical bytes and non-JSON values rather than hashing a lossy projection', () => {
    const value = snapshot();
    expect(decodeStored(encodeStored(value))).toEqual(value);
    expect(() => decodeStored(new TextEncoder().encode(JSON.stringify(value, null, 2)))).toThrow(
      'SNAPSHOT_NON_CANONICAL',
    );
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/Invalid|SNAPSHOT|JSON/u);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/Invalid|SNAPSHOT|JSON/u);
  });
  it('validates a storage port result without importing a filesystem implementation', async () => {
    const value = snapshot();
    const storage: SnapshotStoragePort = {
      save: async () => snapshotRef(value),
      loadByLocator: async () => ({ ref: snapshotRef(value), snapshot: value }),
      list: async () => [],
      delete: async () => {},
    };
    const store = new SnapshotStore(storage);
    await expect(
      store.save({ ...value.locator, fileIdentity: identity }, value),
    ).resolves.toMatchObject({ relativePath: snapshotRelativePath(value.locator) });
    await expect(store.load(value.locator)).resolves.toEqual(value);
    storage.loadByLocator = async () => ({
      ref: { ...snapshotRef(value), checksum: `sha256:${'a'.repeat(64)}` },
      snapshot: value,
    });
    await expect(store.load(value.locator)).rejects.toThrow('SNAPSHOT_STORAGE_REF_MISMATCH');
  });
});
