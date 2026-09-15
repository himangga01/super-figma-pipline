/* eslint-disable no-await-in-loop -- inventories retain ordered identity checks and bounded streaming reads */
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { contentHash } from '@sfp/ir';
import { PortalHashSchema, PortalPathSchema } from '@sfp/shared';
import { parseSync } from 'oxc-parser';
import { z } from 'zod';

import { windowsDirectoryLeaseInvocation } from '../fs/atomic-file.js';
import {
  NATIVE_MODULE_FENCE_PROTOCOL,
  NATIVE_MODULE_FENCE_SOURCE,
} from './native-module-fence-source.js';
import type { NativeProfile, NativeCommand } from './native-runner.js';
import { previewListenerInvocation } from './preview-listener.js';
import { portalError } from './store.js';
import { windowsJobCommand } from './windows-job.js';

export const NativeArtifactDeclarationSchema = z
  .object({
    root: z.string().min(1).max(2048),
    resolutionPath: z.string().min(1).max(2048).optional(),
    kind: z.enum(['node-package-tree', 'browser-runtime', 'captured-assets', 'service-bundle']),
  })
  .strict();
export const NativeOutputDeclarationSchema = z
  .object({
    path: PortalPathSchema,
    kind: z.enum(['provisioned-dependencies', 'generated-output']),
  })
  .strict();
const InventorySchema = z
  .object({
    root: z.string().max(2048),
    identity: z.string().max(256),
    hash: PortalHashSchema,
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
  })
  .strict();
export const NativeArtifactAuthoritySchema = z
  .object({
    version: z.number().int().positive(),
    configurationHash: PortalHashSchema,
    commandHash: PortalHashSchema,
    artifacts: z
      .array(
        z
          .object({ declaration: NativeArtifactDeclarationSchema, inventory: InventorySchema })
          .strict(),
      )
      .max(128),
    executables: z.array(InventorySchema).max(33),
    previewListener: z
      .object({
        protocol: z.literal('windows-preview-listener-v1'),
        executable: InventorySchema,
        args: z.tuple([z.literal('-ano'), z.literal('-p'), z.literal('tcp')]),
        ipv6Args: z.tuple([z.literal('-ano'), z.literal('-p'), z.literal('tcpv6')]),
      })
      .strict()
      .optional(),
    directoryLease: z
      .object({
        protocol: z.literal('windows-directory-lease-v1'),
        executable: InventorySchema,
        args: z.array(z.string()).length(5),
      })
      .strict()
      .optional(),
    hostProbes: z
      .array(
        z
          .object({
            id: z.literal('windows-drive-mapping-v1'),
            request: z.literal('net use'),
            args: z.tuple([z.literal('use')]),
            timeoutMs: z.literal(5000),
            maxBufferPerStream: z.literal(524288),
            executable: InventorySchema,
            helperExecutable: InventorySchema,
          })
          .strict(),
      )
      .max(1)
      .optional(),
  })
  .strict();
