import { parseSync } from 'oxc-parser';

import { scanSfcScripts } from '../scan/sfc-blocks.js';
import { portalError } from './store.js';
const backend =
  /^(?:(?:node:)?(?:http|https|net|tls|child_process|sqlite)|bun|express|fastify|koa|hono|@nestjs\/[^/]+|sqlite3|better-sqlite3|pg|mysql2?|mongoose|typeorm|sequelize|@prisma\/client)(?:\/|$)/u;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Frontend-only is case-specific and checked on syntax/dependencies as well as paths. */
export const assertFrontendSource = (path: string, content: string): void => {
  if (
    !/(?:\.(?:[cm]?[jt]sx?|vue|svelte|json|html|css|scss|sass|less|svg|md|txt|ya?ml|lock)|(?:^|\/)(?:LICENSE|NOTICE|\.gitignore|\.npmrc|\.nvmrc))$/iu.test(
      path,
    )
  )
    throw portalError('PORTAL_C4_SOURCE_FORMAT_UNSUPPORTED');
  if (
    /(?:^|\/)(?:server|backend|migrations|prisma|supabase|pages\/api|app\/api)(?:\/|$)|\.(?:sql|prisma|py|go|cs|java|php)$/u.test(
      path,
    )
  )
    throw portalError('PORTAL_C4_BACKEND_FORBIDDEN');
  if (/(?:^|\/)package\.json$/u.test(path)) {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    for (const kind of ['dependencies', 'devDependencies'])
      if (object(manifest[kind]))
        for (const [dependency, version] of Object.entries(manifest[kind]))
          if (
            backend.test(dependency) ||
            (typeof version === 'string' &&
              version.startsWith('npm:') &&
              backend.test(version.slice(4).replace(/@[^/]*$/u, '')))
          )
            throw portalError('PORTAL_C4_BACKEND_DEPENDENCY');
  }
  if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/u.test(path)) return;
  const scan = /\.(?:vue|svelte)$/u.test(path)
    ? scanSfcScripts(content, { templateIsBlock: path.endsWith('.vue') })
    : null;
  if (scan?.unterminated || scan?.blocks.some(block => block.lang === null || block.external))
    throw portalError('PORTAL_CANDIDATE_SYNTAX_REQUIRES_REVIEW');
  const blocks = scan
    ? scan.blocks.map(block => ({ source: block.body, path: `script.${block.lang ?? 'js'}` }))
    : [{ source: content, path }];
  for (const block of blocks) {
    const parsed = parseSync(block.path, block.source);
    if (parsed.errors.length) throw portalError('PORTAL_CANDIDATE_SYNTAX_INVALID');
    const queue: unknown[] = [parsed.program];
    let visited = 0;
    while (queue.length) {
      if (++visited > 100000) throw portalError('PORTAL_CANDIDATE_AST_LIMIT');
      const node = queue.pop();
      if (Array.isArray(node)) {
        if (queue.length + node.length + visited > 100000)
          throw portalError('PORTAL_CANDIDATE_AST_LIMIT');
        for (const child of node) queue.push(child);
        continue;
      }
      if (!object(node)) continue;
      if (
        node.type === 'MemberExpression' &&
        object(node.object) &&
        (['Bun', 'Deno'].includes(String(node.object.name)) ||
          (object(node.object.property) &&
            ['Bun', 'Deno'].includes(
              String(node.object.property.name ?? node.object.property.value),
            ))) &&
        object(node.property) &&
        ['serve', 'listen', 'listenTls', 'serveHttp'].includes(
          String(node.property.name ?? node.property.value),
        )
      )
        throw portalError('PORTAL_C4_BACKEND_IMPORT');
      if (
        node.type === 'VariableDeclarator' &&
        object(node.init) &&
        ['Bun', 'Deno'].includes(String(node.init.name))
      )
        throw portalError('PORTAL_C4_BACKEND_IMPORT');
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          String(node.type),
        ) &&
        object(node.source) &&
        typeof node.source.value === 'string' &&
        backend.test(node.source.value)
      )
        throw portalError('PORTAL_C4_BACKEND_IMPORT');
      if (
        node.type === 'ImportExpression' &&
        object(node.source) &&
        typeof node.source.value === 'string' &&
        backend.test(node.source.value)
      )
        throw portalError('PORTAL_C4_BACKEND_IMPORT');
      if (
        node.type === 'ExpressionStatement' &&
        object(node.expression) &&
        node.expression.value === 'use server'
      )
        throw portalError('PORTAL_C4_SERVER_ACTION');
      if (
        (node.type === 'CallExpression' || node.type === 'NewExpression') &&
        object(node.callee)
      ) {
        const name = node.callee.name;
        if (name === 'eval' || name === 'Function')
          throw portalError('PORTAL_DYNAMIC_CODE_REQUIRES_REVIEW');
        if (
          name === 'require' &&
          Array.isArray(node.arguments) &&
          object(node.arguments[0]) &&
          typeof node.arguments[0].value === 'string' &&
          backend.test(node.arguments[0].value)
        )
          throw portalError('PORTAL_C4_BACKEND_IMPORT');
      }
      for (const [key, value] of Object.entries(node))
        if (
          !['parent', 'loc', 'comments'].includes(key) &&
          value !== null &&
          typeof value === 'object'
        )
          queue.push(value);
    }
  }
};
