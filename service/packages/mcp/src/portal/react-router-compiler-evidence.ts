/* eslint-disable no-await-in-loop -- source, lock, package and generated observations are ordered */
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import type { PortalSourceInventory } from '@sfp/shared';
import { parseSync } from 'oxc-parser';

import { readFileWithinLimit } from '../fs/atomic-file.js';
import { RepoReader } from '../fs/repo-walk.js';
import {
  isReviewedEpicCompilerConfiguration,
  isReviewedEpicCompilerSource,
} from './epic-compiler-configuration.js';
import type { NativeArtifactAuthority } from './native-artifacts.js';
import type { NativeProfile, NativeRunResult } from './native-runner.js';
import { portalSourceExclusion } from './source-path-policy.js';
import { portalError } from './store.js';

export const REACT_ROUTER_COMPILER_PREFIX = 'compiler-workspace/source';
export const REACT_ROUTER_INPUT_PREFIX = 'compiler-input';
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Fixed initial subset. Unknown config/plugin code requires implementation, not a skipped hook. */
export function assertReactRouterCompilerConfiguration(path: string, text: string): void {
  if (isReviewedEpicCompilerConfiguration(path, text)) return;
  const parsed = parseSync(path, text);
  if (parsed.errors.length) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  const program = parsed.program as unknown as Record<string, unknown>,
    body = program.body;
  if (!Array.isArray(body)) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  const imports = new Map<string, { module: string; name: string }>();
  let value: unknown;
  for (const statement of body) {
    if (!record(statement)) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
    if (
      statement.type === 'ImportDeclaration' &&
      record(statement.source) &&
      typeof statement.source.value === 'string' &&
      Array.isArray(statement.specifiers)
    ) {
      for (const specifier of statement.specifiers) {
        if (
          !record(specifier) ||
          !record(specifier.local) ||
          typeof specifier.local.name !== 'string' ||
          imports.has(specifier.local.name)
        )
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        const name =
          specifier.type === 'ImportDefaultSpecifier'
            ? 'default'
            : record(specifier.imported)
              ? String(specifier.imported.name ?? '')
              : '';
        const module = statement.source.value;
        if (
          ![
            '@react-router/dev/vite',
            '@react-router/dev/config',
            '@tailwindcss/vite',
            'vite',
          ].includes(module)
        )
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        imports.set(specifier.local.name, { module, name });
      }
    } else if (statement.type === 'ExportDefaultDeclaration' && value === undefined)
      value = statement.declaration;
    else throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  }
  while (record(value) && ['TSSatisfiesExpression', 'TSAsExpression'].includes(String(value.type)))
    value = value.expression;
  if (path === 'vite.config.ts') {
    if (
      !record(value) ||
      value.type !== 'CallExpression' ||
      !record(value.callee) ||
      value.callee.type !== 'Identifier' ||
      !Array.isArray(value.arguments) ||
      value.arguments.length !== 1
    )
      throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
    const binding = imports.get(String(value.callee.name));
    if (binding?.module !== 'vite' || binding.name !== 'defineConfig')
      throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
    value = value.arguments[0];
  }
  // Only the inspected SSR configuration shape can run in the fixed output capsule.
  // Literal values alone do not authorize foreign roots, output paths or additional inputs.
  const configurationKeys = new Map<string, readonly string[]>(
    path === 'react-router.config.ts'
      ? [['', ['ssr']]]
      : [
          ['', ['environments', 'plugins', 'resolve']],
          ['environments', ['ssr']],
          ['environments.ssr', ['build']],
          ['environments.ssr.build', ['rollupOptions']],
          ['environments.ssr.build.rollupOptions', ['input']],
          ['resolve', ['tsconfigPaths']],
        ],
  );
  const inspectShape = (node: unknown, location: string): void => {
    if (!record(node)) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
    if (node.type === 'ObjectExpression' && Array.isArray(node.properties)) {
      const permitted = configurationKeys.get(location);
      if (!permitted) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
      const seen = new Set<string>();
      for (const property of node.properties) {
        if (!record(property) || !record(property.key))
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        const name = String(property.key.name ?? property.key.value ?? '');
        if (!permitted.includes(name) || seen.has(name))
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        seen.add(name);
        inspectShape(property.value, location ? location + '.' + name : name);
      }
      if (path === 'react-router.config.ts' && location === '' && !seen.has('ssr'))
        throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
      return;
    }
    if (location === 'plugins' && node.type === 'ArrayExpression' && Array.isArray(node.elements))
      return;
    const expected =
      location === 'environments.ssr.build.rollupOptions.input'
        ? './server/app.ts'
        : ['ssr', 'resolve.tsconfigPaths'].includes(location)
          ? true
          : undefined;
    if (expected === undefined || node.type !== 'Literal' || node.value !== expected)
      throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  };
  inspectShape(value, '');
  const pending = [value];
  let steps = 0;
  while (pending.length && ++steps <= 10000) {
    const node = pending.pop();
    if (!record(node)) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
    if (node.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof node.value))
      continue;
    if (node.type === 'ObjectExpression' && Array.isArray(node.properties)) {
      for (const property of node.properties) {
        if (
          !record(property) ||
          property.type !== 'Property' ||
          property.computed ||
          property.method ||
          property.kind !== 'init'
        )
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        const name = record(property.key)
          ? String(property.key.name ?? property.key.value ?? '')
          : '';
        if (
          [
            'prerender',
            'serverBundles',
            'unstable_rsc',
            'unstable_routeDiscovery',
            'configFile',
            '__proto__',
            'prototype',
            'constructor',
          ].includes(name)
        )
          throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
        pending.push(property.value);
      }
      continue;
    }
    if (node.type === 'ArrayExpression' && Array.isArray(node.elements)) {
      for (const element of node.elements) pending.push(element);
      continue;
    }
    if (
      path === 'vite.config.ts' &&
      node.type === 'CallExpression' &&
      record(node.callee) &&
      node.callee.type === 'Identifier' &&
      Array.isArray(node.arguments) &&
      node.arguments.length === 0
    ) {
      const binding = imports.get(String(node.callee.name));
      if (
        (binding?.module === '@react-router/dev/vite' && binding.name === 'reactRouter') ||
        (binding?.module === '@tailwindcss/vite' && binding.name === 'default')
      )
        continue;
    }
    throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  }
  if (pending.length) throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
}
const digest = (bytes: Uint8Array | string) => storedChecksum(bytes);
const inside = (root: string, path: string) => {
  const value = relative(root, path);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
};
const generated = (path: string) => path.startsWith('.react-router/') || path.startsWith('build/');
const packages = [
  '@react-router/dev',
  '@react-router/express',
  'react-router',
  'vite',
  '@tailwindcss/vite',
  'express',
] as const;