export type NativeArtifactAuthority = z.infer<typeof NativeArtifactAuthoritySchema>;
export type NativeArtifactInventory = z.infer<typeof InventorySchema>;
export interface NativeOutputReceipt {
  producerCommandId: string;
  commandHash: string;
  kind: 'provisioned-dependencies' | 'generated-output';
  path: string;
  inventory: NativeArtifactInventory;
  inputAuthorityHash: string;
  exitCode: 0;
  generatedChildren: string[];
}
const contains = (root: string, path: string) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};
const identity = (stat: { dev: bigint; ino: bigint }) => `${stat.dev}:${stat.ino}`;
export interface NativeArtifactObservation {
  files: Array<{ path: string; identity: string; hash: string; bytes: number; links: string }>;
  directories: Array<{ path: string; identity: string }>;
}
/** Fixed limits: no hidden exclusions. Links must resolve inside the same captured tree. */
export const inventoryNativeArtifact = async (
  rootInput: string,
  signal?: AbortSignal,
  limits = { entries: 100000, bytes: 2_147_483_648, fileBytes: 536_870_912 },
  generatedChildren: string[] = [],
  observation?: NativeArtifactObservation,
): Promise<NativeArtifactInventory> => {
  if (!isAbsolute(rootInput)) throw portalError('PORTAL_ARTIFACT_ABSOLUTE_REQUIRED');
  const root = resolve(rootInput);
  if (relative(root, await realpath(root)) !== '') throw portalError('PORTAL_ARTIFACT_ROOT_ALIAS');
  const initial = await lstat(root, { bigint: true });
  if (initial.isSymbolicLink() || (!initial.isFile() && !initial.isDirectory()))
    throw portalError('PORTAL_ARTIFACT_INVALID');
  const digest = createHash('sha256');
  let entries = 0,
    bytes = 0,
    files = 0;
  const add = (value: unknown) => {
    const encoded = JSON.stringify(value);
    digest.update(`${Buffer.byteLength(encoded)}:`);
    digest.update(encoded);
  };
  for (const path of generatedChildren) PortalPathSchema.parse(path);
  if (generatedChildren.length > 512) throw portalError('PORTAL_ARTIFACT_LIMIT');
  if (generatedChildren.length) add(['generated-children', generatedChildren.toSorted()]);
  const walk = async (path: string): Promise<void> => {
    signal?.throwIfAborted();
    if (++entries > limits.entries) throw portalError('PORTAL_ARTIFACT_LIMIT');
    const stat = await lstat(path, { bigint: true }),
      part = relative(root, path).replaceAll('\\', '/');
    if (generatedChildren.includes(part)) return;
    if (path === root && identity(stat) !== identity(initial))
      throw portalError('PORTAL_ARTIFACT_CHANGED');
    if (stat.isSymbolicLink()) {
      const target = await realpath(path);
      if (!initial.isDirectory() || !contains(root, target))
        throw portalError('PORTAL_ARTIFACT_LINK_OUTSIDE_ROOT');
      const link = await readlink(path),
        targetStat = await lstat(target, { bigint: true });
      const afterLink = await lstat(path, { bigint: true });
      if (
        identity(afterLink) !== identity(stat) ||
        afterLink.mtimeNs !== stat.mtimeNs ||
        afterLink.ctimeNs !== stat.ctimeNs ||
        (await realpath(path)) !== target ||
        (await readlink(path)) !== link
      )
        throw portalError('PORTAL_ARTIFACT_CHANGED');
      add(['link', part, identity(stat), link, relative(root, target), identity(targetStat)]);
      return;
    }
    if (stat.isDirectory()) {
      const children = (await readdir(path)).toSorted();
      if (
        new Set(children.map(name => name.normalize('NFC').toLowerCase())).size !== children.length
      )
        throw portalError('PORTAL_ARTIFACT_PATH_ALIAS');
      add(['directory', part, identity(stat)]);
      observation?.directories.push({ path, identity: identity(stat) });
      for (const child of children) await walk(join(path, child));
      const after = await lstat(path, { bigint: true });
      if (
        identity(after) !== identity(stat) ||
        after.mtimeNs !== stat.mtimeNs ||
        after.ctimeNs !== stat.ctimeNs
      )
        throw portalError('PORTAL_ARTIFACT_CHANGED');
      return;
    }
    if (!stat.isFile() || stat.nlink < 1n) throw portalError('PORTAL_ARTIFACT_UNSUPPORTED_FILE');
    bytes += Number(stat.size);
    files++;
    if (stat.size > BigInt(limits.fileBytes) || bytes > limits.bytes)
      throw portalError('PORTAL_ARTIFACT_LIMIT');
    const handle = await open(path, 'r');
    try {
      const held = await handle.stat({ bigint: true });
      if (
        identity(held) !== identity(stat) ||
        held.size !== stat.size ||
        held.nlink !== stat.nlink ||
        held.mtimeNs !== stat.mtimeNs ||
        held.ctimeNs !== stat.ctimeNs
      )
        throw portalError('PORTAL_ARTIFACT_CHANGED');
      const hash = createHash('sha256'),
        buffer = Buffer.alloc(65536);
      let position = 0;
      while (position < Number(held.size)) {
        signal?.throwIfAborted();
        const read = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, Number(held.size) - position),
          position,
        );
        if (!read.bytesRead) throw portalError('PORTAL_ARTIFACT_CHANGED');
        hash.update(buffer.subarray(0, read.bytesRead));
        position += read.bytesRead;
      }
      const after = await lstat(path, { bigint: true });
      if (
        identity(after) !== identity(held) ||
        after.size !== held.size ||
        after.mtimeNs !== held.mtimeNs ||
        after.ctimeNs !== held.ctimeNs ||
        after.nlink !== held.nlink
      )
        throw portalError('PORTAL_ARTIFACT_CHANGED');
      const fileDigest = hash.digest('hex');
      add(['file', part, identity(held), Number(held.size), String(held.nlink), fileDigest]);
      observation?.files.push({
        path,
        identity: identity(held),
        hash: `sha256:${fileDigest}`,
        bytes: Number(held.size),
        links: String(held.nlink),
      });
    } finally {
      await handle.close();
    }
  };
  await walk(root);
  return {
    root,
    identity: identity(initial),
    hash: `sha256:${digest.digest('hex')}`,
    files,
    bytes,
    entries,
  };
};
const configuration = (environment: Record<string, string>) => ({
  version: 1,
  hostProbe:
    process.platform === 'win32'
      ? {
          id: 'windows-drive-mapping-v1',
          request: 'net use',
          executable: join(process.env.SystemRoot!, 'System32', 'net.exe'),
          helperExecutable: join(process.env.SystemRoot!, 'System32', 'net1.exe'),
          args: ['use'],
          timeoutMs: 5000,
          maxBufferPerStream: 524288,
          role: 'fixed-read-only-query-no-shell',
        }
      : null,
  moduleFence: {
    protocol: NATIVE_MODULE_FENCE_PROTOCOL,
    sourceHash: contentHash('sfp-native-module-preload-v1', NATIVE_MODULE_FENCE_SOURCE),
    injection: 'root-require-and-child-worker-propagation-v1',
    evidence: 'resolved-input-and-produced-module-bytes-v1',
  },
  platform: process.platform,
  environment,
  privateEnvironmentPolicy: 'native-private-home-v1',
  replacements: [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'NPM_CONFIG_USERCONFIG',
    'NPM_CONFIG_GLOBALCONFIG',
    'NPM_CONFIG_CACHE',
    'COREPACK_HOME',
    'PNPM_HOME',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_NOSYSTEM',
    'GIT_TERMINAL_PROMPT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ],
  emptyFiles: ['npmrc', 'global-npmrc', 'gitconfig'],
  systemRoot: process.platform === 'win32' ? process.env.SystemRoot : null,
  windir: process.platform === 'win32' ? process.env.WINDIR : null,
  broker:
    process.platform === 'win32'
      ? windowsJobCommand(process.env.SystemRoot!, '', [], '.', 100)
      : null,
  osPrerequisite:
    'Owner-account execution; operating-system libraries, kernel and system PowerShell/.NET are trusted host prerequisites, not a frozen filesystem or sandbox.',
});
export const prepareNativeArtifactAuthority = async (
  profile: NativeProfile,
  signal?: AbortSignal,
): Promise<NativeArtifactAuthority> => {
  const declarations = [...(profile.externalArtifacts ?? [])];
  for (const declaration of profile.externalArtifacts ?? []) {
    if (declaration.kind !== 'node-package-tree') continue;
    const manifest = await nativePackageManifest(declaration.root);
    if (manifest?.dependencies)
      for (const dependency of await nativePackageTrees(
        join(declaration.root, 'package.json'),
        Object.keys(manifest.dependencies),
      ))
        if (
          !declarations.some(
            value =>
              contains(value.root, dependency.root) &&
              (!dependency.resolutionPath || contains(value.root, dependency.resolutionPath)),
          )
        )
          declarations.push(dependency);
  }
  for (const command of profile.commands) {
    let entry: string | undefined;
    for (const argument of command.args) {
      if (['-e', '--eval', '-p', '--print'].includes(argument)) break;
      if (argument.startsWith('-')) continue;
      entry = argument;
      break;
    }
    if (!entry || !isAbsolute(entry)) continue;
    const declaration = declarations.find(
      value =>
        ['node-package-tree', 'service-bundle'].includes(value.kind) && contains(value.root, entry),
    );
    if (!declaration) continue;
    if (/npm-cli\.(?:c?js|mjs)$/iu.test(basename(entry))) {
      const manifest = await nativePackageManifest(declaration.root);
      if (
        manifest?.name !== 'npm' ||
        relative(declaration.root, entry).replaceAll('\\', '/') !== 'bin/npm-cli.js'
      )
        throw portalError('PORTAL_NATIVE_PACKAGE_MANAGER_UNSUPPORTED');
    } else {
      for (const dependency of await nativeScriptPackageTrees(entry, declaration.root)) {
        if (
          !declarations.some(
            value =>
              value.root === dependency.root && value.resolutionPath === dependency.resolutionPath,
          )
        )
          declarations.push(dependency);
      }
    }
  }
  if (declarations.length > 128) throw portalError('PORTAL_ARTIFACT_LIMIT');
  declarations.sort((a, b) => a.root.localeCompare(b.root));
  const artifacts = [];
  let totalBytes = 0,
    totalEntries = 0;
  for (const declaration of declarations) {
    if (
      declaration.resolutionPath &&
      (await realpath(declaration.resolutionPath)) !== resolve(declaration.root)
    )
      throw portalError('PORTAL_ARTIFACT_RESOLUTION_CHANGED');
    const inventory = await inventoryNativeArtifact(declaration.root, signal);
    totalBytes += inventory.bytes;
    totalEntries += inventory.entries;
    if (totalBytes > 8_589_934_592 || totalEntries > 500000)
      throw portalError('PORTAL_ARTIFACT_LIMIT');
    artifacts.push({ declaration, inventory });
  }
  const paths = [
    ...new Set([
      ...profile.commands.map(command => command.executable),
      ...(process.platform === 'win32'
        ? [windowsJobCommand(process.env.SystemRoot!, '', [], '.', 100).executable]
        : []),
    ]),
  ];
  const executables = [];
  for (const path of paths) executables.push(await inventoryNativeArtifact(path, signal));
  const hostProbes: NonNullable<NativeArtifactAuthority['hostProbes']> =
    process.platform === 'win32'
      ? [
          {
            id: 'windows-drive-mapping-v1',
            request: 'net use',
            args: ['use'],
            timeoutMs: 5000,
            maxBufferPerStream: 524288,
            executable: await inventoryNativeArtifact(
              join(process.env.SystemRoot!, 'System32', 'net.exe'),
              signal,
            ),
            helperExecutable: await inventoryNativeArtifact(
              join(process.env.SystemRoot!, 'System32', 'net1.exe'),
              signal,
            ),
          },
        ]
      : [];
  return {
    version: 1,
    ...(process.platform === 'win32' && profile.commands.some(command => command.preview)
      ? {
          previewListener: {
            protocol: previewListenerInvocation().protocol,
            executable: await inventoryNativeArtifact(
              previewListenerInvocation().executable,
              signal,
            ),
            args: ['-ano', '-p', 'tcp'] as const,
            ipv6Args: ['-ano', '-p', 'tcpv6'] as const,
          },
          directoryLease: {
            protocol: windowsDirectoryLeaseInvocation().protocol,
            executable: await inventoryNativeArtifact(
              windowsDirectoryLeaseInvocation().executable,
              signal,
            ),
            args: windowsDirectoryLeaseInvocation().args,
          },
        }
      : {}),
    hostProbes,
    configurationHash: contentHash(
      'sfp-native-effective-configuration-v1',
      configuration(profile.environment),
    ),
    commandHash: contentHash('sfp-native-artifact-input-v1', {
      commands: profile.commands,
      closure: profile.closure,
      sourceHash: profile.sourceHash,
    }),
    artifacts,
    executables,
  };
};
export const verifyNativeArtifactAuthority = async (
  profile: NativeProfile,
  signal?: AbortSignal,
): Promise<void> => {
  if (!profile.artifactAuthority) throw portalError('PORTAL_ARTIFACT_AUTHORITY_REQUIRED');
  if (profile.artifactAuthority.version !== 1)
    throw portalError('PORTAL_ARTIFACT_AUTHORITY_VERSION_UNSUPPORTED');
  const actual = await prepareNativeArtifactAuthority(profile, signal);
  if (
    contentHash('sfp-native-artifact-authority-v1', actual) !==
    contentHash('sfp-native-artifact-authority-v1', profile.artifactAuthority)
  )
    throw portalError('PORTAL_ARTIFACT_CHANGED');
};
/**
 * Node interpreter flags are a supported allowlist; arbitrary dynamic loader flags are
 * prerequisites.
 */
export const verifyNativeCommandInputs = async (
  profile: NativeProfile,
  command: NativeCommand,
  root: string,
  receipts: NativeOutputReceipt[],
): Promise<void> => {
  if (!/^node(?:\.exe)?$/iu.test(basename(command.executable)))
    throw portalError('PORTAL_NATIVE_INTERPRETER_UNSUPPORTED');
  const args = command.args;
  let entry: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-e' || arg === '--eval' || arg === '-p' || arg === '--print') {
      if (!args[i + 1]) throw portalError('PORTAL_NATIVE_ENTRYPOINT_REQUIRED');
      return;
    }
    if (['--no-warnings', '--experimental-sqlite', '--enable-source-maps'].includes(arg)) continue;
    if (arg.startsWith('-')) throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
    entry = arg;
    break;
  }
  if (!entry) throw portalError('PORTAL_NATIVE_ENTRYPOINT_REQUIRED');
  if (/^(?:pnpm|yarn|corepack)(?:-cli)?\.(?:c?js|mjs)$/iu.test(basename(entry)))
    throw portalError('PORTAL_NATIVE_PACKAGE_MANAGER_UNSUPPORTED');
  const path = resolve(root, command.cwd, entry),
    part = relative(root, path).replaceAll('\\', '/');
  if (contains(root, path) && profile.closure.some(file => file.path === part)) return;
  if (receipts.some(receipt => contains(resolve(root, receipt.path), path))) return;
  const artifact = profile.artifactAuthority?.artifacts.find(
    value =>
      ['node-package-tree', 'service-bundle'].includes(value.declaration.kind) &&
      contains(value.inventory.root, path),
  );
  if (!artifact) throw portalError('PORTAL_NATIVE_ENTRYPOINT_UNBOUND');
  if (/npm-cli\.(?:c?js|mjs)$/iu.test(basename(path))) {
    const index = args.indexOf(entry),
      tail = args.slice(index + 1);
    if (
      !['ci', 'install'].includes(tail[0] ?? '') ||
      !tail.includes('--ignore-scripts') ||
      tail
        .slice(1)
        .some(arg => !['--ignore-scripts', '--offline', '--no-audit', '--no-fund'].includes(arg)) ||
      command.allowLifecycleScripts
    )
      throw portalError('PORTAL_NATIVE_PACKAGE_MANAGER_UNSUPPORTED');
    if (
      !profile.closure.some(file => file.path === 'package-lock.json') ||
      !profile.closure.some(file => file.path === 'package.json') ||
      !command.produces?.some(
        output => output.path === 'node_modules' && output.kind === 'provisioned-dependencies',
      )
    )
      throw portalError('PORTAL_PROVISIONING_INPUTS_REQUIRED');
  }
};
export const verifyNativeOutputReceipts = async (
  root: string,
  receipts: NativeOutputReceipt[],
  signal: AbortSignal,
): Promise<void> => {
  for (const receipt of receipts) {
    const actual = await inventoryNativeArtifact(
      resolve(root, receipt.path),
      signal,
      undefined,
      receipt.generatedChildren,
    );
    if (actual.hash !== receipt.inventory.hash || actual.identity !== receipt.inventory.identity)
      throw portalError('PORTAL_PROVISIONED_OUTPUT_CHANGED');
  }
};

