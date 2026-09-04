import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  statfs,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  decodeFollowerInnerMessage,
  encodeFollowerInnerMessage,
  NO_CAPTURE_OPTIONS,
  OPERATION_EVIDENCE_LIMITS,
  OperationEvidenceReceiptV1Schema,
  OperationEvidenceViewV1Schema,
  PortableRelativeArtifactPathSchema,
  type RuntimeExecutionScope,
  type WorkspacePolicy,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import {
  NativeEvidenceArtifactPort,
  serializeNativeArtifactManifestV1,
  validateNativeArtifactManifestBytes,
} from '../../src/execution/native-evidence-artifact-port.js';
import { createOperationEvidenceProjector } from '../../src/execution/operation-evidence-projector.js';
import { verifyNativeEvidenceContext } from '../../src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { AtomicFileStore, WorkspaceAtomicFileStore } from '../../src/fs/atomic-file.js';
import { normalizeNativeEvidenceProjection } from '../../src/fs/operation-evidence-artifact-store.js';
import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';
import { writeExportedPdf } from '../../src/tools/export-pdf.js';
import { writeExportedVideo } from '../../src/tools/export-video.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
import { writeImageFills } from '../../src/tools/save-image-fills.js';
import { writeScreenshots } from '../../src/tools/save-screenshots.js';

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))),
);

const withFailureAtomicFixture = async <T>(
  prefix: string,
  body: (root: string) => Promise<T>,
): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  let value: T | undefined;
  let bodyFailure: unknown;
  let cleanupFailure: unknown;
  try {
    value = await body(root);
  } catch (error) {
    bodyFailure = error;
  }
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    cleanupFailure = error;
  }
  if (bodyFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError([bodyFailure, cleanupFailure], 'fixture body and cleanup both failed');
  }
  if (bodyFailure !== undefined) throw bodyFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  return value as T;
};

const R28_SIZES = Object.freeze(
  Array.from({ length: 256 }, (_unused, index) =>
    index < 195 ? 1_000_000 : index === 195 ? 326_592 : 100_000,
  ),
);

const exactPortableMemberPath = (index: number): string => {
  const segments = ['members', `p${String(index).padStart(3, '0')}`];
  let length = segments.join('/').length;
  while (length + 1 + 240 < 1_024) {
    segments.push(String.fromCharCode(97 + (index % 26)).repeat(240));
    length += 241;
  }
  segments.push(String.fromCharCode(65 + (index % 26)).repeat(1_024 - length - 1));
  return segments.join('/');
};

interface R28PhysicalFixture {
  workspaceRoot: string;
  stateRoot: string;
  workspaceId: string;
  policy: WorkspacePolicy;
  paths: readonly string[];
  physicalPaths: readonly string[];
}

