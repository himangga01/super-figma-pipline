/* eslint-disable no-await-in-loop -- each collected file is bound to its verified authority inventory */
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';

import { readFileWithinLimit } from '../fs/atomic-file.js';
import {
  inventoryNativeArtifact,
  type NativeArtifactObservation,
  type NativeOutputReceipt,
} from './native-artifacts.js';
import {
  NATIVE_MODULE_FENCE_PROTOCOL,
  NATIVE_MODULE_FENCE_SOURCE,
} from './native-module-fence-source.js';
import type { NativeCommand, NativeProfile } from './native-runner.js';
import { portalError } from './store.js';

export interface NativeModuleEvidence {
  protocol: typeof NATIVE_MODULE_FENCE_PROTOCOL;
  policyHash: string;
  directory: string;
  traceFiles: string[];
  approvedInputHash: string;
  traceHash: string;
  processes: number;
  loadedModules: number;
  generatedModules: Array<{
    path: string;
    hash: string;
    bytes: number;
    producerPath: string;
    retained: string;
  }>;
}
export interface NativeModuleFence {
  args: string[];
  environment: Record<string, string>;
  collectEvidence: (required?: boolean) => Promise<NativeModuleEvidence | undefined>;
}
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};
const key = (path: string) =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
/** Materialize the approved guard with a command-local table proven by current inventory digests. */
export const createNativeModuleFence = async (
  profile: NativeProfile,
  command: NativeCommand,
  root: string,
  receipts: NativeOutputReceipt[],
  privateHome: string,
  signal: AbortSignal,
): Promise<NativeModuleFence> => {
  const traceRoot = join(privateHome, `module-${command.id}`);
  await mkdir(traceRoot, { mode: 0o700 });
  const preload = join(traceRoot, 'preload.cjs');
  await writeFile(preload, NATIVE_MODULE_FENCE_SOURCE, { flag: 'wx', mode: 0o600 });
  const observed: NativeArtifactObservation = { files: [], directories: [] };
  for (const file of profile.closure) {
    const start = observed.files.length;
    await inventoryNativeArtifact(resolve(root, file.path), signal, undefined, [], observed);
    if (observed.files[start]?.hash !== file.hash)
      throw portalError('PORTAL_PROFILE_CLOSURE_CHANGED');
    let path = dirname(resolve(root, file.path));
    while (inside(root, path)) {
      const stat = await lstat(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw portalError('PORTAL_NATIVE_ROOT_CHANGED');
      observed.directories.push({ path, identity: `${stat.dev}:${stat.ino}` });
      if (path === root) break;
      path = dirname(path);
    }
  }
  for (const artifact of profile.artifactAuthority!.artifacts) {
    const inventory = await inventoryNativeArtifact(
      artifact.inventory.root,
      signal,
      undefined,
      [],
      observed,
    );
    if (
      inventory.hash !== artifact.inventory.hash ||
      inventory.identity !== artifact.inventory.identity
    )
      throw portalError('PORTAL_ARTIFACT_CHANGED');
  }
  for (const receipt of receipts) {
    const inventory = await inventoryNativeArtifact(
      resolve(root, receipt.path),
      signal,
      undefined,
      receipt.generatedChildren,
      observed,
    );
    if (
      inventory.hash !== receipt.inventory.hash ||
      inventory.identity !== receipt.inventory.identity
    )
      throw portalError('PORTAL_PROVISIONED_OUTPUT_CHANGED');
  }
  const hostProbes: Array<{
    id: 'windows-drive-mapping-v1';
    request: 'net use';
    executable: string;
    args: ['use'];
    timeoutMs: 5000;
    maxBufferPerStream: 524288;
    files: NativeArtifactObservation['files'];
  }> = [];
  for (const probe of profile.artifactAuthority!.hostProbes ?? []) {
    const probeObservation: NativeArtifactObservation = { files: [], directories: [] };
    for (const expected of [probe.executable, probe.helperExecutable]) {
      const inventory = await inventoryNativeArtifact(
        expected.root,
        signal,
        undefined,
        [],
        probeObservation,
      );
      if (inventory.hash !== expected.hash || inventory.identity !== expected.identity)
        throw portalError('PORTAL_ARTIFACT_CHANGED');
    }
    hostProbes.push({
      id: probe.id,
      request: probe.request,
      executable: probe.executable.root,
      args: probe.args,
      timeoutMs: probe.timeoutMs,
      maxBufferPerStream: probe.maxBufferPerStream,
      files: probeObservation.files,
    });
  }
  const previewListener = profile.artifactAuthority!.previewListener;
  if (previewListener) {
    const actual = await inventoryNativeArtifact(
      previewListener.executable.root,
      signal,
      undefined,
      [],
      observed,
    );
    if (
      actual.hash !== previewListener.executable.hash ||
      actual.identity !== previewListener.executable.identity
    )
      throw portalError('PORTAL_ARTIFACT_CHANGED');
  }
  const directoryLease = profile.artifactAuthority!.directoryLease;
  if (directoryLease) {
    const actual = await inventoryNativeArtifact(
      directoryLease.executable.root,
      signal,
      undefined,
      [],
      observed,
    );
    if (
      actual.hash !== directoryLease.executable.hash ||
      actual.identity !== directoryLease.executable.identity
    )
      throw portalError('PORTAL_ARTIFACT_CHANGED');
  }
  await inventoryNativeArtifact(preload, signal, undefined, [], observed);
  const files = [...new Map(observed.files.map(file => [key(file.path), file])).values()];
  const fileIndex = new Map(files.map(file => [key(file.path), file]));
  const directories = [
    ...new Map(observed.directories.map(directory => [key(directory.path), directory])).values(),
  ];
  if (files.length > 128000 || directories.length > 128000)
    throw portalError('PORTAL_NATIVE_MODULE_POLICY_LIMIT');
  const approvedInputHash = contentHash(
    'sfp-native-artifact-authority-v1',
    profile.artifactAuthority,
  );
  const policy = {
    protocol: NATIVE_MODULE_FENCE_PROTOCOL,
    commandId: command.id,
    inputCommandHash: contentHash('sfp-native-module-command-v1', command),
    approvedInputHash,
    traceRoot,
    preload,
    hostProbes,
    previewListener: previewListener
      ? {
          protocol: previewListener.protocol,
          executable: previewListener.executable.root,
          args: previewListener.args,
          ipv6Args: previewListener.ipv6Args,
        }
      : null,
    directoryLease: directoryLease
      ? {
          protocol: directoryLease.protocol,
          executable: directoryLease.executable.root,
          args: directoryLease.args,
        }
      : null,
    files,
    directories,
    producers: (command.produces ?? []).map(output => ({
      root: resolve(root, output.path),
      path: output.path,
      kind: output.kind,
    })),
  };
  const policyBytes = Buffer.from(JSON.stringify(policy));
  if (policyBytes.length > 33554432) throw portalError('PORTAL_NATIVE_MODULE_POLICY_LIMIT');
  const policyHash = storedChecksum(policyBytes),
    policyPath = join(traceRoot, 'policy.json');
  await writeFile(policyPath, policyBytes, { flag: 'wx', mode: 0o600 });
  const options = `--require ${JSON.stringify(preload)}`;
  return {
    args: ['--require', preload, ...command.args],
    environment: {
      NODE_OPTIONS: options,
      SFP_NATIVE_MODULE_POLICY: policyPath,
      SFP_NATIVE_MODULE_POLICY_HASH: policyHash,
    },
    collectEvidence: async (required = true) => {
      if (
        storedChecksum(await readFileWithinLimit(policyPath, 33554432)) !== policyHash ||
        storedChecksum(await readFileWithinLimit(preload, 1048576)) !==
          storedChecksum(NATIVE_MODULE_FENCE_SOURCE)
      )
        throw portalError('PORTAL_NATIVE_MODULE_POLICY_CHANGED');
      const traces = (await readdir(traceRoot))
        .filter(name => /^trace-[0-9]+-[0-9]+\.jsonl$/u.test(name))
        .toSorted();
      if (!traces.length && !required) return undefined;
      if (!traces.length || traces.length > 512)
        throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_REQUIRED');
      let total = 0,
        loadedModules = 0;
      const traceHashes: string[] = [],
        generatedModules: NativeModuleEvidence['generatedModules'] = [];
      for (const name of traces) {
        const path = join(traceRoot, name),
          stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8388608)
          throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_LIMIT');
        total += stat.size;
        if (total > 16777216) throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_LIMIT');
        const bytes = await readFileWithinLimit(path, 8388608);
        traceHashes.push(storedChecksum(bytes));
        const records = bytes
          .toString('utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line) as Record<string, unknown>);
        const first = records[0];
        if (
          first?.kind !== 'start' ||
          first.policyHash !== policyHash ||
          first.protocol !== NATIVE_MODULE_FENCE_PROTOCOL
        )
          throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_REQUIRED');
        for (const record of records) {
          if (record.kind === 'violation')
            throw portalError(
              typeof record.code === 'string' && /^PORTAL_NATIVE_MODULE_[A-Z_]+$/u.test(record.code)
                ? record.code
                : 'PORTAL_NATIVE_MODULE_REJECTED',
            );
          if (record.kind === 'host-probe-start' || record.kind === 'host-probe-finish') {
            if (!hostProbes.some(probe => probe.id === record.probeId))
              throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
          }
          if (record.kind === 'module') {
            const file = fileIndex.get(key(String(record.path)));
            if (
              !file ||
              file.hash !== record.hash ||
              file.identity !== record.identity ||
              file.bytes !== record.bytes
            )
              throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
            loadedModules++;
          }
          if (record.kind === 'generated-module') {
            if (
              typeof record.path !== 'string' ||
              typeof record.hash !== 'string' ||
              typeof record.retained !== 'string' ||
              typeof record.bytes !== 'number' ||
              typeof record.producerPath !== 'string' ||
              !policy.producers.some(
                producer =>
                  producer.path === record.producerPath &&
                  inside(producer.root, record.path as string),
              ) ||
              !inside(traceRoot, record.retained)
            )
              throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
            const retainedStat = await lstat(record.retained);
            if (
              !retainedStat.isFile() ||
              retainedStat.isSymbolicLink() ||
              retainedStat.nlink !== 1 ||
              retainedStat.size !== record.bytes ||
              retainedStat.size > 16777216
            )
              throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
            if (
              storedChecksum(await readFileWithinLimit(record.retained, 16777216)) !== record.hash
            )
              throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
            generatedModules.push({
              path: record.path,
              hash: record.hash,
              bytes: record.bytes,
              producerPath: record.producerPath,
              retained: record.retained,
            });
          }
        }
      }
      return {
        protocol: NATIVE_MODULE_FENCE_PROTOCOL,
        directory: traceRoot,
        traceFiles: traces,
        policyHash,
        approvedInputHash,
        traceHash: contentHash('sfp-native-module-traces-v1', traceHashes),
        processes: traces.length,
        loadedModules,
        generatedModules,
      };
    },
  };
};

/** Recheck retained proof bytes after later commands or a long freshness wait. */
export const verifyNativeModuleEvidence = async (
  evidence: NativeModuleEvidence,
  signal?: AbortSignal,
): Promise<void> => {
  if (
    evidence.protocol !== NATIVE_MODULE_FENCE_PROTOCOL ||
    !isAbsolute(evidence.directory) ||
    evidence.traceFiles.length > 512
  )
    throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
  const policy = await readFileWithinLimit(
    join(evidence.directory, 'policy.json'),
    33554432,
    undefined,
    signal ? { signal } : {},
  );
  const preload = await readFileWithinLimit(
    join(evidence.directory, 'preload.cjs'),
    1048576,
    undefined,
    signal ? { signal } : {},
  );
  if (
    storedChecksum(policy) !== evidence.policyHash ||
    storedChecksum(preload) !== storedChecksum(NATIVE_MODULE_FENCE_SOURCE)
  )
    throw portalError('PORTAL_NATIVE_MODULE_POLICY_CHANGED');
  const hashes: string[] = [];
  let total = 0;
  for (const name of evidence.traceFiles) {
    if (!/^trace-[0-9]+-[0-9]+\.jsonl$/u.test(name))
      throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
    const bytes = await readFileWithinLimit(
      join(evidence.directory, name),
      8388608,
      undefined,
      signal ? { signal } : {},
    );
    total += bytes.length;
    if (total > 16777216) throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_LIMIT');
    hashes.push(storedChecksum(bytes));
  }
  if (contentHash('sfp-native-module-traces-v1', hashes) !== evidence.traceHash)
    throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
  let generatedBytes = 0;
  for (const generated of evidence.generatedModules) {
    if (!inside(evidence.directory, generated.retained))
      throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
    const bytes = await readFileWithinLimit(
      generated.retained,
      16777216,
      undefined,
      signal ? { signal } : {},
    );
    generatedBytes += bytes.length;
    if (
      generatedBytes > 67108864 ||
      bytes.length !== generated.bytes ||
      storedChecksum(bytes) !== generated.hash
    )
      throw portalError('PORTAL_NATIVE_MODULE_EVIDENCE_CHANGED');
  }
};
