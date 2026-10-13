/* eslint-disable no-await-in-loop -- bounded capture retains ordered source and artifact checks */
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import type { PortalSourceInventory } from '@sfp/shared';

import { RepoReader } from '../fs/repo-walk.js';
import type { NativeArtifactAuthority, NativeArtifactObservation } from './native-artifacts.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const portable = (path: string) =>
  path.length > 0 &&
  path.length <= 2048 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/^(?:\.\.(?:\/|$)|[A-Za-z]:)/u.test(path) &&
  !/[%:]/u.test(path) &&
  ![...path].some(char => char.charCodeAt(0) < 32) &&
  posix.normalize(path) === path;
const contains = (root: string, path: string) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};

/** JSONC data only. No repository or package module is loaded or evaluated. */
export const parsePackageConfigJsonc = (input: string): unknown => {
  const output = [...input];
  let quote = false;
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === '"') quote = false;
    } else if (char === '"') quote = true;
    else if (char === '/' && output[i + 1] === '/') {
      while (i < output.length && output[i] !== '\n') output[i++] = ' ';
    } else if (char === '/' && output[i + 1] === '*') {
      output[i++] = ' ';
      output[i++] = ' ';
      while (i < output.length && !(output[i] === '*' && output[i + 1] === '/')) {
        if (output[i] !== '\n' && output[i] !== '\r') output[i] = ' ';
        i++;
      }
      if (i >= output.length) throw new Error('Unterminated comment');
      output[i] = ' ';
      output[++i] = ' ';
    }
  }
  quote = false;
  for (let i = 0; i < output.length; i++) {
    if (quote) {
      if (output[i] === '\\') i++;
      else if (output[i] === '"') quote = false;
    } else if (output[i] === '"') quote = true;
    else if (output[i] === ',') {
      let next = i + 1;
      while (next < output.length && /\s/u.test(output[next] ?? '')) next++;
      if (output[next] === '}' || output[next] === ']') output[i] = ' ';
    }
  }
  return JSON.parse(output.join('').replace(/^\uFEFF/u, ''));
};

export interface PackageConfigEvidence {
  readonly hash: `sha256:${string}`;
  readonly sourceInventoryHash: string;
  readonly issues: readonly string[];
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly ownerManifest: string;
    readonly root: string;
    readonly manifestHash: string;
    readonly lockPath: string;
    readonly lockHash: string;
    readonly integrity: string;
    readonly artifactHash: string;
    readonly configurations: readonly {
      readonly path: string;
      readonly hash: string;
      readonly bytes: number;
    }[];
  }[];
}
interface Admission {
  sourceBinding: string;
  sources: Map<string, string>;
  targets: Map<string, string>;
  evidence: PackageConfigEvidence;
}
const admitted = new WeakMap<PackageConfigEvidence, Admission>();
const sourceBinding = (sources: ReadonlyMap<string, string>, paths: readonly string[]) => {
  let bytes = 0;
  if (sources.size > 5000 || paths.length > 5000) return 'limit';
  for (const text of sources.values()) {
    const size = Buffer.byteLength(text);
    bytes += size;
    if (size > 262_144 || bytes > 8_388_608) return 'limit';
  }
  return contentHash('sfp-package-config-source-v1', {
    sources: [...sources].toSorted(([a], [b]) => a.localeCompare(b)),
    paths: [...paths].toSorted(),
  });
};

/** An opaque in-process capture cannot be reconstructed from an untrusted serialized receipt. */
export const admittedPackageConfigEvidence = (
  evidence: PackageConfigEvidence,
  sources: ReadonlyMap<string, string>,
  paths: readonly string[],
) => {
  const capture = admitted.get(evidence);
  if (!capture || capture.sourceBinding !== sourceBinding(sources, paths)) return null;
  return {
    sources: new Map(capture.sources),
    targets: new Map(capture.targets),
    evidence: capture.evidence,
  };
};

