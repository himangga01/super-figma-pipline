import { isBuiltin } from 'node:module';
import { posix } from 'node:path';

import { parseSync } from 'oxc-parser';

import { cssImports, localCssImport } from '../fs/css-imports.js';
import { scanSfcScripts } from '../scan/sfc-blocks.js';
import {
  admittedPackageConfigEvidence,
  parsePackageConfigJsonc as jsonc,
  type PackageConfigEvidence,
} from './package-config-evidence.js';
import {
  admittedReactRouterCompilerEvidence,
  type ReactRouterCompilerEvidence,
} from './react-router-compiler-evidence.js';

export interface PortalModuleReference {
  from: string;
  offset: number;
  kind: 'import' | 're-export' | 'dynamic-import' | 'require' | 'import-equals' | 'css-import';
  specifier: string | null;
  status: 'resolved' | 'builtin' | 'external' | 'unresolved';
  /** Conservative source closure across supported condition branches, not a runtime trace. */
  targets: string[];
  configuration: string[];
  reason?: string;
}
interface Config {
  files: string[];
  base?: string;
  paths: Record<string, { base: string; values: string[] }>;
  pathsPresent?: boolean;
  rootDirs?: string[];
  sourceFiles?: string[];
  include?: string[];
  exclude?: string[];
  membershipUnsupported?: boolean;
  allowJs?: boolean;
  checkJs?: boolean;
  outDir?: string;
  declarationDir?: string;
}
interface Package {
  path: string;
  root: string;
  value: Record<string, unknown>;
}
type Resolution = Pick<PortalModuleReference, 'status' | 'targets' | 'configuration' | 'reason'>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const literal = (value: unknown): string | null =>
  object(value) && typeof value.value === 'string' ? value.value : null;
const code = /\.(?:[cm]?[jt]sx?|vue|svelte)$/u;
const extensions = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.vue',
  '.svelte',
];
const hasControl = (value: string) => [...value].some(char => char.charCodeAt(0) < 32);
const safe = (path: string) =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !/^(?:\.\.(?:\/|$)|[A-Za-z]:)/u.test(path) &&
  !path.includes('\\') &&
  !hasControl(path);
const unique = (values: string[]) => [...new Set(values)].toSorted();
const failed = (
  reason: string,
  targets: string[] = [],
  configuration: string[] = [],
): Resolution => ({ status: 'unresolved', reason, targets, configuration });
const closest = (from: string, candidates: string[]) =>
  candidates
    .filter(path => {
      const root = posix.dirname(path);
      return root === '.' || from.startsWith(`${root}/`);
    })
    .toSorted((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
const matchesSelector = (from: string, selector: string, exclude = false) => {
  if (!/[*?]/u.test(selector)) {
    if (exclude)
      return from === selector || from.startsWith(selector === '.' ? '' : selector + '/');
    if (selector !== '.' && posix.basename(selector).includes('.')) return from === selector;
    selector = selector === '.' ? '**/*' : selector + '/**/*';
  }
  const expression = selector
    .split('/')
    .map((part, index, parts) => {
      if (part === '**')
        return exclude ? (index === parts.length - 1 ? '.*' : '(?:[^/]+/)*') : '(?:[^/.][^/]*/)*';
      const segment = part
        .split('')
        .map(char =>
          char === '*'
            ? '[^/]*'
            : char === '?'
              ? '[^/]'
              : char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
        )
        .join('');
      return (exclude || part.startsWith('.') ? '' : '(?!\\.)') + segment + '/';
    })
    .join('')
    .replace(/\/$/u, '');
  return new RegExp(`^${expression}${exclude ? '(?:$|/)' : '$'}`, 'u').test(from);
};
const boundName = (pattern: unknown, name: string): boolean => {
  const pending = [pattern];
  let count = 0;
  while (pending.length && ++count <= 100_000) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (!object(value)) continue;
    if (value.type === 'Identifier' && value.name === name) return true;
    if (value.type === 'ObjectPattern') pending.push(value.properties);
    if (value.type === 'ArrayPattern') pending.push(value.elements);
    if (value.type === 'Property') pending.push(value.value);
    if (value.type === 'RestElement') pending.push(value.argument);
    if (value.type === 'AssignmentPattern') pending.push(value.left);
  }
  // Exhausted binding analysis cannot prove that the native binding is unshadowed.
  return pending.length > 0;
};
const bindingMutated = (program: unknown, name: string): boolean => {
  const pending: unknown[] = [program];
  let count = 0;
  while (pending.length && ++count <= 100000) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!object(value)) continue;
    if (['AssignmentExpression', 'UpdateExpression'].includes(String(value.type))) {
      let target = value.left ?? value.argument;
      while (object(target) && target.type === 'MemberExpression') target = target.object;
      if (boundName(target, name)) return true;
    }
    for (const child of Object.values(value))
      if (object(child) || Array.isArray(child)) pending.push(child);
  }
  return pending.length > 0;
};

/** Literal-only top-level consts. Any ambiguous binding anywhere in this script fails closed. */
const immutableModuleLiterals = (
  program: unknown,
): Map<string, { value: string; declaredAt: number }> => {
  const candidates = new Map<string, { value: string; declaredAt: number }>();
  if (!object(program) || !Array.isArray(program.body)) return candidates;
  for (const raw of program.body) {
    const statement = object(raw) && raw.type === 'ExportNamedDeclaration' ? raw.declaration : raw;
    if (
      !object(statement) ||
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      !Array.isArray(statement.declarations)
    )
      continue;
    for (const declaration of statement.declarations) {
      if (
        !object(declaration) ||
        !object(declaration.id) ||
        declaration.id.type !== 'Identifier' ||
        typeof declaration.id.name !== 'string'
      )
        continue;
      const value = literal(declaration.init);
      if (value !== null)
        candidates.set(declaration.id.name, { value, declaredAt: Number(declaration.end) });
      if (candidates.size > 128) return new Map();
    }
  }
  if (!candidates.size) return candidates;
  const counts = new Map<string, number>();
  const invalid = new Set<string>();
  const pending: unknown[] = [program];
  let steps = 0;
  while (pending.length && ++steps <= 100_000) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      if (pending.length + node.length + steps > 100_000) return new Map();
      for (const child of node) pending.push(child);
      continue;
    }
    if (!object(node)) continue;
    const declaration = ['VariableDeclarator', 'FunctionDeclaration', 'ClassDeclaration'].includes(
      String(node.type),
    )
      ? node.id
      : ['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(
            String(node.type),
          )
        ? node.local
        : null;
    for (const name of candidates.keys()) {
      if (declaration && boundName(declaration, name))
        counts.set(name, (counts.get(name) ?? 0) + 1);
      if (boundName(node.params, name) || boundName(node.param, name)) invalid.add(name);
      if (['AssignmentExpression', 'UpdateExpression'].includes(String(node.type))) {
        let target = node.left ?? node.argument;
        while (object(target) && target.type === 'MemberExpression') target = target.object;
        if (boundName(target, name)) invalid.add(name);
      }
    }
    for (const [key, value] of Object.entries(node))
      if (!['loc', 'comments', 'parent'].includes(key) && (object(value) || Array.isArray(value)))
        pending.push(value);
  }
  if (pending.length) return new Map();
  for (const name of candidates.keys())
    if (counts.get(name) !== 1 || invalid.has(name)) candidates.delete(name);
  return candidates;
};

