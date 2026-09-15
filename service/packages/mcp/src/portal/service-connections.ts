import { createHash } from 'node:crypto';

import { parseSync } from 'oxc-parser';

import type { PortalModuleReference } from './module-resolution.js';

export interface PortalConnectionSource {
  sourceId: string;
  serviceId: string;
  path: string;
  hash: string;
  text: string;
  role: 'runtime' | 'auxiliary' | 'configuration' | 'asset';
}
export interface PortalConnectionEvidence {
  sourceId: string;
  path: string;
  hash: string;
  offset: number;
  reason: string;
}
/** The caller must derive configuration or admit review; this helper does not grant authority. */
export interface PortalRoutingBinding {
  sourceId: string;
  serviceId: string;
  deploymentId: string;
  /** Literal externally mounted prefix, separate from the normalized URL origin. */
  routePrefix?: string;
  origin?: string;
  basis: 'supported-configuration' | 'admitted-source-review';
  evidence: PortalConnectionEvidence;
}
interface Endpoint {
  sourceId: string;
  serviceId: string;
  method: string;
  route: string;
  origin?: string;
  evidence: PortalConnectionEvidence;
  supportingEvidence?: PortalConnectionEvidence[];
}
interface Candidate {
  sourceId: string;
  serviceId: string;
  module: string;
  status: 'candidate';
  evidence: PortalConnectionEvidence;
}
export interface PortalServiceConnectionAnalysis {
  version: 1;
  complete: boolean;
  /** Loss of diagnostics is a hard analysis limit, never reviewable uncertainty. */
  issuesTruncated: boolean;
  producers: Endpoint[];
  clients: Endpoint[];
  data: Candidate[];
  configuration: Candidate[];
  connections: {
    kind: 'module-dependency' | 'http-contract';
    fromSourceId: string;
    fromServiceId: string;
    toSourceId: string;
    toServiceId: string;
    evidence: PortalConnectionEvidence[];
    routingBasis?: PortalRoutingBinding['basis'][];
  }[];
  issues: { code: string; evidence?: PortalConnectionEvidence }[];
}
type Node = Record<string, unknown>;
const obj = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined =>
  obj(value) && typeof value.value === 'string' ? value.value : undefined;
const id = (value: unknown): string | undefined =>
  obj(value) && value.type === 'Identifier' && typeof value.name === 'string'
    ? value.name
    : undefined;
const member = (value: unknown): { receiver: string; name: string } | undefined => {
  if (!obj(value) || value.type !== 'MemberExpression' || value.computed) return undefined;
  const receiver = id(value.object),
    name = id(value.property);
  return receiver && name ? { receiver, name } : undefined;
};
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const dataModules =
  /^(?:pg|mysql2?|sqlite3|better-sqlite3|node:sqlite|@prisma\/client|prisma|drizzle-orm|mongoose|typeorm|sequelize)$/u;
const key = (sourceId: string, path: string) => JSON.stringify([sourceId, path]);
const limit = (value: number | undefined, fallback: number) =>
  Number.isInteger(value ?? fallback) && (value ?? fallback) > 0
    ? Math.min(value ?? fallback, fallback)
    : 0;