const scalar = (input: string): string => {
  if (input.startsWith("'") && input.endsWith("'")) return input.slice(1, -1).replaceAll("''", "'");
  if (/^[A-Za-z0-9_@./^~+*()| -]+$/u.test(input) && !input.startsWith('*') && !input.includes(' #'))
    return input;
  throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
};
/** Closed pnpm v9 importer/package projection. No YAML execution, aliases or custom tags. */
export function readReactRouterPnpmLock(
  text: string,
  importer: string,
): Map<string, { specifier: string; version: string; integrity: string }> {
  if (Buffer.byteLength(text) > 1_048_576 || !/^lockfileVersion: ['"]9\.0['"]\r?$/mu.test(text))
    throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
  // Validate the complete top-level document before deriving any selected package facts.
  const topLevel = new Set<string>(),
    settings = new Set<string>();
  let inspectedSection = '';
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const header = /^([A-Za-z][A-Za-z0-9]*):(?: (.+))?$/u.exec(line);
      if (
        !header ||
        !['lockfileVersion', 'settings', 'importers', 'packages', 'snapshots'].includes(header[1]!)
      )
        throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
      if (topLevel.has(header[1]!)) throw portalError('PORTAL_COMPILER_LOCK_AMBIGUOUS');
      topLevel.add(header[1]!);
      inspectedSection = header[1]!;
      if (
        inspectedSection === 'lockfileVersion'
          ? !/^(?:'9\.0'|"9\.0")$/u.test(header[2] ?? '')
          : header[2] !== undefined
      )
        throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
    } else if (inspectedSection === 'settings') {
      const setting = /^  (autoInstallPeers|excludeLinksFromLockfile): (true|false)$/u.exec(line);
      if (!setting) throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
      if (settings.has(setting[1]!)) throw portalError('PORTAL_COMPILER_LOCK_AMBIGUOUS');
      settings.add(setting[1]!);
    }
  }
  if (!['lockfileVersion', 'importers', 'packages'].every(key => topLevel.has(key)))
    throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
  const selected = new Map<string, { specifier: string; version: string; integrity: string }>();
  const records = new Map<string, { specifier?: string; version?: string }>();
  const integrity = new Map<string, string>();
  let section = '',
    currentImporter = '',
    dependencySection = '',
    currentPackage = '';

  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.length > 16_384 || line.includes('\t'))
      throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
    if (!line.startsWith(' ')) {
      section = line.replace(/:.*$/u, '');
      currentPackage = '';
      continue;
    }
    if (section === 'importers') {
      const head = /^  ([^ ].*):$/u.exec(line);
      if (head) {
        currentImporter = scalar(head[1]!);
        dependencySection = '';
        currentPackage = '';
        continue;
      }
      if (currentImporter !== importer) continue;
      const group = /^    (dependencies|devDependencies|optionalDependencies):$/u.exec(line);
      if (group) {
        dependencySection = group[1]!;
        currentPackage = '';
        continue;
      }
      const name = /^      ([^ ].*):$/u.exec(line);
      if (name && dependencySection) {
        currentPackage = scalar(name[1]!);
        if (records.has(currentPackage)) throw portalError('PORTAL_COMPILER_LOCK_AMBIGUOUS');
        records.set(currentPackage, {});
        continue;
      }
      const value = /^        (specifier|version): (.+)$/u.exec(line);
      if (value && currentPackage) {
        const entry = records.get(currentPackage)!;
        const key = value[1]! as 'specifier' | 'version';
        if (entry[key] !== undefined) throw portalError('PORTAL_COMPILER_LOCK_AMBIGUOUS');
        entry[key] = scalar(value[2]!);
        continue;
      }
      throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
    }
    if (section === 'packages') {
      const head = /^  ([^ ].*):$/u.exec(line);
      if (head) {
        currentPackage = scalar(head[1]!);
        continue;
      }
      const value = /^    resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}$/u.exec(line);
      if (value && currentPackage) {
        if (integrity.has(currentPackage)) throw portalError('PORTAL_COMPILER_LOCK_AMBIGUOUS');
        integrity.set(currentPackage, value[1]!);
      }
    }
  }
  for (const name of packages) {
    const entry = records.get(name),
      version = entry?.version?.split('(')[0];
    if (!entry?.specifier || !version || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version))
      throw portalError('PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED');
    const sum = integrity.get(name + '@' + version);
    if (!sum) throw portalError('PORTAL_COMPILER_LOCK_INTEGRITY_REQUIRED');
    selected.set(name, { specifier: entry.specifier, version, integrity: sum });
  }
  return selected;
}

/** Npm v3 standalone package projection. All paths are data, never module resolution inputs. */
export function readReactRouterNpmLock(
  text: string,
  manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  names: readonly string[] = packages,
): Map<string, { specifier: string; version: string; integrity: string }> {
  if (Buffer.byteLength(text) > 1048576) throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
  const lock: unknown = JSON.parse(text);
  if (
    !record(lock) ||
    lock.lockfileVersion !== 3 ||
    !record(lock.packages) ||
    Object.keys(lock.packages).length > 5000
  )
    throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
  const importer = lock.packages[''];
  if (!record(importer)) throw portalError('PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED');
  for (const [p, value] of Object.entries(lock.packages)) {
    if (p === '') continue;
    if (
      !/^node_modules\/(?:[A-Za-z0-9@._-]+\/)*[A-Za-z0-9._-]+$/u.test(p) ||
      p.split('/').some(v => v === '.' || v === '..') ||
      !record(value) ||
      value.link === true ||
      typeof value.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(value.version) ||
      typeof value.integrity !== 'string' ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/u.test(value.integrity)
    )
      throw portalError('PORTAL_COMPILER_LOCK_UNSUPPORTED');
  }
  const out = new Map<string, { specifier: string; version: string; integrity: string }>();
  for (const name of names) {
    const specifier = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
      entry = lock.packages['node_modules/' + name];
    const locked =
      (record(importer.dependencies) ? importer.dependencies[name] : undefined) ??
      (record(importer.devDependencies) ? importer.devDependencies[name] : undefined);
    if (
      typeof specifier !== 'string' ||
      specifier !== locked ||
      !record(entry) ||
      typeof entry.version !== 'string' ||
      typeof entry.integrity !== 'string'
    )
      throw portalError('PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED');
    out.set(name, { specifier, version: entry.version, integrity: entry.integrity });
  }
  return out;
}