const acquireR28PhysicalFixture = async (root: string): Promise<R28PhysicalFixture> => {
  const workspaceRoot = join(root, 'workspace');
  const stateRoot = join(root, 'state');
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
  ]);
  const available = await statfs(workspaceRoot);
  const availableBytes = BigInt(available.bavail) * BigInt(available.bsize);
  if (availableBytes < 268_435_456n) {
    throw Object.assign(new Error('R28 native fixture requires 256 MiB free space'), {
      code: 'NATIVE_EVIDENCE_TEMP_SPACE_INSUFFICIENT',
      availableBytes,
      requiredBytes: 268_435_456n,
    });
  }
  const permissions: BoundStatePermissions = {
    stateRoot,
    ensureSecure: async () => undefined,
    verifySecure: async () => undefined,
    inspectSecure: async path => {
      const metadata = await stat(path, { bigint: true });
      return {
        canonicalPath: await realpath(path),
        key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
        directory: metadata.isDirectory(),
        file: metadata.isFile(),
      };
    },
  };
  const workspaceStore = createWorkspaceConfigStore(
    stateRoot,
    { hasUnsettled: async () => false },
    permissions,
  );
  const workspaceId = (await workspaceStore.add('actor', workspaceRoot)).workspaceId;
  const policy = createWorkspacePolicy(workspaceStore);
  const paths = R28_SIZES.map((_size, index) => exactPortableMemberPath(index));
  const physicalPaths: string[] = [];
  const identities = new Set<string>();
  /* eslint-disable no-await-in-loop -- fixture acquisition is ordered and failure-atomic */
  for (let index = 0; index < paths.length; index += 1) {
    const portablePath = paths[index] as string;
    if (
      Buffer.byteLength(portablePath, 'utf8') !== 1_024 ||
      portablePath.split('/').some(segment => Buffer.byteLength(segment, 'utf8') > 240)
    ) {
      throw new Error('R28 portable path construction is invalid');
    }
    const physicalPath = join(workspaceRoot, portablePath);
    await mkdir(join(physicalPath, '..'), { recursive: true });
    await writeFile(physicalPath, '');
    await truncate(physicalPath, R28_SIZES[index] as number);
    const startSentinel = Buffer.from(`SFP-START-${String(index).padStart(3, '0')}`, 'ascii');
    const endSentinel = Buffer.from(`SFP-END-${String(index).padStart(3, '0')}`, 'ascii');
    const handle = await open(physicalPath, 'r+');
    try {
      await handle.write(startSentinel, 0, startSentinel.byteLength, 0);
      await handle.write(
        endSentinel,
        0,
        endSentinel.byteLength,
        (R28_SIZES[index] as number) - endSentinel.byteLength,
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    const identity = await stat(physicalPath, { bigint: true });
    const key = `${identity.dev}:${identity.ino}`;
    if (identities.has(key)) throw new Error('R28 member inode alias detected');
    identities.add(key);
    physicalPaths.push(physicalPath);
  }
  /* eslint-enable no-await-in-loop */
  return { workspaceRoot, stateRoot, workspaceId, policy, paths, physicalPaths };
};

const streamingDigest = async (path: string): Promise<string> => {
  const handle = await open(path, 'r');
  const hashState = createHash('sha256');
  try {
    let position = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(65_536);
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
      if (bytesRead === 0) break;
      hashState.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hashState.digest('hex');
};

const workspaceFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-packed-workspace-'));
  roots.push(root);
  const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
  const canonical = await realpath(root);
  const policy = createWorkspacePolicy(
    {
      list: async () => [
        {
          workspaceId,
          path: canonical,
          realPath: canonical,
          addedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
    { boundaryInspector: { assertSafe: async () => undefined } },
  );
  return { root, workspaceId, policy };
};

describe('packed operation evidence parity', () => {
  it('cleans a partially acquired heavy fixture when acquisition throws', async () => {
    let acquiredRoot = '';
    const acquisitionFailure = Object.assign(new Error('injected partial acquisition failure'), {
      code: 'TEST_FIXTURE_ACQUISITION_FAILED',
    });

    await expect(
      withFailureAtomicFixture('sfp-partial-acquisition-', async root => {
        acquiredRoot = root;
        await mkdir(join(root, 'members'));
        await writeFile(join(root, 'members', 'partial.bin'), 'partial');
        throw acquisitionFailure;
      }),
    ).rejects.toBe(acquisitionFailure);
    await expect(stat(acquiredRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    {
      operationName: 'save_screenshots',
      write: async (files: WorkspaceAtomicFileStore) =>
        writeScreenshots(
          'exports/screens',
          [{ nodeId: '1:1', format: 'PNG' as const, base64: 'YQ==' }],
          files,
        ),
      paths: (result: unknown) =>
        (result as { saved: Array<{ path: string | null }> }).saved.map(row => row.path),
    },
    {
      operationName: 'save_image_fills',
      write: async (files: WorkspaceAtomicFileStore) =>
        writeImageFills(
          'exports/fills',
          [
            {
              nodeId: '1:1',
              images: [{ index: 0, imageHash: 'shared', base64: 'iVBORw==' }],
            },
          ],
          files,
        ),
      paths: (result: unknown) =>
        (result as { nodes: Array<{ images: Array<{ path: string | null }> }> }).nodes.flatMap(
          node => node.images.map(image => image.path),
        ),
    },
    {
      operationName: 'export_pdf',
      write: async (files: WorkspaceAtomicFileStore) =>
        writeExportedPdf('exports/document.pdf', { nodeId: '1:1', base64: 'YQ==' }, files),
      paths: (result: unknown) => [(result as { path: string | null }).path],
    },
    {
      operationName: 'export_video',
      write: async (files: WorkspaceAtomicFileStore) =>
        writeExportedVideo(
          'exports/clip.mp4',
          { nodeId: '1:1', format: 'MP4' as const, base64: 'YQ==' },
          1_024,
          files,
        ),
      paths: (result: unknown) => [(result as { path: string | null }).path],
    },
  ] as const)(
    'keeps $operationName output portable through real write, projection, and native manifest IO',
    async ({ operationName, write, paths }) => {
      const { root, workspaceId, policy } = await workspaceFixture();
      const files = new WorkspaceAtomicFileStore({
        workspaceId,
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      });
      const result = await write(files);
      const outputPaths = paths(result).filter((path): path is string => path !== null);
      expect(outputPaths.length).toBeGreaterThan(0);
      for (const path of outputPaths) {
        expect(isAbsolute(path)).toBe(false);
        expect(path).not.toContain('\\');
      }

      const context = Object.freeze({ operationId: `operation-${operationName}`, workspaceId });
      const projection = normalizeNativeEvidenceProjection(
        createOperationEvidenceProjector().project(context, 'tool', operationName, {}, result),
      );
      if (projection.kind !== 'export-candidates') throw new Error('export projection expected');
      const evidence = await new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
      }).createNativeManifest({
        context: verifyNativeEvidenceContext(context, projection),
        projection,
      });
      expect(evidence.artifactCount).toBe(new Set(outputPaths).size);
      await expect(stat(join(root, evidence.manifestRelativePath))).resolves.toBeDefined();
    },
  );

  it('issues, verifies, executes, descriptor-rereads, and fsyncs the exact production 297905-byte manifest', async () => {
    await withFailureAtomicFixture('sfp-native-production-max-', async root => {
      const fixture = await acquireR28PhysicalFixture(root);
      const { workspaceRoot, stateRoot, workspaceId, policy, paths, physicalPaths } = fixture;
      const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
      const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
      const fixedNow = 1_724_803_200_000;
      const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 42));
      const operationId = issuer.issue(actorId, fixedNow, {
        nonce: 'KgAAAAAAAAAAAAAAAAAAAA',
      });
      const operationIdBytes = Buffer.byteLength(operationId, 'ascii');
      expect(operationIdBytes).toBe(304);
      expect(paths.every(path => Buffer.byteLength(path, 'utf8') === 1_024)).toBe(true);
      expect(R28_SIZES.reduce((sum, size) => sum + size, 0)).toBe(
        OPERATION_EVIDENCE_LIMITS.maxBytesPerActor,
      );
      const strictResult = {
        saved: paths.map((path, index) => ({ nodeId: `1:${index}`, format: 'PNG', path })),
      };
      const scope: RuntimeExecutionScope = Object.freeze({
        requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
        leaderGeneration: 'generation-packed',
        actor: Object.freeze({ actorId, authSessionId, entryPath: 'mcp-direct' as const }),
        workspace: Object.freeze({ workspaceId, workspaceRoot }),
        resolvedPaths: Object.freeze({
          outDir: Object.freeze({ path: join(workspaceRoot, 'members'), overwrites: false }),
        }),
        target: Object.freeze({
          sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
          pluginGeneration: 'plugin-g1',
          fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-a' }),
          fileExecutionKey: 'figma:file-a' as const,
        }),
        consent: Object.freeze({
          mode: 'local-trusted' as const,
          consentId: null,
          allowedClasses: [
            'public',
            'project-code',
            'design-text',
            'design-image',
            'secret',
          ] as const,
        }),
      });
      const events: string[] = [];
      const journal = new OperationJournal({ stateRoot, actorId, now: () => fixedNow });
      const egress = new EgressManifestStore({ stateRoot, actorId, now: () => fixedNow });
      const receipts = new OperationEvidenceReceiptStore({
        stateRoot,
        actorId,
        syncPreparedReceipt: async handle => {
          await handle.sync();
          events.push('prepared-evidence-receipt-fsync');
        },
      });
      await Promise.all([journal.recover(), egress.recover(fixedNow), receipts.recover()]);
      let directorySyncResult: 'succeeded' | 'eperm-limited' | null = null;
      const nativeArtifacts = new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore({
          afterFileFsync: async () => events.push('native-manifest-fsync'),
          afterDirectoryFsync: async (_path: string, result: 'succeeded' | 'eperm-limited') => {
            directorySyncResult = result;
            events.push(
              result === 'succeeded'
                ? 'native-manifest-directory-fsync-succeeded'
                : 'native-manifest-directory-sync-attempted-eperm-limited',
            );
          },
        } as never),
        afterMembersReread: async () => events.push('native-members-reread'),
      } as never);
      const executor = new OperationExecutor({
        issuer,
        journal,
        queue: new FileExecutionQueue(),
        runtimes: createBoundRuntimeRegistry(
          { execute: async () => ({}) },
          { execute: async () => strictResult },
        ),
        durability: {
          egress,
          receipts,
          artifacts: { createNew: async () => Promise.reject(new Error('capture disabled')) },
          projector: createOperationEvidenceProjector(),
          nativeArtifacts,
        },
        now: () => fixedNow,
      });
      await executor.invokeTool(
        scope,
        'save_screenshots',
        { nodeIds: paths.map((_path, index) => `1:${index}`), outDir: 'members' },
        operationId,
        NO_CAPTURE_OPTIONS,
      );
      const receipt = await receipts.get(actorId, operationId);
      if (receipt?.terminalStatus !== 'succeeded' || receipt.nativeEvidence.kind !== 'export') {
        throw new Error('executor did not persist successful native evidence');
      }
      const evidence = receipt.nativeEvidence;
      const manifestPath = join(workspaceRoot, evidence.manifestRelativePath);
      const manifestBytes = await readFile(manifestPath);
      expect(evidence).toMatchObject({
        kind: 'export',
        artifactCount: 256,
        totalArtifactBytes: OPERATION_EVIDENCE_LIMITS.maxBytesPerActor,
      });
      expect(manifestBytes.byteLength).toBe(297_905);
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
        artifacts: Array<{
          artifactRelativePath: string;
          artifactDigest64: string;
          artifactBytes: number;
        }>;
      };
      const independentDigests: string[] = [];
      const observedSentinels: string[] = [];
      /* eslint-disable no-await-in-loop -- independent verification is intentionally sequential */
      for (let index = 0; index < physicalPaths.length; index += 1) {
        independentDigests.push(await streamingDigest(physicalPaths[index] as string));
        const handle = await open(physicalPaths[index] as string, 'r');
        try {
          const sentinel = Buffer.alloc(13);
          await handle.read(sentinel, 0, sentinel.byteLength, 0);
          observedSentinels.push(sentinel.toString('ascii'));
        } finally {
          await handle.close();
        }
      }
      /* eslint-enable no-await-in-loop */
      expect(
        manifest.artifacts.map(member => ({
          path: member.artifactRelativePath,
          bytes: member.artifactBytes,
          digest: member.artifactDigest64,
        })),
      ).toEqual(
        paths.map((path, index) => ({
          path,
          bytes: R28_SIZES[index],
          digest: independentDigests[index],
        })),
      );
      expect(observedSentinels).toEqual(
        paths.map((_path, index) => `SFP-START-${String(index).padStart(3, '0')}`),
      );
      expect(new Set(observedSentinels).size).toBe(256);
      const persistedLog = await readFile(receipts.logPath, 'utf8');
      const rawReceiptLine = persistedLog
        .split('\n')
        .filter(Boolean)
        .find(line => (JSON.parse(line) as { operationId?: unknown }).operationId === operationId);
      expect(rawReceiptLine).toBeDefined();
      const persistedReceipt = OperationEvidenceReceiptV1Schema.parse(
        JSON.parse(rawReceiptLine as string),
      );
      expect(persistedReceipt).toEqual(receipt);
      expect(persistedReceipt.operationId).toBe(operationId);
      expect(persistedReceipt.nativeEvidence).toEqual({
        kind: 'export',
        manifestRelativePath: evidence.manifestRelativePath,
        manifestDigest64: evidence.manifestDigest64,
        artifactCount: 256,
        totalArtifactBytes: OPERATION_EVIDENCE_LIMITS.maxBytesPerActor,
      });
      const contentBase = { ...persistedReceipt } as Record<string, unknown>;
      delete contentBase.previousReceiptHash;
      delete contentBase.contentHash;
      delete contentBase.receiptHash;
      const expectedContentHash = `sha256:${createHash('sha256')
        .update('sfp-operation-evidence-content-v1', 'utf8')
        .update(Buffer.from([0]))
        .update(canonicalJson(contentBase), 'utf8')
        .digest('hex')}`;
      const expectedReceiptHash = `sha256:${createHash('sha256')
        .update('sfp-operation-evidence-record-v1', 'utf8')
        .update(Buffer.from([0]))
        .update(expectedContentHash, 'ascii')
        .update(Buffer.from([0]))
        .digest('hex')}`;
      expect(persistedReceipt.previousReceiptHash).toBeNull();
      expect(persistedReceipt.contentHash).toBe(expectedContentHash);
      expect(persistedReceipt.receiptHash).toBe(expectedReceiptHash);
      expect(`${rawReceiptLine as string}\n`).toBe(`${canonicalJson(persistedReceipt)}\n`);
      const rawReceiptLineBytes = Buffer.byteLength(`${rawReceiptLine as string}\n`, 'utf8');
      expect(rawReceiptLineBytes).toBeLessThanOrEqual(OPERATION_EVIDENCE_LIMITS.maxRowBytes);
      const recoveredReceipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
      await recoveredReceipts.recover();
      await expect(recoveredReceipts.get(actorId, operationId)).resolves.toEqual(persistedReceipt);
      expect(
        directorySyncResult === 'succeeded' ||
          (process.platform === 'win32' && directorySyncResult === 'eperm-limited'),
      ).toBe(true);
      expect(events).toEqual([
        'native-members-reread',
        'native-manifest-fsync',
        directorySyncResult === 'succeeded'
          ? 'native-manifest-directory-fsync-succeeded'
          : 'native-manifest-directory-sync-attempted-eperm-limited',
        'prepared-evidence-receipt-fsync',
      ]);
    });
  }, 120_000);

  it('cancels during the 201326592-byte production reread with no manifest or success receipt', async () => {
    await withFailureAtomicFixture('sfp-native-production-cancel-', async root => {
      const fixture = await acquireR28PhysicalFixture(root);
      const { workspaceRoot, stateRoot, workspaceId, policy, paths } = fixture;
      const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
      const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
      const fixedNow = 1_724_803_200_000;
      const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 43));
      const operationId = issuer.issue(actorId, fixedNow, {
        nonce: 'KwAAAAAAAAAAAAAAAAAAAA',
      });
      issuer.verify(actorId, operationId, fixedNow);
      const strictResult = {
        saved: paths.map((path, index) => ({ nodeId: `1:${index}`, format: 'PNG', path })),
      };
      const scope: RuntimeExecutionScope = Object.freeze({
        requestId: 'sfp_req1_BAAAAAAAAAAAAAAAAAAAAA',
        leaderGeneration: 'generation-packed-cancel',
        actor: Object.freeze({ actorId, authSessionId, entryPath: 'mcp-direct' as const }),
        workspace: Object.freeze({ workspaceId, workspaceRoot }),
        resolvedPaths: Object.freeze({
          outDir: Object.freeze({ path: join(workspaceRoot, 'members'), overwrites: false }),
        }),
        target: Object.freeze({
          sessionId: 'AgAAAAAAAAAAAAAAAAAAAA',
          pluginGeneration: 'plugin-g1',
          fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-b' }),
          fileExecutionKey: 'figma:file-b' as const,
        }),
        consent: Object.freeze({
          mode: 'local-trusted' as const,
          consentId: null,
          allowedClasses: [
            'public',
            'project-code',
            'design-text',
            'design-image',
            'secret',
          ] as const,
        }),
      });
      const journal = new OperationJournal({ stateRoot, actorId, now: () => fixedNow });
      const egress = new EgressManifestStore({ stateRoot, actorId, now: () => fixedNow });
      const receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
      await Promise.all([journal.recover(), egress.recover(fixedNow), receipts.recover()]);
      let chunks = 0;
      let cancelFlight: Promise<void> | null = null;
      let executor!: OperationExecutor;
      const nativeArtifacts = new NativeEvidenceArtifactPort({
        workspacePolicy: policy,
        atomicFiles: new AtomicFileStore(),
        afterMemberChunk: async () => {
          chunks += 1;
          if (cancelFlight !== null) return;
          cancelFlight = executor.cancel(scope.actor, {
            version: 1,
            requestId: scope.requestId,
            operationId,
          });
          await cancelFlight;
        },
      } as never);
      executor = new OperationExecutor({
        issuer,
        journal,
        queue: new FileExecutionQueue(),
        runtimes: createBoundRuntimeRegistry(
          { execute: async () => ({}) },
          { execute: async () => strictResult },
        ),
        durability: {
          egress,
          receipts,
          artifacts: { createNew: async () => Promise.reject(new Error('capture disabled')) },
          projector: createOperationEvidenceProjector(),
          nativeArtifacts,
        },
        now: () => fixedNow,
      });

      await expect(
        executor.invokeTool(
          scope,
          'save_screenshots',
          { nodeIds: paths.map((_path, index) => `1:${index}`), outDir: 'members' },
          operationId,
          NO_CAPTURE_OPTIONS,
        ),
      ).rejects.toMatchObject({ code: 'OPERATION_OUTCOME_UNKNOWN' });
      await cancelFlight;
      expect(chunks).toBe(1);
      const projection = createOperationEvidenceProjector().project(
        { operationId, workspaceId },
        'tool',
        'save_screenshots',
        {},
        strictResult,
      );
      const manifestPath = join(
        workspaceRoot,
        '.sfp',
        'operation-evidence',
        projection.contextHash.slice('sha256:'.length),
        'native-manifest.v1.json',
      );
      await expect(stat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(receipts.get(actorId, operationId)).resolves.toBeNull();
      const settled = journal.get(operationId);
      expect(settled).toMatchObject({
        status: 'outcome-unknown',
        errorCode: 'OPERATION_CANCELLED_AFTER_DISPATCH',
        operationEvidenceReceiptHash: null,
        finalEgressManifestHash: expect.stringMatching(/^sha256:/u),
      });
      await expect(
        egress.readVerifiedFinalizer(
          actorId,
          operationId,
          settled?.finalEgressManifestHash ?? null,
        ),
      ).resolves.toMatchObject({ finalStatus: 'outcome-unknown' });
    });
  }, 120_000);

  it('keeps 299836 as a serializer-only safe-integer structural bound, not production IO', () => {
    const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 42));
    const operationId = issuer.issue(actorId, 1_724_803_200_000, {
      nonce: 'KgAAAAAAAAAAAAAAAAAAAA',
    });
    const operationIdBytes = Buffer.byteLength(operationId, 'ascii');
    expect(operationIdBytes).toBe(304);
    const paths = Array.from({ length: 256 }, (_unused, index) => {
      const prefix = `p${String(index).padStart(3, '0')}/`;
      return `${prefix}${'a'.repeat(1_024 - prefix.length)}`;
    });
    const sizes = Array.from({ length: 256 }, (_unused, index) =>
      index < 71 ? 100_000_000_000_000 : 10_000_000_000_000,
    );
    const totalArtifactBytes = sizes.reduce((sum, size) => sum + size, 0);
    expect(totalArtifactBytes).toBe(8_950_000_000_000_000);
    expect(Number.isSafeInteger(totalArtifactBytes)).toBe(true);
    expect(totalArtifactBytes).toBeGreaterThan(OPERATION_EVIDENCE_LIMITS.maxBytesPerActor);
    const withoutHash = {
      schemaVersion: 1 as const,
      operationId,
      artifacts: paths.map((artifactRelativePath, index) => ({
        artifactRelativePath,
        artifactDigest64: '0'.repeat(64),
        artifactBytes: sizes[index]!,
      })),
      artifactCount: 256,
      totalArtifactBytes,
    };
    const { bytes } = serializeNativeArtifactManifestV1(withoutHash);
    expect(bytes.byteLength).toBe(OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes);
    expect(validateNativeArtifactManifestBytes(bytes)).toMatchObject({
      operationId,
      artifactCount: 256,
      totalArtifactBytes,
    });
  });

  it('derives the 297909 artificial-issued and 297985 forged-grammar layer bounds', () => {
    const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 42));
    const artificialIssuedId = issuer.issue(actorId, Number.MAX_SAFE_INTEGER, {
      nonce: 'KgAAAAAAAAAAAAAAAAAAAA',
    });
    const paths = Array.from({ length: 256 }, (_unused, index) => {
      const prefix = `p${String(index).padStart(3, '0')}/`;
      return `${prefix}${'a'.repeat(1_024 - prefix.length)}`;
    });
    const artifacts = paths.map((artifactRelativePath, index) => ({
      artifactRelativePath,
      artifactDigest64: '0'.repeat(64),
      artifactBytes: R28_SIZES[index] as number,
    }));
    const totalArtifactBytes = R28_SIZES.reduce((sum, size) => sum + size, 0);
    const artificialBytes = serializeNativeArtifactManifestV1({
      schemaVersion: 1,
      operationId: artificialIssuedId,
      artifacts,
      artifactCount: 256,
      totalArtifactBytes,
    }).bytes;
    const forgedGrammarId = `sfp_op1_${'A'.repeat(332)}.${'A'.repeat(43)}`;
    const forgedBytes = serializeNativeArtifactManifestV1({
      schemaVersion: 1,
      operationId: forgedGrammarId,
      artifacts,
      artifactCount: 256,
      totalArtifactBytes,
    }).bytes;

    expect(Buffer.byteLength(artificialIssuedId, 'ascii')).toBe(308);
    expect(artificialBytes.byteLength).toBe(297_909);
    expect(forgedBytes.byteLength).toBe(297_985);
    expect(() => issuer.verify(actorId, forgedGrammarId, 1_724_803_200_000)).toThrowError(
      /operation ID/u,
    );
  });

  it('rejects lone-surrogate portable paths and forged C0 operation IDs before filesystem IO', () => {
    expect(PortableRelativeArtifactPathSchema.safeParse('assets/\ud800.png').success).toBe(false);
    expect(PortableRelativeArtifactPathSchema.safeParse('assets/\udc00.png').success).toBe(false);
    expect(PortableRelativeArtifactPathSchema.safeParse('assets/😀.png').success).toBe(true);
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 42));
    const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
    expect(() => issuer.verify(actorId, '\u0001'.repeat(384), 1_724_803_200_000)).toThrowError(
      /operation ID/u,
    );
  });

  it('preserves the same strict public view through control JSON and follower MessagePack', () => {
    const view = OperationEvidenceViewV1Schema.parse({
      schemaVersion: 1,
      serverVerified: true,
      statusProjection: {
        operationId: 'operation-1',
        status: 'succeeded',
        operationKind: 'tool',
        operationName: 'get_selection',
        operationFingerprintHash: hash('1'),
        resultHash: hash('2'),
        preExecutionConsentManifestHash: hash('3'),
        operationEvidenceReceiptHash: hash('4'),
        finalEgressManifestHash: hash('5'),
      },
      receipt: {
        schemaVersion: 1,
        operationId: 'operation-1',
        operationKind: 'tool',
        operationName: 'get_selection',
        argsHash: hash('6'),
        workspaceId: null,
        fileExecutionKeyHash: null,
        targetBindingHash: null,
        captureIntentHash: hash('7'),
        captureResult: false,
        finalizerHash: hash('5'),
        daemonGenerationHash: hash('8'),
        completedAt: '2026-08-31T00:00:00.000Z',
        contentHash: hash('4'),
        terminalStatus: 'succeeded',
        resultHash: hash('2'),
        resultBytes: 2,
        resultArtifact: null,
        nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
      },
      finalizerProjection: {
        finalStatus: 'output',
        manifestHash: hash('5'),
        preExecutionManifestHash: hash('3'),
        resultHash: hash('2'),
        reasonCode: null,
      },
    });
    const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;
    const frame = decodeFollowerInnerMessage(
      encodeFollowerInnerMessage({
        version: 1,
        type: 'result',
        requestId,
        operationId: 'operation-1',
        result: view,
      }),
    );
    if (frame.type !== 'result') throw new Error('result frame expected');

    expect(OperationEvidenceViewV1Schema.parse(frame.result)).toEqual(view);
    expect(OperationEvidenceViewV1Schema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(view.receipt).not.toHaveProperty('actorId');
    expect(view.receipt).not.toHaveProperty('previousReceiptHash');
    expect(view.receipt).not.toHaveProperty('receiptHash');
    expect(view.receipt).not.toHaveProperty('state');
  });

  it('keeps a 256-member native export in a bounded receipt summary instead of inlining members', () => {
    const receipt = {
      schemaVersion: 1,
      operationId: 'operation-256',
      operationKind: 'tool',
      operationName: 'save_screenshots',
      argsHash: hash('6'),
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
      fileExecutionKeyHash: null,
      targetBindingHash: null,
      captureIntentHash: hash('7'),
      captureResult: false,
      finalizerHash: hash('5'),
      daemonGenerationHash: hash('8'),
      completedAt: '2026-08-31T00:00:00.000Z',
      contentHash: hash('4'),
      terminalStatus: 'succeeded',
      resultHash: hash('2'),
      resultBytes: 2,
      resultArtifact: null,
      nativeEvidence: {
        kind: 'export',
        manifestRelativePath: `.sfp/operation-evidence/${'a'.repeat(64)}/native-manifest.v1.json`,
        manifestDigest64: 'b'.repeat(64),
        artifactCount: 256,
        totalArtifactBytes: 201_326_592,
      },
    } as const;
    const view = OperationEvidenceViewV1Schema.parse({
      schemaVersion: 1,
      serverVerified: true,
      statusProjection: {
        operationId: receipt.operationId,
        status: 'succeeded',
        operationKind: 'tool',
        operationName: receipt.operationName,
        operationFingerprintHash: hash('1'),
        resultHash: receipt.resultHash,
        preExecutionConsentManifestHash: hash('3'),
        operationEvidenceReceiptHash: receipt.contentHash,
        finalEgressManifestHash: receipt.finalizerHash,
      },
      receipt,
      finalizerProjection: {
        finalStatus: 'output',
        manifestHash: receipt.finalizerHash,
        preExecutionManifestHash: hash('3'),
        resultHash: receipt.resultHash,
        reasonCode: null,
      },
    });
    if (view.receipt === null) throw new Error('receipt expected');
    const bytes = Buffer.from(JSON.stringify(view.receipt), 'utf8');

    expect(bytes.byteLength).toBeLessThanOrEqual(OPERATION_EVIDENCE_LIMITS.maxRowBytes);
    expect(view.receipt.nativeEvidence).toMatchObject({ artifactCount: 256 });
    expect(view.receipt.nativeEvidence).not.toHaveProperty('artifacts');
  });

  it('deduplicates image-fill paths many-to-one and classifies all-null output without filesystem IO', () => {
    const context = Object.freeze({
      operationId: 'operation-image-fills',
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
    });
    const projector = createOperationEvidenceProjector();
    const repeated = normalizeNativeEvidenceProjection(
      projector.project(
        context,
        'tool',
        'save_image_fills',
        {},
        {
          nodes: [
            {
              nodeId: '1:1',
              images: [
                { path: 'assets/shared.png' },
                { path: 'assets/shared.png' },
                { path: 'assets/shared.png' },
              ],
            },
          ],
        },
      ),
    );
    if (repeated.kind !== 'export-candidates') throw new Error('candidate projection expected');
    expect(repeated.candidates).toHaveLength(3);
    expect(new Set(repeated.candidates.map(row => row.candidateRelativePath))).toEqual(
      new Set(['assets/shared.png']),
    );

    expect(
      normalizeNativeEvidenceProjection(
        projector.project(
          context,
          'tool',
          'save_image_fills',
          {},
          {
            nodes: [{ nodeId: '1:1', images: [{ path: null }, { path: null }] }],
          },
        ),
      ),
    ).toMatchObject({ kind: 'no-artifact', reasonCode: 'native-output-path-null' });
  });

  it('materializes many-to-one source refs reciprocally and rejects a mismatched verified context before IO', async () => {
    const { root, workspaceId, policy } = await workspaceFixture();
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'shared.png'), 'shared');
    const context = Object.freeze({ operationId: 'operation-many-to-one', workspaceId });
    const projection = createOperationEvidenceProjector().project(
      context,
      'tool',
      'save_image_fills',
      {},
      {
        nodes: [
          {
            nodeId: '1:1',
            images: [
              { path: 'assets/shared.png' },
              { path: 'assets/shared.png' },
              { path: 'assets/shared.png' },
            ],
          },
        ],
      },
    );
    if (projection.kind !== 'export-candidates') throw new Error('export projection expected');
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: policy,
      atomicFiles: new AtomicFileStore(),
    });
    const evidence = await port.createNativeManifest({
      context: verifyNativeEvidenceContext(context, projection),
      projection,
    });
    const manifest = JSON.parse(
      await readFile(join(root, evidence.manifestRelativePath), 'utf8'),
    ) as { artifacts: Array<{ artifactRelativePath: string }> };
    expect(evidence.artifactCount).toBe(1);
    expect(
      projection.candidates.every(candidate =>
        candidate.candidateRelativePath === null
          ? true
          : manifest.artifacts.filter(
              member => member.artifactRelativePath === candidate.candidateRelativePath,
            ).length === 1,
      ),
    ).toBe(true);
    expect(
      manifest.artifacts.every(member =>
        projection.candidates.some(
          candidate => candidate.candidateRelativePath === member.artifactRelativePath,
        ),
      ),
    ).toBe(true);

    let filesystemCalls = 0;
    const mismatchedPort = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async () => {
          filesystemCalls += 1;
          return 'unused';
        },
        resolveWrite: async () => {
          filesystemCalls += 1;
          return { path: 'unused', overwrites: false };
        },
        assertWithinRoot: async () => {
          filesystemCalls += 1;
        },
      },
      atomicFiles: new AtomicFileStore(),
    });
    const other = Object.freeze({ operationId: 'operation-other', workspaceId });
    await expect(
      mismatchedPort.createNativeManifest({
        context: verifyNativeEvidenceContext(other, {
          ...projection,
          contextHash: createOperationEvidenceProjector().project(
            other,
            'tool',
            'save_image_fills',
            {},
            { nodes: [] },
          ).contextHash,
        }),
        projection,
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CONTEXT_MISMATCH' });
    expect(filesystemCalls).toBe(0);
  });

  it.each([
    'count257',
    'path1025',
    'quote',
    'backslash',
    'c0-control',
    'serializer-manifest299837',
    'duplicate',
    'unsorted',
    'digest-mismatch',
  ] as const)('rejects invalid persisted native manifest %s without unlink', async fault => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-native-invalid-'));
    roots.push(root);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const contextBase = Object.freeze({ operationId: `operation-invalid-${fault}`, workspaceId });
    const projection = createOperationEvidenceProjector().project(
      contextBase,
      'tool',
      'export_pdf',
      {},
      { nodeId: '1:1', path: 'assets/a.png' },
    );
    if (projection.kind !== 'export-candidates') throw new Error('projection expected');
    const context = verifyNativeEvidenceContext(contextBase, projection);
    const relativeManifestPath = `.sfp/operation-evidence/${context.contextHash.slice('sha256:'.length)}/native-manifest.v1.json`;
    const manifestPath = join(root, relativeManifestPath);
    await mkdir(join(manifestPath, '..'), { recursive: true });
    const validMember = {
      artifactRelativePath: 'assets/a.png',
      artifactDigest64: 'a'.repeat(64),
      artifactBytes: 1,
    };
    let bytes: Buffer;
    let serializerProof: {
      operationIdBytes: number;
      pathPayloadBytes: number;
      manifestBytes: number;
    } | null = null;
    if (fault === 'serializer-manifest299837') {
      const artificialOperationId = operationIdIssuerFromKey(Buffer.alloc(32, 42)).issue(
        'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        Number.MAX_SAFE_INTEGER,
        { nonce: 'KgAAAAAAAAAAAAAAAAAAAA' },
      );
      const operationIdBytes = Buffer.byteLength(artificialOperationId, 'ascii');
      const structuralPaths = Array.from({ length: 256 }, (_unused, index) => {
        const prefix = `p${String(index).padStart(3, '0')}/`;
        const pathBytes = index === 255 ? 1_021 : 1_024;
        return `${prefix}${'a'.repeat(pathBytes - prefix.length)}`;
      });
      const pathPayloadBytes = structuralPaths.reduce(
        (sum, path) => sum + Buffer.byteLength(path),
        0,
      );
      const structuralSizes = Array.from({ length: 256 }, (_unused, index) =>
        index < 71 ? 100_000_000_000_000 : 10_000_000_000_000,
      );
      const totalArtifactBytes = structuralSizes.reduce((sum, size) => sum + size, 0);
      const withoutHash = {
        schemaVersion: 1 as const,
        operationId: artificialOperationId,
        artifacts: structuralPaths.map((artifactRelativePath, index) => ({
          artifactRelativePath,
          artifactDigest64: '0'.repeat(64),
          artifactBytes: structuralSizes[index]!,
        })),
        artifactCount: 256,
        totalArtifactBytes,
      };
      bytes = serializeNativeArtifactManifestV1(withoutHash).bytes;
      serializerProof = { operationIdBytes, pathPayloadBytes, manifestBytes: bytes.byteLength };
    } else {
      let artifacts = [validMember];
      if (fault === 'count257') {
        artifacts = Array.from({ length: 257 }, (_unused, index) => ({
          ...validMember,
          artifactRelativePath: `assets/${String(index).padStart(3, '0')}.png`,
        }));
      } else if (fault === 'path1025') {
        artifacts = [{ ...validMember, artifactRelativePath: `a/${'b'.repeat(1_023)}` }];
      } else if (fault === 'quote') {
        artifacts = [{ ...validMember, artifactRelativePath: 'assets/"a.png' }];
      } else if (fault === 'backslash') {
        artifacts = [{ ...validMember, artifactRelativePath: 'assets\\a.png' }];
      } else if (fault === 'c0-control') {
        artifacts = [{ ...validMember, artifactRelativePath: 'assets/\u0001a.png' }];
      } else if (fault === 'duplicate') {
        artifacts = [validMember, validMember];
      } else if (fault === 'unsorted') {
        artifacts = [
          { ...validMember, artifactRelativePath: 'assets/z.png' },
          { ...validMember, artifactRelativePath: 'assets/a.png' },
        ];
      }
      const withoutHash = {
        schemaVersion: 1 as const,
        operationId: context.operationId,
        artifacts,
        artifactCount: artifacts.length,
        totalArtifactBytes: artifacts.reduce((sum, member) => sum + member.artifactBytes, 0),
      };
      const serialized = serializeNativeArtifactManifestV1(withoutHash);
      bytes =
        fault === 'digest-mismatch'
          ? Buffer.from(
              `${canonicalJson({ ...serialized.manifest, contentHash: hash('0') })}\n`,
              'utf8',
            )
          : serialized.bytes;
    }
    expect(serializerProof).toEqual(
      fault === 'serializer-manifest299837'
        ? {
            operationIdBytes: 308,
            pathPayloadBytes: 256 * 1_024 - 3,
            manifestBytes: 299_837,
          }
        : null,
    );
    await writeFile(manifestPath, bytes);
    const manifestDigest64 = createHash('sha256').update(bytes).digest('hex');
    let manifestBodyReads = 0;
    const port = new NativeEvidenceArtifactPort({
      workspacePolicy: {
        resolveRead: async (_workspace: string, relative: string) => join(root, relative),
        resolveWrite: async () => ({ path: manifestPath, overwrites: true }),
        assertWithinRoot: async () => undefined,
      },
      atomicFiles: new AtomicFileStore(),
      beforeManifestBodyRead: async () => {
        manifestBodyReads += 1;
      },
    } as never);

    const removal = port.removeLinkedManifest({
      context,
      evidence: {
        kind: 'export',
        manifestRelativePath: relativeManifestPath,
        manifestDigest64,
        artifactCount: 1,
        totalArtifactBytes: 1,
      },
    });
    const removalError = await removal.then(
      () => null,
      (error: unknown) => error as { code?: unknown; beforeRead?: unknown; bytesRead?: unknown },
    );
    expect(removalError).not.toBeNull();
    expect(String(removalError?.code)).toMatch(
      fault === 'serializer-manifest299837'
        ? /^NATIVE_ARTIFACT_MANIFEST_SIZE_LIMIT_EXCEEDED$/u
        : /ARTIFACT|PATH|EVIDENCE/u,
    );
    expect(
      fault === 'serializer-manifest299837'
        ? { beforeRead: removalError?.beforeRead, bytesRead: removalError?.bytesRead }
        : null,
    ).toEqual(fault === 'serializer-manifest299837' ? { beforeRead: true, bytesRead: 0 } : null);
    expect(manifestBodyReads).toBe(fault === 'serializer-manifest299837' ? 0 : 1);
    await expect(readFile(manifestPath)).resolves.toEqual(bytes);
  });

  it.each(['symlink', 'escape'] as const)(
    'rejects invalid native member authority %s before manifest publication',
    async fault => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-native-member-authority-'));
      roots.push(root);
      const outside = await mkdtemp(join(tmpdir(), 'sfp-native-member-outside-'));
      roots.push(outside);
      const outsideFile = join(outside, 'foreign.png');
      const linked = join(root, 'linked.png');
      await writeFile(outsideFile, 'foreign');
      if (fault === 'symlink') {
        const { symlink } = await import('node:fs/promises');
        try {
          await symlink(outsideFile, linked, 'file');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }
      }
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const contextBase = Object.freeze({ operationId: `operation-${fault}`, workspaceId });
      const projection = createOperationEvidenceProjector().project(
        contextBase,
        'tool',
        'export_pdf',
        {},
        { nodeId: '1:1', path: fault === 'escape' ? '../escape.png' : 'linked.png' },
      );
      if (projection.kind !== 'export-candidates') throw new Error('projection expected');
      let writes = 0;
      const port = new NativeEvidenceArtifactPort({
        workspacePolicy: {
          resolveRead: async () => (fault === 'symlink' ? linked : outsideFile),
          resolveWrite: async () => {
            writes += 1;
            return { path: join(root, 'manifest.json'), overwrites: false };
          },
          assertWithinRoot: async () => undefined,
        },
        atomicFiles: new AtomicFileStore(),
      });
      await expect(
        port.createNativeManifest({
          context: verifyNativeEvidenceContext(contextBase, projection),
          projection,
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/ARTIFACT|PATH|EVIDENCE/u) });
      expect(writes).toBe(0);
    },
  );
});