/**
 * Resolve only supplied, verified source bytes. Does not read disk, import repository code, or
 * verify installed packages. `external` means declared provisioning, not runtime success.
 */
export const resolvePortalModules = (
  sources: ReadonlyMap<string, string>,
  inventoryPaths: readonly string[],
  limits: {
    maxReferences?: number;
    packageConfigEvidence?: PackageConfigEvidence;
    reactRouterCompilerEvidence?: ReactRouterCompilerEvidence;
    sourceId?: string;
    sourceInventoryHash?: string;
  } = {},
): { complete: boolean; references: PortalModuleReference[]; issues: string[] } => {
  const issues = new Set<string>();
  const problem = (value: string) => {
    if (issues.size < 512) issues.add(value);
  };
  const requestedLimit = limits.maxReferences ?? 10_000;
  const maxReferences =
    Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 10_000) : 0;
  if (!maxReferences) problem('MODULE_REFERENCE_LIMIT');
  if (inventoryPaths.length > 5000 || sources.size > 5000) problem('MODULE_FILE_LIMIT');
  const inventory = new Set(inventoryPaths.slice(0, 5000));
  const lower = new Map<string, string>();
  for (const path of inventory) {
    if (!safe(path) || posix.normalize(path) !== path || path.normalize('NFC') !== path)
      problem(`MODULE_PATH_INVALID:${path}`);
    if (lower.has(path.toLowerCase())) problem(`MODULE_PATH_ALIAS:${path}`);
    lower.set(path.toLowerCase(), path);
  }
  let sourceBytes = 0;
  const entries = [...sources.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 5000)
    .filter(([path, text]) => {
      sourceBytes += Buffer.byteLength(text);
      if (Buffer.byteLength(text) <= 262_144 && sourceBytes <= 8_388_608) return true;
      problem(`MODULE_SOURCE_LIMIT:${path}`);
      return false;
    });
  const packages: Package[] = [];
  const compiler =
    limits.reactRouterCompilerEvidence && limits.sourceId && limits.sourceInventoryHash
      ? admittedReactRouterCompilerEvidence(
          limits.reactRouterCompilerEvidence,
          limits.sourceId,
          limits.sourceInventoryHash,
          sources,
        )
      : null;
  if (limits.reactRouterCompilerEvidence && !compiler) problem('PORTAL_COMPILER_EVIDENCE_REQUIRED');
  const named = new Map<string, Package[]>();
  for (const [path, text] of entries) {
    if (!inventory.has(path)) problem(`MODULE_SOURCE_NOT_IN_INVENTORY:${path}`);
    if (posix.basename(path) !== 'package.json') continue;
    try {
      const value: unknown = JSON.parse(text);
      if (!object(value)) throw new Error('Invalid manifest');
      const pkg = { path, root: posix.dirname(path), value };
      packages.push(pkg);
      if (typeof value.name === 'string')
        named.set(value.name, [...(named.get(value.name) ?? []), pkg]);
    } catch {
      problem(`MODULE_MANIFEST_INVALID:${path}`);
    }
  }
  const workspaceOwners = packages.flatMap(pkg => {
    const declared = object(pkg.value.workspaces)
      ? pkg.value.workspaces.packages
      : pkg.value.workspaces;
    if (declared === undefined) return [];
    if (
      !Array.isArray(declared) ||
      declared.some(
        value =>
          typeof value !== 'string' ||
          value.length > 512 ||
          !/^[A-Za-z0-9@_./*-]+$/u.test(value) ||
          value.startsWith('../'),
      )
    ) {
      problem(`WORKSPACE_MEMBERSHIP_UNSUPPORTED:${pkg.path}`);
      return [];
    }
    return [{ pkg, patterns: declared as string[] }];
  });
  const workspaceEvidence = (from: string, target: Package): string[] =>
    workspaceOwners
      .filter(({ pkg, patterns }) => {
        if (pkg.root !== '.' && !from.startsWith(`${pkg.root}/`)) return false;
        const root = posix.relative(pkg.root, target.root);
        return patterns.some(pattern => {
          const normalized = pattern.replace(/^\.\//u, '').replace(/\/$/u, '');
          const expression = normalized
            .split('/')
            .map(part =>
              part === '**'
                ? '.*'
                : part
                    .split('*')
                    .map(value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
                    .join('[^/]*'),
            )
            .join('/');
          return new RegExp(`^${expression}$`, 'u').test(root);
        });
      })
      .map(({ pkg }) => pkg.path);
  const configs = new Map<string, Config>();
  const projectReferences = new Map<string, string[]>();
  // Configuration bytes are subject to the same source-size bounds as parsed modules.
  const configSources = new Map(entries);
  const captured = limits.packageConfigEvidence
    ? admittedPackageConfigEvidence(limits.packageConfigEvidence, sources, inventoryPaths)
    : undefined;
  if (limits.packageConfigEvidence && !captured) problem('PACKAGE_CONFIG_ADMISSION_INVALID');
  for (const issue of captured?.evidence.issues ?? []) problem(issue);
  for (const [path, text] of captured?.sources ?? []) {
    if (configSources.has(path) || inventory.has(path))
      problem(`PACKAGE_CONFIG_PATH_AMBIGUOUS:${path}`);
    else configSources.set(path, text);
  }
  let configurationReads = 0;
  const configTarget = (path: string, target: unknown): string | null => {
    if (
      typeof target !== 'string' ||
      !target.length ||
      target.length > 2048 ||
      target.startsWith('/') ||
      target.includes('\\') ||
      target.includes('%') ||
      target.includes(':') ||
      hasControl(target)
    )
      return null;
    let normalized = posix.normalize(posix.join(posix.dirname(path), target));
    if (normalized === '.' || !posix.extname(normalized))
      normalized = posix.join(normalized, 'tsconfig.json');
    return safe(normalized) ? normalized : null;
  };
  const sourceSelectors = (path: string, values: unknown, globs: boolean): string[] | null => {
    if (!Array.isArray(values) || values.length > 128) return null;
    const result: string[] = [];
    for (const value of values) {
      if (
        typeof value !== 'string' ||
        !value.length ||
        value.length > 2048 ||
        value.startsWith('/') ||
        value.includes('\\') ||
        value.includes('%') ||
        value.includes(':') ||
        hasControl(value) ||
        /[[\]{}!]/u.test(value) ||
        (!globs && /[*?]/u.test(value))
      )
        return null;
      const segments = value.split('/');
      const wildcard = segments.findIndex(segment => /[*?]/u.test(segment));
      if (wildcard >= 0 && segments.slice(wildcard).includes('..')) return null;
      const normalized = posix.normalize(posix.join(posix.dirname(path), value));
      if (normalized !== '.' && !safe(normalized)) return null;
      result.push(normalized);
    }
    return result;
  };
  const readConfig = (path: string, chain: string[] = []): Config => {
    if (configs.has(path)) return configs.get(path)!;
    const empty: Config = { files: [path], paths: {} };
    if (chain.includes(path) || chain.length >= 32 || ++configurationReads > 256) {
      problem(`CONFIG_CYCLE:${path}`);
      return empty;
    }
    const text = configSources.get(path);
    if (text === undefined || (!inventory.has(path) && !captured?.sources.has(path))) {
      problem(`CONFIG_MISSING:${path}`);
      return empty;
    }
    let value: unknown;
    try {
      value = jsonc(text);
    } catch {
      problem(`CONFIG_INVALID:${path}`);
      return empty;
    }
    if (!object(value)) {
      problem(`CONFIG_INVALID:${path}`);
      return empty;
    }
    let result = empty;
    if (value.references !== undefined) {
      projectReferences.set(path, []);
      if (!Array.isArray(value.references)) problem(`CONFIG_REFERENCE_UNSUPPORTED:${path}`);
      else if (value.references.length > 32) problem(`CONFIG_REFERENCE_LIMIT:${path}`);
      else {
        const targets: string[] = [];
        for (const reference of value.references) {
          const target = object(reference) ? configTarget(path, reference.path) : null;
          if (!target) problem(`CONFIG_REFERENCE_UNSUPPORTED:${path}`);
          else targets.push(target);
        }
        projectReferences.set(path, unique(targets));
      }
    }
    if (value.extends !== undefined) {
      const parents = typeof value.extends === 'string' ? [value.extends] : value.extends;
      if (
        !Array.isArray(parents) ||
        parents.length > 32 ||
        parents.some(parent => typeof parent !== 'string')
      )
        problem(`CONFIG_EXTENDS_UNSUPPORTED:${path}`);
      else {
        for (const specifier of parents as string[]) {
          let parent = captured?.targets.get(path + '\0' + specifier);
          if (!parent && specifier.startsWith('.') && !captured?.sources.has(path)) {
            parent = posix.normalize(posix.join(posix.dirname(path), specifier));
            if (!parent.endsWith('.json')) parent += '.json';
          }
          if (!parent || !safe(parent)) {
            problem(`CONFIG_EXTENDS_UNSUPPORTED:${path}`);
            continue;
          }
          const inherited = readConfig(parent, [...chain, path]);
          result = Object.assign({}, result, inherited, {
            paths: { ...(inherited.pathsPresent ? inherited.paths : result.paths) },
            files: unique([path, ...result.files, ...inherited.files]),
          });
        }
      }
    }
    for (const [field, output] of [
      ['files', 'sourceFiles'],
      ['include', 'include'],
      ['exclude', 'exclude'],
    ] as const) {
      if (value[field] === undefined) continue;
      const values = sourceSelectors(path, value[field], field !== 'files');
      if (values === null) {
        problem(`CONFIG_SOURCE_SELECTION_UNSUPPORTED:${path}`);
        result.membershipUnsupported = true;
      } else {
        result[output] = values;
      }
    }
    if (object(value.compilerOptions)) {
      const options = value.compilerOptions;
      for (const field of ['outDir', 'declarationDir'] as const) {
        if (options[field] === undefined) continue;
        const values = sourceSelectors(path, [options[field]], false);
        if (values === null) {
          problem(`CONFIG_SOURCE_SELECTION_UNSUPPORTED:${path}`);
          result.membershipUnsupported = true;
        } else result[field] = values[0]!;
      }
      for (const field of ['allowJs', 'checkJs'] as const) {
        if (options[field] === undefined) continue;
        if (typeof options[field] !== 'boolean') {
          problem(`CONFIG_SOURCE_SELECTION_UNSUPPORTED:${path}`);
          result.membershipUnsupported = true;
        } else result[field] = options[field];
      }
      if (options.baseUrl !== undefined) {
        if (typeof options.baseUrl !== 'string') problem(`CONFIG_BASE_UNSUPPORTED:${path}`);
        else {
          const base = posix.normalize(posix.join(posix.dirname(path), options.baseUrl));
          if (base !== '.' && !safe(base)) problem(`CONFIG_BASE_UNSUPPORTED:${path}`);
          else result.base = base;
        }
      }
      if (options.paths !== undefined) {
        result.pathsPresent = true;
        result.paths = {};
        if (!object(options.paths)) problem(`CONFIG_PATHS_UNSUPPORTED:${path}`);
        else
          for (const [key, values] of Object.entries(options.paths)) {
            if (
              key.length > 512 ||
              key.split('*').length > 2 ||
              !Array.isArray(values) ||
              !values.length ||
              values.length > 32 ||
              values.some(v => typeof v !== 'string' || v.length > 2048 || v.split('*').length > 2)
            )
              problem(`CONFIG_PATHS_UNSUPPORTED:${path}`);
            else
              result.paths[key] = {
                base: result.base ?? posix.dirname(path),
                values: values as string[],
              };
          }
      }
      if (options.rootDirs !== undefined) {
        const values = sourceSelectors(path, options.rootDirs, false);
        if (values === null || values.length > 32) {
          problem(`CONFIG_ROOT_DIRS_UNSUPPORTED:${path}`);
          delete result.rootDirs;
        } else result.rootDirs = values;
      }
      if (options.moduleSuffixes !== undefined) problem(`CONFIG_RESOLUTION_UNSUPPORTED:${path}`);
    }
    configs.set(path, result);
    return result;
  };
  const configPaths = entries
    .map(([path]) => path)
    .filter(path => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/u.test(path));
  for (const path of configPaths) readConfig(path);
  const referenceClosures = new Map<string, Map<string, string[]>>();
  let referenceCount = 0;
  const collectProjects = (path: string, chain: string[], closure: Map<string, string[]>) => {
    if (chain.includes(path)) {
      problem(`CONFIG_REFERENCE_CYCLE:${path}`);
      return;
    }
    if (chain.length >= 32 || ++referenceCount > 256) {
      problem(`CONFIG_REFERENCE_LIMIT:${path}`);
      return;
    }
    const config = readConfig(path);
    const evidence = unique([...chain, ...config.files]);
    if (chain.length) closure.set(path, unique([...(closure.get(path) ?? []), ...evidence]));
    for (const target of projectReferences.get(path) ?? [])
      collectProjects(target, [...chain, path], closure);
  };
  for (const path of configPaths) {
    if (!projectReferences.has(path)) continue;
    const closure = new Map<string, string[]>();
    collectProjects(path, [], closure);
    referenceClosures.set(path, closure);
  }
  const activeConfigs = new Set(configPaths);
  for (const closure of referenceClosures.values())
    for (const path of closure.keys()) activeConfigs.add(path);
  for (const path of unique([...activeConfigs]))
    for (const target of readConfig(path).sourceFiles ?? []) {
      if (!inventory.has(target)) problem(`CONFIG_SOURCE_FILE_MISSING:${path}:${target}`);
      else if (!configSources.has(target))
        problem(`CONFIG_SOURCE_FILE_UNAVAILABLE:${path}:${target}`);
    }
  let selectionComparisons = 0;
  const selectionMatches = (from: string, selector: string, exclude = false) => {
    if (++selectionComparisons > 100_000) return false;
    return matchesSelector(from, selector, exclude);
  };
  const projectSelections = new Map<
    string,
    { config?: Config; configuration: string[]; reason?: string }
  >();
  const selectConfig = (
    from: string,
  ): { config?: Config; configuration: string[]; reason?: string } => {
    const path = closest(from, configPaths);
    if (!path) return { configuration: [] };
    const root = readConfig(path);
    if (!projectReferences.has(path)) return { config: root, configuration: root.files };
    const candidates = [
      [path, root.files] as [string, string[]],
      ...(referenceClosures.get(path) ?? new Map<string, string[]>()),
    ].filter(([target]) => {
      const config = readConfig(target);
      if (config.membershipUnsupported) return true; // Unknown membership cannot exclude an overlapping owner.
      if (/\.[cm]?jsx?$/u.test(from) && !(config.allowJs ?? config.checkJs ?? false)) return false;
      if (config.sourceFiles?.includes(from)) return true;
      const included =
        config.include ??
        (config.sourceFiles === undefined ? [posix.join(posix.dirname(target), '**/*')] : []);
      return (
        included.some(selector => selectionMatches(from, selector)) &&
        !(
          config.exclude ??
          [config.outDir, config.declarationDir].filter(
            (value): value is string => value !== undefined,
          )
        ).some(selector => selectionMatches(from, selector, true))
      );
    });
    if (selectionComparisons > 100_000) {
      problem('CONFIG_SELECTION_LIMIT');
      return { configuration: root.files, reason: 'config-project-selection-limit' };
    }
    if (candidates.length !== 1)
      return {
        configuration: unique([...root.files, ...candidates.flatMap(([, evidence]) => evidence)]),
        reason: candidates.length ? 'config-project-ambiguous' : 'config-project-source-unassigned',
      };
    const [target, evidence] = candidates[0]!;
    const config = readConfig(target);
    return config.membershipUnsupported
      ? { configuration: evidence, reason: 'config-project-membership-unsupported' }
      : { config, configuration: evidence };
  };

  const configFor = (from: string) => {
    const cached = projectSelections.get(from);
    if (cached) return cached;
    const selected =
      from === 'react-router.config.ts' && compiler
        ? {
            config: { files: [...compiler.configuration], paths: {} } as Config,
            configuration: [...compiler.configuration],
          }
        : selectConfig(from);
    projectSelections.set(from, selected);
    return selected;
  };

  const fileResolution = (base: string, tsxSubstitution = false): Resolution => {
    if (!safe(base)) return failed('path-outside-source');
    const options = [base];
    const ext = posix.extname(base);
    // Explicit TSX specifiers prefer their exact source. Compiler-only fallback must never
    // replace an unreadable or case-aliased exact target, nor alter Node package targets.
    if (tsxSubstitution && ext === '.tsx' && !inventory.has(base)) {
      if (lower.has(base.toLowerCase())) return failed('case-mismatched-target');
      options.push(base.slice(0, -4) + '.ts');
    }
    if (ext === '.js') options.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
    if (ext === '.jsx') options.push(base.slice(0, -4) + '.tsx');
    if (ext === '.mjs') options.push(base.slice(0, -4) + '.mts');
    if (ext === '.cjs') options.push(base.slice(0, -4) + '.cts');
    if (!ext) options.push(...extensions.map(e => base + e));
    options.push(...extensions.map(e => posix.join(base, 'index' + e)));
    const targets = unique(options.filter(path => inventory.has(path)));
    if (!targets.length)
      return failed(
        options.some(path => lower.has(path.toLowerCase()))
          ? 'case-mismatched-target'
          : 'module-target-missing',
      );
    if (targets.some(path => code.test(path) && !sources.has(path)))
      return failed('source-text-unavailable', targets);
    return { status: 'resolved', targets, configuration: [] };
  };
  const exportValues = (value: unknown, depth = 0): string[] | null => {
    if (depth > 16) return null;
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) {
      const values = value.map(entry => exportValues(entry, depth + 1));
      return values.some(entry => entry === null) ? null : (values.flat() as string[]);
    }
    if (object(value)) {
      if (Object.keys(value).some(key => key.startsWith('.'))) return null;
      const values = Object.entries(value)
        .filter(([key]) => !key.startsWith('.'))
        .map(([, entry]) => exportValues(entry, depth + 1));
      return values.length && values.every(entry => entry !== null)
        ? (values.flat() as string[])
        : null;
    }
    return null;
  };
  const combine = (values: Resolution[], configuration: string[]): Resolution => {
    const targets = unique(values.flatMap(value => value.targets));
    const rejected = values.find(value => value.status === 'unresolved');
    return rejected
      ? failed(rejected.reason!, targets, unique(configuration))
      : { status: 'resolved', targets, configuration: unique(configuration) };
  };
  const packageResolution = (pkg: Package, subpath: string): Resolution => {
    const configuration = [pkg.path];
    let values: string[] | null;
    if ('exports' in pkg.value) {
      const declared = pkg.value.exports;
      let selected: unknown = subpath === '.' ? declared : undefined;
      let wildcard: string | undefined;
      if (object(declared) && Object.keys(declared).some(key => key.startsWith('.'))) {
        if (Object.keys(declared).some(key => !key.startsWith('.')))
          return failed('package-export-not-supported', [], configuration);
        selected = declared[subpath];
        if (selected === undefined) {
          const patterns = Object.keys(declared)
            .filter(
              key =>
                key.split('*').length === 2 &&
                subpath.startsWith(key.split('*')[0]!) &&
                subpath.endsWith(key.split('*')[1]!),
            )
            .toSorted((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
          const key = patterns[0];
          if (key) {
            const [prefix, suffix] = key.split('*');
            wildcard = subpath.slice(prefix!.length, subpath.length - suffix!.length);
            selected = declared[key];
          }
        }
      }
      values = exportValues(selected);
      if (wildcard !== undefined)
        values = values?.map(value => value.replaceAll('*', wildcard)) ?? null;
      if (!values?.length || values.some(value => !value.startsWith('./')))
        return failed('package-export-not-supported', [], configuration);
    } else if (subpath !== '.') values = [subpath];
    else {
      values = ['module', 'main', 'types', 'typings'].flatMap(key =>
        typeof pkg.value[key] === 'string' ? [pkg.value[key] as string] : [],
      );
      if (!values.length) values = ['./index'];
    }
    const results = values.map(value => {
      const target = posix.normalize(posix.join(pkg.root, value));
      if (pkg.root !== '.' && !target.startsWith(`${pkg.root}/`))
        return failed('package-target-outside-root');
      return fileResolution(target);
    });
    return combine(results, configuration);
  };
  const privateResolution = (from: string, specifier: string): Resolution => {
    const manifest = closest(
      from,
      packages.map(pkg => pkg.path),
    );
    const pkg = packages.find(candidate => candidate.path === manifest);
    const configuration = pkg ? [pkg.path] : [];
    if (!pkg || specifier === '#' || specifier.startsWith('#/') || specifier.includes('%'))
      return failed('package-import-not-supported', [], configuration);
    const declared = pkg.value.imports;
    if (!object(declared)) return failed('package-import-not-defined', [], configuration);
    const keys = Object.keys(declared);
    if (
      keys.length > 1024 ||
      keys.some(
        key =>
          !key.startsWith('#') ||
          key === '#' ||
          key.startsWith('#/') ||
          key.length > 512 ||
          key.split('*').length > 2 ||
          hasControl(key),
      )
    )
      return failed('package-import-not-supported', [], configuration);
    const matches = (key: string) =>
      key === specifier ||
      (key.includes('*') &&
        specifier.startsWith(key.split('*')[0]!) &&
        specifier.endsWith(key.split('*')[1]!));
    // A compiler path override can select different source bytes than Node's private mapping.
    // Keep that disagreement explicit until its runtime/bundler authority has been reviewed.
    const selected = configFor(from);
    if (selected.reason)
      return failed(selected.reason, [], unique([...configuration, ...selected.configuration]));
    if (selected.config) {
      const config = selected.config;
      if (Object.keys(config.paths).some(matches))
        return failed(
          'package-import-tsconfig-ambiguity',
          [],
          unique([...configuration, ...selected.configuration]),
        );
    }
    const key = Object.hasOwn(declared, specifier)
      ? specifier
      : keys
          .filter(matches)
          .toSorted((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)[0];
    if (key === undefined) return failed('package-import-not-defined', [], configuration);
    let values = exportValues(declared[key]);
    if (key.includes('*')) {
      const [prefix, suffix] = key.split('*');
      const capture = specifier.slice(prefix!.length, specifier.length - suffix!.length);
      values = values?.map(value => value.replaceAll('*', capture)) ?? null;
    }
    // Relative, in-package targets only. External packages, chained private imports and URL
    // encodings remain explicit unsupported inputs; normalization must not erase traversal.
    if (
      !values?.length ||
      values.length > 32 ||
      values.some(
        value =>
          value.length > 2048 ||
          !value.startsWith('./') ||
          /[\\%?#*]/u.test(value) ||
          hasControl(value) ||
          value
            .slice(2)
            .split('/')
            .some(
              segment =>
                !segment ||
                segment === '.' ||
                segment === '..' ||
                segment.toLowerCase() === 'node_modules',
            ),
      )
    )
      return failed('package-import-target-not-supported', [], configuration);
    return combine(
      values.map(value => fileResolution(posix.join(pkg.root, value))),
      configuration,
    );
  };
  const viteCssBindings = new Map<string, boolean>();
  const resolve = (from: string, specifier: string, typeOnly = false): Resolution => {
    if (specifier.length > 2048 || specifier.includes('\\') || hasControl(specifier))
      return failed('unsupported-module-specifier');
    const generated =
      specifier === 'virtual:react-router/server-build'
        ? specifier
        : /^\.{1,2}\//u.test(specifier)
          ? posix.normalize(posix.join(posix.dirname(from), specifier))
          : null;
    // Producer route-type aliases must reach the type-only/rootDirs/member guards below.
    const generatedRouteType = generated && /(?:^|\/)\+types\//u.test(generated);
    if (generated && !generatedRouteType && compiler?.modules.has(generated))
      return {
        status: 'external',
        targets: [],
        configuration: [...compiler.configuration],
        reason: 'observed-compiler-generated-module',
      };
    if (specifier.includes('?')) {
      const cssUrl = /^(.*\.css)\?url$/u.exec(specifier);
      if (cssUrl) {
        if (cssUrl[1]!.endsWith('.module.css')) return failed('css-url-module-not-supported');
        const selected = configFor(from);
        if (selected.reason) return failed(selected.reason, [], selected.configuration);
        const configPath = closest(
          from,
          entries
            .map(([path]) => path)
            .filter(path => /(?:^|\/)vite\.config\.[cm]?[jt]s$/u.test(path)),
        );
        const pkgPath = closest(
          from,
          packages.map(pkg => pkg.path),
        );
        const pkg = packages.find(value => value.path === pkgPath);
        const configuration = unique([
          ...selected.configuration,
          ...(pkgPath ? [pkgPath] : []),
          ...(configPath ? [configPath] : []),
        ]);
        const declared =
          pkg &&
          ['dependencies', 'devDependencies'].some(
            key =>
              object(pkg.value[key]) &&
              typeof pkg.value[key].vite === 'string' &&
              /^[~^]?(?:7|8)(?:\.\d+){0,2}(?:-[\w.-]+)?$/u.test(pkg.value[key].vite),
          );
        if (
          !declared ||
          !pkgPath ||
          !inventory.has(pkgPath) ||
          !configSources.has(pkgPath) ||
          !configPath ||
          !inventory.has(configPath) ||
          (pkg!.root !== '.' && !configPath.startsWith(pkg!.root + '/'))
        )
          return failed('vite-css-url-configuration-required', [], configuration);
        let configured = viteCssBindings.get(configPath);
        if (configured === undefined) {
          configured = false;
          try {
            const parsed = parseSync(configPath, configSources.get(configPath)!);
            const program = parsed.program as unknown as { body: Record<string, unknown>[] };
            let value = program.body.find(
              node => node.type === 'ExportDefaultDeclaration',
            )?.declaration;
            if (object(value) && value.type === 'CallExpression') {
              const name =
                object(value.callee) && value.callee.type === 'Identifier'
                  ? value.callee.name
                  : null;
              const imported = program.body.find(
                node => node.type === 'ImportDeclaration' && literal(node.source) === 'vite',
              );
              const helper =
                imported &&
                imported.importKind !== 'type' &&
                (imported.specifiers as Record<string, unknown>[]).some(
                  node =>
                    node.importKind !== 'type' &&
                    object(node.imported) &&
                    node.imported.name === 'defineConfig' &&
                    object(node.local) &&
                    node.local.name === name,
                );
              value =
                helper &&
                typeof name === 'string' &&
                !bindingMutated(parsed.program, name) &&
                (value.arguments as unknown[]).length === 1
                  ? (value.arguments as unknown[])[0]
                  : null;
            }
            if (
              object(value) &&
              ['ArrowFunctionExpression', 'FunctionExpression'].includes(String(value.type))
            ) {
              if (value.async || value.generator || !object(value.body)) value = null;
              else if (value.body.type === 'ObjectExpression') value = value.body;
              else if (value.body.type === 'BlockStatement') {
                const statements = value.body.body as Record<string, unknown>[];
                const returns = statements.filter(node => node.type === 'ReturnStatement');
                value =
                  returns.length === 1 &&
                  statements.at(-1) === returns[0] &&
                  statements.every(node =>
                    ['VariableDeclaration', 'ReturnStatement'].includes(String(node.type)),
                  )
                    ? returns[0]!.argument
                    : null;
              } else value = null;
            }
            configured =
              !parsed.errors.length &&
              object(value) &&
              value.type === 'ObjectExpression' &&
              (value.properties as Record<string, unknown>[]).every(
                property =>
                  property.type === 'Property' &&
                  property.kind === 'init' &&
                  !property.computed &&
                  object(property.key) &&
                  !['root', 'resolve', '__proto__'].includes(
                    String(property.key.name ?? property.key.value),
                  ) &&
                  // Enabled plugin hooks can change CSS ID/root/alias/load behavior.
                  // Core-loader declarations cannot establish an intercepted source target.
                  ((property.key.name ?? property.key.value) !== 'plugins' ||
                    (object(property.value) &&
                      property.value.type === 'ArrayExpression' &&
                      (property.value.elements as unknown[]).length === 0)),
              );
          } catch {
            configured = false;
          }
          viteCssBindings.set(configPath, configured);
        }
        // A TypeScript alias or local workspace package can replace the purported Vite helper.
        if (!configured || resolve(configPath, 'vite').status !== 'external')
          return failed('vite-css-url-configuration-required', [], configuration);
        const raw = resolve(from, cssUrl[1]!);
        const evidence = unique([...configuration, ...raw.configuration]);
        if (raw.status === 'unresolved') return { ...raw, configuration: evidence };
        if (raw.status !== 'resolved') return failed('css-url-source-unavailable', [], evidence);
        if (
          !raw.targets.length ||
          raw.targets.some(
            target =>
              !target.endsWith('.css') ||
              target.endsWith('.module.css') ||
              !configSources.has(target),
          )
        )
          return failed('css-url-source-unavailable', raw.targets, evidence);
        return { ...raw, configuration: evidence };
      }
      const match = /^(.*\.svg)\?(react|component)$/u.exec(specifier);
      if (!match) return failed('loader-query-unsupported');
      const configPath = closest(
        from,
        entries
          .map(([path]) => path)
          .filter(path => /(?:^|\/)vite\.config\.[cm]?[jt]s$/u.test(path)),
      );
      const loader = match[2] === 'react' ? 'vite-plugin-svgr' : 'vite-svg-loader';
      const pkgPath = closest(
        from,
        packages.map(pkg => pkg.path),
      );
      const pkg = packages.find(value => value.path === pkgPath);
      const declared =
        pkg &&
        ['dependencies', 'devDependencies'].some(
          key => object(pkg.value[key]) && typeof pkg.value[key][loader] === 'string',
        );
      if (!configPath || !declared)
        return failed('svg-loader-configuration-required', [], pkgPath ? [pkgPath] : []);
      const configuration = unique([configPath, pkgPath!]);
      let configured = false;
      try {
        const parsed = parseSync(configPath, sources.get(configPath)!);
        const program = parsed.program as unknown as { body: Record<string, unknown>[] };
        const imported = program.body.find(
          node => node.type === 'ImportDeclaration' && literal(node.source) === loader,
        );
        const binding =
          imported &&
          (imported.specifiers as Record<string, unknown>[]).find(
            node => node.type === 'ImportDefaultSpecifier',
          );
        const name =
          binding && object(binding.local) && typeof binding.local.name === 'string'
            ? binding.local.name
            : null;
        const declaration = program.body.find(
          node => node.type === 'ExportDefaultDeclaration',
        )?.declaration;
        let value = declaration;
        if (object(value) && value.type === 'CallExpression') {
          const callee = object(value.callee) ? value.callee.name : null;
          const vite = program.body.find(
            node => node.type === 'ImportDeclaration' && literal(node.source) === 'vite',
          );
          const helper =
            vite &&
            (vite.specifiers as Record<string, unknown>[]).some(
              node =>
                object(node.imported) &&
                node.imported.name === 'defineConfig' &&
                object(node.local) &&
                node.local.name === callee,
            );
          value =
            helper && typeof callee === 'string' && !bindingMutated(parsed.program, callee)
              ? (value.arguments as unknown[])[0]
              : null;
        }
        const property =
          object(value) && value.type === 'ObjectExpression'
            ? (value.properties as Record<string, unknown>[]).find(
                node =>
                  node.type === 'Property' &&
                  !node.computed &&
                  object(node.key) &&
                  (node.key.name ?? node.key.value) === 'plugins',
              )
            : null;
        const plugins = property?.value;
        configured =
          !parsed.errors.length &&
          !!name &&
          !bindingMutated(parsed.program, name) &&
          object(plugins) &&
          plugins.type === 'ArrayExpression' &&
          (plugins.elements as unknown[]).some(
            node =>
              object(node) &&
              node.type === 'CallExpression' &&
              object(node.callee) &&
              node.callee.type === 'Identifier' &&
              node.callee.name === name &&
              (node.arguments as unknown[]).length === 0,
          );
      } catch {
        configured = false;
      }
      if (!configured) return failed('svg-loader-configuration-required', [], configuration);
      const raw = resolve(from, match[1]!);
      return { ...raw, configuration: unique([...raw.configuration, ...configuration]) };
    }
    if (isBuiltin(specifier)) return { status: 'builtin', targets: [], configuration: [] };
    if (specifier.startsWith('.')) {
      const target = posix.normalize(posix.join(posix.dirname(from), specifier));
      let direct = fileResolution(target);
      if (direct.reason !== 'module-target-missing') return direct;
      const selected = configFor(from);
      if (selected.reason) return failed(selected.reason, [], selected.configuration);
      const substitute = /\.[cm]?tsx?$/u.test(from) && selected.config !== undefined;
      if (substitute && target.endsWith('.tsx')) {
        direct = fileResolution(target, true);
        if (direct.reason !== 'module-target-missing')
          return { ...direct, configuration: selected.configuration };
      }
      const roots = selected.config?.rootDirs ?? [];
      // TypeScript overlays only the longest root prefix containing the requested path.
      const origin = roots
        .filter(root => root === '.' || target.startsWith(root + '/'))
        .toSorted((a, b) => b.length - a.length)[0];
      if (origin === undefined) return direct;
      // Generated route types stay in the admitted compiler capsule, never source inventory.
      if (
        typeOnly &&
        compiler &&
        origin === '.' &&
        roots.includes('.react-router/types') &&
        safe(target) &&
        /^\.{1,2}\/(?:[A-Za-z0-9_$()[\]-]+\/)*\+types\/[A-Za-z0-9_$()[\]-]+(?:\.[A-Za-z0-9_$()[\]-]+)*$/u.test(
          specifier,
        )
      ) {
        const typedTarget = target.endsWith('.ts')
          ? target
          : target.endsWith('.tsx')
            ? target.slice(0, -4) + '.ts'
            : target + '.ts';
        const member = '.react-router/types/' + typedTarget;
        const candidates = [...compiler.modules.keys()].filter(
          value => value.toLowerCase() === member.toLowerCase(),
        );
        const configuration = unique([...selected.configuration, ...compiler.configuration]);
        if (candidates.length > 1)
          return failed('compiler-generated-route-type-ambiguous', [], configuration);
        if (candidates.length === 1 && candidates[0] === member)
          return {
            status: 'external',
            targets: [],
            // The exact generated member is protected by this admitted compiler capsule and
            // graph.compilerEvidenceHash. It is a type target, not a source configuration file.
            configuration,
            reason: 'observed-compiler-generated-route-type',
          };
      }
      for (const root of roots) {
        if (root === origin) continue;
        const alternative = fileResolution(
          posix.join(root, posix.relative(origin, target)),
          substitute,
        );
        if (alternative.reason !== 'module-target-missing')
          return { ...alternative, configuration: selected.configuration };
      }
      return { ...direct, configuration: selected.configuration };
    }
    if (specifier.startsWith('#')) return privateResolution(from, specifier);
    if (specifier.startsWith('/') || specifier.includes(':'))
      return failed('unsupported-module-specifier');
    const selected = configFor(from);
    if (selected.reason) return failed(selected.reason, [], selected.configuration);
    if (selected.config) {
      const config = selected.config;
      const match = Object.keys(config.paths)
        .filter(
          key =>
            key === specifier ||
            (key.includes('*') &&
              specifier.startsWith(key.split('*')[0]!) &&
              specifier.endsWith(key.split('*')[1]!)),
        )
        .toSorted(
          (a, b) =>
            Number(b === specifier) - Number(a === specifier) ||
            b.split('*')[0]!.length - a.split('*')[0]!.length ||
            b.length - a.length,
        )[0];
      if (match !== undefined) {
        const entry = config.paths[match]!;
        const [prefix, suffix = ''] = match.split('*');
        const capture = match.includes('*')
          ? specifier.slice(prefix!.length, specifier.length - suffix.length)
          : '';
        const resolutions = entry.values.map(value =>
          fileResolution(
            posix.normalize(posix.join(config.base ?? entry.base, value.replaceAll('*', capture))),
            /\.[cm]?tsx?$/u.test(from),
          ),
        );
        // A known exact TSX file cannot be skipped merely because its text was not captured.
        // Missing paths can fall through; unreadable/case-aliased compiler choices remain unknown.
        const rejectedTsx = resolutions.find(
          (value, index) =>
            /\.[cm]?tsx?$/u.test(from) &&
            entry.values[index]!.endsWith('.tsx') &&
            value.status === 'unresolved' &&
            value.reason !== 'module-target-missing',
        );
        if (rejectedTsx) return { ...rejectedTsx, configuration: selected.configuration };
        const supported = resolutions.filter(value => value.status === 'resolved');
        return combine(supported.length ? supported : resolutions, selected.configuration);
      }
      if (config.base !== undefined) {
        const target = fileResolution(
          posix.join(config.base, specifier),
          /\.[cm]?tsx?$/u.test(from),
        );
        if (target.status === 'resolved')
          return { ...target, configuration: selected.configuration };
        if (
          /\.[cm]?tsx?$/u.test(from) &&
          specifier.endsWith('.tsx') &&
          target.reason !== 'module-target-missing'
        )
          return { ...target, configuration: selected.configuration };
      }
    }
    const parts = specifier.split('/');
    const name = parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    const tail = specifier.slice(name.length);
    const manifest = closest(
      from,
      packages.map(pkg => pkg.path),
    );
    const pkg = packages.find(entry => entry.path === manifest);
    if (pkg?.value.name === name && 'exports' in pkg.value)
      return packageResolution(pkg, tail ? '.' + tail : '.');
    const declarations = pkg
      ? ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
          key =>
            object(pkg.value[key]) && typeof pkg.value[key][name] === 'string'
              ? [pkg.value[key][name] as string]
              : [],
        )
      : [];
    const selectors = unique(declarations);
    if (selectors.length > 1)
      return failed('conflicting-package-selectors', [], pkg ? [pkg.path] : []);
    const selector = selectors[0];
    if (pkg && selector && /^(?:file:|link:)/u.test(selector)) {
      const relative = selector.slice(selector.indexOf(':') + 1);
      if (relative.startsWith('/') || relative.includes('\\') || /^[A-Za-z]:/u.test(relative))
        return failed('local-package-membership-unresolved', [], [pkg.path]);
      const root = posix.normalize(posix.join(pkg.root, relative));
      const target =
        root === '.' || safe(root) ? packages.find(entry => entry.root === root) : undefined;
      if (!target) return failed('local-package-membership-unresolved', [], [pkg.path]);
      const result = packageResolution(target, tail ? '.' + tail : '.');
      return { ...result, configuration: unique([...result.configuration, pkg.path]) };
    }
    if (pkg && selector && /^(?:npm:|git(?:\+|:)|github:|https?:|ssh:)/u.test(selector))
      return { status: 'external', targets: [], configuration: [pkg.path] };
    if (selector?.startsWith('workspace:') && !/^workspace:[*^~]$/u.test(selector))
      return failed('workspace-selector-requires-review', [], pkg ? [pkg.path] : []);
    const candidates = (named.get(name) ?? []).filter(
      candidate =>
        (candidate === pkg && 'exports' in candidate.value) ||
        workspaceEvidence(from, candidate).length > 0 ||
        declarations.some(value => value.startsWith('workspace:')),
    );
    if (
      selector &&
      !selector.startsWith('workspace:') &&
      candidates.length &&
      selector !== '*' &&
      !candidates.every(candidate => candidate.value.version === selector)
    )
      return failed(
        'workspace-version-selection-requires-review',
        [],
        unique([
          ...(pkg ? [pkg.path] : []),
          ...candidates.flatMap(candidate => workspaceEvidence(from, candidate)),
        ]),
      );
    if (candidates?.length) {
      if (candidates.length !== 1) return failed('ambiguous-workspace-package');
      const result = packageResolution(candidates[0]!, tail ? '.' + tail : '.');
      return {
        ...result,
        configuration: unique([
          ...result.configuration,
          ...(pkg ? [pkg.path] : []),
          ...workspaceEvidence(from, candidates[0]!),
        ]),
      };
    }
    if (declarations.some(value => /^(?:workspace:|file:|link:)/u.test(value)))
      return failed('local-package-membership-unresolved', [], pkg ? [pkg.path] : []);
    if (
      pkg &&
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
        key => object(pkg.value[key]) && typeof pkg.value[key][name] === 'string',
      )
    )
      return { status: 'external', targets: [], configuration: [pkg.path] };
    return failed('undeclared-external-module');
  };

  const references: PortalModuleReference[] = [];
  let totalBytes = 0;
  for (const [path, text] of entries) {
    if (path.endsWith('.css')) {
      for (const dependency of cssImports(text)) {
        const target =
          dependency.specifier === null ? null : localCssImport(path, dependency.specifier);
        const resolution =
          dependency.specifier === null
            ? failed('css-import-syntax-unsupported')
            : target === null
              ? resolve(path, dependency.specifier)
              : fileResolution(target);
        references.push({
          from: path,
          offset: dependency.offset,
          kind: 'css-import',
          specifier: dependency.specifier,
          ...resolution,
        });
        if (resolution.status === 'unresolved')
          problem(`MODULE_UNRESOLVED:${path}:${dependency.offset}:${resolution.reason}`);
      }
      continue;
    }
    if (!code.test(path)) continue;
    totalBytes += Buffer.byteLength(text);
    if (Buffer.byteLength(text) > 262_144 || totalBytes > 8_388_608) {
      problem(`MODULE_SOURCE_LIMIT:${path}`);
      continue;
    }
    const sfc = /\.(?:vue|svelte)$/u.test(path)
      ? scanSfcScripts(text, { templateIsBlock: path.endsWith('.vue'), includeOffsets: true })
      : null;
    if (
      sfc &&
      (sfc.unterminated || sfc.blocks.some(block => block.external || block.lang === null))
    )
      problem(`MODULE_SFC_UNSUPPORTED:${path}`);
    const scripts = sfc
      ? sfc.blocks
          .filter(block => !block.external && block.lang !== null)
          .map(block => ({
            name: `${path}.${block.lang}`,
            body: block.body,
            offset: block.offset ?? 0,
          }))
      : [{ name: path, body: text, offset: 0 }];
    for (const script of scripts) {
      let ast;
      try {
        ast = parseSync(script.name, script.body);
      } catch {
        problem(`MODULE_AST_FAILED:${path}`);
        continue;
      }
      if (ast.errors.length) problem(`MODULE_AST_ERRORS:${path}`);
      const pending: unknown[] = [ast.program];
      const found: Array<{
        node: Record<string, unknown>;
        kind: PortalModuleReference['kind'];
        source: unknown;
        uncertain?: boolean;
      }> = [];
      const calls: Record<string, unknown>[] = [];
      const requireFactories = new Set(['createRequire']);
      let count = 0,
        requireShadowed = false;
      while (pending.length && ++count <= 100_000) {
        const node = pending.pop();
        if (Array.isArray(node)) {
          if (pending.length + node.length + count > 100_000) {
            problem(`MODULE_AST_LIMIT:${path}`);
            break;
          }
          for (const child of node) pending.push(child);
          continue;
        }
        if (!object(node)) continue;
        if (
          [
            'VariableDeclarator',
            'FunctionDeclaration',
            'FunctionExpression',
            'ClassDeclaration',
            'ImportSpecifier',
            'ImportDefaultSpecifier',
            'ImportNamespaceSpecifier',
          ].includes(String(node.type)) &&
          (boundName(node.id, 'require') || boundName(node.local, 'require'))
        )
          requireShadowed = true;
        if (
          boundName(node.params, 'require') ||
          boundName(node.param, 'require') ||
          (node.type === 'AssignmentExpression' && boundName(node.left, 'require'))
        )
          requireShadowed = true;
        if (node.type === 'ImportDeclaration')
          found.push({ node, kind: 'import', source: node.source });
        if (
          ['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(node.type)) &&
          node.source
        )
          found.push({ node, kind: 're-export', source: node.source });
        if (node.type === 'ImportExpression')
          found.push({ node, kind: 'dynamic-import', source: node.source });
        if (node.type === 'TSImportType') found.push({ node, kind: 'import', source: node.source });
        if (
          node.type === 'ImportSpecifier' &&
          object(node.imported) &&
          node.imported.name === 'createRequire' &&
          object(node.local) &&
          typeof node.local.name === 'string'
        )
          requireFactories.add(node.local.name);
        if (
          node.type === 'Property' &&
          object(node.key) &&
          node.key.name === 'createRequire' &&
          object(node.value) &&
          typeof node.value.name === 'string'
        )
          requireFactories.add(node.value.name);
        if (
          node.type === 'TSImportEqualsDeclaration' &&
          object(node.moduleReference) &&
          node.moduleReference.type === 'TSExternalModuleReference'
        )
          found.push({ node, kind: 'import-equals', source: node.moduleReference.expression });
        if (node.type === 'CallExpression') calls.push(node);
        for (const [key, value] of Object.entries(node))
          if (
            !['loc', 'comments', 'parent'].includes(key) &&
            value !== null &&
            typeof value === 'object'
          )
            pending.push(value);
      }
      if (pending.length) problem(`MODULE_AST_LIMIT:${path}`);
      for (const node of calls) {
        if (!object(node.callee)) continue;
        const callee = node.callee;
        const member =
          callee.type === 'MemberExpression' && object(callee.property)
            ? String(callee.property.name ?? callee.property.value ?? '')
            : null;
        if ((callee.type === 'Identifier' && callee.name === 'require') || member === 'require')
          found.push({
            node,
            kind: 'require',
            source: Array.isArray(node.arguments) ? node.arguments[0] : null,
            uncertain: member !== null,
          });
        if (
          (callee.type === 'Identifier' && requireFactories.has(String(callee.name))) ||
          member === 'createRequire'
        )
          problem(`MODULE_CUSTOM_LOADER_REQUIRES_REVIEW:${path}:${String(node.start)}`);
      }
      const moduleLiterals = immutableModuleLiterals(ast.program);
      for (const item of found.toSorted((a, b) => Number(a.node.start) - Number(b.node.start))) {
        if (references.length >= maxReferences) {
          problem('MODULE_REFERENCE_LIMIT');
          break;
        }
        const binding =
          ['dynamic-import', 'require'].includes(item.kind) &&
          object(item.source) &&
          item.source.type === 'Identifier' &&
          typeof item.source.name === 'string'
            ? moduleLiterals.get(item.source.name)
            : undefined;
        const specifier =
          literal(item.source) ??
          (binding && binding.declaredAt <= Number(item.node.start) ? binding.value : null);
        const resolution =
          item.uncertain || (item.kind === 'require' && requireShadowed)
            ? failed('require-binding-needs-review')
            : specifier === null
              ? failed('nonliteral-module')
              : resolve(
                  path,
                  specifier,
                  item.node.type === 'ImportDeclaration' &&
                    (item.node.importKind === 'type' ||
                      (Array.isArray(item.node.specifiers) &&
                        item.node.specifiers.length > 0 &&
                        item.node.specifiers.every(
                          value => object(value) && value.importKind === 'type',
                        ))),
                );
        const reference = {
          from: path,
          offset: script.offset + Number(item.node.start ?? 0),
          kind: item.kind,
          specifier,
          ...resolution,
        };
        references.push(reference);
        if (reference.status === 'unresolved')
          problem(`MODULE_UNRESOLVED:${path}:${reference.offset}:${reference.reason}`);
      }
    }
  }
  // `files`/`include` identify program roots, not every member: verified imports also bring
  // targets into the importing project's context. Never switch a shared target to whichever
  // project's selectors happen to list it. This conservative closure rejects multiple contexts;
  // it does not claim context-specific TypeScript compiler execution or resolve uncertain edges.
  const projectConfigs = new Set<Config>();
  for (const [path, closure] of referenceClosures) {
    projectConfigs.add(readConfig(path));
    for (const target of closure.keys()) projectConfigs.add(readConfig(target));
  }
  const contexts = new Map<string, Map<Config, string[]>>();
  const defaultContext: Config = { files: [], paths: {} };
  const referenceSources = new Set(references.map(reference => reference.from));
  const queue: Array<{ path: string; config: Config; configuration: string[] }> = [];
  const addContext = (path: string, config: Config, configuration: string[]) => {
    const owners = contexts.get(path) ?? new Map<Config, string[]>();
    if (owners.has(config)) return;
    owners.set(config, configuration);
    contexts.set(path, owners);
    queue.push({ path, config, configuration });
  };
  for (const [path] of entries) {
    if (!code.test(path) || !projectConfigs.size) continue;
    const selected = configFor(path);
    // Retain the context actually used to resolve outgoing references, including a nested
    // standalone config or default/no-config resolution. A leaf with no references and no
    // declared project ownership has no prior module-resolution context to switch away from.
    if ((selected.config && projectConfigs.has(selected.config)) || referenceSources.has(path))
      addContext(path, selected.config ?? defaultContext, selected.configuration);
  }
  const edges = new Map<string, string[]>();
  for (const reference of references) {
    if (reference.status !== 'resolved') continue;
    const targets = reference.targets.filter(
      target => code.test(target) && configSources.has(target),
    );
    edges.set(reference.from, unique([...(edges.get(reference.from) ?? []), ...targets]));
  }
  let contextSteps = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const owner = queue[cursor]!;
    for (const target of edges.get(owner.path) ?? []) {
      if (++contextSteps > 100_000) break;
      addContext(target, owner.config, owner.configuration);
    }
    if (contextSteps > 100_000) {
      problem('CONFIG_CONTEXT_LIMIT');
      break;
    }
  }
  for (const [path, owners] of contexts) {
    if (owners.size < 2) continue;
    problem(`CONFIG_PROJECT_CONTEXT_AMBIGUOUS:${path}`);
    const configuration = unique([...owners.values()].flat());
    for (const reference of references) {
      if (reference.from !== path) continue;
      Object.assign(reference, failed('config-project-context-ambiguous', [], configuration));
      problem(`MODULE_UNRESOLVED:${path}:${reference.offset}:config-project-context-ambiguous`);
    }
  }
  return { complete: !issues.size, references, issues: [...issues].toSorted() };
};
