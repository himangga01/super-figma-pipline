import { contentHash, storedChecksum } from '@sfp/ir';
import { parse as parseVue } from '@vue/compiler-dom';
import { parseSync } from 'oxc-parser';

import { scanSfcScripts } from '../../scan/sfc-blocks.js';
import { resolvePortalModules } from '../module-resolution.js';
import { portalError } from '../store.js';

type Node = Record<string, unknown>;
const object = (value: unknown): value is Node =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const name = (value: unknown): string | null =>
  object(value)
    ? typeof value.name === 'string'
      ? value.name
      : typeof value.value === 'string'
        ? value.value
        : null
    : null;
const vueNames = (tag: string) => {
  const camel = tag.replace(/-(\w)/gu, (_match, letter: string) => letter.toUpperCase());
  return [tag, camel, (camel[0]?.toUpperCase() ?? '') + camel.slice(1)];
};
const jsxName = (value: unknown): string | null =>
  object(value) &&
  ['JSXMemberExpression', 'MemberExpression'].includes(String(value.type)) &&
  value.computed !== true
    ? `${jsxName(value.object)}.${jsxName(value.property)}`
    : name(value);
function boundIdentifiers(pattern: unknown): Set<string> {
  const names = new Set<string>(),
    pending = [pattern];
  let count = 0;
  while (pending.length) {
    if (++count > 100000) throw portalError('PORTAL_COMPONENT_AST_LIMIT');
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!object(value)) continue;
    if (value.type === 'Identifier' && typeof value.name === 'string') names.add(value.name);
    else if (value.type === 'ObjectPattern' && Array.isArray(value.properties)) {
      for (const property of value.properties)
        if (object(property))
          pending.push(property.type === 'RestElement' ? property.argument : property.value);
    } else if (value.type === 'ArrayPattern') pending.push(value.elements);
    else if (value.type === 'AssignmentPattern') pending.push(value.left);
    else if (value.type === 'RestElement') pending.push(value.argument);
    else if (value.type === 'TSParameterProperty') pending.push(value.parameter);
  }
  return names;
}
function nodes(root: unknown): Node[] {
  const found: Node[] = [],
    pending: unknown[] = [root];
  let visited = 0;
  while (pending.length) {
    if (++visited > 100000) throw portalError('PORTAL_COMPONENT_AST_LIMIT');
    const value = pending.pop();
    if (Array.isArray(value)) pending.push(...value);
    else if (object(value)) {
      if (typeof value.type === 'string' || typeof value.type === 'number') found.push(value);
      for (const [key, child] of Object.entries(value))
        if (!['loc', 'comments', 'tokens'].includes(key)) pending.push(child);
    }
    if (pending.length > 100000) throw portalError('PORTAL_COMPONENT_AST_LIMIT');
  }
  return found;
}
function sourceNodes(
  path: string,
  text: string,
): {
  ast: Node[];
  templateTags: Array<{ tag: string; offset: number }>;
  hasTemplate: boolean;
  templateBindings: Map<string, Set<string>>;
  templateShadows: Set<string>;
} {
  if (Buffer.byteLength(text) > 1048576) throw portalError('PORTAL_COMPONENT_SOURCE_LIMIT');
  const vue = path.endsWith('.vue'),
    ast: Node[] = [],
    templateTags: Array<{ tag: string; offset: number }> = [];
  let hasTemplate = false;
  const templateBindings = new Map<string, Set<string>>(),
    templateShadows = new Set<string>(),
    setupRanges: Array<[number, number]> = [];
  const expose = (local: string, tag: string) => {
    const tags = templateBindings.get(local) ?? new Set<string>();
    tags.add(tag);
    templateBindings.set(local, tags);
  };
  const scripts = vue
    ? scanSfcScripts(text, { includeOffsets: true, templateIsBlock: true })
    : null;
  if (scripts?.unterminated || scripts?.blocks.some(block => block.external || block.lang === null))
    throw portalError('PORTAL_COMPONENT_SFC_UNSUPPORTED');
  if (vue) {
    const errors: unknown[] = [];
    const parsed = parseVue(text, { parseMode: 'sfc', onError: error => errors.push(error) });
    if (errors.length) throw portalError('PORTAL_COMPONENT_PARSE_FAILED');
    for (const child of parsed.children) {
      if (
        child.type === 1 &&
        child.tag === 'script' &&
        child.props.some(prop => prop.type === 6 && prop.name === 'setup')
      )
        setupRanges.push([child.loc.start.offset, child.loc.end.offset]);
      if (child.type !== 1 || child.tag !== 'template') continue;
      hasTemplate = true;
      if (
        child.props.some(
          prop =>
            prop.type === 6 &&
            (prop.name === 'src' || (prop.name === 'lang' && prop.value?.content !== 'html')),
        )
      )
        throw portalError('PORTAL_COMPONENT_SFC_UNSUPPORTED');
      for (const node of nodes(child)) {
        if (
          node.type === 1 &&
          node.tagType === 1 &&
          typeof node.tag === 'string' &&
          !['component', 'template', 'slot'].includes(node.tag) &&
          object(node.loc) &&
          object(node.loc.start) &&
          typeof node.loc.start.offset === 'number'
        )
          templateTags.push({ tag: node.tag, offset: node.loc.start.offset });
        if (
          node.type === 7 &&
          ['slot', 'for'].includes(String(node.name)) &&
          object(node.exp) &&
          typeof node.exp.content === 'string'
        ) {
          let pattern = node.exp.content.trim();
          if (node.name === 'for')
            pattern = pattern
              .split(/\s+(?:in|of)\s+/u)[0]!
              .trim()
              .replace(/^\(([\s\S]*)\)$/u, '$1');
          if (pattern.length > 16384)
            throw portalError('PORTAL_COMPONENT_TEMPLATE_SCOPE_UNSUPPORTED');
          const parsedScope = parseSync('scope.ts', `(${pattern})=>{}`);
          if (parsedScope.errors.length)
            throw portalError('PORTAL_COMPONENT_TEMPLATE_SCOPE_UNSUPPORTED');
          for (const item of nodes(parsedScope.program))
            if (item.type === 'ArrowFunctionExpression')
              for (const local of boundIdentifiers(item.params)) templateShadows.add(local);
        }
      }
    }
  }
  for (const script of scripts?.blocks.map(block => ({
    text: block.body,
    path: path + '.' + block.lang,
    offset: block.offset ?? 0,
  })) ?? [{ text, path, offset: 0 }]) {
    const parsed = parseSync(script.path, script.text);
    if (parsed.errors.length) throw portalError('PORTAL_COMPONENT_PARSE_FAILED');
    const scriptNodes = nodes(parsed.program);
    ast.push(...scriptNodes);
    if (setupRanges.some(([start, end]) => script.offset > start && script.offset < end))
      for (const node of scriptNodes)
        if (
          node.type === 'ImportDeclaration' &&
          node.importKind !== 'type' &&
          Array.isArray(node.specifiers)
        )
          for (const specifier of node.specifiers)
            if (object(specifier) && specifier.importKind !== 'type') {
              const local = name(specifier.local);
              if (local) expose(local, local);
            }
  }
  const defineComponent = new Set<string>();
  for (const node of ast)
    if (
      node.type === 'ImportDeclaration' &&
      node.importKind !== 'type' &&
      name(node.source) === 'vue' &&
      Array.isArray(node.specifiers)
    )
      for (const specifier of node.specifiers)
        if (
          object(specifier) &&
          specifier.importKind !== 'type' &&
          name(specifier.imported) === 'defineComponent'
        ) {
          const local = name(specifier.local);
          if (local) defineComponent.add(local);
        }
  const propertyKey = (property: Node) =>
    property.computed === true
      ? object(property.key) && typeof property.key.value === 'string'
        ? property.key.value
        : null
      : name(property.key);
  // Follow literal object write order. Unknown later spreads/computed keys can replace earlier bindings.
  const componentBindings = (
    value: unknown,
    known = new Map<string, string>(),
    depth = 0,
  ): Map<string, string> => {
    if (depth > 64) throw portalError('PORTAL_COMPONENT_OPTIONS_LIMIT');
    if (!object(value) || value.type !== 'ObjectExpression' || !Array.isArray(value.properties))
      return new Map();
    for (const property of value.properties)
      if (object(property)) {
        if (property.type === 'SpreadElement') {
          if (object(property.argument) && property.argument.type === 'ObjectExpression')
            known = componentBindings(property.argument, known, depth + 1);
          else known.clear();
          continue;
        }
        const tag = propertyKey(property);
        if (tag === null) {
          known.clear();
          continue;
        }
        const local = jsxName(property.value);
        if (local) known.set(tag, local);
        else known.delete(tag);
      }
    return known;
  };
  const optionBindings = (
    value: unknown,
    known: Map<string, string> | null = new Map(),
    depth = 0,
  ): Map<string, string> | null => {
    if (depth > 64) throw portalError('PORTAL_COMPONENT_OPTIONS_LIMIT');
    if (!object(value) || value.type !== 'ObjectExpression' || !Array.isArray(value.properties))
      return null;
    for (const property of value.properties)
      if (object(property)) {
        if (property.type === 'SpreadElement') {
          known =
            object(property.argument) && property.argument.type === 'ObjectExpression'
              ? optionBindings(property.argument, known, depth + 1)
              : null;
          continue;
        }
        const key = propertyKey(property);
        if (key === null) known = null;
        else if (key === 'components') known = componentBindings(property.value);
      }
    return known;
  };
  for (const node of ast)
    if (node.type === 'ExportDefaultDeclaration') {
      let options = node.declaration;
      if (
        object(options) &&
        options.type === 'CallExpression' &&
        defineComponent.has(name(options.callee) ?? '') &&
        Array.isArray(options.arguments)
      )
        options = options.arguments[0];
      if (
        !object(options) ||
        options.type !== 'ObjectExpression' ||
        !Array.isArray(options.properties)
      )
        continue;
      for (const [tag, local] of optionBindings(options) ?? []) expose(local, tag);
    }
  return { ast, templateTags, hasTemplate, templateBindings, templateShadows };
}

