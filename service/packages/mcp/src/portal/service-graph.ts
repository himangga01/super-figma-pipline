import { posix } from 'node:path';

import { contentHash, storedChecksum } from '@sfp/ir';
import { ServiceGraphProfileSchema, type ServiceGraphProfile, type PortalLayer } from '@sfp/shared';
import { parseSync } from 'oxc-parser';

import type { RepoReader } from '../fs/repo-walk.js';
import { analyzeProject } from '../profile/profile.js';
import { scanSfcScripts } from '../scan/sfc-blocks.js';
import { resolvePortalModules } from './module-resolution.js';
import {
  analyzePortalServiceConnections,
  type PortalConnectionMember,
  type PortalRoutingBinding,
} from './service-connections.js';
import { classifyPortalSourceBytes, collectPortalSourceInventory } from './source-inventory.js';
import { isPortalSourcePath, portalSourceExclusion } from './source-path-policy.js';

export { isPortalSourcePath } from './source-path-policy.js';

type Evidence = ServiceGraphProfile['services'][number]['evidence'][number];
type Service = ServiceGraphProfile['services'][number];
/** Text analysis bounds. Hash-only members are byte-bound by the inventory instead. */
const MAX_TEXT_FILE_BYTES = 262_144;
const MAX_TEXT_TOTAL_BYTES = 8_388_608;
const MAX_SERVICE_EVIDENCE = 512;
/** Dependency lockfiles are resolution records, never text evidence: always hash-only. */
const lockfiles =
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|deno\.lock|composer\.lock|Gemfile\.lock|Pipfile\.lock|poetry\.lock|pdm\.lock|uv\.lock|Cargo\.lock|go\.sum|packages\.lock\.json|gradle\.lockfile|flake\.lock|mix\.lock|Podfile\.lock|pubspec\.lock|Package\.resolved)$/u;
/** Data read as text only while it fits the text bounds; otherwise it is a hash-only member. */
const dataText =
  /\.(?:json|ya?ml|toml|xml|html|css|scss|md|graphql|gql)$|(?:^|\/)Dockerfile(?:\.[^/]*)?$/u;
/** Module-resolution configuration: parsed by resolvePortalModules, including `extends` parents. */
const resolutionConfiguration = /(?:^|\/)(?:ts|js)config[^/]*\.json$/u;
/**
 * Package key of a module specifier: `@scope/name`, `name` or `node:name`. Relative and absolute
 * specifiers name file locations rather than modules and share one key.
 */
const moduleKey = (specifier: string): string => {
  if (/^\.{1,2}(?:\/|$)/u.test(specifier) || specifier.startsWith('/')) return '(relative)';
  const [first = specifier, second] = specifier.split('/');
  return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
};
const auxiliary = (path: string) =>
  /(?:^|\/)(?:test|tests|__tests__|examples?|fixtures?|stories)(?:\/|$)|\.(?:test|spec|stories)\.[^/]+$/u.test(
    path,
  );
const manifests =
  /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|Cargo\.toml|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|[^/]+\.csproj)$/u;
