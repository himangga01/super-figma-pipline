import { createHash } from 'node:crypto';

import {
  CONVENTION_CATEGORIES,
  type ConventionEvidence,
  type ProjectConventions,
} from '@sfp/shared';
import { parseSync } from 'oxc-parser';

import type { RepoReader } from '../fs/repo-walk.js';
import { scanSfcScripts } from '../scan/sfc-blocks.js';

type Category = (typeof CONVENTION_CATEGORIES)[number];
type Ast = Record<string, unknown>;
const cache = new WeakMap<RepoReader, Promise<ProjectConventions>>();
const object = (value: unknown): value is Ast =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const LIBRARIES: ReadonlyArray<readonly [Category, RegExp]> = [
  [
    'routing',
    /^(?:next\/(?:navigation|router|link)|vue-router|react-router(?:-dom)?|@angular\/router|\$app\/navigation)$/u,
  ],
  [
    'state',
    /^(?:zustand(?:\/.*)?|jotai|recoil|pinia|redux|react-redux|@reduxjs\/toolkit|mobx(?:-react(?:-lite)?)?|svelte\/store)$/u,
  ],
  [
    'dataAccess',
    /^(?:axios|ky|swr|@tanstack\/(?:react|vue|svelte)-query|@apollo\/client|graphql-request)$/u,
  ],
  ['theme', /^(?:next-themes|styled-components|@emotion\/react|vuetify)$/u],
  ['testing', /^(?:vitest|@jest\/globals|@playwright\/test|@testing-library\/.+|cypress)$/u],
];
const CALLS: Readonly<Record<string, Category>> = {
  useState: 'state',
  useReducer: 'state',
  createContext: 'state',
  ref: 'state',
  reactive: 'state',
  createSignal: 'state',
  fetch: 'dataAccess',
  useFetch: 'dataAccess',
  useAsyncData: 'dataAccess',
  useTheme: 'theme',
  defineStore: 'state',
  createRouter: 'routing',
};

