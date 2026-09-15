import { isBuiltin } from 'node:module';
import { posix } from 'node:path';

import { parseSync } from 'oxc-parser';

import { scanSfcScripts } from '../scan/sfc-blocks.js';

export interface PortalModuleReference {
  from: string;
  offset: number;
  kind: 'import' | 're-export' | 'dynamic-import' | 'require' | 'import-equals';
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

/** JSONC only: comments and trailing commas, never evaluated configuration. */
const jsonc = (input: string): unknown => {
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
      while (/\s/u.test(output[next] ?? '') && next < output.length) next++;
      if (output[next] === '}' || output[next] === ']') output[i] = ' ';
    }
  }
  return JSON.parse(output.join(''));
};

/**
 * Resolve only supplied, verified source bytes. Does not read disk, import repository code, or
 * verify installed packages. `external` means declared provisioning, not runtime success.
 */
export const resolvePortalModules = (
  sources: ReadonlyMap<string, string>,
  inventoryPaths: readonly string[],
  limits: { maxReferences?: number } = {},
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
  const readConfig = (path: string, chain: string[] = []): Config => {
    if (configs.has(path)) return configs.get(path)!;
    const empty: Config = { files: [path], paths: {} };
    if (chain.includes(path) || chain.length >= 32) {
      problem(`CONFIG_CYCLE:${path}`);
      return empty;
    }
    const text = sources.get(path);
    if (text === undefined || !inventory.has(path)) {
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
    if (value.references !== undefined) problem(`CONFIG_PROJECT_REFERENCES_REQUIRE_REVIEW:${path}`);
    if (value.extends !== undefined) {
      if (typeof value.extends !== 'string' || !value.extends.startsWith('.'))
        problem(`CONFIG_EXTENDS_UNSUPPORTED:${path}`);
      else {
        let parent = posix.normalize(posix.join(posix.dirname(path), value.extends));
        if (!parent.endsWith('.json')) parent += '.json';
        if (!safe(parent)) problem(`CONFIG_EXTENDS_UNSUPPORTED:${path}`);
        else {
          const inherited = readConfig(parent, [...chain, path]);
          result = {
            ...inherited,
            paths: { ...inherited.paths },
            files: unique([path, ...inherited.files]),
          };
        }
      }
    }
    if (object(value.compilerOptions)) {
      const options = value.compilerOptions;
      if (options.baseUrl !== undefined) {
        if (typeof options.baseUrl !== 'string') problem(`CONFIG_BASE_UNSUPPORTED:${path}`);
        else {
          const base = posix.normalize(posix.join(posix.dirname(path), options.baseUrl));
          if (base !== '.' && !safe(base)) problem(`CONFIG_BASE_UNSUPPORTED:${path}`);
          else result.base = base;
        }
      }
      if (options.paths !== undefined) {
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
      if (options.rootDirs !== undefined || options.moduleSuffixes !== undefined)
        problem(`CONFIG_RESOLUTION_UNSUPPORTED:${path}`);
    }
    configs.set(path, result);
    return result;
  };
  const configPaths = entries
    .map(([path]) => path)
    .filter(path => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/u.test(path));
  for (const path of configPaths) readConfig(path);

  const fileResolution = (base: string): Resolution => {
    if (!safe(base)) return failed('path-outside-source');
    const options = [base];
    const ext = posix.extname(base);
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
  const resolve = (from: string, specifier: string): Resolution => {
    if (specifier.length > 2048 || specifier.includes('\\') || hasControl(specifier))
      return failed('unsupported-module-specifier');
    if (isBuiltin(specifier)) return { status: 'builtin', targets: [], configuration: [] };
    if (specifier.startsWith('.'))
      return fileResolution(posix.normalize(posix.join(posix.dirname(from), specifier)));
    if (specifier.startsWith('/') || specifier.includes(':') || specifier.startsWith('#'))
      return failed('unsupported-module-specifier');
    const configPath = closest(from, configPaths);
    if (configPath) {
      const config = readConfig(configPath);
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
          fileResolution(posix.normalize(posix.join(entry.base, value.replaceAll('*', capture)))),
        );
        const supported = resolutions.filter(value => value.status === 'resolved');
        return combine(supported.length ? supported : resolutions, config.files);
      }
      if (config.base !== undefined) {
        const target = fileResolution(posix.join(config.base, specifier));
        if (target.status === 'resolved') return { ...target, configuration: config.files };
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
      for (const item of found.toSorted((a, b) => Number(a.node.start) - Number(b.node.start))) {
        if (references.length >= maxReferences) {
          problem('MODULE_REFERENCE_LIMIT');
          break;
        }
        const specifier = literal(item.source);
        const resolution =
          item.uncertain || (item.kind === 'require' && requireShadowed)
            ? failed('require-binding-needs-review')
            : specifier === null
              ? failed('nonliteral-module')
              : resolve(path, specifier);
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
  return { complete: !issues.size, references, issues: [...issues].toSorted() };
};