/** Resolve package manifests using the same installation as the importing bundle. */
export const nativePackageTrees = async (
  entry: string,
  names: string[],
): Promise<z.infer<typeof NativeArtifactDeclarationSchema>[]> => {
  const found = new Set<string>();
  const declarations: z.infer<typeof NativeArtifactDeclarationSchema>[] = [];
  const visit = async (from: string, name: string): Promise<void> => {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name))
      throw portalError('PORTAL_ARTIFACT_PACKAGE_UNRESOLVED');
    let base = dirname(from),
      lexicalRoot: string | undefined;
    for (let depth = 0; depth < 64; depth++) {
      const candidate = join(base, 'node_modules', name);
      const stat = await lstat(join(candidate, 'package.json')).catch(error => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      });
      if (stat) {
        lexicalRoot = candidate;
        break;
      }
      const parent = dirname(base);
      if (parent === base) break;
      base = parent;
    }
    if (!lexicalRoot) throw portalError('PORTAL_ARTIFACT_PACKAGE_UNRESOLVED');
    const root = await realpath(lexicalRoot);
    if (!declarations.some(value => value.resolutionPath === lexicalRoot))
      declarations.push({ root, resolutionPath: lexicalRoot, kind: 'node-package-tree' });
    if (found.has(root)) return;
    found.add(root);
    if (found.size > 1024 || declarations.length > 4096) throw portalError('PORTAL_ARTIFACT_LIMIT');
    const manifest = await nativePackageManifest(root);
    if (!manifest || manifest.name !== name)
      throw portalError('PORTAL_ARTIFACT_PACKAGE_UNRESOLVED');
    for (const dependency of Object.keys(manifest.dependencies ?? {}).toSorted())
      await visit(join(root, 'package.json'), dependency);
    for (const dependency of Object.keys(manifest.peerDependencies ?? {}).toSorted()) {
      try {
        await visit(join(root, 'package.json'), dependency);
      } catch (error) {
        if (
          !manifest.peerDependenciesMeta?.[dependency]?.optional ||
          (error as { code?: string }).code !== 'PORTAL_ARTIFACT_PACKAGE_UNRESOLVED'
        )
          throw error;
      }
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}).toSorted()) {
      try {
        await visit(join(root, 'package.json'), dependency);
      } catch (error) {
        if ((error as { code?: string }).code !== 'PORTAL_ARTIFACT_PACKAGE_UNRESOLVED') throw error;
      }
    }
  };
  for (const name of names) await visit(entry, name);
  return declarations.toSorted((a, b) => a.root.localeCompare(b.root));
};
interface NativePackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
const nativePackageManifest = async (root: string): Promise<NativePackageManifest | null> => {
  const path = join(root, 'package.json');
  const stat = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576)
    throw portalError('PORTAL_ARTIFACT_MANIFEST_UNSUPPORTED');
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(1048577);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > 1048576) throw portalError('PORTAL_ARTIFACT_MANIFEST_UNSUPPORTED');
    return JSON.parse(bytes.subarray(0, length).toString('utf8')) as NativePackageManifest;
  } finally {
    await handle.close();
  }
};