const exportsTarget = (value: unknown, depth = 0): string | null => {
  if (typeof value === 'string') return value;
  if (!object(value) || depth >= 8) return null;
  for (const [condition, target] of Object.entries(value)) {
    if (condition.startsWith('.') || /^\d/u.test(condition)) return null;
    if (['types', 'require', 'node', 'default'].includes(condition))
      return exportsTarget(target, depth + 1);
  }
  return null;
};
const compilerSensitiveSelection = (manifest: Record<string, unknown>): boolean => {
  // Compiler version is not part of this data-only adapter's authority. Never skip a
  // version-sensitive branch and attest a fallback that TypeScript might not select.
  if (manifest.typesVersions !== undefined) return true;
  const pending = [{ value: manifest.exports, depth: 0 }];
  let visits = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++visits > 4096 || depth >= 8) return true;
    if (Array.isArray(value)) {
      for (const child of value) pending.push({ value: child, depth: depth + 1 });
    } else if (object(value)) {
      for (const [condition, target] of Object.entries(value)) {
        if (condition.startsWith('types@')) return true;
        pending.push({ value: target, depth: depth + 1 });
      }
    }
    if (pending.length > 4096) return true;
  }
  return false;
};
const declaredVersion = (selector: string, version: string) => {
  const match = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/u.exec(selector);
  const installed = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match || !installed) return false;
  const wanted = match.slice(2).map(Number),
    actual = installed.slice(1).map(Number);
  if (!match[1]) return version === selector;
  if (actual[0] !== wanted[0]) return false;
  if (match[1] === '~' || wanted[0] === 0) {
    if (actual[1] !== wanted[1]) return false;
    if (wanted[0] === 0 && wanted[1] === 0 && match[1] === '^') return actual[2] === wanted[2];
  }
  return actual[1]! > wanted[1]! || (actual[1] === wanted[1] && actual[2]! >= wanted[2]!);
};