const languages: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  svelte: 'svelte',
  py: 'python',
  go: 'go',
  rs: 'rust',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  php: 'php',
  sql: 'sql',
  prisma: 'prisma',
};
const layerForModule = (name: string): PortalLayer | undefined => {
  if (/^(?:react(?:-dom)?|vue|next|nuxt|svelte|@angular\/)/u.test(name)) return 'frontend';
  if (
    /^(?:express|fastify|koa|hono|@nestjs\/[^/]+|django|fastapi|flask|actix-web|axum|(?:node:)?(?:http|https|net))(?:\/|$)/u.test(
      name,
    )
  )
    return 'backend';
  if (
    /^(?:pg|mysql2?|sqlite3|better-sqlite3|node:sqlite|@prisma\/client|prisma|drizzle-orm|mongoose|typeorm|sequelize|sqlalchemy)$/u.test(
      name,
    )
  )
    return 'database';
  if (/^(?:passport|next-auth|@auth\/|better-auth|jsonwebtoken|jose|bcrypt|argon2)/u.test(name))
    return 'authentication';
  if (/^(?:bullmq|bull|amqplib|kafkajs|celery)/u.test(name)) return 'jobs';
  if (/^(?:@aws-sdk\/client-s3|multer|minio)/u.test(name)) return 'storage';
  if (/^(?:stripe|nodemailer|twilio|@sendgrid\/)/u.test(name)) return 'integration';
  return undefined;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read-only evidence extraction. No repository module/configuration/script is executed. */
export const analyzeServiceGraph = async (
  reader: RepoReader,
  sourceId: `sha256:${string}` = contentHash('sfp-unqualified-analysis-v1', reader.rootDir),
): Promise<ServiceGraphProfile> => {
  const sourceInventory = await collectPortalSourceInventory(reader);
  const files: ServiceGraphProfile['files'] = [],
    issues: string[] = sourceInventory.issues.map(
      issue => `SOURCE_INVENTORY:${issue.code}${issue.path === undefined ? '' : `:${issue.path}`}`,
    );
  let issuesTruncated = false;
  const addIssue = (...values: string[]) => {
    for (const value of values) {
      if (issues.length < 512) issues.push(value);
      else issuesTruncated = true;
    }
  };
  let bytes = 0,
    incomplete = !sourceInventory.complete,
    hardIncomplete = !sourceInventory.complete;
  const hard = (issue: string) => {
    incomplete = true;
    hardIncomplete = true;
    addIssue(issue);
  };
  // Sources that the analysis must read (code, manifests, resolution configuration and routing)
  // take the text budget first. Other data is read only while it fits; the rest, and every
  // lockfile, is a hash-only member whose bytes the inventory binds.
  const required = (path: string) =>
    Object.hasOwn(languages, posix.extname(path).slice(1)) ||
    manifests.test(path) ||
    resolutionConfiguration.test(path) ||
    path === 'portal.routes.json' ||
    path.endsWith('.mdx');
  const candidates = sourceInventory.files.filter(
    member =>
      (isPortalSourcePath(member.path) ||
        (member.path.endsWith('.css') &&
          portalSourceExclusion(member.path) === 'generated-output')) &&
      !lockfiles.test(member.path),
  );
  const texts = new Map<string, { text: string; bytes: number }>();
  const failed = new Set<string>();
  const fail = (path: string, code: string) => {
    failed.add(path);
    hard(`${code}:${path}`);
  };
  for (const mustRead of [true, false])
    for (const member of candidates) {
      const path = member.path;
      if (required(path) !== mustRead || (!mustRead && !dataText.test(path))) continue;
      if (member.bytes > MAX_TEXT_FILE_BYTES || bytes + member.bytes > MAX_TEXT_TOTAL_BYTES) {
        if (mustRead) fail(path, 'SOURCE_LIMIT');
        continue;
      }
      let data: Buffer;
      try {
        // eslint-disable-next-line no-await-in-loop -- shared RepoReader byte and path authority
        data = await reader.readBytes(path, MAX_TEXT_FILE_BYTES);
      } catch (cause) {
        const code = (cause as { code?: unknown } | null)?.code;
        if (code === 'ABORT_ERR') throw cause;
        if (code === 'REPO_TOTAL_BYTES_EXCEEDED') {
          if (mustRead) fail(path, 'SOURCE_LIMIT');
        } else
          fail(
            path,
            code === 'FILE_SIZE_LIMIT_EXCEEDED' || code === 'REPO_FILE_NOT_FOUND'
              ? 'SOURCE_CHANGED_DURING_ANALYSIS'
              : 'SOURCE_UNREADABLE',
          );
        continue;
      }
      bytes += data.length;
      if (storedChecksum(data) !== member.hash) {
        fail(path, 'SOURCE_CHANGED_DURING_ANALYSIS');
        continue;
      }
      let text: string | undefined;
      try {
        // The default decoder removes one leading BOM; hashes always bind the raw bytes.
        if (classifyPortalSourceBytes(data) === 'text')
          text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      } catch {
        text = undefined;
      }
      if (text === undefined) fail(path, 'SOURCE_ENCODING');
      else texts.set(path, { text, bytes: data.length });
    }
  // Inventory order keeps evidence and module resolution deterministic.
  const source = new Map<string, string>();
  const hashOnly: string[] = [];
  for (const member of sourceInventory.files) {
    const read = texts.get(member.path);
    if (read) {
      source.set(member.path, read.text);
      files.push({ path: member.path, hash: member.hash, bytes: read.bytes });
    } else if (isPortalSourcePath(member.path) && !failed.has(member.path))
      hashOnly.push(member.path);
  }
  const roots = [
    ...new Set(
      [...source.keys()].filter(path => manifests.test(path)).map(path => posix.dirname(path)),
    ),
  ].toSorted();
  if (!roots.includes('.')) roots.unshift('.');
  if (roots.length > 128) {
    roots.length = 128;
    incomplete = true;
    hardIncomplete = true;
    addIssue('SERVICE_COUNT_LIMIT');
  }
  const services = new Map<string, Service>(
    roots.map(rootPath => [
      rootPath,
      {
        id: contentHash('sfp-qualified-service-v2', { sourceId, rootPath }).slice(7, 39),
        rootPath,
        languages: [],
        frameworks: [],
        layers: [],
        dependencies: {},
        scripts: {},
        evidence: [],
      },
    ]),
  );
  const edges: ServiceGraphProfile['edges'] = [];
  const byPath = new Map(files.map(file => [file.path, file]));
  const moduleGraph = resolvePortalModules(
    source,
    sourceInventory.files.map(file => file.path),
  );
  if (!moduleGraph.complete) {
    incomplete = true;
    hardIncomplete = true;
    addIssue(...moduleGraph.issues);
  }
  // A required input is byte-bound or blocking: a relative import into a recorded exclusion
  // (generated output, credentials, dependencies) is named explicitly, never silently missing.
  const exclusions = sourceInventory.exclusions.map(exclusion => ({
    ...exclusion,
    folded: exclusion.path.toLowerCase(),
  }));
  for (const reference of moduleGraph.references) {
    if (
      reference.status !== 'unresolved' ||
      reference.specifier === null ||
      !/^\.{1,2}(?:\/|$)/u.test(reference.specifier)
    )
      continue;
    const target = posix
      .normalize(posix.join(posix.dirname(reference.from), reference.specifier))
      .replace(/\/+$/u, '')
      .toLowerCase();
    const excluded = exclusions.find(
      exclusion =>
        target === exclusion.folded ||
        target.startsWith(`${exclusion.folded}/`) ||
        (exclusion.kind !== 'directory' && exclusion.folded.startsWith(`${target}.`)),
    );
    if (excluded)
      hard(
        `SOURCE_REQUIRED_INPUT_EXCLUDED:${reference.from}:${reference.offset}:${excluded.reason}:${excluded.path}`,
      );
  }
  const runtimePaths = new Set(
    [...source.keys()].filter(
      path =>
        !auxiliary(path) &&
        !/\.(?:json|ya?ml|toml|xml|html|css|scss|sql|prisma|graphql|gql|md)$/u.test(path),
    ),
  );
  const runtimeImports = new Map<string, string[]>();
  for (const ref of moduleGraph.references)
    if (ref.status === 'resolved')
      runtimeImports.set(ref.from, [...(runtimeImports.get(ref.from) ?? []), ...ref.targets]);
  const pending = [...runtimePaths];
  while (pending.length) {
    const path = pending.pop()!;
    for (const target of runtimeImports.get(path) ?? [])
      if (source.has(target) && auxiliary(target) && !runtimePaths.has(target)) {
        runtimePaths.add(target);
        pending.push(target);
      }
  }
  const sourceRole = (path: string): 'runtime' | 'auxiliary' | 'configuration' | 'asset' =>
    runtimePaths.has(path)
      ? 'runtime'
      : auxiliary(path)
        ? 'auxiliary'
        : /\.(?:json|ya?ml|toml|xml|html|css|scss)$/u.test(path)
          ? 'configuration'
          : /\.(?:sql|prisma|graphql|gql|md)$/u.test(path)
            ? 'asset'
            : 'runtime';
  const fileRoot = (path: string) =>
    roots
      .filter(value => value === '.' || path.startsWith(`${value}/`))
      .toSorted((a, b) => (b === '.' ? 0 : b.length) - (a === '.' ? 0 : a.length))[0]!;
  // Structural edges are kept once per endpoint pair; import and API edges stay per occurrence.
  const structuralEdges = new Set<string>();
  const addEdge = (edge: ServiceGraphProfile['edges'][number]) => {
    if (edge.kind === 'configures' || edge.kind === 'depends-on') {
      const edgeKey = JSON.stringify([edge.kind, edge.from, edge.to, edge.evidence.kind]);
      if (structuralEdges.has(edgeKey)) return;
      structuralEdges.add(edgeKey);
    }
    if (edges.length < 10000) edges.push(edge);
    else {
      incomplete = true;
      hardIncomplete = true;
      if (!issues.includes('EDGE_LIMIT')) addIssue('EDGE_LIMIT');
    }
  };
  const newlines = new Map<string, number[]>();
  /** 1-based line of `offset`: one more than the newlines strictly before it. */
  const lineOf = (path: string, offset: number) => {
    let positions = newlines.get(path);
    if (positions === undefined) {
      positions = [];
      const text = source.get(path) ?? '';
      for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
        positions.push(index);
      newlines.set(path, positions);
    }
    let low = 0,
      high = positions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle]! < offset) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  };
  // Service evidence is aggregated per kind, role and module key (or detail): one row with the
  // first location and an exact `count`, instead of one row per occurrence.
  const rowIndex = new Map<Service, Map<string, Evidence>>();
  const addRow = (service: Service, evidence: Evidence, key: string, layer?: PortalLayer) => {
    if (layer && !service.layers.includes(layer)) service.layers.push(layer);
    const rows = rowIndex.get(service) ?? new Map<string, Evidence>();
    rowIndex.set(service, rows);
    const rowKey = JSON.stringify([evidence.kind, evidence.sourceRole ?? null, key]);
    const row = rows.get(rowKey);
    if (row) row.count = (row.count ?? 1) + 1;
    else if (service.evidence.length < MAX_SERVICE_EVIDENCE) {
      const created = { ...evidence, detail: key.slice(0, 2048), count: 1 };
      service.evidence.push(created);
      rows.set(rowKey, created);
    } else {
      incomplete = true;
      hardIncomplete = true;
      if (!issues.includes('EVIDENCE_LIMIT')) addIssue('EVIDENCE_LIMIT');
    }
  };
  const references = new Map<string, typeof moduleGraph.references>();
  for (const reference of moduleGraph.references) {
    const items = references.get(reference.from) ?? [];
    items.push(reference);
    references.set(reference.from, items);
  }
  for (const [path, text] of source) {
    const root = fileRoot(path);
    const service = services.get(root)!;
    const language = languages[posix.extname(path).slice(1)];
    if (language && !service.languages.includes(language)) service.languages.push(language);
    /** Exact per-occurrence evidence for edges; the service row aggregates it under `key`. */
    const add = (
      kind: string,
      detail: string,
      offset: number,
      layer?: PortalLayer,
      key = detail,
    ): Evidence => {
      const line = lineOf(path, offset);
      const evidence = {
        sourceId,
        sourceRole: sourceRole(path),
        path,
        startLine: line,
        endLine: line,
        hash: byPath.get(path)!.hash,
        kind,
        detail: detail.slice(0, 2048),
      };
      addRow(service, evidence, key, layer);
      return evidence;
    };
    for (const reference of references.get(path) ?? []) {
      const evidence = add(
        reference.status === 'external'
          ? 'declared-external-module'
          : reference.status === 'unresolved'
            ? 'unresolved-module'
            : 'resolved-module',
        reference.specifier ?? reference.reason ?? 'Nonliteral module',
        reference.offset,
        sourceRole(path) !== 'runtime' || reference.specifier === null
          ? undefined
          : layerForModule(reference.specifier),
        // Local files aggregate per target service; packages and built-ins per package key.
        reference.status === 'resolved' && reference.targets.length
          ? `local:${[...new Set(reference.targets.map(fileRoot))].toSorted().join(',')}`
          : reference.specifier === null
            ? (reference.reason ?? 'Nonliteral module')
            : moduleKey(reference.specifier),
      );
      for (const target of reference.targets) {
        addEdge({ from: path, to: target, kind: 'imports', evidence });
        const dependency = fileRoot(target);
        if (dependency !== root && sourceRole(path) === 'runtime')
          addEdge({ from: root, to: dependency, kind: 'depends-on', evidence });
      }
      if (reference.status === 'external' && reference.specifier)
        addEdge({ from: path, to: reference.specifier, kind: 'imports', evidence });
      for (const configuration of reference.configuration) {
        const file = byPath.get(configuration);
        if (!file) continue;
        addEdge({
          from: configuration,
          to: path,
          kind: 'configures',
          evidence: {
            sourceId,
            path: configuration,
            startLine: 1,
            endLine: 1,
            hash: file.hash,
            kind: 'module-resolution-configuration',
            detail: reference.specifier ?? '',
          },
        });
      }
    }
    if (posix.basename(path) === 'package.json') {
      try {
        const manifest: unknown = JSON.parse(text);
        if (!object(manifest)) throw new Error('MANIFEST_INVALID');
        for (const group of ['dependencies', 'devDependencies', 'peerDependencies'])
          if (object(manifest[group]))
            for (const [name, version] of Object.entries(manifest[group])) {
              if (typeof version !== 'string') continue;
              service.dependencies[name] = version;
              const layer = layerForModule(name);
              if (layer && group !== 'devDependencies' && !auxiliary(path)) {
                add('dependency', `${name}@${version}`, 0, layer);
                if (service.frameworks.length < 32 && !service.frameworks.includes(name))
                  service.frameworks.push(name);
              }
            }
        if (object(manifest.scripts))
          for (const [name, command] of Object.entries(manifest.scripts))
            if (typeof command === 'string') service.scripts[name] = command;
        add(
          'manifest',
          'Declared package versions; installed versions require runtime verification',
          0,
          'configuration',
        );
      } catch {
        incomplete = true;
        hardIncomplete = true;
        addIssue(`MANIFEST_INVALID:${path}`);
      }
    }
    const sfc = /\.(?:vue|svelte)$/u.test(path)
      ? scanSfcScripts(text, { templateIsBlock: path.endsWith('.vue'), includeOffsets: true })
      : null;
    if (sfc) {
      if (!service.layers.includes('frontend')) service.layers.push('frontend');
      if (sfc.unterminated || sfc.blocks.some(block => block.external || block.lang === null)) {
        incomplete = true;
        hardIncomplete = true;
        addIssue(`SFC_SOURCE_REQUIRES_REVIEW:${path}`);
      }
    }
    const scripts = sfc
      ? sfc.blocks
          .filter(block => !block.external && block.lang !== null)
          .map(block => ({
            name: `${path}.${block.lang}`,
            body: block.body,
            offset: block.offset ?? 0,
          }))
      : /\.(?:[cm]?[jt]sx?)$/u.test(path)
        ? [{ name: path, body: text, offset: 0 }]
        : [];
    for (const script of scripts) {
      let ast;
      try {
        ast = parseSync(script.name, script.body);
      } catch {
        incomplete = true;
        hardIncomplete = true;
        addIssue(`AST_FAILED:${path}`);
        continue;
      }
      if (ast.errors.length) {
        incomplete = true;
        hardIncomplete = true;
        addIssue(`AST_ERRORS:${path}`);
      }
      const queue: unknown[] = [ast.program];
      let visited = 0;
      while (queue.length && ++visited <= 100000) {
        const node = queue.pop();
        if (Array.isArray(node)) {
          if (queue.length + node.length + visited > 100000) {
            incomplete = true;
            hardIncomplete = true;
            addIssue(`AST_LIMIT:${path}`);
            break;
          }
          for (const child of node) queue.push(child);
          continue;
        }
        if (!object(node)) continue;
        const offset = script.offset + (typeof node.start === 'number' ? node.start : 0);
        if (node.type === 'CallExpression' && object(node.callee)) {
          const member =
            node.callee.type === 'MemberExpression' && object(node.callee.property)
              ? String(node.callee.property.name ?? '')
              : String(node.callee.name ?? '');
          if (
            !auxiliary(path) &&
            ['authorize', 'requireRole', 'requirePermission', 'checkPermission'].includes(member)
          )
            add('authorization-call-candidate', member, offset, 'authorization');
        }
        for (const [key, value] of Object.entries(node))
          if (
            !['loc', 'comments', 'parent'].includes(key) &&
            value !== null &&
            typeof value === 'object'
          )
            queue.push(value);
      }
      if (queue.length) {
        incomplete = true;
        hardIncomplete = true;
        addIssue(`AST_LIMIT:${path}`);
      }
    }
    if (!auxiliary(path) && /\.(?:sql|prisma)$/u.test(path)) {
      for (const match of text.matchAll(
        /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|model)\s+([\w."`]+)/giu,
      ))
        add('schema-declaration-candidate', match[1]!, match.index, 'database');
      if (/(?:^|\/)migrations?\//u.test(path)) add('migration-path', path, 0, 'database');
    }
    if (
      language &&
      !['typescript', 'javascript', 'vue', 'svelte', 'sql', 'prisma'].includes(language)
    ) {
      // Lexical evidence is explicitly weaker than a parsed import/call graph.
      for (const [pattern, layer, label] of [
        [
          /\b(?:FastAPI|Flask|django|gin\.Default|gin\.New|SpringBootApplication|WebApplication\.CreateBuilder|actix_web|axum::|Illuminate\\)/gu,
          'backend',
          'backend-framework',
        ],
        [
          /(?:@(?:app|router)\.(?:get|post|put|delete)|\[Http(?:Get|Post|Put|Delete)|@(?:Get|Post|Request)Mapping|Route::(?:get|post))/gu,
          'api',
          'route-declaration',
        ],
        [
          /\b(?:sqlalchemy|DbContext|EntityFramework|gorm|database\/sql|diesel|JpaRepository|Eloquent)\b/gu,
          'database',
          'data-access',
        ],
        [
          /\b(?:Authorize|UseAuthentication|OAuth2|LoginRequired|login_required|SecurityFilterChain)\b/gu,
          'authentication',
          'authentication',
        ],
      ] as const)
        for (const match of text.matchAll(pattern))
          add(`lexical-${label}`, match[0], match.index, layer);
      incomplete = true;
      addIssue(`CROSS_LANGUAGE_GRAPH_REQUIRES_REVIEW:${path}`);
    }
    if (
      /(?:^|\/)(?:Dockerfile[^/]*|compose\.ya?ml|docker-compose[^/]*\.ya?ml|[^/]*config\.(?:json|ya?ml|toml))$/u.test(
        path,
      )
    )
      add('runtime-configuration', path, 0, 'configuration');
  }
  const routingBindings: PortalRoutingBinding[] = [];
  const routingText = source.get('portal.routes.json');
  if (routingText !== undefined) {
    try {
      const config: unknown = JSON.parse(routingText);
      if (
        !object(config) ||
        config.version !== 1 ||
        !Array.isArray(config.services) ||
        config.services.length > 128
      )
        throw new Error('invalid');
      for (const entry of config.services) {
        if (
          !object(entry) ||
          typeof entry.rootPath !== 'string' ||
          !services.has(entry.rootPath) ||
          typeof entry.deploymentId !== 'string' ||
          !entry.deploymentId ||
          (entry.origin !== undefined && typeof entry.origin !== 'string') ||
          (entry.routePrefix !== undefined && typeof entry.routePrefix !== 'string')
        )
          throw new Error('invalid');
        routingBindings.push({
          sourceId,
          serviceId: services.get(entry.rootPath)!.id,
          deploymentId: entry.deploymentId,
          ...(typeof entry.origin === 'string' ? { origin: entry.origin } : {}),
          ...(typeof entry.routePrefix === 'string' ? { routePrefix: entry.routePrefix } : {}),
          basis: 'supported-configuration',
          evidence: {
            sourceId,
            path: 'portal.routes.json',
            hash: byPath.get('portal.routes.json')!.hash,
            offset: 0,
            reason: 'Explicit portal routing configuration version 1',
          },
        });
      }
    } catch {
      incomplete = true;
      hardIncomplete = true;
      addIssue('ROUTING_CONFIGURATION_INVALID:portal.routes.json');
    }
  }
  const inventoryHashes = new Map(sourceInventory.files.map(file => [file.path, file.hash]));
  const members: PortalConnectionMember[] = hashOnly.map(path => ({
    sourceId,
    serviceId: services.get(fileRoot(path))!.id,
    path,
    hash: inventoryHashes.get(path)!,
    role: lockfiles.test(path)
      ? 'configuration'
      : auxiliary(path)
        ? 'auxiliary'
        : /\.(?:json|ya?ml|toml|xml|html|css|scss)$/u.test(path)
          ? 'configuration'
          : 'asset',
  }));
  const connections = analyzePortalServiceConnections({
    sources: [...source].map(([path, text]) => ({
      sourceId,
      serviceId: services.get(fileRoot(path))!.id,
      path,
      hash: byPath.get(path)!.hash,
      text,
      role: sourceRole(path),
    })),
    members,
    modules: [{ sourceId, complete: moduleGraph.complete, references: moduleGraph.references }],
    routingBindings,
  });
  const serviceById = new Map([...services.values()].map(service => [service.id, service]));
  for (const [kind, entries, layer] of [
    ['provides-api', connections.producers, 'api'],
    ['consumes-api', connections.clients, undefined],
    ['persists', connections.data, 'database'],
  ] as const) {
    for (const entry of entries) {
      const service = serviceById.get(entry.serviceId)!;
      const ev = entry.evidence;
      const line = lineOf(ev.path, ev.offset);
      const evidence = {
        sourceId,
        sourceRole: sourceRole(ev.path),
        path: ev.path,
        hash: ev.hash,
        startLine: line,
        endLine: line,
        kind,
        detail: 'route' in entry ? entry.method + ' ' + entry.route : entry.module,
      };
      addRow(service, evidence, evidence.detail, layer);
      addEdge({ from: ev.path, to: 'route' in entry ? entry.route : entry.module, kind, evidence });
    }
  }
  for (const connection of connections.connections) {
    const from = [...services.values()].find(value => value.id === connection.fromServiceId),
      to = [...services.values()].find(value => value.id === connection.toServiceId),
      ev = connection.evidence[0];
    if (from && to && ev && from !== to)
      addEdge({
        from: from.rootPath,
        to: to.rootPath,
        kind: 'depends-on',
        evidence: {
          sourceId,
          path: ev.path,
          hash: ev.hash,
          startLine: 1,
          endLine: 1,
          kind: connection.kind,
          detail: ev.reason,
        },
      });
  }
  if (!connections.complete) incomplete = true;
  for (const service of services.values()) {
    if (!service.layers.includes('frontend')) continue;
    // eslint-disable-next-line no-await-in-loop -- actively reuse Figwright-derived project conventions inside the verified service root
    const scoped = await reader.subdirectory(service.rootPath);
    // eslint-disable-next-line no-await-in-loop -- project patterns are evidence read from the selected service, never an executed config
    const profile = await analyzeProject(scoped.rootDir, scoped);
    service.codePatterns = { ...profile, rootDir: service.rootPath };
  }
  return ServiceGraphProfileSchema.parse({
    schemaVersion: 1,
    analysisVersion: 2,
    issuesTruncated,
    sourceId,
    connections,
    rootPath: '.',
    sourceHash: contentHash('sfp-service-source-v2', {
      inventoryHash: sourceInventory.hash,
      files,
    }),
    sourceInventory,
    services: [...services.values()],
    files,
    edges,
    incomplete,
    lexicalReviewable:
      incomplete &&
      !hardIncomplete &&
      issues.length < 512 &&
      issues.every(issue => issue.startsWith('CROSS_LANGUAGE_GRAPH_REQUIRES_REVIEW:')),
    issues: issues.slice(0, 512),
  });
};