export interface ReactRouterCompilerSource {
  readonly sourceId: string;
  readonly sourceInventoryHash: string;
  readonly inputHash: `sha256:${string}`;
  readonly files: readonly { path: string; hash: string }[];
}
interface SourceData {
  root: string;
  identity: string;
  inventory: PortalSourceInventory;
  texts: Map<string, string>;
  files: Map<string, Uint8Array>;
}
const sources = new WeakMap<object, SourceData>();
const compilerProfiles = new WeakMap<object, { source: ReactRouterCompilerSource; hash: string }>();
/** Diagnostic projection only. Reported child markers grant no execution or cleanup authority. */
export function compilerCommandDiagnostics(command: NativeRunResult['commands'][number]) {
  const marker = command.output.match(
    /^PORTAL_COMPILER_OBSERVATION_FAILED phase=(typegen|configuration|client-build|ssr-build|observation) cause=([A-Z_]+|unclassified)(?: errorCode=([A-Z_]+|unclassified))? messageHash=([a-f0-9]{64})(?: plugin=([^\s]+) hook=([^\s]+) module=([^\s]+) pluginHash=([a-f0-9]{64}) hookHash=([a-f0-9]{64}) moduleHash=([a-f0-9]{64}))?(?: contextGuard=(none|client-builder|client-manifest|ssr-flag|ssr-directory|manifest-data))?(?: cssBytes=(\d{1,10}) cssPrior=(0|1) cssOverLimit=(true|false) cssRepeated=(true|false) cssSame=(true|false) cssHash=([a-f0-9]{64}))?$/mu,
  );
  const knownCodes = new Set([
    'PORTAL_COMPILER_CLI_UNSUPPORTED',
    'PORTAL_COMPILER_CONTEXT_REQUIRED',
    'PORTAL_COMPILER_PLUGIN_CONTEXT_REQUIRED',
    'PORTAL_COMPILER_VIRTUAL_MODULE_AMBIGUOUS',
    'PORTAL_COMPILER_EVIDENCE_LIMIT',
    'PORTAL_COMPILER_CSS_OBSERVATION_INVALID',
    'PORTAL_COMPILER_LEGACY_CONTEXT_UNSUPPORTED',
    'PORTAL_COMPILER_VIRTUAL_MODULE_REQUIRED',
    'MODULE_NOT_FOUND',
    'ERR_MODULE_NOT_FOUND',
    'PLUGIN_ERROR',
    'PARSE_ERROR',
    'UNRESOLVED_IMPORT',
    'INVALID_INPUT_OPTIONS',
  ]);
  return Object.freeze({
    id: ['compiler-dependencies', 'react-router-compiler'].includes(command.commandId)
      ? command.commandId
      : 'unclassified',
    status: ['passed', 'failed', 'timed-out', 'cancelled', 'output-limit'].includes(command.status)
      ? command.status
      : 'unclassified',
    exitCode: Number.isSafeInteger(command.exitCode) ? command.exitCode : null,
    durationMs:
      Number.isFinite(command.durationMs) && command.durationMs >= 0 ? command.durationMs : null,
    cleanup: ['finished', 'tree-termination-requested'].includes(command.cleanup)
      ? command.cleanup
      : 'unconfirmed',
    outputBytes: Buffer.byteLength(command.output),
    outputHash: storedChecksum(command.output),
    moduleEvidenceHash: command.moduleEvidence
      ? contentHash('sfp-compiler-module-diagnostic-v1', command.moduleEvidence)
      : null,
    ...(marker
      ? {
          reportedPhase: marker[1],
          reportedCause: knownCodes.has(marker[2]!) ? marker[2] : 'unclassified',
          reportedCode: knownCodes.has(marker[3]!) ? marker[3] : 'unclassified',
          reportedMessageHash: marker[4],
          ...(marker[5]
            ? {
                reportedPlugin: [
                  'react-router',
                  'react-router:virtual-modules',
                  'react-router:build-client-route',
                  'react-router:route-chunks-index',
                  'react-router:split-route-modules',
                  'react-router:dot-server',
                  'react-router:dot-client',
                  'react-router:route-exports',
                  'react-router:validate-plugin-order',
                  'vite:load-fallback',
                  'vite:css',
                  'vite:esbuild',
                  'sfp:react-router-source',
                ].includes(marker[5]!)
                  ? marker[5]
                  : 'unclassified',
                reportedHook: [
                  'config',
                  'configResolved',
                  'buildStart',
                  'resolveId',
                  'load',
                  'transform',
                  'renderChunk',
                  'generateBundle',
                  'writeBundle',
                  'buildEnd',
                  'closeBundle',
                ].includes(marker[6]!)
                  ? marker[6]
                  : 'unclassified',
                reportedModule: [
                  'virtual:react-router/server-build',
                  'virtual:react-router/server-manifest',
                  'server/app.ts',
                  'app/styles/tailwind.css?url',
                  'vite.config.ts',
                  'react-router.config.ts',
                ].includes(marker[7]!)
                  ? marker[7]
                  : 'unclassified',
                reportedPluginHash: marker[8],
                reportedHookHash: marker[9],
                reportedModuleHash: marker[10],
              }
            : {}),
          ...(marker[11] ? { reportedContextGuard: marker[11] } : {}),
          ...(marker[12] !== undefined && Number(marker[12]) <= 2147483647
            ? {
                reportedCssCodeBytes: Number(marker[12]),
                reportedCssPriorObservations: Number(marker[13]),
                reportedCssOverLimit: marker[14] === 'true',
                reportedCssRepeated: marker[15] === 'true',
                reportedCssSameCode: marker[16] === 'true',
                reportedCssCodeHash: marker[17],
              }
            : {}),
          reportedMarkerOnly: true,
        }
      : {}),
  });
}
export function compilerRunDiagnostics(result: NativeRunResult) {
  return {
    commands: result.commands.slice(0, 4).map(compilerCommandDiagnostics),
    runnerReturnedAt: Date.now(),
    commandCount: result.commands.length,
    outputCount: result.outputReceipts.length,
  };
}
export const REACT_ROUTER_DEPENDENCY_BOOTSTRAP = String.raw`
const fs=require('node:fs/promises'),path=require('node:path');
const inside=(root,p)=>{const r=path.relative(root,p);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
const context=JSON.parse(process.argv[1]);
const base=path.resolve('compiler-workspace');
async function copy(source,target){
  await fs.cp(source,target,{recursive:true,dereference:false,verbatimSymlinks:true,force:false,errorOnExist:true,filter:p=>path.relative(source,p).split(path.sep)[0]!=='.vite-temp'});
  const pending=[target];while(pending.length){const p=pending.pop(),s=await fs.lstat(p);if(s.isSymbolicLink()){if(!inside(base,await fs.realpath(p)))throw Error('PORTAL_COMPILER_DEPENDENCY_LINK_REJECTED');}else if(s.isDirectory()){for(const d of await fs.readdir(p))pending.push(path.join(p,d));}else if(!s.isFile())throw Error('PORTAL_COMPILER_DEPENDENCY_MEMBER_REJECTED');}
}
void(async()=>{await fs.cp('compiler-input',path.join(base,'source'),{recursive:true,dereference:false,errorOnExist:true,force:false});if(context.shared!==context.local)await copy(context.shared,path.join(base,'node_modules'));await copy(context.local,path.join(base,'source','node_modules'));
if(context.icons!==undefined){if(!Array.isArray(context.icons)||context.icons.length!==2)throw Error('PORTAL_COMPILER_ICON_INPUT_INVALID');for(let index=0;index<2;index++){const item=context.icons[index],name=['sprite.svg','types.ts'][index];if(item.name!==name||typeof item.hash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(item.hash))throw Error('PORTAL_COMPILER_ICON_INPUT_INVALID');const file=path.join(base,'source/app/components/ui/icons',name);if(!inside(base,file)||await fs.realpath(base)!==base||await fs.realpath(file)!==file)throw Error('PORTAL_COMPILER_ICON_INPUT_INVALID');const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('PORTAL_COMPILER_ICON_INPUT_INVALID');const bytes=await fs.readFile(file),after=await fs.lstat(file);if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||'sha256:'+require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==item.hash)throw Error('PORTAL_COMPILER_ICON_INPUT_CHANGED');await fs.rm(file);}}
console.log('COMPILER_DEPENDENCIES_READY');})().catch(()=>{console.error('PORTAL_COMPILER_DEPENDENCY_PROVISION_FAILED');process.exitCode=1;});
`;
/** Actual Vite/RR hooks, reviewed with the profile. Bytes stay in the private compiler output. */
export const REACT_ROUTER_COMPILER_BOOTSTRAP = String.raw`
const fs=require('node:fs/promises'),path=require('node:path');
const E=['PORTAL_COMPILER_CLI_UNSUPPORTED','PORTAL_COMPILER_CONTEXT_REQUIRED','PORTAL_COMPILER_PLUGIN_CONTEXT_REQUIRED','PORTAL_COMPILER_VIRTUAL_MODULE_AMBIGUOUS','PORTAL_COMPILER_EVIDENCE_LIMIT','PORTAL_COMPILER_CSS_OBSERVATION_INVALID','PORTAL_COMPILER_LEGACY_CONTEXT_UNSUPPORTED','PORTAL_COMPILER_VIRTUAL_MODULE_REQUIRED'];
let phase='typegen',g='none',cf=null;
void(async()=>{
const root=process.cwd();
const manifest=require.resolve('@react-router/dev/package.json'),pkg=JSON.parse(await fs.readFile(manifest,'utf8'));const bin=pkg.bin?.['react-router'];if(!['bin.js','bin.cjs'].includes(bin))throw Error(E[0]);const cli=path.join(path.dirname(manifest),bin);
require('node:child_process').execFileSync(process.execPath,[cli,'typegen'],{cwd:root,env:process.env,windowsHide:true,shell:false,timeout:60000,maxBuffer:1048576});
phase='configuration';const vite=await import('vite');let ob=null,v=null;const cs=[];
const audit={name:'sfp:react-router-source',enforce:'post',configResolved(config){
const context=config.__reactRouterPluginContext;
if(config.command!=='build'||config.mode!=='production'||path.resolve(config.root)!==root||!context||path.resolve(context.rootDirectory)!==root||context.reactRouterConfig?.ssr!==true)throw Error(E[1]);
const plugins=config.plugins.map(p=>p.name);if(plugins.filter(n=>n==='react-router').length!==1||plugins.length>128)throw Error(E[2]);
ob={schemaVersion:1,command:'build',mode:config.mode,configFile:path.relative(root,config.configFile).split(path.sep).join('/'),frameworkConfig:'react-router.config.ts',ssr:true,plugins};
},transform(code,id){if(this.environment?.name==='ssr'&&id.replace(/^\0/,'')==='virtual:react-router/server-build'){
if(v!==null&&v!==code)throw Error(E[3]);if(Buffer.byteLength(code)>1048576)throw Error(E[4]);v=code;
}
if(this.environment?.name==='ssr'&&id===path.join(root,'app/styles/tailwind.css').split(path.sep).join('/')+'?url'){
const cb=Buffer.byteLength(code),prior=cs.length;
if(cb>65536||prior){cf={codeBytes:cb,prior,overLimit:cb>65536,repeated:prior>0,same:prior===1&&cs[0].code===code,codeHash:require('node:crypto').createHash('sha256').update(code).digest('hex')};throw Error(E[5]);}
cs.push({path:'app/styles/tailwind.css?url',code});}

}};
const legacy=process.argv[1]==='epic-legacy-ssr-v1';
const builder=await vite.createBuilder({root,mode:'production',configFile:path.join(root,'vite.config.ts'),plugins:[audit]},legacy);
const ea=builder.config.__reactRouterPluginContext?.reactRouterConfig?.future?.v8_viteEnvironmentApi===true;
if(legacy&&(ea||pkg.version!=='7.16.0'))throw Error(E[6]);
if(legacy){g='client-builder';const client=builder.environments?.client;
if(Object.keys(builder.environments??{}).length!==1||Object.values(builder.environments)[0]!==client||client?.name!=='client'||path.resolve(client.config.root)!==root||client.config.build?.ssr===true||builder.config.build?.ssr===true)throw Error(E[6]);g='none';}
phase='client-build';await builder.buildApp();
if(legacy){
phase='ssr-build';const context=builder.config.__reactRouterPluginContext;
g='client-manifest';
const ms=value=>{
let nodes=0,bytes=0;const fail=()=>{throw Error(E[6]);};
const keys=value=>{if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail();if(++nodes>10000)fail();return Object.getOwnPropertyNames(value).sort();};
const own=(value,key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value' in descriptor))fail();return descriptor.value;};
const charge=value=>{bytes+=Buffer.byteLength(JSON.stringify(value))+8;if(bytes>1048576)fail();};
const names=keys(value);if(names.length!==1||names[0]!=='routes')fail();const routes=own(value,'routes'),ids=keys(routes);if(!ids.includes('root')||ids.length>10000)fail();const projected=Object.create(null);
for(const id of ids){if(id.length>4096)fail();charge(id);const route=own(routes,id),fields=keys(route);if(fields.length>6||own(route,'id')!==id||typeof own(route,'file')!=='string')fail();const item=Object.create(null);
for(const field of fields){if(++nodes>10000||!['id','parentId','file','path','index','caseSensitive'].includes(field))fail();const data=own(route,field);if(data===undefined){if(['id','file'].includes(field))fail();continue;}if(['index','caseSensitive'].includes(field)?typeof data!=='boolean':typeof data!=='string'||data.length>4096)fail();charge(field);charge(data);item[field]=data;}
projected[id]=item;}
const result=JSON.stringify({routes:projected});if(Buffer.byteLength(result)>1048576)fail();return result;
};
const cm=ms(context.buildManifest);g='none';
// The pinned upstream legacy CLI injects the same context and resolved SSR environment.
// Resolve options through its genuine config hook; do not synthesize a future flag or output config.
const si={root,mode:'production',configFile:path.join(root,'vite.config.ts'),build:{ssr:true},plugins:[audit],__reactRouterPluginContext:context};
const sc=await vite.resolveConfig(si,'build');
g='ssr-flag';if(sc.build?.ssr!==true)throw Error(E[6]);
g='ssr-directory';if(path.resolve(sc.build.outDir)!==path.join(context.reactRouterConfig.buildDirectory,'server'))throw Error(E[6]);
g='manifest-data';if(ms(context.buildManifest)!==cm||ms(sc.__reactRouterPluginContext?.buildManifest)!==cm)throw Error(E[6]);g='none';
const options={build:sc.build,resolve:sc.ssr?.resolve};
await vite.build({...si,__reactRouterEnvironmentBuildContext:{name:'ssr',resolveOptions:()=>options}});
}
phase='observation';
if(!ob||v===null)throw Error(E[7]);
await fs.mkdir('compiler-observations',{recursive:false});await fs.writeFile('compiler-observations/observed.json',JSON.stringify({...ob,environment:'ssr',virtualId:'virtual:react-router/server-build',virtualCode:v,cssUrlModules:cs}));
console.log('COMPILER_SOURCE_OBSERVED');
})().catch(error=>{const known=E;let message='';try{const value=error?.message;message=typeof value==='string'?value.slice(0,4096):'';}catch{}let code='unclassified';try{const value=error?.code;if(['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','PLUGIN_ERROR','PARSE_ERROR','UNRESOLVED_IMPORT','INVALID_INPUT_OPTIONS'].includes(value))code=value;}catch{}const read=key=>{try{const value=error?.[key];return typeof value==='string'?value.slice(0,4096):'';}catch{return '';}};
const plugin=read('plugin'),hook=read('hook'),id=read('id');const ni=id.replace(/^\0/,'');
const mi=ni.startsWith('virtual:')?ni:path.relative(process.cwd(),ni).split(path.sep).join('/');
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const closed=(value,known)=>known.includes(value)?value:'unclassified';
console.error('PORTAL_COMPILER_OBSERVATION_FAILED phase='+phase+' cause='+(cf?E[5]:known.includes(message)?message:'unclassified')+' errorCode='+code+' messageHash='+hash(message)+' plugin='+closed(plugin,["react-router","react-router:virtual-modules","react-router:build-client-route","react-router:route-chunks-index","react-router:split-route-modules","react-router:dot-server","react-router:dot-client","react-router:route-exports","react-router:validate-plugin-order","vite:load-fallback","vite:css","vite:esbuild","sfp:react-router-source"])+' hook='+closed(hook,["config","configResolved","buildStart","resolveId","load","transform","renderChunk","generateBundle","writeBundle","buildEnd","closeBundle"])+' module='+closed(mi,["virtual:react-router/server-build","virtual:react-router/server-manifest","server/app.ts","app/styles/tailwind.css?url","vite.config.ts","react-router.config.ts"])+' pluginHash='+hash(plugin)+' hookHash='+hash(hook)+' moduleHash='+hash(id)+' contextGuard='+g+(cf?' cssBytes='+cf.codeBytes+' cssPrior='+cf.prior+' cssOverLimit='+cf.overLimit+' cssRepeated='+cf.repeated+' cssSame='+cf.same+' cssHash='+cf.codeHash:''));process.exitCode=1;});
`;