/** Capture bounded installed JSONC after matching the explicitly admitted package-tree bytes. */
export const capturePackageConfigEvidence = async (
  reader: RepoReader,
  sources: ReadonlyMap<string, string>,
  inventory: PortalSourceInventory,
  authorityInput: NativeArtifactAuthority,
): Promise<PackageConfigEvidence> => {
  // Keep pure source resolution independent of artifact authority initialization.
  // Runtime validation is loaded only for an explicitly requested asynchronous capture.
  const { inventoryNativeArtifact, NativeArtifactAuthoritySchema } =
    await import('./native-artifacts.js');
  const issues = new Set<string>();
  const problem = (code: string, path: string) => {
    if (issues.size < 128) issues.add(`PACKAGE_CONFIG_${code}:${path}`);
  };
  const configs = new Map<string, string>(),
    targets = new Map<string, string>();
  const packages: PackageConfigEvidence['packages'][number][] = [];
  const members = new Map(inventory.files.map(file => [file.path, file]));
  const validated = new Map<
    string,
    {
      files: Map<string, NativeArtifactObservation['files'][number]>;
      directories: Map<string, string>;
    }
  >();
  const roots = NativeArtifactAuthoritySchema.safeParse(authorityInput);
  const binding = sourceBinding(
    sources,
    inventory.files.map(file => file.path),
  );
  if (binding === 'limit') problem('SOURCE_LIMIT', '.');
  let visited = 0,
    textBytes = 0;
  const checkedSource = async (path: string, text?: string) => {
    const member = members.get(path);
    if (!member || member.bytes > 8_388_608) throw new Error('source-binding');
    const bytes = await reader.readBytes(path, 8_388_608);
    if (
      storedChecksum(bytes) !== member.hash ||
      (text !== undefined && new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text)
    )
      throw new Error('source-binding');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  const capturePackage = async (from: string, specifier: string, chain: string[]) => {
    if (!roots.success || !inventory.complete) throw new Error('authority');
    const match =
      /^(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_./-]+))?$/u.exec(
        specifier,
      );
    if (!match || specifier.includes('..') || specifier.length > 512) throw new Error('specifier');
    const name = match[1]!,
      subpath = match[2];
    const owner = [...sources.keys()]
      .filter(
        path =>
          posix.basename(path) === 'package.json' &&
          (posix.dirname(path) === '.' || from.startsWith(posix.dirname(path) + '/')),
      )
      .toSorted((a, b) => b.length - a.length)[0];
    if (!owner) throw new Error('owner');
    const ownerManifest: unknown = JSON.parse(await checkedSource(owner, sources.get(owner)));
    if (!object(ownerManifest)) throw new Error('owner');
    const selectors = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(field =>
      object(ownerManifest[field]) && typeof ownerManifest[field][name] === 'string'
        ? [ownerManifest[field][name] as string]
        : [],
    );
    if (!selectors.length || new Set(selectors).size !== 1) throw new Error('declaration');
    let directory = posix.dirname(from),
      logicalRoot: string | undefined,
      root: string | undefined;
    while (true) {
      const candidate = posix.join(directory, 'node_modules', name);
      const physical = resolve(reader.rootDir, candidate);
      try {
        root = await realpath(physical);
        logicalRoot = candidate;
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
      if (directory === '.') break;
      directory = posix.dirname(directory);
    }
    if (!root || !logicalRoot) throw new Error('missing');
    const declarations = roots.data.artifacts.filter(
      ({ declaration }) =>
        declaration.kind === 'node-package-tree' &&
        contains(resolve(declaration.root), root!) &&
        (contains(resolve(declaration.root), resolve(reader.rootDir, logicalRoot!)) ||
          declaration.resolutionPath === resolve(reader.rootDir, logicalRoot!)),
    );
    if (declarations.length !== 1) throw new Error('authority');
    const artifact = declarations[0]!;
    if (
      artifact.declaration.resolutionPath &&
      (await realpath(artifact.declaration.resolutionPath)) !== resolve(artifact.declaration.root)
    )
      throw new Error('resolution-binding');
    if (!validated.has(artifact.declaration.root)) {
      const observation: NativeArtifactObservation = { files: [], directories: [] };
      const current = await inventoryNativeArtifact(
        artifact.declaration.root,
        undefined,
        undefined,
        [],
        observation,
      );
      if (JSON.stringify(current) !== JSON.stringify(artifact.inventory))
        throw new Error('artifact-changed');
      validated.set(artifact.declaration.root, {
        files: new Map(observation.files.map(file => [file.path, file])),
        directories: new Map(observation.directories.map(dir => [dir.path, dir.identity])),
      });
    }
    const observation = validated.get(artifact.declaration.root)!;
    const rootStat = await lstat(root, { bigint: true });
    if (observation.directories.get(root) !== `${rootStat.dev}:${rootStat.ino}`)
      throw new Error('package-root-changed');
    const packageReader = new RepoReader({
      rootDir: root,
      maxFileBytes: 262_144,
      maxTotalBytes: 8_388_608,
    });
    const packageBytes = async (part: string) => {
      const path = resolve(root!, part);
      const member = observation.files.get(path);
      if (!member) throw new Error('artifact-member-missing');
      const bytes = await packageReader.readBytes(part, 262_144);
      const current = await lstat(path, { bigint: true });
      if (
        storedChecksum(bytes) !== member.hash ||
        `${current.dev}:${current.ino}` !== member.identity ||
        bytes.length !== member.bytes ||
        String(current.nlink) !== member.links
      )
        throw new Error('artifact-member-changed');
      return bytes;
    };
    const manifestBytes = await packageBytes('package.json');
    textBytes += manifestBytes.length;
    if (textBytes > 1_048_576) throw new Error('limit');
    const manifest: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    );
    if (
      !object(manifest) ||
      manifest.name !== name ||
      typeof manifest.version !== 'string' ||
      !declaredVersion(selectors[0]!, manifest.version)
    )
      throw new Error('identity');
    if (compilerSensitiveSelection(manifest)) throw new Error('compiler-selection-unsupported');
    const locks = inventory.files
      .filter(
        file =>
          /(?:^|\/)(?:package-lock|npm-shrinkwrap)\.json$/u.test(file.path) &&
          (posix.dirname(file.path) === '.' || owner.startsWith(posix.dirname(file.path) + '/')),
      )
      .toSorted((a, b) => b.path.length - a.path.length);
    if (
      !locks.length ||
      (locks[1] && posix.dirname(locks[0]!.path) === posix.dirname(locks[1].path))
    )
      throw new Error('lock');
    const lockPath = locks[0]!.path;
    const lock: unknown = JSON.parse(await checkedSource(lockPath));
    const entry =
      object(lock) && object(lock.packages)
        ? lock.packages[posix.relative(posix.dirname(lockPath), logicalRoot)]
        : undefined;
    if (
      !object(lock) ||
      ![2, 3].includes(Number(lock.lockfileVersion)) ||
      !object(entry) ||
      entry.version !== manifest.version ||
      typeof entry.integrity !== 'string' ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/u.test(entry.integrity) ||
      entry.link === true
    )
      throw new Error('lock');
    let selected: string | null;
    if (manifest.exports !== undefined) {
      const exports = manifest.exports;
      const key = subpath ? `./${subpath}` : '.';
      if (
        object(exports) &&
        Object.keys(exports).some(k => k.startsWith('.')) &&
        Object.keys(exports).some(k => k !== '.' && !k.startsWith('./'))
      )
        throw new Error('exports-shape');
      selected =
        object(exports) && Object.keys(exports).some(k => k.startsWith('.'))
          ? exportsTarget(exports[key])
          : key === '.'
            ? exportsTarget(exports)
            : null;
    } else
      selected = subpath
        ? `./${subpath}${subpath.endsWith('.json') ? '' : '.json'}`
        : typeof manifest.tsconfig === 'string'
          ? manifest.tsconfig
          : './tsconfig.json';
    if (!selected?.startsWith('./') || !selected.endsWith('.json') || !portable(selected.slice(2)))
      throw new Error('target');
    const record = {
      name,
      version: manifest.version,
      ownerManifest: owner,
      root,
      manifestHash: storedChecksum(manifestBytes),
      lockPath,
      lockHash: members.get(lockPath)!.hash,
      integrity: entry.integrity,
      artifactHash: artifact.inventory.hash,
      configurations: [] as { path: string; hash: string; bytes: number }[],
    };
    const visitPackage = async (part: string, ancestors: string[]): Promise<void> => {
      const path = posix.join(logicalRoot!, part);
      if (ancestors.includes(path) || ancestors.length >= 32 || ++visited > 128 || !portable(part))
        throw new Error('closure');
      const bytes = await packageBytes(part);
      textBytes += bytes.length;
      if (textBytes > 1_048_576) throw new Error('limit');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const value = parsePackageConfigJsonc(text);
      if (!object(value)) throw new Error('jsonc');
      if (value.compilerOptions !== undefined && !object(value.compilerOptions))
        throw new Error('config-shape');
      const compilerOptions = value.compilerOptions;
      const pathOptions = object(compilerOptions)
        ? ['baseUrl', 'paths', 'rootDirs', 'outDir', 'declarationDir'].map(
            field => compilerOptions[field],
          )
        : [];
      if (
        JSON.stringify([...pathOptions, value.files, value.include, value.exclude]).includes('${')
      )
        throw new Error('config-template-unsupported');
      configs.set(path, text);
      record.configurations.push({ path, hash: storedChecksum(bytes), bytes: bytes.length });
      const parents =
        value.extends === undefined
          ? []
          : typeof value.extends === 'string'
            ? [value.extends]
            : value.extends;
      if (!Array.isArray(parents) || parents.length > 32) throw new Error('closure');
      for (const parent of parents) {
        if (
          typeof parent !== 'string' ||
          !/^\.{1,2}\//u.test(parent) ||
          parent.includes('\\') ||
          parent.includes('%') ||
          parent.includes(':')
        )
          throw new Error('closure');
        const target = posix.normalize(
          posix.join(posix.dirname(part), parent.endsWith('.json') ? parent : parent + '.json'),
        );
        if (!portable(target)) throw new Error('closure');
        targets.set(path + '\0' + parent, posix.join(logicalRoot!, target));
        await visitPackage(target, [...ancestors, path]);
      }
      // Required byte reads retain narrow directory/file authority and detect capture drift.
      if (storedChecksum(await packageBytes(part)) !== storedChecksum(bytes))
        throw new Error('changed');
    };
    await visitPackage(selected.slice(2), chain);
    if (
      storedChecksum(await packageBytes('package.json')) !== record.manifestHash ||
      (await realpath(resolve(reader.rootDir, logicalRoot))) !== root
    )
      throw new Error('changed');
    await checkedSource(owner, sources.get(owner));
    await checkedSource(lockPath);
    packages.push(record);
    targets.set(from + '\0' + specifier, posix.join(logicalRoot, selected.slice(2)));
  };
  const completed = new Set<string>();
  const visitSource = async (path: string, chain: string[]): Promise<void> => {
    if (chain.includes(path) || chain.length >= 32 || ++visited > 128) {
      problem('CLOSURE', path);
      return;
    }
    if (completed.has(path)) return;
    const text = sources.get(path);
    if (text === undefined) return; // Ordinary resolver reports missing local configuration.
    let value: unknown;
    try {
      value = parsePackageConfigJsonc(text);
    } catch {
      return;
    }
    if (!object(value)) return;
    const parents =
      value.extends === undefined
        ? []
        : typeof value.extends === 'string'
          ? [value.extends]
          : value.extends;
    if (!Array.isArray(parents) || parents.length > 32) return;
    for (const parent of parents) {
      if (typeof parent !== 'string') continue;
      if (parent.startsWith('.')) {
        const target = posix.normalize(
          posix.join(posix.dirname(path), parent.endsWith('.json') ? parent : parent + '.json'),
        );
        if (portable(target)) await visitSource(target, [...chain, path]);
      } else
        try {
          await checkedSource(path, text);
          await capturePackage(path, parent, [...chain, path]);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === 'ABORT_ERR') throw cause;
          const reason =
            cause instanceof Error && /^[a-z-]{1,40}$/u.test(cause.message)
              ? cause.message.toUpperCase().replaceAll('-', '_')
              : 'REJECTED';
          problem(reason, path);
        }
    }
    completed.add(path);
    if (Array.isArray(value.references))
      for (const ref of value.references.slice(0, 32)) {
        if (!object(ref) || typeof ref.path !== 'string') continue;
        let target = posix.normalize(posix.join(posix.dirname(path), ref.path));
        if (!posix.extname(target)) target = posix.join(target, 'tsconfig.json');
        if (portable(target)) await visitSource(target, []);
      }
  };
  if (binding !== 'limit')
    for (const path of [...sources.keys()]
      .filter(candidate => /(?:^|\/)(?:ts|js)config[^/]*\.json$/u.test(candidate))
      .toSorted())
      await visitSource(path, []);
  const evidence: PackageConfigEvidence = Object.freeze({
    hash: contentHash('sfp-package-config-evidence-v1', {
      sourceInventoryHash: inventory.hash,
      sourceBinding: sourceBinding(
        sources,
        inventory.files.map(member => member.path),
      ),
      authorityHash: contentHash('sfp-package-config-authority-v1', authorityInput),
      packages,
      configurations: [...configs],
      targets: [...targets],
      issues: [...issues].toSorted(),
    }),
    sourceInventoryHash: inventory.hash,
    packages: Object.freeze(
      packages.map(pkg =>
        Object.freeze({
          ...pkg,
          configurations: Object.freeze(pkg.configurations.map(config => Object.freeze(config))),
        }),
      ),
    ),
    issues: Object.freeze([...issues].toSorted()),
  });
  // A rejected partial closure never grants any successful package binding.
  admitted.set(evidence, {
    sourceBinding: sourceBinding(
      sources,
      inventory.files.map(file => file.path),
    ),
    sources: issues.size ? new Map() : configs,
    targets: issues.size ? new Map() : targets,
    evidence,
  });
  return evidence;
};