/**
 * Static symbol/reference evidence only. Acceptance also needs real rendered association and
 * review.
 */
export function inspectCoreComponentReference(
  files: ReadonlyMap<string, { hash: string; bytes: Uint8Array }>,
  request: { componentPath: string; exportName: string; consumerPath: string },
) {
  const component = files.get(request.componentPath),
    consumer = files.get(request.consumerPath);
  if (!component || !consumer) throw portalError('PORTAL_COMPONENT_SOURCE_REQUIRED');
  if (files.size > 5000) throw portalError('PORTAL_COMPONENT_SOURCE_LIMIT');
  const sources = new Map<string, string>();
  let totalBytes = 0;
  for (const [path, file] of files) {
    if (file.bytes.byteLength > 16_777_216 || (totalBytes += file.bytes.byteLength) > 134_217_728)
      throw portalError('PORTAL_COMPONENT_SOURCE_LIMIT');
    if (storedChecksum(file.bytes) !== file.hash)
      throw portalError('PORTAL_COMPONENT_SOURCE_CHANGED');
    if (/\.(?:[cm]?[jt]sx?|vue|json)$/u.test(path))
      sources.set(path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
  }
  const target = sourceNodes(request.componentPath, sources.get(request.componentPath) ?? '');
  const exported =
    (request.componentPath.endsWith('.vue') &&
      request.exportName === 'default' &&
      target.hasTemplate) ||
    target.ast.some(
      node =>
        (node.type === 'ExportDefaultDeclaration' && request.exportName === 'default') ||
        (node.type === 'ExportNamedDeclaration' &&
          ((object(node.declaration) &&
            (name(node.declaration.id) === request.exportName ||
              (Array.isArray(node.declaration.declarations) &&
                node.declaration.declarations.some(
                  value => object(value) && name(value.id) === request.exportName,
                )))) ||
            (Array.isArray(node.specifiers) &&
              node.specifiers.some(
                value => object(value) && name(value.exported) === request.exportName,
              )))),
    );
  if (!exported) throw portalError('PORTAL_COMPONENT_EXPORT_MISSING');
  const actual = sourceNodes(request.consumerPath, sources.get(request.consumerPath) ?? '');
  const modules = resolvePortalModules(sources, [...files.keys()]);
  const parsed = new Map<string, ReturnType<typeof sourceNodes>>([
    [request.componentPath, target],
    [request.consumerPath, actual],
  ]);
  const read = (path: string) => {
    if (!sources.has(path)) throw portalError('PORTAL_COMPONENT_SOURCE_REQUIRED');
    if (!parsed.has(path)) parsed.set(path, sourceNodes(path, sources.get(path)!));
    return parsed.get(path)!;
  };
  const resolved = (from: string, specifier: string | null) =>
    modules.references.find(
      ref =>
        ref.from === from &&
        ref.specifier === specifier &&
        ref.status === 'resolved' &&
        ref.targets.length === 1,
    )?.targets[0];
  let resolutionWork = 0;
  const reaches = (path: string, symbol: string, seen: Set<string>): boolean => {
    if (++resolutionWork > 10000) throw portalError('PORTAL_COMPONENT_RESOLUTION_LIMIT');
    if (path === request.componentPath) return symbol === request.exportName;
    const key = JSON.stringify([path, symbol]);
    if (seen.has(key) || seen.size >= 32) return false;
    const next = new Set(seen).add(key),
      statements = read(path).ast;
    for (const node of statements) {
      if (node.exportKind === 'type') continue;
      if (node.type === 'ExportAllDeclaration' && !node.exported && symbol !== 'default') {
        const targetPath = resolved(path, name(node.source));
        if (targetPath && reaches(targetPath, symbol, next)) return true;
      }
      if (node.type !== 'ExportNamedDeclaration' || !Array.isArray(node.specifiers)) continue;
      for (const spec of node.specifiers) {
        if (!object(spec) || spec.exportKind === 'type' || name(spec.exported) !== symbol) continue;
        const local = name(spec.local);
        if (!local) continue;
        if (node.source) {
          const targetPath = resolved(path, name(node.source));
          if (targetPath && reaches(targetPath, local, next)) return true;
        } else
          for (const imported of statements) {
            if (
              imported.type !== 'ImportDeclaration' ||
              imported.importKind === 'type' ||
              !Array.isArray(imported.specifiers)
            )
              continue;
            const origin = resolved(path, name(imported.source));
            if (!origin) continue;
            for (const binding of imported.specifiers)
              if (
                object(binding) &&
                binding.importKind !== 'type' &&
                name(binding.local) === local
              ) {
                const original =
                  binding.type === 'ImportDefaultSpecifier' ? 'default' : name(binding.imported);
                if (original && reaches(origin, original, next)) return true;
              }
          }
      }
    }
    return false;
  };
  const aliases: string[] = [];
  if (request.consumerPath === request.componentPath && request.exportName !== 'default')
    aliases.push(request.exportName);
  for (const node of actual.ast) {
    if (
      node.type !== 'ImportDeclaration' ||
      node.importKind === 'type' ||
      !Array.isArray(node.specifiers)
    )
      continue;
    const specifier = name(node.source);
    const importPath = resolved(request.consumerPath, specifier);
    if (!importPath) continue;
    for (const imported of node.specifiers)
      if (
        object(imported) &&
        imported.importKind !== 'type' &&
        (imported.type === 'ImportNamespaceSpecifier' ||
          reaches(
            importPath,
            imported.type === 'ImportDefaultSpecifier'
              ? 'default'
              : (name(imported.imported) ?? ''),
            new Set(),
          ))
      ) {
        const local = name(imported.local);
        if (
          local &&
          (imported.type !== 'ImportNamespaceSpecifier' ||
            reaches(importPath, request.exportName, new Set()))
        )
          aliases.push(
            imported.type === 'ImportNamespaceSpecifier' ? `${local}.${request.exportName}` : local,
          );
      }
  }
  if (!aliases.length) throw portalError('PORTAL_COMPONENT_IMPORT_MISSING');
  const references: Array<{ local: string; kind: 'jsx' | 'vue-template'; offset: number }> = [];
  const declarations = new Map<string, number>(),
    parameters = new Set<string>(),
    jsxReferences = new Map<string, number[]>();
  for (const node of actual.ast) {
    if (
      [
        'VariableDeclarator',
        'FunctionDeclaration',
        'FunctionExpression',
        'ClassDeclaration',
        'ClassExpression',
      ].includes(String(node.type))
    )
      for (const identifier of boundIdentifiers(node.id))
        declarations.set(identifier, (declarations.get(identifier) ?? 0) + 1);
    for (const identifier of boundIdentifiers(node.params)) parameters.add(identifier);
    for (const identifier of boundIdentifiers(node.param)) parameters.add(identifier);
    if (node.type === 'JSXOpeningElement') {
      const identifier = jsxName(node.name);
      if (identifier) {
        const offsets = jsxReferences.get(identifier) ?? [];
        offsets.push(Number(node.start));
        jsxReferences.set(identifier, offsets);
      }
    }
  }
  const templateReferences = new Map<string, Array<{ tag: string; offset: number }>>();
  for (const tag of actual.templateTags)
    for (const identifier of new Set(vueNames(tag.tag))) {
      const matches = templateReferences.get(identifier) ?? [];
      matches.push(tag);
      templateReferences.set(identifier, matches);
    }
  for (const local of new Set(aliases)) {
    // Conservatively reject shadowed imports rather than attributing an unrelated local component.
    const base = local.split('.')[0]!;
    const shadowed =
      (declarations.get(base) ?? 0) > (request.consumerPath === request.componentPath ? 1 : 0) ||
      parameters.has(base) ||
      actual.templateShadows.has(base);
    if (shadowed) throw portalError('PORTAL_COMPONENT_SYMBOL_AMBIGUOUS');
    for (const offset of jsxReferences.get(local) ?? [])
      references.push({ local, kind: 'jsx', offset });
    const exposed = new Set(actual.templateBindings.get(local) ?? []);
    if (local.includes('.') && actual.templateBindings.get(base)?.has(base)) exposed.add(local);
    for (const visible of exposed)
      for (const tag of templateReferences.get(visible) ?? [])
        references.push({ local, kind: 'vue-template', offset: tag.offset });
  }
  if (!references.length) throw portalError('PORTAL_COMPONENT_REFERENCE_MISSING');
  const evidence = {
    ...request,
    componentHash: component.hash,
    consumerHash: consumer.hash,
    sourceClosureHash: contentHash(
      'sfp-core-component-source-closure-v1',
      [...files]
        .map(([path, file]) => ({ path, hash: file.hash }))
        .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ),
    references,
    moduleEvidence: modules.references.filter(
      ref => ref.from === request.consumerPath && ref.targets.includes(request.componentPath),
    ),
  };
  return { ...evidence, evidenceHash: contentHash('sfp-core-component-reference-v1', evidence) };
}