const evidence = (
  source: PortalConnectionSource,
  offset: unknown,
  reason: string,
): PortalConnectionEvidence => ({
  sourceId: source.sourceId,
  path: source.path,
  hash: source.hash,
  offset: typeof offset === 'number' ? offset : 0,
  reason,
});
const url = (value: string): { route: string; origin?: string } | undefined => {
  if (
    value.length > 2048 ||
    value.includes('\\') ||
    [...value].some(char => char.charCodeAt(0) <= 32)
  )
    return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return { route: value.split(/[?#]/u)[0]! };
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return undefined;
    return { route: parsed.pathname, origin: parsed.origin };
  } catch {
    return undefined;
  }
};

/** Bounded, read-only static evidence. Complete means supported analysis, never execution proof. */
export const analyzePortalServiceConnections = (input: {
  sources: readonly PortalConnectionSource[];
  modules: readonly {
    sourceId: string;
    complete: boolean;
    references: readonly PortalModuleReference[];
  }[];
  routingBindings?: readonly PortalRoutingBinding[];
  limits?: { maxAstNodes?: number; maxEvidence?: number };
}): PortalServiceConnectionAnalysis => {
  const out: PortalServiceConnectionAnalysis = {
    version: 1,
    complete: true,
    issuesTruncated: false,
    producers: [],
    clients: [],
    data: [],
    configuration: [],
    connections: [],
    issues: [],
  };
  const maxAst = limit(input.limits?.maxAstNodes, 100_000),
    maxEvidence = limit(input.limits?.maxEvidence, 10_000);
  let evidenceCount = 0;
  const problem = (code: string, detail?: PortalConnectionEvidence) => {
    out.complete = false;
    if (out.issues.length < 512) out.issues.push({ code, ...(detail ? { evidence: detail } : {}) });
    else out.issuesTruncated = true;
  };
  const emit = <T>(collection: T[], value: T) => {
    if (++evidenceCount <= maxEvidence) collection.push(value);
    else if (evidenceCount === maxEvidence + 1) problem('EVIDENCE_LIMIT');
  };
  const sources = new Map<string, PortalConnectionSource>();
  const duplicateSources = new Set<string>();
  let bytes = 0;
  if (input.sources.length > 5000 || input.modules.length > 5000) problem('FILE_LIMIT');
  for (const source of input.sources.slice(0, 5000)) {
    bytes += Buffer.byteLength(source.text);
    if (Buffer.byteLength(source.text) > 262_144 || bytes > 8_388_608) {
      problem('SOURCE_LIMIT', evidence(source, 0, 'Source analysis limit'));
      continue;
    }
    const sourceKey = key(source.sourceId, source.path);
    if (sources.has(sourceKey) || duplicateSources.has(sourceKey)) {
      problem('DUPLICATE_SOURCE', evidence(source, 0, 'Duplicate qualified path'));
      sources.delete(sourceKey);
      duplicateSources.add(sourceKey);
      continue;
    }
    if (source.hash !== `sha256:${createHash('sha256').update(source.text).digest('hex')}`) {
      problem('SOURCE_HASH_MISMATCH', evidence(source, 0, 'Text differs from verified bytes'));
      continue;
    }
    sources.set(sourceKey, source);
  }
  const verifiedEvidence = (item: PortalConnectionEvidence) => {
    const source = sources.get(key(item.sourceId, item.path));
    return (
      source &&
      source.hash === item.hash &&
      Number.isInteger(item.offset) &&
      item.offset >= 0 &&
      item.offset <= source.text.length
    );
  };
  const routing = new Map<string, PortalRoutingBinding>();
  const duplicateRouting = new Set<string>();
  for (const binding of (input.routingBindings ?? []).slice(0, 5000)) {
    const bindingKey = key(binding.sourceId, binding.serviceId);
    const normalized = binding.origin === undefined ? undefined : url(binding.origin);
    if (
      binding.sourceId !== binding.evidence.sourceId ||
      !verifiedEvidence(binding.evidence) ||
      !binding.deploymentId ||
      (binding.routePrefix !== undefined &&
        (url(binding.routePrefix)?.route !== binding.routePrefix ||
          /[:*{}]/u.test(binding.routePrefix))) ||
      (binding.origin !== undefined &&
        (!normalized?.origin ||
          normalized.route !== '/' ||
          binding.origin.includes('?') ||
          binding.origin.includes('#')))
    ) {
      problem('ROUTING_EVIDENCE_INVALID');
      continue;
    }
    if (routing.has(bindingKey) || duplicateRouting.has(bindingKey)) {
      routing.delete(bindingKey);
      duplicateRouting.add(bindingKey);
      problem('ROUTING_BINDING_AMBIGUOUS');
      continue;
    }
    routing.set(bindingKey, {
      ...binding,
      ...(normalized?.origin ? { origin: normalized.origin } : {}),
    });
  }
  if ((input.routingBindings?.length ?? 0) > 5000) problem('ROUTING_LIMIT');
  const refs = new Map<string, PortalModuleReference[]>();
  const analyzedSources = new Set<string>();
  let refCount = 0;
  for (const module of input.modules.slice(0, 5000)) {
    if (analyzedSources.has(module.sourceId)) {
      problem('MODULE_ANALYSIS_DUPLICATE');
      continue;
    }
    analyzedSources.add(module.sourceId);
    if (!module.complete) problem('MODULE_ANALYSIS_INCOMPLETE');
    for (const ref of module.references) {
      if (++refCount > 10_000) {
        problem('MODULE_REFERENCE_LIMIT');
        break;
      }
      const source = sources.get(key(module.sourceId, ref.from));
      if (!source) {
        problem('MODULE_SOURCE_MISSING');
        continue;
      }
      if (!Number.isInteger(ref.offset) || ref.offset < 0 || ref.offset > source.text.length) {
        problem('MODULE_OFFSET_INVALID');
        continue;
      }
      const sourceRefs = refs.get(key(module.sourceId, ref.from)) ?? [];
      sourceRefs.push(ref);
      refs.set(key(module.sourceId, ref.from), sourceRefs);
      if (source.role !== 'runtime') continue;
      const ev = evidence(source, ref.offset, 'Verified static module reference');
      if (ref.specifier && /^(?:node:)?https?$/u.test(ref.specifier))
        problem('UNSUPPORTED_NODE_HTTP', ev);
      if (ref.status === 'unresolved') problem('MODULE_UNRESOLVED', ev);
      if (ref.specifier && dataModules.test(ref.specifier))
        emit(out.data, {
          sourceId: source.sourceId,
          serviceId: source.serviceId,
          module: ref.specifier,
          status: 'candidate',
          evidence: ev,
        });
      for (const path of ref.configuration.slice(0, 5000)) {
        const config = sources.get(key(source.sourceId, path));
        if (!config) {
          problem('CONFIGURATION_SOURCE_MISSING', ev);
          continue;
        }
        emit(out.configuration, {
          sourceId: source.sourceId,
          serviceId: source.serviceId,
          module: path,
          status: 'candidate',
          evidence: evidence(config, 0, 'Module resolution configuration input'),
        });
      }
      if (ref.targets.length > 5000 || ref.configuration.length > 5000)
        problem('MODULE_TARGET_LIMIT', ev);
      for (const path of ref.targets.slice(0, 5000)) {
        const target = sources.get(key(source.sourceId, path));
        if (!target) {
          problem('MODULE_TARGET_MISSING', ev);
          continue;
        }
        if (target.role === 'auxiliary') problem('AUXILIARY_RUNTIME_IMPORT', ev);
        if (
          target.role !== 'asset' &&
          target.serviceId !== source.serviceId &&
          ref.status === 'resolved'
        )
          emit(out.connections, {
            kind: 'module-dependency',
            fromSourceId: source.sourceId,
            fromServiceId: source.serviceId,
            toSourceId: target.sourceId,
            toServiceId: target.serviceId,
            evidence: [ev, evidence(target, 0, 'Resolved target')],
          });
      }
    }
  }
  for (const source of sources.values()) {
    if (source.role !== 'runtime') continue;
    if (!analyzedSources.has(source.sourceId))
      problem(
        'MODULE_ANALYSIS_MISSING',
        evidence(source, 0, 'No reviewed module analysis for qualified source'),
      );
    if (/\.(?:sql|prisma)$/u.test(source.path)) {
      emit(out.data, {
        sourceId: source.sourceId,
        serviceId: source.serviceId,
        module: source.path,
        status: 'candidate',
        evidence: evidence(
          source,
          0,
          'Schema or migration candidate; execution relationship unproven',
        ),
      });
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/u.test(source.path)) {
      problem(
        'UNSUPPORTED_RUNTIME_SOURCE',
        evidence(source, 0, 'Runtime format has no supported parser'),
      );
      continue;
    }
    let program: unknown;
    try {
      const parsed = parseSync(source.path, source.text);
      if (parsed.errors.length) {
        problem('PARSE_ERROR', evidence(source, 0, 'Source cannot be parsed'));
        continue;
      }
      program = parsed.program;
    } catch {
      problem('PARSE_ERROR', evidence(source, 0, 'Source cannot be parsed'));
      continue;
    }
    const nodes: Node[] = [],
      queue: unknown[] = [program];
    let count = 0,
      exhausted = false;
    while (queue.length) {
      const next = queue.pop();
      if (++count > maxAst) {
        exhausted = true;
        break;
      }
      if (Array.isArray(next)) {
        for (const value of next) {
          if (queue.length + count >= maxAst) {
            exhausted = true;
            break;
          }
          queue.push(value);
        }
      } else if (obj(next)) {
        if (typeof next.type === 'string') nodes.push(next);
        for (const value of Object.values(next)) {
          if (obj(value) || Array.isArray(value)) {
            if (queue.length + count >= maxAst) {
              exhausted = true;
              break;
            }
            queue.push(value);
          }
        }
      }
      if (exhausted) break;
    }
    if (exhausted) {
      problem('AST_LIMIT', evidence(source, 0, 'AST traversal limit'));
      continue;
    }
    nodes.sort((a, b) => Number(a.start) - Number(b.start));
    const declarations = new Map<string, number>();
    const mutated = new Set<string>();
    const bind = (pattern: unknown) => {
      const pending = [pattern];
      while (pending.length) {
        const value = pending.pop();
        if (!obj(value)) continue;
        const name = id(value);
        if (name) {
          declarations.set(name, (declarations.get(name) ?? 0) + 1);
          continue;
        }
        if (value.type === 'ObjectPattern')
          for (const prop of value.properties as unknown[])
            pending.push(obj(prop) && prop.type === 'Property' ? prop.value : prop);
        else if (value.type === 'ArrayPattern')
          for (const element of value.elements as unknown[]) pending.push(element);
        else if (value.type === 'RestElement') pending.push(value.argument);
        else if (value.type === 'AssignmentPattern') pending.push(value.left);
      }
    };
    for (const node of nodes) {
      if (
        [
          'VariableDeclarator',
          'FunctionDeclaration',
          'FunctionExpression',
          'ClassDeclaration',
          'ClassExpression',
        ].includes(String(node.type))
      )
        bind(node.id);
      if (
        ['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(
          String(node.type),
        )
      )
        bind(node.local);
      if (
        ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
          String(node.type),
        )
      )
        for (const param of node.params as unknown[]) bind(param);
      if (node.type === 'CatchClause') bind(node.param);
      if (
        node.type === 'AssignmentExpression' ||
        node.type === 'UpdateExpression' ||
        (node.type === 'UnaryExpression' && node.operator === 'delete')
      ) {
        const target = node.left ?? node.argument;
        bind(target);
        let root = target;
        while (obj(root) && root.type === 'MemberExpression') root = root.object;
        const name = id(root);
        if (name) mutated.add(name);
      }
    }
    const imports = new Map<string, { module: string; exported: string }>();
    const sourceRefs = refs.get(key(source.sourceId, source.path)) ?? [];
    const declared = (specifier: string) =>
      sourceRefs.some(
        ref =>
          ref.specifier === specifier && (ref.status === 'external' || ref.status === 'builtin'),
      );
    const requireModule = (value: unknown): string | undefined => {
      if (
        !obj(value) ||
        value.type !== 'CallExpression' ||
        id(value.callee) !== 'require' ||
        declarations.has('require')
      )
        return undefined;
      const specifier = str((value.arguments as unknown[])[0]);
      return specifier && declared(specifier) ? specifier : undefined;
    };
    for (const node of nodes) {
      if (node.type === 'ImportDeclaration') {
        const specifier = str(node.source);
        if (!specifier || !declared(specifier) || node.importKind === 'type') continue;
        for (const binding of node.specifiers as Node[]) {
          const name = id(binding.local);
          if (name && binding.importKind !== 'type')
            imports.set(name, {
              module: specifier,
              exported:
                binding.type === 'ImportSpecifier'
                  ? (id(binding.imported) ?? str(binding.imported) ?? '')
                  : binding.type === 'ImportNamespaceSpecifier'
                    ? '*'
                    : 'default',
            });
        }
      }
      if (node.type === 'VariableDeclarator') {
        const specifier = requireModule(node.init);
        if (!specifier) continue;
        const name = id(node.id);
        if (name) imports.set(name, { module: specifier, exported: 'default' });
        else if (obj(node.id) && node.id.type === 'ObjectPattern')
          for (const property of node.id.properties as Node[]) {
            const local = id(property.value),
              exported = id(property.key);
            if (local && exported) imports.set(local, { module: specifier, exported });
          }
      }
    }
    type Receiver = { kind: 'app' | 'router' | 'client' | 'unknown'; framework?: string; at: Node };
    const receivers = new Map<string, Receiver>();
    const factory = (
      callee: unknown,
    ): { kind: Receiver['kind']; framework: string } | undefined => {
      const name = id(callee),
        part = member(callee),
        binding = imports.get(name ?? part?.receiver ?? '');
      if (!binding) return undefined;
      if (
        mutated.has(name ?? part?.receiver ?? '') ||
        (declarations.get(name ?? part?.receiver ?? '') ?? 0) !== 1
      )
        return { kind: 'unknown', framework: binding.module };
      if (
        binding.module === 'express' &&
        ((!part && binding.exported === 'Router') ||
          (part?.name === 'Router' && ['default', '*'].includes(binding.exported)))
      )
        return { kind: 'router', framework: 'express' };
      if (binding.module === 'express' && !part && binding.exported === 'default')
        return { kind: 'app', framework: 'express' };
      if (
        binding.module === 'fastify' &&
        !part &&
        ['default', 'fastify'].includes(binding.exported)
      )
        return { kind: 'app', framework: 'fastify' };
      if (binding.module === 'hono' && !part && binding.exported === 'Hono')
        return { kind: 'app', framework: 'hono' };
      if (binding.module === 'axios' && part?.name === 'create')
        return { kind: 'unknown', framework: 'axios' };
      return undefined;
    };
    for (const [name, binding] of imports)
      if (binding.module === 'axios' && binding.exported === 'default')
        receivers.set(name, {
          kind: declarations.get(name) === 1 && !mutated.has(name) ? 'client' : 'unknown',
          framework: 'axios',
          at: {},
        });
    for (const node of nodes) {
      const initializer =
        obj(node.init) && node.init.type === 'AwaitExpression' ? node.init.argument : node.init;
      if (
        node.type === 'VariableDeclarator' &&
        id(node.id) &&
        obj(initializer) &&
        ['CallExpression', 'NewExpression'].includes(String(initializer.type))
      ) {
        const name = id(node.id)!,
          inferred = factory(initializer.callee);
        const args = initializer.arguments as unknown[];
        const supportedOptions =
          args.length === 0 ||
          (args.length === 1 &&
            obj(args[0]) &&
            args[0].type === 'ObjectExpression' &&
            (args[0].properties as unknown[]).length === 0);
        receivers.set(name, {
          kind:
            declarations.get(name) === 1 &&
            !mutated.has(name) &&
            supportedOptions &&
            (inferred?.framework !== 'hono' || initializer.type === 'NewExpression')
              ? (inferred?.kind ?? 'unknown')
              : 'unknown',
          ...(inferred ? { framework: inferred.framework } : {}),
          at: node,
        });
      }
    }
    const routes: { receiver: string; endpoint: Endpoint }[] = [],
      mounts: {
        parent: string;
        child: string;
        prefix: string;
        evidence: PortalConnectionEvidence;
      }[] = [];
    const invalid = new Set<string>();
    const endpoint = (node: Node, method: string, routeValue: unknown): Endpoint | undefined => {
      const route = str(routeValue),
        parsed = route === undefined ? undefined : url(route);
      if (!parsed || /[:*{}]/u.test(parsed.route)) {
        problem(
          'DYNAMIC_OR_PATTERN_ROUTE',
          evidence(source, node.start, 'Literal exact HTTP contract required'),
        );
        return undefined;
      }
      return {
        sourceId: source.sourceId,
        serviceId: source.serviceId,
        method,
        ...parsed,
        evidence: evidence(source, node.start, 'Static HTTP contract'),
      };
    };
    const hasHttpChainRoot = (value: unknown): boolean => {
      let current = value;
      for (let depth = 0; depth < 32; depth++) {
        const name = id(current);
        if (name) return receivers.has(name);
        if (!obj(current)) return false;
        if (current.type === 'CallExpression' || current.type === 'NewExpression') {
          if (factory(current.callee)) return true;
          current = current.callee;
        } else if (current.type === 'MemberExpression') current = current.object;
        else return false;
      }
      problem('HTTP_CHAIN_LIMIT', evidence(source, 0, 'HTTP chain ancestry limit'));
      return false;
    };
    for (const node of nodes) {
      if (node.type !== 'CallExpression') continue;
      const args = node.arguments as unknown[],
        part = member(node.callee),
        receiver = part ? receivers.get(part.receiver) : undefined;
      if (
        obj(node.callee) &&
        node.callee.type === 'MemberExpression' &&
        node.callee.computed &&
        receivers.has(id(node.callee.object) ?? '')
      ) {
        problem(
          'COMPUTED_HTTP_CALL',
          evidence(source, node.start, 'Computed receiver call requires review'),
        );
        continue;
      }
      if (id(node.callee) === 'fetch') {
        if (declarations.has('fetch')) {
          problem(
            'SHADOWED_HTTP_CLIENT',
            evidence(source, node.start, 'Fetch binding is not the global client'),
          );
          continue;
        }
        let method = 'GET';
        if (args[1] !== undefined) {
          if (!obj(args[1]) || args[1].type !== 'ObjectExpression') {
            problem('DYNAMIC_HTTP_OPTIONS', evidence(source, node.start, 'Unknown fetch options'));
            continue;
          }
          let unknown = false;
          for (const property of args[1].properties as Node[]) {
            if (property.type !== 'Property' || property.computed) unknown = true;
            else if ((id(property.key) ?? str(property.key)) === 'method') {
              const value = str(property.value);
              if (!value) unknown = true;
              else method = value.toUpperCase();
            }
          }
          if (unknown) {
            problem('DYNAMIC_HTTP_OPTIONS', evidence(source, node.start, 'Unknown fetch method'));
            continue;
          }
        }
        const item = endpoint(node, method, args[0]);
        if (item) emit(out.clients, item);
        continue;
      }
      if (!part || !receiver) {
        const direct = id(node.callee),
          binding = imports.get(direct ?? part?.receiver ?? '');
        if (binding && /^(?:node:)?https?$/u.test(binding.module))
          problem(
            'UNSUPPORTED_NODE_HTTP',
            evidence(source, node.start, 'Node HTTP control flow requires review'),
          );
        if (binding?.module === 'axios')
          problem(
            'UNSUPPORTED_HTTP_CLIENT',
            evidence(source, node.start, 'Callable or namespace axios form requires review'),
          );
        if (
          obj(node.callee) &&
          node.callee.type === 'MemberExpression' &&
          obj(node.callee.object) &&
          ['CallExpression', 'NewExpression'].includes(String(node.callee.object.type)) &&
          hasHttpChainRoot(node.callee.object)
        )
          problem(
            'UNSUPPORTED_CHAINED_HTTP',
            evidence(source, node.start, 'Chained HTTP receiver or factory call requires review'),
          );
        continue;
      }
      if (receiver.kind === 'unknown') {
        if (methods.has(part.name) || ['use', 'route', 'register', 'request'].includes(part.name))
          problem(
            'UNKNOWN_HTTP_RECEIVER',
            evidence(source, node.start, 'Factory or receiver binding is unproven'),
          );
        continue;
      }
      if (receiver.kind === 'client') {
        if (!methods.has(part.name) || part.name === 'all') {
          problem(
            'UNSUPPORTED_HTTP_CLIENT',
            evidence(source, node.start, 'Unsupported axios call form'),
          );
          continue;
        }
        const options = args[['post', 'put', 'patch'].includes(part.name) ? 2 : 1];
        if (
          options !== undefined &&
          (!obj(options) ||
            options.type !== 'ObjectExpression' ||
            (options.properties as Node[]).some(
              property =>
                property.type !== 'Property' ||
                property.computed ||
                !['headers', 'params', 'signal', 'timeout', 'responseType', 'data'].includes(
                  id(property.key) ?? str(property.key) ?? '',
                ),
            ))
        ) {
          problem(
            'DYNAMIC_HTTP_OPTIONS',
            evidence(source, node.start, 'Axios routing options are not proven'),
          );
          continue;
        }
        const item = endpoint(node, part.name.toUpperCase(), args[0]);
        if (item) emit(out.clients, item);
        continue;
      }
      if (part.name === 'use' || part.name === 'route' || part.name === 'register') {
        const middleware = args[0],
          middlewareMember = obj(middleware) ? member(middleware.callee) : undefined;
        if (
          receiver.framework === 'express' &&
          part.name === 'use' &&
          args.length === 1 &&
          obj(middleware) &&
          middleware.type === 'CallExpression' &&
          middlewareMember &&
          ['json', 'urlencoded', 'raw', 'text'].includes(middlewareMember.name) &&
          imports.get(middlewareMember.receiver)?.module === 'express' &&
          !mutated.has(middlewareMember.receiver) &&
          declarations.get(middlewareMember.receiver) === 1
        )
          continue;
        const prefix = str(args[0]),
          child = id(args[1]);
        if (
          receiver.framework === 'express' &&
          part.name === 'use' &&
          args.length === 2 &&
          prefix !== undefined &&
          url(prefix)?.route === prefix &&
          !/[:*{}]/u.test(prefix) &&
          child &&
          receivers.get(child)?.kind === 'router' &&
          receivers.get(child)?.framework === 'express'
        )
          mounts.push({
            parent: part.receiver,
            child,
            prefix,
            evidence: evidence(source, node.start, 'Literal local router mount'),
          });
        else {
          invalid.add(part.receiver);
          if (child) invalid.add(child);
          problem(
            'UNRESOLVED_MOUNT',
            evidence(source, node.start, 'Mount or middleware semantics require review'),
          );
        }
        continue;
      }
      if (methods.has(part.name)) {
        // Express app.get(name) reads a setting; a route registration requires a handler.
        if (
          receiver.framework === 'express' &&
          receiver.kind === 'app' &&
          part.name === 'get' &&
          args.length < 2
        )
          continue;
        if (args.length < 2) {
          problem(
            'PROVIDER_HANDLER_UNPROVEN',
            evidence(source, node.start, 'Provider registration has no handler'),
          );
          continue;
        }
        const item = endpoint(node, part.name.toUpperCase(), args[0]);
        if (
          item &&
          !item.origin &&
          str(args[0]) === item.route &&
          !/[?#[\]()+]/u.test(item.route) &&
          part.name !== 'all'
        )
          routes.push({ receiver: part.receiver, endpoint: item });
        else if (item) problem('UNSUPPORTED_PROVIDER_ROUTE', item.evidence);
      }
    }
    const prefixes = (
      name: string,
      visited: Set<string>,
    ): { prefix: string; supportingEvidence: PortalConnectionEvidence[] }[] => {
      if (visited.has(name) || visited.size >= 32) {
        problem(
          'MOUNT_CYCLE_OR_LIMIT',
          evidence(source, 0, 'Router ancestry is not bounded and acyclic'),
        );
        return [];
      }
      if (invalid.has(name)) return [];
      if (receivers.get(name)?.kind === 'app') return [{ prefix: '', supportingEvidence: [] }];
      const parents = mounts.filter(mount => mount.child === name);
      if (parents.length !== 1) {
        problem(
          parents.length ? 'AMBIGUOUS_MOUNT' : 'UNMOUNTED_ROUTER',
          evidence(source, 0, 'Router needs one proven mount'),
        );
        return [];
      }
      const parent = parents[0]!;
      const next = new Set(visited);
      next.add(name);
      return prefixes(parent.parent, next).map(item => ({
        prefix: `${item.prefix}${parent.prefix === '/' ? '' : parent.prefix.replace(/\/$/u, '')}`,
        supportingEvidence: item.supportingEvidence.concat(parent.evidence),
      }));
    };
    for (const route of routes)
      for (const prefix of prefixes(route.receiver, new Set()))
        emit(out.producers, {
          ...route.endpoint,
          route: `${prefix.prefix}${route.endpoint.route}`,
          supportingEvidence: prefix.supportingEvidence,
        });
    for (const node of nodes)
      if (
        node.type === 'MemberExpression' &&
        obj(node.object) &&
        member(node.object)?.receiver === 'process' &&
        member(node.object)?.name === 'env'
      )
        emit(out.configuration, {
          sourceId: source.sourceId,
          serviceId: source.serviceId,
          module: 'process.env',
          status: 'candidate',
          evidence: evidence(
            source,
            node.start,
            'Environment configuration reference; value not collected',
          ),
        });
  }
  const contracts = new Map<string, Endpoint[]>();
  for (const producer of out.producers) {
    const prefix = routing.get(key(producer.sourceId, producer.serviceId))?.routePrefix;
    const effectiveRoute = `${prefix && prefix !== '/' ? prefix.replace(/\/$/u, '') : ''}${producer.route}`;
    const contractKey = key(producer.method, effectiveRoute),
      group = contracts.get(contractKey) ?? [];
    group.push(producer);
    contracts.set(contractKey, group);
  }
  let comparisons = 0;
  for (const client of out.clients) {
    const clientScope = routing.get(key(client.sourceId, client.serviceId));
    const sameContract = contracts.get(key(client.method, client.route)) ?? [];
    comparisons += sameContract.length;
    if (comparisons > 100_000) {
      problem('CONNECTION_MATCH_LIMIT', client.evidence);
      break;
    }
    const candidates = sameContract.filter(producer => {
      const scope = routing.get(key(producer.sourceId, producer.serviceId));
      return (
        scope &&
        (client.origin
          ? scope.origin === client.origin
          : clientScope && scope.deploymentId === clientScope.deploymentId)
      );
    });
    if (candidates.length !== 1) {
      problem(
        candidates.length > 1
          ? 'AMBIGUOUS_PROVIDER'
          : sameContract.length
            ? 'ROUTING_SCOPE_UNPROVEN'
            : 'PROVIDER_UNRESOLVED',
        client.evidence,
      );
      continue;
    }
    const producer = candidates[0]!,
      scope = routing.get(key(producer.sourceId, producer.serviceId))!;
    emit(out.connections, {
      kind: 'http-contract',
      fromSourceId: client.sourceId,
      fromServiceId: client.serviceId,
      toSourceId: producer.sourceId,
      toServiceId: producer.serviceId,
      evidence: [
        client.evidence,
        producer.evidence,
        ...(producer.supportingEvidence ?? []),
        scope.evidence,
        ...(clientScope ? [clientScope.evidence] : []),
      ],
      routingBasis: [scope.basis, ...(clientScope ? [clientScope.basis] : [])],
    });
  }
  return out;
};
