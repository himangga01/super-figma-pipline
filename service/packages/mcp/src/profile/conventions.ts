import { createHash } from 'node:crypto';

import {
  CONVENTION_CATEGORIES,
  CONVENTION_EVIDENCE_SAMPLE_SIZE,
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

/** 1-based line of `offset`: one more than the newlines strictly before it. */
const lineIndex = (source: string) => {
  let newlines: number[] | undefined;
  return (offset: number): number => {
    if (newlines === undefined) {
      newlines = [];
      for (let index = source.indexOf('\n'); index >= 0; index = source.indexOf('\n', index + 1))
        newlines.push(index);
    }
    let low = 0,
      high = newlines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (newlines[middle]! < offset) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  };
};

/**
 * Evidence is a bounded sample with exact counts. Only an unread effective input marks the analysis
 * `truncated`, and every such input is named in `unreadFiles`.
 */
const inspect = async (reader: RepoReader): Promise<ProjectConventions> => {
  const categories = Object.fromEntries(
    CONVENTION_CATEGORIES.map(key => [
      key,
      {
        status: 'not-observed',
        evidence: [] as ConventionEvidence[],
        count: 0,
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
    truncated = false;
  const unread = (filePath: string, reason: string) => {
    unreadFiles.push({ filePath, reason });
    truncated = true;
  };
  // Discovery stopped at its cap: files after the listed ones under this root were not read.
  if (walk.truncated) unread('.', 'DISCOVERY_LIMIT');
  for (const filePath of walk.files) {
    if (/\.d\.[cm]?ts$/u.test(filePath)) continue;
    let source: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- metadata and reads share the operation's retained authority
      const metadata = await reader.metadata(filePath);
      if (metadata.size > 262_144 || bytes + metadata.size > 8_000_000) {
        unread(filePath, 'SOURCE_SIZE_LIMIT');
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- bounded AST reads must not multiply the operation byte budget
      source = await reader.readText(filePath, 262_144);
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (code === 'ABORT_ERR') throw cause;
      // A file that cannot be read within the retained authority or byte budget is unread input.
      unread(
        filePath,
        typeof code === 'string' && code ? code.slice(0, 128) : 'SOURCE_READ_FAILED',
      );
      continue;
    }
    bytes += Buffer.byteLength(source);
    inspectedFiles++;
    const sourceHash = `sha256:${createHash('sha256').update(source).digest('hex')}` as const;
    const lineOf = lineIndex(source);
    const seen = new Set<string>();
    const add = (
      category: Category,
      rawSignal: string,
      offset: number,
      kind: ConventionEvidence['kind'],
    ) => {
      const line = lineOf(Math.max(0, offset)),
        signal = rawSignal.slice(0, 256),
        key = JSON.stringify([category, line, signal]);
      if (seen.has(key)) return;
      seen.add(key);
      const entry = categories[category];
      entry.count = (entry.count ?? 0) + 1;
      if (entry.evidence.length < CONVENTION_EVIDENCE_SAMPLE_SIZE)
        entry.evidence.push({ filePath, line, signal, kind, sourceHash });
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
    if (sfc?.unterminated) unread(filePath, 'SFC_UNTERMINATED');
    let from = 0;
    for (const block of blocks) {
      if (block.external || (sfc !== null && block.lang === null)) {
        unread(filePath, 'SCRIPT_UNSUPPORTED');
        continue;
      }
      const offset = sfc === null ? 0 : Math.max(0, source.indexOf(block.body, from));
      from = offset + block.body.length;
      let parsed;
      try {
        parsed = parseSync(sfc === null ? filePath : `script.${block.lang}`, block.body);
      } catch {
        unread(filePath, 'PARSE_FAILED');
        continue;
      }
      if (parsed.errors.length > 0) unread(filePath, 'PARSE_FAILED');
      const queue: unknown[] = [parsed.program];
      let visited = 0;
      while (queue.length > 0) {
        if (++visited > 50_000) {
          unread(filePath, 'AST_LIMIT');
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
  // A full sample is still `observed`; only unread input leaves an unobserved category open.
  for (const category of CONVENTION_CATEGORIES)
    categories[category].status = categories[category].count
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