/** Data-only preparation. The returned exact file is reviewed/registered before execution. */
export async function prepareReactRouterCompilerProfile(
  source: ReactRouterCompilerSource,
  input: NativeProfile,
  packageContextRoot: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<NativeProfile> {
  const [{ NativeProfileSchema, nativeExecutableHash }, { prepareNativeArtifactAuthority }] =
    await Promise.all([import('./native-runner.js'), import('./native-artifacts.js')]);
  signal.throwIfAborted();
  const data = sources.get(source);
  if (!data) throw portalError('PORTAL_COMPILER_SOURCE_REQUIRED');
  assertReactRouterCompilerConfiguration(
    'react-router.config.ts',
    data.texts.get('react-router.config.ts')!,
  );
  assertReactRouterCompilerConfiguration('vite.config.ts', data.texts.get('vite.config.ts')!);
  if (!isAbsolute(packageContextRoot) || /^(?:\\\\|\/\/)/u.test(packageContextRoot))
    throw portalError('PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED');
  const context = resolve(packageContextRoot);
  if (!inside(context, data.root)) throw portalError('PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED');
  const stat = await lstat(context);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(context)) !== context)
    throw portalError('PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED');
  const importer = relative(context, data.root).split(sep).join('/') || '.';
  if (importer.split('/').length > 8) throw portalError('PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED');
  const manifest = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(data.files.get('package.json')!),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const epic = isReviewedEpicCompilerSource(data.texts);
  if (
    (isReviewedEpicCompilerConfiguration('vite.config.ts', data.texts.get('vite.config.ts')!) ||
      isReviewedEpicCompilerConfiguration(
        'react-router.config.ts',
        data.texts.get('react-router.config.ts')!,
      )) &&
    !epic
  )
    throw portalError('PORTAL_COMPILER_CONFIGURATION_UNSUPPORTED');
  const selectedPackages = epic
    ? [
        ...packages,
        '@epic-web/config',
        '@sentry/react-router',
        'react-router-devtools',
        'vite-env-only',
        'vite-plugin-icons-spritesheet',
        'react-router-auto-routes',
      ]
    : packages;
  const lock = epic
    ? readReactRouterNpmLock(data.texts.get('package-lock.json') ?? '', manifest, selectedPackages)
    : readReactRouterPnpmLock(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readFileWithinLimit(join(context, 'pnpm-lock.yaml'), 1048576),
        ),
        importer,
      );
  if (epic && context !== data.root) throw portalError('PORTAL_COMPILER_PACKAGE_CONTEXT_REQUIRED');
  const versions = [];
  for (const name of selectedPackages) {
    signal.throwIfAborted();
    const installed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readFileWithinLimit(join(data.root, 'node_modules', name, 'package.json'), 262_144),
      ),
    ) as { name?: string; version?: string; bin?: Record<string, string> };
    const entry = lock.get(name)!;
    if (
      installed.name !== name ||
      installed.version !== entry.version ||
      (manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]) !== entry.specifier
    )
      throw portalError('PORTAL_COMPILER_PACKAGE_CHANGED');
    versions.push({ name, version: installed.version });
  }
  const version = versions.find(p => p.name === '@react-router/dev')!.version!;
  const major = Number(version.split('.')[0]);
  if (![7, 8].includes(major)) throw portalError('PORTAL_COMPILER_FRAMEWORK_VERSION_UNSUPPORTED');
  const shared = join(context, 'node_modules'),
    local = join(data.root, 'node_modules');
  if (!epic && shared === local) throw portalError('PORTAL_COMPILER_PACKAGE_LAYOUT_UNSUPPORTED');
  const executable = process.execPath,
    executableHash = await nativeExecutableHash(executable);
  const profile = NativeProfileSchema.parse({
    ...input,
    sourceAuthorityVersion: 2,
    sourceHash: source.inputHash,
    closure: source.files.map(f => ({
      path: REACT_ROUTER_INPUT_PREFIX + '/' + f.path,
      hash: f.hash,
    })),
    resources: undefined,
    environmentAuthority: undefined,
    artifactAuthority: undefined,
    externalArtifacts: [{ root: epic ? local : context, kind: 'node-package-tree' }],
    environment: { NODE_ENV: 'production', CI: 'true', DO_NOT_TRACK: '1' },
    commands: [
      {
        id: 'compiler-dependencies',
        executable,
        executableHash,
        args: [
          '-e',
          REACT_ROUTER_DEPENDENCY_BOOTSTRAP,
          JSON.stringify({
            shared,
            local,
            ...(epic
              ? {
                  icons: ['sprite.svg', 'types.ts'].map(name => {
                    const bytes = data.files.get('app/components/ui/icons/' + name);
                    if (!bytes) throw portalError('PORTAL_COMPILER_OUTPUT_REQUIRED');
                    return { name, hash: digest(bytes) };
                  }),
                }
              : {}),
          }),
        ],
        cwd: '.',
        timeoutMs: 180000,
        maxOutputBytes: 65536,
        allowLifecycleScripts: false,
        produces: [{ path: 'compiler-workspace', kind: 'provisioned-dependencies' }],
      },
      {
        id: 'react-router-compiler',
        moduleLoader: 'tailwindcss-node-esm-cache-v1',
        moduleResolver: 'vite-import-meta-resolve-v1',
        executable,
        executableHash,
        args: ['-e', REACT_ROUTER_COMPILER_BOOTSTRAP, ...(epic ? ['epic-legacy-ssr-v1'] : [])],
        cwd: REACT_ROUTER_COMPILER_PREFIX,
        timeoutMs: 180000,
        maxOutputBytes: 1_048_576,
        allowLifecycleScripts: false,
        produces: [
          { path: REACT_ROUTER_COMPILER_PREFIX + '/build', kind: 'generated-output' },
          { path: REACT_ROUTER_COMPILER_PREFIX + '/.react-router', kind: 'generated-output' },
          {
            path: REACT_ROUTER_COMPILER_PREFIX + '/node_modules/.vite-temp',
            kind: 'generated-output',
          },
          {
            path: REACT_ROUTER_COMPILER_PREFIX + '/compiler-observations',
            kind: 'generated-output',
          },
          ...(epic
            ? ['sprite.svg', 'types.ts'].map(name => ({
                path: REACT_ROUTER_COMPILER_PREFIX + '/app/components/ui/icons/' + name,
                kind: 'generated-output' as const,
              }))
            : []),
        ],
      },
    ],
  });
  profile.artifactAuthority = await prepareNativeArtifactAuthority(profile, signal);
  signal.throwIfAborted();
  compilerProfiles.set(profile, { source, hash: contentHash('sfp-native-profile-v1', profile) });
  return profile;
}
export async function captureReactRouterCompilerSource(
  reader: RepoReader,
  sourceId: string,
  inventory: PortalSourceInventory,
): Promise<ReactRouterCompilerSource> {
  if (!inventory.complete || inventory.files.length > 5000)
    throw portalError('PORTAL_COMPILER_SOURCE_INCOMPLETE');
  const root = reader.rootDir,
    stat = await lstat(root, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(root) !== (await realpath(root)))
    throw portalError('PORTAL_ROOT_CHANGED');
  const files = new Map<string, Uint8Array>(),
    texts = new Map<string, string>();
  let total = 0;
  for (const row of inventory.files) {
    if (portalSourceExclusion(row.path) === 'credentials')
      throw portalError('PORTAL_COMPILER_ENVIRONMENT_REVIEW_REQUIRED');
    const bytes = await reader.readBytes(row.path, 16_777_216);
    if (digest(bytes) !== row.hash || (total += bytes.length) > 134_217_728)
      throw portalError('PORTAL_SOURCE_CHANGED');
    if (row.classification === 'text')
      texts.set(row.path, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!generated(row.path)) files.set(row.path, bytes);
  }
  if (
    !files.has('react-router.config.ts') ||
    !files.has('vite.config.ts') ||
    !files.has('server/app.ts')
  )
    throw portalError('PORTAL_COMPILER_FRAMEWORK_REQUIRED');
  const rows = [...files]
    .map(([path, bytes]) => ({ path, hash: digest(bytes) }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const value = Object.freeze({
    sourceId,
    sourceInventoryHash: inventory.hash,
    inputHash: contentHash('sfp-react-router-compiler-input-v1', rows),
    files: Object.freeze(rows.map(row => Object.freeze(row))),
  });
  sources.set(value, { root, identity: `${stat.dev}:${stat.ino}`, inventory, texts, files });
  return value;
}
export function compilerSourceBytes(
  source: ReactRouterCompilerSource,
): ReadonlyMap<string, Uint8Array> {
  const data = sources.get(source);
  if (!data) throw portalError('PORTAL_COMPILER_SOURCE_REQUIRED');
  return new Map([...data.files].map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
}

export interface ReactRouterCompilerEvidence {
  readonly hash: `sha256:${string}`;
  readonly sourceId: string;
  readonly sourceInventoryHash: string;
  readonly generatedFiles: number;
}
interface EvidenceData {
  workspaceId: string;
  source: ReactRouterCompilerSource;
  ownerId: string;
  generation: string;
  root: string;
  profile: NativeProfile;
  result: NativeRunResult;
  texts: Map<string, string>;
  modules: Map<string, string>;
  configuration: readonly string[];
  deadlineAt: number;
}
const evidence = new WeakMap<object, EvidenceData>();
// A bounded weak index permits independent recipe lifecycles to revalidate the same issuer.
// A serialized hash never constructs a capsule. Closing the owning runtime retires its entry.
const currentEvidence = new Map<string, WeakRef<ReactRouterCompilerEvidence>>();
export function reactRouterCompilerEvidenceExpired(value: ReactRouterCompilerEvidence): boolean {
  const data = evidence.get(value);
  return !data || Date.now() >= data.deadlineAt;
}
export function retireReactRouterCompilerEvidence(value: ReactRouterCompilerEvidence): void {
  if (currentEvidence.get(value.hash)?.deref() === value) currentEvidence.delete(value.hash);
  evidence.delete(value);
}
export async function verifyReactRouterCompilerGraphEvidence(
  hash: string,
  ownerId: string,
  sourceId: string,
  inventoryHash: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  const value = currentEvidence.get(hash)?.deref();
  const data = value && evidence.get(value);
  if (
    !value ||
    !data ||
    data.ownerId !== ownerId ||
    data.workspaceId !== workspaceId ||
    value.sourceId !== sourceId
  )
    throw portalError('PORTAL_COMPILER_EVIDENCE_REQUIRED');
  await verifyReactRouterCompilerEvidence(
    value,
    ownerId,
    data.generation,
    inventoryHash,
    signal,
    workspaceId,
  );
}
/** Called only after the service-owned native producer; outside/serialized result rows fail. */
/**
 * Pure decoder/read seam. It never issues evidence; capture retains private issuer and receipt
 * checks.
 */
const compilerObservationRequired = () => portalError('PORTAL_COMPILER_OBSERVATION_REQUIRED');
export async function readReactRouterCssAsset(input: {
  code: string;
  sourceRoot: string;
  clientRoot: string;
  reviewedEpic: boolean;
  signal: AbortSignal;
}): Promise<{ path: string; hash: string; bytes: number }> {
  const invalid = compilerObservationRequired;
  input.signal.throwIfAborted();
  if (Buffer.byteLength(input.code) > 65536) throw invalid();
  const parsed = parseSync('css-url.mjs', input.code),
    body = parsed.program.body as unknown as Record<string, unknown>[];
  if (parsed.errors.length) throw invalid();
  const member = async (root: string, file: string): Promise<void> => {
    input.signal.throwIfAborted();
    const base = resolve(root);
    if ((await realpath(base)) !== base) throw invalid();
    const part = relative(base, file);
    if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep) || !part) throw invalid();
    let current = base;
    const chunks = part.split(sep);
    for (let i = 0; i < chunks.length; i++) {
      input.signal.throwIfAborted();
      current = join(current, chunks[i]!);
      const stat = await lstat(current);
      if (
        stat.isSymbolicLink() ||
        (await realpath(current)) !== current ||
        (i === chunks.length - 1 ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())
      )
        throw invalid();
    }
    input.signal.throwIfAborted();
  };
  let assetPath: string;
  if (body.length === 1 && body[0]?.type === 'ExportDefaultDeclaration') {
    const declaration = body[0].declaration;
    if (
      !record(declaration) ||
      declaration.type !== 'Literal' ||
      typeof declaration.value !== 'string' ||
      !/^\/assets\/[A-Za-z0-9_.-]+\.css$/u.test(declaration.value)
    )
      throw invalid();
    assetPath = declaration.value.slice(1);
  } else {
    if (
      !input.reviewedEpic ||
      body.length !== 2 ||
      body[0]?.type !== 'ImportDeclaration' ||
      body[1]?.type !== 'ExportDefaultDeclaration'
    )
      throw invalid();
    const importNode = body[0],
      declaration = body[1].declaration;
    if (
      !Array.isArray(importNode.specifiers) ||
      importNode.specifiers.length ||
      !record(importNode.source) ||
      typeof importNode.source.value !== 'string' ||
      !record(declaration) ||
      declaration.type !== 'Literal' ||
      typeof declaration.value !== 'string' ||
      (Array.isArray(importNode.attributes) && importNode.attributes.length)
    )
      throw invalid();
    const cssFile = resolve(input.sourceRoot, 'app/styles/tailwind.css'),
      request = cssFile.replaceAll('\\', '/') + '?transform-only';
    if (importNode.source.value !== request) throw invalid();
    const token = /^__VITE_CSS_URL__([a-f0-9]+)__$/u.exec(declaration.value);
    if (!token || token[1]!.length % 2) throw invalid();
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token[1]!, 'hex'));
    } catch {
      throw invalid();
    }
    if (decoded !== request || Buffer.from(decoded).toString('hex') !== token[1]) throw invalid();
    await member(input.sourceRoot, cssFile);
    const manifestFile = resolve(input.clientRoot, '.vite/manifest.json');
    await member(input.clientRoot, manifestFile);
    const bytes = await readFileWithinLimit(manifestFile, 2097152);
    input.signal.throwIfAborted();
    const manifest: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!record(manifest)) throw invalid();
    const identity = cssFile.replaceAll('\\', '/'),
      matches = Object.entries(manifest).filter(([key]) => key.replaceAll('\\', '/') === identity);
    if (matches.length !== 1) throw invalid();
    const entry = matches[0]![1];
    if (
      !record(entry) ||
      Object.keys(entry).toSorted().join(',') !== 'file,src' ||
      typeof entry.src !== 'string' ||
      entry.src.replaceAll('\\', '/') !== identity ||
      typeof entry.file !== 'string' ||
      !/^assets\/[A-Za-z0-9_.-]+\.css$/u.test(entry.file)
    )
      throw invalid();
    assetPath = entry.file;
  }
  const assetFile = resolve(input.clientRoot, assetPath);
  await member(input.clientRoot, assetFile);
  const asset = await readFileWithinLimit(assetFile, 16777216);
  if (!asset.length) throw portalError('PORTAL_COMPILER_OUTPUT_REQUIRED');
  input.signal.throwIfAborted();
  return { path: assetPath, hash: storedChecksum(asset), bytes: asset.length };
}

