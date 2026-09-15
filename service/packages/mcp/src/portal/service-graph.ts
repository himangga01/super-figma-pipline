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
  type PortalRoutingBinding,
} from './service-connections.js';
import { classifyPortalSourceBytes, collectPortalSourceInventory } from './source-inventory.js';
import { isPortalSourcePath } from './source-path-policy.js';

export { isPortalSourcePath } from './source-path-policy.js';

type Evidence = ServiceGraphProfile['services'][number]['evidence'][number];
type Service = ServiceGraphProfile['services'][number];
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
  const source = new Map<string, string>();
  let bytes = 0,
    incomplete = !sourceInventory.complete,
    hardIncomplete = !sourceInventory.complete;
  for (const member of sourceInventory.files) {
    const path = member.path;
    if (!isPortalSourcePath(path)) continue;
    const extension = posix.extname(path).slice(1);
    if (
      !(extension in languages) &&
      !manifests.test(path) &&
      !/\.(?:json|ya?ml|toml|xml|html|css|scss)$/u.test(path) &&
      !/(?:^|\/)Dockerfile(?:\..*)?$/u.test(path) &&
      !/\.(?:mdx?|graphql|gql)$/u.test(path)
    )
      continue;
    // eslint-disable-next-line no-await-in-loop -- preserve bounded, root-verified source reads
    const metadata = await reader.metadata(path);
    if (metadata.size > 262_144 || bytes + metadata.size > 8_388_608) {
      incomplete = true;
      hardIncomplete = true;
      addIssue(`SOURCE_LIMIT:${path}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- shared RepoReader byte and path authority
    const data = await reader.readBytes(path);
    bytes += data.length;
    if (storedChecksum(data) !== member.hash) {
      incomplete = true;
      hardIncomplete = true;
      addIssue(`SOURCE_CHANGED_DURING_ANALYSIS:${path}`);
      continue;
    }
    if (classifyPortalSourceBytes(data) === 'binary') {
      incomplete = true;
      hardIncomplete = true;
      addIssue(`SOURCE_ENCODING:${path}`);
      continue;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      incomplete = true;
      hardIncomplete = true;
      addIssue(`SOURCE_ENCODING:${path}`);
      continue;
    }
    source.set(path, text);
    files.push({ path, hash: storedChecksum(data), bytes: data.length });
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
  const addEdge = (edge: ServiceGraphProfile['edges'][number]) => {
    if (edges.length < 10000) edges.push(edge);
    else {
      incomplete = true;
      hardIncomplete = true;
      if (!issues.includes('EDGE_LIMIT')) addIssue('EDGE_LIMIT');
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
    const add = (kind: string, detail: string, offset: number, layer?: PortalLayer): Evidence => {
      const line = text.slice(0, offset).split('\n').length;
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
      if (service.evidence.length < 512) service.evidence.push(evidence);
      else {
        incomplete = true;
        hardIncomplete = true;
        if (!issues.includes('EVIDENCE_LIMIT')) addIssue('EVIDENCE_LIMIT');
      }
      if (layer && !service.layers.includes(layer)) service.layers.push(layer);
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
  const connections = analyzePortalServiceConnections({
    sources: [...source].map(([path, text]) => ({
      sourceId,
      serviceId: services.get(fileRoot(path))!.id,
      path,
      hash: byPath.get(path)!.hash,
      text,
      role: sourceRole(path),
    })),
    modules: [{ sourceId, complete: moduleGraph.complete, references: moduleGraph.references }],
    routingBindings,
  });
  for (const [kind, entries, layer] of [
    ['provides-api', connections.producers, 'api'],
    ['consumes-api', connections.clients, undefined],
    ['persists', connections.data, 'database'],
  ] as const) {
    for (const entry of entries) {
      const service = [...services.values()].find(value => value.id === entry.serviceId)!;
      const ev = entry.evidence;
      const evidence = {
        sourceId,
        sourceRole: sourceRole(ev.path),
        path: ev.path,
        hash: ev.hash,
        startLine: source.get(ev.path)!.slice(0, ev.offset).split('\n').length,
        endLine: source.get(ev.path)!.slice(0, ev.offset).split('\n').length,
        kind,
        detail: 'route' in entry ? entry.method + ' ' + entry.route : entry.module,
      };
      if (layer && !service.layers.includes(layer)) service.layers.push(layer);
      if (service.evidence.length < 512) service.evidence.push(evidence);
      else {
        incomplete = true;
        hardIncomplete = true;
        addIssue('EVIDENCE_LIMIT');
      }
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