export const verifyNativeWorkingMembership = async (
  root: string,
  profile: NativeProfile,
  allowedOutputs: string[],
  privateHome: string,
  signal: AbortSignal,
): Promise<void> => {
  const expected = new Set(profile.closure.map(file => file.path));
  let entries = 0;
  const visit = async (path: string): Promise<void> => {
    signal.throwIfAborted();
    if (++entries > 20000) throw portalError('PORTAL_ARTIFACT_LIMIT');
    const part = relative(root, path).replaceAll('\\', '/');
    if (path === privateHome || allowedOutputs.includes(part)) return;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw portalError('PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED');
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
      return;
    }
    if (!stat.isFile() || !expected.delete(part))
      throw portalError('PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED');
  };
  await visit(root);
  if (expected.size) throw portalError('PORTAL_PROFILE_CLOSURE_MEMBERSHIP_CHANGED');
};

/** Supported service bundles and external harnesses use literal static module references. */
export const nativeScriptPackageTrees = async (
  entry: string,
  boundary: string,
): Promise<z.infer<typeof NativeArtifactDeclarationSchema>[]> => {
  const pending = [entry],
    seen = new Set<string>(),
    packages: z.infer<typeof NativeArtifactDeclarationSchema>[] = [];
  let bytes = 0;
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    if (seen.size > 1024 || !contains(boundary, path))
      throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16777216)
      throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
    bytes += stat.size;
    if (bytes > 134217728) throw portalError('PORTAL_ARTIFACT_LIMIT');
    const code = await readFile(path, 'utf8');
    const parsed = parseSync(path, code);
    if (parsed.errors.length) throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
    const specifications: string[] = [],
      nodes: unknown[] = [parsed.program];
    let count = 0;
    while (nodes.length) {
      const node = nodes.pop();
      if (!node || typeof node !== 'object') continue;
      if (++count > 1000000) throw portalError('PORTAL_ARTIFACT_LIMIT');
      if (Array.isArray(node)) {
        nodes.push(...node);
        continue;
      }
      const record = node as Record<string, unknown>;
      const loaderKey = (record.imported ?? record.property ?? record.key) as
        | { name?: unknown; value?: unknown }
        | undefined;
      if (
        loaderKey &&
        ['createRequire', '_load'].includes(String(loaderKey.name ?? loaderKey.value))
      )
        throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
      let spec: unknown;
      if (
        [
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
        ].includes(String(record.type))
      )
        spec = record.source;
      if (record.type === 'CallExpression') {
        const callee = record.callee as Record<string, unknown> | undefined;
        if (callee?.type === 'Identifier' && callee.name === 'createRequire')
          throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
        if (callee?.type === 'Identifier' && callee.name === 'require')
          spec = (record.arguments as unknown[])[0];
      }
      if (spec !== undefined && spec !== null) {
        const value = (spec as { value?: unknown }).value;
        if (typeof value !== 'string') throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
        specifications.push(value);
      }
      for (const [key, value] of Object.entries(record))
        if (!['loc', 'comments', 'parent'].includes(key) && value && typeof value === 'object')
          nodes.push(value);
    }
    for (const specifier of specifications) {
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith('.')) {
        const dependency = resolve(dirname(path), specifier);
        if (!contains(boundary, dependency)) throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
        if (!/\.(?:mjs|cjs|js)$/iu.test(dependency))
          throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
        pending.push(dependency);
      } else {
        if (specifier.startsWith('/') || specifier.includes(':') || specifier.startsWith('#'))
          throw portalError('PORTAL_NATIVE_LOADER_UNSUPPORTED');
        const pieces = specifier.split('/'),
          name = specifier.startsWith('@') ? pieces.slice(0, 2).join('/') : pieces[0]!;
        packages.push(...(await nativePackageTrees(path, [name])));
      }
    }
  }
  return packages.filter(
    (value, index) =>
      packages.findIndex(
        other => other.root === value.root && other.resolutionPath === value.resolutionPath,
      ) === index,
  );
};