/** Bounded output reader only. It does not admit a producer or issue compiler authority. */
export async function readReactRouterGeneratedTypeModules(
  rootDir: string,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const reader = new RepoReader({
    rootDir,
    maxFileBytes: 1048576,
    maxTotalBytes: 16777216,
    signal,
  });
  const rows = await reader.walk({ cap: 5000 });
  if (rows.truncated) throw portalError('PORTAL_COMPILER_OUTPUT_REQUIRED');
  const modules = new Map<string, string>();
  for (const path of rows.files) {
    if (!/^types\/.+\.ts$/u.test(path)) continue;
    const body = new TextDecoder('utf-8', { fatal: true }).decode(await reader.readBytes(path));
    modules.set('.react-router/' + path, body);
    modules.set(path.slice('types/'.length), body);
  }
  return modules;
}

export async function captureReactRouterCompilerEvidence(input: {
  source: ReactRouterCompilerSource;
  ownerId: string;
  generation: string;
  workspaceId: string;
  originPlanId: string;
  originContextHash: string;
  root: string;
  runId: string;
  profile: NativeProfile;
  result: NativeRunResult;
  signal: AbortSignal;
}): Promise<ReactRouterCompilerEvidence> {
  const [
    { issuedNativeRunBinding },
    { verifyNativeModuleEvidence },
    { verifyNativeOutputReceipts },
  ] = await Promise.all([
    import('./native-runner.js'),
    import('./native-module-fence.js'),
    import('./native-artifacts.js'),
  ]);
  input.signal.throwIfAborted();
  const source = sources.get(input.source);
  const runBinding = issuedNativeRunBinding(input.result, input.profile, input.root, input.runId);
  if (!source || !issuedNativeRunBinding(input.result, input.profile, input.root, input.runId))
    throw portalError('PORTAL_COMPILER_PRODUCER_REQUIRED');
  if (!runBinding || Date.now() >= runBinding.deadlineAt)
    throw portalError('PORTAL_COMPILER_EVIDENCE_EXPIRED');
  const producer = compilerProfiles.get(input.profile);
  if (
    !producer ||
    producer.source !== input.source ||
    producer.hash !== contentHash('sfp-native-profile-v1', input.profile)
  )
    throw portalError('PORTAL_COMPILER_PROFILE_REQUIRED');
  if (
    input.result.commands.length !== input.profile.commands.length ||
    input.result.commands.some(c => c.status !== 'passed' || c.exitCode !== 0 || !c.moduleEvidence)
  )
    throw portalError('PORTAL_COMPILER_PRODUCER_FAILED');
  for (const command of input.result.commands)
    await verifyNativeModuleEvidence(command.moduleEvidence!, input.signal);
  await verifyNativeOutputReceipts(input.root, input.result.outputReceipts, input.signal);
  const outputs = input.result.outputReceipts.filter(r => r.kind === 'generated-output');
  const server = outputs.find(r => r.path === REACT_ROUTER_COMPILER_PREFIX + '/build');
  if (!server) throw portalError('PORTAL_COMPILER_OUTPUT_REQUIRED');
  const types = outputs.find(r => r.path === REACT_ROUTER_COMPILER_PREFIX + '/.react-router');
  if (!types) throw portalError('PORTAL_COMPILER_OUTPUT_REQUIRED');
  const observation = outputs.find(
    r => r.path === REACT_ROUTER_COMPILER_PREFIX + '/compiler-observations',
  );
  if (!observation) throw portalError('PORTAL_COMPILER_OBSERVATION_REQUIRED');
  const observed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      await readFileWithinLimit(join(input.root, observation.path, 'observed.json'), 2_097_152),
    ),
  );
  if (
    !record(observed) ||
    Object.keys(observed).toSorted().join(',') !==
      [
        'schemaVersion',
        'command',
        'mode',
        'configFile',
        'frameworkConfig',
        'ssr',
        'plugins',
        'environment',
        'virtualId',
        'virtualCode',
        ...(observed.cssUrlModules === undefined ? [] : ['cssUrlModules']),
      ]
        .toSorted()
        .join(',') ||
    observed.schemaVersion !== 1 ||
    observed.command !== 'build' ||
    observed.mode !== 'production' ||
    observed.configFile !== 'vite.config.ts' ||
    observed.frameworkConfig !== 'react-router.config.ts' ||
    observed.ssr !== true ||
    observed.environment !== 'ssr' ||
    observed.virtualId !== 'virtual:react-router/server-build' ||
    typeof observed.virtualCode !== 'string' ||
    Buffer.byteLength(observed.virtualCode) > 1_048_576 ||
    !Array.isArray(observed.plugins) ||
    observed.plugins.some(p => typeof p !== 'string' || p.length > 256) ||
    observed.plugins.length > 128 ||
    observed.plugins.filter(p => p === 'react-router').length !== 1
  )
    throw portalError('PORTAL_COMPILER_OBSERVATION_REQUIRED');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(
    await readFileWithinLimit(join(input.root, server.path, 'server/index.js'), 16_777_216),
  );
  // Retain the real server output in a separate compiler namespace, never source inventory.
  const css = observed.cssUrlModules ?? [];
  if (
    !Array.isArray(css) ||
    css.length > 1 ||
    css.some(
      v =>
        !record(v) ||
        Object.keys(v).toSorted().join(',') !== 'code,path' ||
        v.path !== 'app/styles/tailwind.css?url' ||
        typeof v.code !== 'string' ||
        Buffer.byteLength(v.code) > 65536,
    )
  )
    throw portalError('PORTAL_COMPILER_OBSERVATION_REQUIRED');
  if (isReviewedEpicCompilerSource(source.texts) && css.length !== 1)
    throw portalError('PORTAL_COMPILER_OBSERVATION_REQUIRED');
  for (const row of css) {
    await readReactRouterCssAsset({
      code: row.code,
      sourceRoot: join(input.root, REACT_ROUTER_COMPILER_PREFIX),
      clientRoot: join(input.root, server.path, 'client'),
      reviewedEpic: isReviewedEpicCompilerSource(source.texts),
      signal: input.signal,
    });
  }
  await verifyNativeOutputReceipts(input.root, [server], input.signal);
  const modules = new Map<string, string>([
    ['virtual:react-router/server-build', observed.virtualCode],
    ['build/server/index.js', text],
    ...css.map(v => [v.path, v.code] as [string, string]),
  ]);
  // Every admitted React Router source needs its actual generated route types. The receipt,
  // producer/source binding and original deadline were verified above; this is no source file.
  for (const [path, body] of await readReactRouterGeneratedTypeModules(
    join(input.root, types.path),
    input.signal,
  ))
    modules.set(path, body);
  const value = Object.freeze({
    hash: contentHash('sfp-react-router-compiler-evidence-v1', {
      owner: input.ownerId,
      workspaceId: input.workspaceId,
      originPlanId: input.originPlanId,
      originContextHash: input.originContextHash,
      generation: input.generation,
      source: input.source.inputHash,
      inventory: input.source.sourceInventoryHash,
      profile: input.result.profileHash,
      authority: input.result.artifactAuthorityHash,
      outputs: input.result.outputReceipts,
      server: digest(text),
    }),
    sourceId: input.source.sourceId,
    sourceInventoryHash: input.source.sourceInventoryHash,
    generatedFiles: server.inventory.files + types.inventory.files,
  });
  input.signal.throwIfAborted();
  if (Date.now() >= runBinding.deadlineAt) throw portalError('PORTAL_COMPILER_EVIDENCE_EXPIRED');
  evidence.set(value, {
    source: input.source,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    generation: input.generation,
    root: input.root,
    profile: input.profile,
    result: input.result,
    texts: new Map(source.texts),
    modules,
    configuration: ['react-router.config.ts', 'vite.config.ts', 'package.json'],
    deadlineAt: runBinding.deadlineAt,
  });
  if (currentEvidence.size >= 16 && !currentEvidence.has(value.hash))
    currentEvidence.delete(currentEvidence.keys().next().value!);
  currentEvidence.set(value.hash, new WeakRef(value));
  return value;
}
export async function verifyReactRouterCompilerEvidence(
  value: ReactRouterCompilerEvidence,
  ownerId: string,
  generation: string,
  sourceInventoryHash: string,
  signal?: AbortSignal,
  workspaceId?: string,
): Promise<void> {
  const [{ verifyNativeModuleEvidence }, { verifyNativeOutputReceipts }] = await Promise.all([
    import('./native-module-fence.js'),
    import('./native-artifacts.js'),
  ]);
  const data = evidence.get(value);
  if (
    !data ||
    data.ownerId !== ownerId ||
    (workspaceId !== undefined && data.workspaceId !== workspaceId) ||
    data.generation !== generation ||
    value.sourceInventoryHash !== sourceInventoryHash
  )
    throw portalError('PORTAL_COMPILER_EVIDENCE_REQUIRED');
  if (Date.now() >= data.deadlineAt) throw portalError('PORTAL_COMPILER_EVIDENCE_EXPIRED');
  for (const command of data.result.commands)
    await verifyNativeModuleEvidence(command.moduleEvidence!, signal);
  await verifyNativeOutputReceipts(
    data.root,
    data.result.outputReceipts,
    signal ?? new AbortController().signal,
  );
  signal?.throwIfAborted();
  if (Date.now() >= data.deadlineAt) throw portalError('PORTAL_COMPILER_EVIDENCE_EXPIRED');
}
/** Recipe propagation retains the original private owner/issuer; no JSON proof is accepted. */
export async function verifyReactRouterCompilerSourceEvidence(
  value: ReactRouterCompilerEvidence,
  sourceId: string,
  sourceInventoryHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const data = evidence.get(value);
  if (!data || value.sourceId !== sourceId) throw portalError('PORTAL_COMPILER_EVIDENCE_REQUIRED');
  await verifyReactRouterCompilerEvidence(
    value,
    data.ownerId,
    data.generation,
    sourceInventoryHash,
    signal,
  );
}
export function admittedReactRouterCompilerEvidence(
  value: ReactRouterCompilerEvidence,
  sourceId: string,
  sourceInventoryHash: string,
  current: ReadonlyMap<string, string>,
): { hash: string; configuration: readonly string[]; modules: ReadonlyMap<string, string> } | null {
  const data = evidence.get(value);
  if (
    !data ||
    value.sourceId !== sourceId ||
    value.sourceInventoryHash !== sourceInventoryHash ||
    Date.now() >= data.deadlineAt
  )
    return null;
  for (const [path, text] of current) if (data.texts.get(path) !== text) return null;
  return {
    hash: value.hash,
    configuration: [...data.configuration],
    modules: new Map(data.modules),
  };
}