const inspect = async (reader: RepoReader): Promise<ProjectConventions> => {
  const categories = Object.fromEntries(
    CONVENTION_CATEGORIES.map(key => [
      key,
      {
        status: 'not-observed',
        evidence: [] as ConventionEvidence[],
      },
    ]),
  ) as ProjectConventions['categories'];
  const walk = await reader.walk({
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'vue', 'svelte'],
    cap: 512,
  });
  const unreadFiles: ProjectConventions['unreadFiles'] = [];
  let inspectedFiles = 0,
    bytes = 0,
    truncated = walk.truncated;
  for (const filePath of walk.files) {
    if (/\.d\.[cm]?ts$/u.test(filePath)) continue;
    // eslint-disable-next-line no-await-in-loop -- metadata and reads share the operation's retained authority
    const metadata = await reader.metadata(filePath);
    if (metadata.size > 262_144 || bytes + metadata.size > 8_000_000) {
      unreadFiles.push({ filePath, reason: 'SOURCE_SIZE_LIMIT' });
      truncated = true;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- bounded AST reads must not multiply the operation byte budget
    const source = await reader.readText(filePath, 262_144);
    bytes += Buffer.byteLength(source);
    inspectedFiles++;
    const sourceHash = `sha256:${createHash('sha256').update(source).digest('hex')}` as const;
    const add = (
      category: Category,
      signal: string,
      offset: number,
      kind: ConventionEvidence['kind'],
    ) => {
      const list = categories[category].evidence;
      if (list.length >= 32) {
        truncated = true;
        return;
      }
      const line = source.slice(0, Math.max(0, offset)).split('\n').length;
      if (
        !list.some(
          item => item.filePath === filePath && item.line === line && item.signal === signal,
        )
      )
        list.push({ filePath, line, signal: signal.slice(0, 256), kind, sourceHash });
    };
    if (
      /(?:^|\/)(?:pages|routes)\/|(?:^|\/)app\/.*(?:page|layout|route)\.[cm]?[jt]sx?$/u.test(
        filePath,
      )
    )
      add('routing', 'route-file', 0, 'path');
    if (/(?:^|\/)(?:themes?|tokens?)(?:\/|\.)/iu.test(filePath))
      add('theme', 'theme-or-token-file', 0, 'path');
    if (/(?:\.(?:test|spec)\.|(?:^|\/)(?:test|tests|__tests__)\/)/u.test(filePath))
      add('testing', 'test-file', 0, 'path');
    const sfc = /\.(?:vue|svelte)$/u.test(filePath)
      ? scanSfcScripts(source, { templateIsBlock: filePath.endsWith('.vue') })
      : null;
    const blocks = sfc === null ? [{ body: source, lang: null, external: false }] : sfc.blocks;
    if (sfc?.unterminated) {
      unreadFiles.push({ filePath, reason: 'SFC_UNTERMINATED' });
      truncated = true;
    }
    let from = 0;
    for (const block of blocks) {
      if (block.external || (sfc !== null && block.lang === null)) {
        unreadFiles.push({ filePath, reason: 'SCRIPT_UNSUPPORTED' });
        truncated = true;
        continue;
      }
      const offset = sfc === null ? 0 : Math.max(0, source.indexOf(block.body, from));
      from = offset + block.body.length;
      let parsed;
      try {
        parsed = parseSync(sfc === null ? filePath : `script.${block.lang}`, block.body);
      } catch {
        unreadFiles.push({ filePath, reason: 'PARSE_FAILED' });
        truncated = true;
        continue;
      }
      if (parsed.errors.length > 0) {
        unreadFiles.push({ filePath, reason: 'PARSE_FAILED' });
        truncated = true;
      }
      const queue: unknown[] = [parsed.program];
      let visited = 0;
      while (queue.length > 0) {
        if (++visited > 50_000) {
          truncated = true;
          unreadFiles.push({ filePath, reason: 'AST_LIMIT' });
          break;
        }
        const node = queue.pop();
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        if (!object(node)) continue;
        const start = typeof node.start === 'number' ? offset + node.start : offset;
        if (
          node.type === 'ImportDeclaration' &&
          object(node.source) &&
          typeof node.source.value === 'string'
        ) {
          const module = node.source.value;
          if (/^[\w@./$#~-]+$/u.test(module) || /^node:[a-z0-9/_-]+$/u.test(module))
            add('imports', module, start, 'import');
          if (node.importKind !== 'type')
            for (const [category, pattern] of LIBRARIES)
              if (pattern.test(module)) add(category, module, start, 'import');
        }
        if (
          node.type === 'CallExpression' &&
          object(node.callee) &&
          typeof node.callee.name === 'string'
        ) {
          const category = CALLS[node.callee.name];
          if (category !== undefined) add(category, node.callee.name, start, 'call');
        }
        if (
          node.type === 'JSXAttribute' &&
          object(node.name) &&
          typeof node.name.name === 'string' &&
          /^(?:aria-|role$)/u.test(node.name.name)
        )
          add('accessibility', node.name.name, start, 'attribute');
        for (const [key, value] of Object.entries(node))
          if (
            !['parent', 'loc', 'comments'].includes(key) &&
            typeof value === 'object' &&
            value !== null
          )
            queue.push(value);
      }
    }
  }
  for (const category of CONVENTION_CATEGORIES)
    categories[category].status =
      categories[category].evidence.length > 0
        ? 'observed'
        : truncated
          ? 'incomplete'
          : 'not-observed';
  return {
    schemaVersion: 1,
    categories,
    inspectedFiles,
    truncated,
    unreadFiles: unreadFiles.slice(0, 512),
  };
};

/** Request-scoped reuse, never a process-wide cache keyed only by a filesystem path. */
export const analyzeConventions = (reader: RepoReader): Promise<ProjectConventions> => {
  let result = cache.get(reader);
  if (result === undefined) {
    result = inspect(reader);
    cache.set(reader, result);
  }
  return result;
};
