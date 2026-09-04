import { constants, type Dirent } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { OPERATION_EVIDENCE_LIMITS } from '@sfp/shared';

import {
  withCanonicalPathMutex,
  withRetainedDirectoryAuthority,
  withRetainedDirectoryChain,
  type RetainedDirectoryAuthority,
} from './atomic-file.js';

export interface EvidenceRetentionLimits {
  maxRows: number;
  maxBytes: number;
  maxScanEntries: number;
}

export interface EvidenceRetentionMetrics {
  scannedEntries: number;
  retainedRows: number;
  retainedBytes: number;
}

export interface EvidenceRetentionAuthority extends EvidenceRetentionMetrics {
  rootEntries: readonly Dirent[];
  operationDirectories: ReadonlySet<string>;
  retainedOperationDirectories: ReadonlySet<string>;
  operationDirectoryEntries: ReadonlyMap<string, readonly Dirent[]>;
}

export const DEFAULT_EVIDENCE_RETENTION_LIMITS: Readonly<EvidenceRetentionLimits> = Object.freeze({
  maxRows: 1_024,
  maxBytes: 67_108_864,
  maxScanEntries: 4_096,
});

const markerName = /^\.cleanup-intent\.v1\.json\.[0-9a-f]{64}\.[0-9a-f]{32}\.retained$/u;
const artifactName = /^\.result\.v1\.json\.[0-9a-f]{64}\.cleanup-artifact$/u;
const nativeName = /^\.native-manifest\.v1\.json\.[0-9a-f]{64}\.[0-9a-f]{32}\.retained$/u;

const retentionError = (
  code: 'EVIDENCE_RETENTION_CAPACITY_EXCEEDED' | 'EVIDENCE_RETENTION_IDENTITY_INVALID',
  message: string,
  metrics: EvidenceRetentionMetrics,
) => Object.assign(new Error(message), { code, ...metrics });

const validateLimits = (limits: EvidenceRetentionLimits): void => {
  if (
    !Number.isSafeInteger(limits.maxRows) ||
    limits.maxRows < 1 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxScanEntries) ||
    limits.maxScanEntries < 1
  ) {
    throw retentionError(
      'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
      'evidence retention limits are invalid',
      { scannedEntries: 0, retainedRows: 0, retainedBytes: 0 },
    );
  }
};

const recognizedLimit = (name: string): number | null => {
  if (markerName.test(name)) return 65_536;
  if (artifactName.test(name)) return 8_388_608;
  if (nativeName.test(name)) return OPERATION_EVIDENCE_LIMITS.maxNativeArtifactManifestBytes;
  return null;
};

const malformedRetainedNamespace = (name: string): boolean =>
  (name.startsWith('.cleanup-intent.v1.json.') && name.endsWith('.retained')) ||
  (name.startsWith('.result.v1.json.') && name.endsWith('.cleanup-artifact')) ||
  (name.startsWith('.native-manifest.v1.json.') && name.endsWith('.retained'));

export const evidenceRetentionMutexTarget = (evidenceRoot: string): string =>
  join(evidenceRoot, '.retained-marker-authority');

export interface EvidenceRetentionMutexOptions {
  createMissing?: boolean;
  errorCode?: string;
  beforeMutexAcquire?: (authority: RetainedDirectoryAuthority) => Promise<void>;
}

export const withEvidenceRetentionMutex = <T>(
  registeredRoot: string,
  evidenceRoot: string,
  operation: (authority: RetainedDirectoryAuthority) => Promise<T>,
  options: EvidenceRetentionMutexOptions = {},
): Promise<T> =>
  withRetainedDirectoryChain(
    registeredRoot,
    evidenceRoot,
    async authority => {
      await options.beforeMutexAcquire?.(authority);
      await authority.verify();
      return withCanonicalPathMutex(
        resolve(evidenceRetentionMutexTarget(evidenceRoot)),
        async () => {
          const result = await operation(authority);
          await authority.verify();
          return result;
        },
        {
          filesystemTarget: evidenceRetentionMutexTarget(authority.path),
          retainedParentAuthority: true,
        },
      );
    },
    {
      ...(options.createMissing === undefined ? {} : { createMissing: options.createMissing }),
      ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
    },
  );

export interface EvidenceRetentionScanOptions {
  rootAuthority?: RetainedDirectoryAuthority;
  metrics?: EvidenceRetentionMetrics;
}