/**
 * Source-graph package config reads use only the genuine current compiler profile artifact
 * authority.
 */
export function reactRouterCompilerPackageAuthority(
  value: ReactRouterCompilerEvidence,
  sourceId: string,
  inventoryHash: string,
): NativeArtifactAuthority | undefined {
  const data = evidence.get(value);
  if (
    !data ||
    Date.now() >= data.deadlineAt ||
    value.sourceId !== sourceId ||
    value.sourceInventoryHash !== inventoryHash
  )
    return undefined;
  return data.profile.artifactAuthority;
}

/**
 * Only a genuine unchanged service-issued Epic source profile may produce these copied-source
 * leaves.
 */
export function reactRouterCompilerAllowsIconOutput(
  profile: NativeProfile,
  path: string,
  parent: string,
): boolean {
  const issued = compilerProfiles.get(profile),
    data = issued && sources.get(issued.source);
  return (
    !!issued &&
    !!data &&
    issued.hash === contentHash('sfp-native-profile-v1', profile) &&
    isReviewedEpicCompilerSource(data.texts) &&
    parent === 'compiler-workspace' &&
    [
      'compiler-workspace/source/app/components/ui/icons/sprite.svg',
      'compiler-workspace/source/app/components/ui/icons/types.ts',
    ].includes(path)
  );
}

export function reactRouterCompilerUsesProvisionedModules(
  profile: NativeProfile,
  commandId: string,
): boolean {
  const issued = compilerProfiles.get(profile),
    data = issued && sources.get(issued.source);
  return (
    !!issued &&
    !!data &&
    issued.hash === contentHash('sfp-native-profile-v1', profile) &&
    isReviewedEpicCompilerSource(data.texts) &&
    commandId === 'react-router-compiler'
  );
}

/** Read-only private issuer pairing; equal serialized hashes never construct source authority. */
export function reactRouterCompilerProfileMatchesSource(
  profile: NativeProfile,
  source: ReactRouterCompilerSource,
): boolean {
  const issued = compilerProfiles.get(profile);
  return (
    !!issued &&
    issued.source === source &&
    sources.has(source) &&
    issued.hash === contentHash('sfp-native-profile-v1', profile) &&
    profile.sourceHash === source.inputHash
  );
}