export const scanEvidenceRetentionAuthority = async (
  evidenceRoot: string,
  limits: EvidenceRetentionLimits = DEFAULT_EVIDENCE_RETENTION_LIMITS,
  options: EvidenceRetentionScanOptions = {},
): Promise<Readonly<EvidenceRetentionAuthority>> => {
  validateLimits(limits);
  const metrics: EvidenceRetentionMetrics = options.metrics ?? {
    scannedEntries: 0,
    retainedRows: 0,
    retainedBytes: 0,
  };
  const retainedOperationDirectories = new Set<string>();
  const operationDirectories = new Set<string>();
  const operationDirectoryEntries = new Map<string, readonly Dirent[]>();
  const rootEntries: Dirent[] = [];
  const consume = (): void => {
    if (metrics.scannedEntries >= limits.maxScanEntries) {
      throw retentionError(
        'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
        'evidence retention scan capacity is exhausted',
        metrics,
      );
    }
    metrics.scannedEntries += 1;
  };
  const scanRoot = async (rootAuthority: RetainedDirectoryAuthority): Promise<void> => {
    const roots = await opendir(rootAuthority.path, { bufferSize: 1 });
    /* eslint-disable no-await-in-loop -- every retained entry shares one exact operation budget */
    for await (const entry of roots) {
      consume();
      rootEntries.push(entry);
      if (entry.name.startsWith('.retained-marker-authority')) continue;
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/u.test(entry.name)) continue;
      operationDirectories.add(entry.name);
      const operationDirectory = rootAuthority.child(entry.name);
      const operationMetadata = await lstat(operationDirectory);
      if (!operationMetadata.isDirectory() || operationMetadata.isSymbolicLink()) {
        throw retentionError(
          'EVIDENCE_RETENTION_IDENTITY_INVALID',
          'retained operation directory is not direct',
          metrics,
        );
      }
      await withRetainedDirectoryAuthority(
        operationDirectory,
        operationMetadata,
        async operationAuthority => {
          const children = await opendir(operationAuthority.path, { bufferSize: 1 });
          const inventory: Dirent[] = [];
          let operationBytes = 0;
          let retained = false;
          let retainedMarker = false;
          let fixedResultBytes = 0;
          for await (const child of children) {
            consume();
            inventory.push(child);
            const hardLimit =
              child.name === 'result.v1.json' ? 8_388_608 : recognizedLimit(child.name);
            if (hardLimit === null) {
              if (malformedRetainedNamespace(child.name)) {
                throw retentionError(
                  'EVIDENCE_RETENTION_IDENTITY_INVALID',
                  'retained evidence namespace is malformed',
                  metrics,
                );
              }
              continue;
            }
            const path = operationAuthority.child(child.name);
            const pathname = await lstat(path);
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            let metadata;
            try {
              metadata = await handle.stat();
              if (
                !child.isFile() ||
                !pathname.isFile() ||
                pathname.isSymbolicLink() ||
                pathname.nlink !== 1 ||
                !metadata.isFile() ||
                metadata.nlink !== 1 ||
                pathname.dev !== metadata.dev ||
                pathname.ino !== metadata.ino ||
                metadata.size < 1 ||
                metadata.size > hardLimit
              ) {
                throw retentionError(
                  'EVIDENCE_RETENTION_IDENTITY_INVALID',
                  'retained evidence is not one bounded unaliased regular file',
                  metrics,
                );
              }
            } finally {
              await handle.close();
            }
            if (child.name === 'result.v1.json') {
              fixedResultBytes = metadata.size;
              continue;
            }
            retained = true;
            if (markerName.test(child.name)) retainedMarker = true;
            operationBytes += metadata.size;
            if (!Number.isSafeInteger(operationBytes)) {
              throw retentionError(
                'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
                'retained evidence byte count is unsafe',
                metrics,
              );
            }
          }
          operationDirectoryEntries.set(entry.name, Object.freeze(inventory));
          if (retainedMarker) operationBytes += fixedResultBytes;
          if (!Number.isSafeInteger(operationBytes)) {
            throw retentionError(
              'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
              'retained operation byte count is unsafe',
              metrics,
            );
          }
          if (!retained) return;
          retainedOperationDirectories.add(entry.name);
          metrics.retainedRows += 1;
          metrics.retainedBytes += operationBytes;
          if (metrics.retainedRows > limits.maxRows || metrics.retainedBytes > limits.maxBytes) {
            throw retentionError(
              'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
              'evidence retention capacity is exhausted',
              metrics,
            );
          }
        },
        { errorCode: 'EVIDENCE_RETENTION_IDENTITY_INVALID' },
      );
    }
    /* eslint-enable no-await-in-loop */
    await rootAuthority.verify();
  };
  if (options.rootAuthority === undefined) {
    const root = await lstat(evidenceRoot).catch(() => null);
    if (root === null) {
      return Object.freeze({
        ...metrics,
        operationDirectories,
        retainedOperationDirectories,
        operationDirectoryEntries,
        rootEntries: Object.freeze(rootEntries),
      });
    }
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw retentionError(
        'EVIDENCE_RETENTION_IDENTITY_INVALID',
        'evidence retention root is not one direct directory',
        metrics,
      );
    }
    await withRetainedDirectoryAuthority(evidenceRoot, root, scanRoot, {
      errorCode: 'EVIDENCE_RETENTION_IDENTITY_INVALID',
    });
  } else {
    await options.rootAuthority.verify();
    await scanRoot(options.rootAuthority);
  }
  return Object.freeze({
    ...metrics,
    operationDirectories,
    retainedOperationDirectories,
    operationDirectoryEntries,
    rootEntries: Object.freeze(rootEntries),
  });
};

export const assertProspectiveEvidenceRetention = async (input: {
  evidenceRoot: string;
  operationDirectoryName: string;
  nextBytes: number;
  limits?: EvidenceRetentionLimits;
  authority?: Readonly<EvidenceRetentionAuthority>;
  rootAuthority?: RetainedDirectoryAuthority;
  metrics?: EvidenceRetentionMetrics;
}): Promise<Readonly<EvidenceRetentionAuthority>> => {
  const limits = input.limits ?? DEFAULT_EVIDENCE_RETENTION_LIMITS;
  const authority =
    input.authority ??
    (await scanEvidenceRetentionAuthority(input.evidenceRoot, limits, {
      ...(input.rootAuthority === undefined ? {} : { rootAuthority: input.rootAuthority }),
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    }));
  if (!Number.isSafeInteger(input.nextBytes) || input.nextBytes < 0) {
    throw retentionError(
      'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
      'prospective retained evidence bytes are invalid',
      authority,
    );
  }
  const nextRows = authority.retainedOperationDirectories.has(input.operationDirectoryName) ? 0 : 1;
  if (
    authority.retainedRows > limits.maxRows - nextRows ||
    authority.retainedBytes > limits.maxBytes - input.nextBytes
  ) {
    throw retentionError(
      'EVIDENCE_RETENTION_CAPACITY_EXCEEDED',
      'prospective evidence retention capacity is exhausted',
      authority,
    );
  }
  return authority;
};
