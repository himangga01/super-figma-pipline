import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { resolvePortalModules } from '../../src/portal/module-resolution.js';
import {
  analyzePortalServiceConnections,
  type PortalConnectionSource,
} from '../../src/portal/service-connections.js';

const analyze = (
  files: Record<string, string>,
  options: { deployment?: boolean; maxAstNodes?: number } = {},
) => {
  const sources: PortalConnectionSource[] = Object.entries(files).map(([path, text]) => ({
    sourceId: 'reference:0',
    serviceId: path.split('/')[0]!,
    path,
    text,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    role: path.endsWith('package.json') ? 'configuration' : 'runtime',
  }));
  const modules = resolvePortalModules(new Map(Object.entries(files)), Object.keys(files));
  return analyzePortalServiceConnections({
    sources,
    modules: [{ sourceId: 'reference:0', ...modules }],
    routingBindings:
      options.deployment === false
        ? []
        : [...new Set(sources.map(source => source.serviceId))].map(serviceId => {
            const source = sources.find(item => item.serviceId === serviceId)!;
            return {
              sourceId: source.sourceId,
              serviceId,
              deploymentId: 'portal',
              basis: 'admitted-source-review' as const,
              evidence: {
                sourceId: source.sourceId,
                path: source.path,
                hash: source.hash,
                offset: 0,
                reason: 'Fixture admitted deployment review',
              },
            };
          }),
    limits: options.maxAstNodes === undefined ? {} : { maxAstNodes: options.maxAstNodes },
  });
};

it('connects a literal web contract to its provider without adding an unrelated sibling', () => {
  const result = analyze({
    'api/package.json': '{"dependencies":{"express":"5","pg":"8"}}',
    'api/main.ts': `import express from 'express'; import { Pool } from 'pg'; const app = express(); const db = new Pool(); app.get('/api/docs', () => db.query('select * from docs'));`,
    'web/main.ts': `fetch('/api/docs');`,
    'other/package.json': '{"dependencies":{"express":"5"}}',
    'other/main.ts': `import express from 'express'; const app = express(); app.get('/unrelated', () => {});`,
  });
  expect(
    result.connections
      .filter(item => item.kind === 'http-contract')
      .map(item => [item.fromServiceId, item.toServiceId]),
  ).toEqual([['web', 'api']]);
  expect(result.data.some(item => item.module === 'pg' && item.status === 'candidate')).toBe(true);
  expect(result.producers.every(item => item.evidence.hash.startsWith('sha256:'))).toBe(true);
});

it('supports CJS routers and axios clients while ignoring arbitrary get methods', () => {
  const result = analyze({
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.cjs': `const express = require('express'); const app = express(); const router = express.Router(); router.post('/docs', () => {}); app.use('/api', router); const ordinary = {}; ordinary.get('/not-http');`,
    'web/package.json': '{"dependencies":{"axios":"1"}}',
    'web/main.ts': `import axios from 'axios'; axios.post('/api/docs', {}); const cache = {}; cache.get('/not-http');`,
  });
  expect(result.producers.map(item => [item.method, item.route])).toEqual([['POST', '/api/docs']]);
  expect(result.clients.map(item => item.route)).toEqual(['/api/docs']);
  expect(result.connections.filter(item => item.kind === 'http-contract')).toHaveLength(1);
});

it('does not promote shadowed factories, unknown factories or dynamic mounts to providers', () => {
  for (const body of [
    `import express from 'express'; function f(express) { const app = express(); app.get('/docs', () => {}); }`,
    `import { makeServer } from './factory'; const app = makeServer(); app.get('/docs', () => {});`,
    `import express from 'express'; const app = express(); const r = express.Router(); r.get('/docs', () => {}); app.use(prefix, r);`,
  ]) {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5"}}',
      'api/main.ts': body,
      'api/factory.ts': 'export const makeServer = () => ({});',
    });
    expect(result.complete).toBe(false);
    expect(result.producers).toHaveLength(0);
  }
});

it('retains ambiguous provider and unproven deployment relevance as issues', () => {
  const files = {
    'a/package.json': '{"dependencies":{"hono":"4"}}',
    'a/main.ts': `import { Hono } from 'hono'; const app = new Hono(); app.get('/docs', () => {});`,
    'b/package.json': '{"dependencies":{"fastify":"5"}}',
    'b/main.ts': `import fastify from 'fastify'; const app = fastify(); app.get('/docs', () => {});`,
    'web/main.ts': `fetch('/docs');`,
  };
  expect(analyze(files).issues.some(item => item.code === 'AMBIGUOUS_PROVIDER')).toBe(true);
  expect(analyze(files).connections.filter(item => item.kind === 'http-contract')).toHaveLength(0);
  expect(
    analyze(files, { deployment: false }).issues.some(
      item => item.code === 'ROUTING_SCOPE_UNPROVEN',
    ),
  ).toBe(true);
});

it('fails finite AST limits without spreading a wide array onto the argument stack', () => {
  const result = analyze(
    { 'web/main.ts': `const values = [${'0,'.repeat(80_000)}]; fetch('/docs');` },
    { maxAstNodes: 100 },
  );
  expect(result.complete).toBe(false);
  expect(result.issues.some(item => item.code === 'AST_LIMIT')).toBe(true);
});

it('does not trust mutated factories or computed receiver calls', () => {
  for (const code of [
    `import express from 'express'; express.Router = custom; const r = express.Router(); r.get('/docs', () => {});`,
    `import express from 'express'; const app = express(); app['get']('/docs', () => {});`,
    `import axios from 'axios'; axios.get('/docs', { baseURL: target });`,
  ]) {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5","axios":"1"}}',
      'api/main.ts': code,
    });
    expect(result.complete).toBe(false);
    expect(result.producers).toHaveLength(0);
    expect(result.clients).toHaveLength(0);
  }
});

it('records explicit Node HTTP uncertainty and ignores auxiliary providers', () => {
  const result = analyze({
    'api/main.ts': `import { createServer } from 'node:http'; createServer((req,res) => { if (req.url === '/docs') res.end('ok'); });`,
  });
  expect(result.issues.some(item => item.code === 'UNSUPPORTED_NODE_HTTP')).toBe(true);
  const source: PortalConnectionSource = {
    sourceId: 'r:1',
    serviceId: 'api',
    path: 'example.ts',
    text: `const app = factory(); app.get('/docs', () => {});`,
    hash: '',
    role: 'auxiliary',
  };
  source.hash = `sha256:${createHash('sha256').update(source.text).digest('hex')}`;
  const auxiliary = analyzePortalServiceConnections({ sources: [source], modules: [] });
  expect(auxiliary.producers).toEqual([]);
  expect(auxiliary.complete).toBe(true);
});

it('rejects missing or corrupt qualified source authority and absent module analysis', () => {
  const source: PortalConnectionSource = {
    sourceId: 'r:1',
    serviceId: 'web',
    path: 'main.ts',
    text: `fetch('/docs')`,
    hash: 'sha256:wrong',
    role: 'runtime',
  };
  expect(
    analyzePortalServiceConnections({ sources: [source], modules: [] }).issues.some(
      item => item.code === 'SOURCE_HASH_MISMATCH',
    ),
  ).toBe(true);
  source.hash = `sha256:${createHash('sha256').update(source.text).digest('hex')}`;
  expect(
    analyzePortalServiceConnections({ sources: [source], modules: [] }).issues.some(
      item => item.code === 'MODULE_ANALYSIS_MISSING',
    ),
  ).toBe(true);
});

it('retains qualified module and configuration edges for colliding reference paths', () => {
  const files = {
    'web/main.ts': `import '../data/repository';`,
    'data/repository.ts': `export const data = [];`,
  };
  const sources: PortalConnectionSource[] = ['reference:0', 'reference:1'].flatMap(sourceId =>
    Object.entries(files).map(([path, text]) => ({
      sourceId,
      serviceId: path.split('/')[0]!,
      path,
      text,
      hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      role: 'runtime',
    })),
  );
  const resolution = resolvePortalModules(new Map(Object.entries(files)), Object.keys(files));
  const result = analyzePortalServiceConnections({
    sources,
    modules: ['reference:0', 'reference:1'].map(sourceId => ({
      sourceId,
      complete: resolution.complete,
      references: resolution.references,
    })),
  });
  expect(result.complete).toBe(true);
  expect(
    result.connections.map(connection => [
      connection.fromSourceId,
      connection.toSourceId,
      connection.toServiceId,
    ]),
  ).toEqual([
    ['reference:0', 'reference:0', 'data'],
    ['reference:1', 'reference:1', 'data'],
  ]);
  expect(
    result.connections.every(connection =>
      connection.evidence.every(item => item.sourceId === connection.fromSourceId),
    ),
  ).toBe(true);
});

it('validates routing evidence and canonical origin, port and literal mount prefix', () => {
  const files = {
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.ts': `import express from 'express'; const app = express(); app.use(express.json()); app.get('/docs', () => {});`,
    'web/main.ts': `fetch('https://API.EXAMPLE:443/v1/docs?token=not-retained');`,
  };
  const sources: PortalConnectionSource[] = Object.entries(files).map(([path, text]) => ({
    sourceId: 'reference:0',
    serviceId: path.split('/')[0]!,
    path,
    text,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    role: path.endsWith('.json') ? 'configuration' : 'runtime',
  }));
  const config = sources[0]!;
  const modules = [
    {
      sourceId: 'reference:0',
      ...resolvePortalModules(new Map(Object.entries(files)), Object.keys(files)),
    },
  ];
  const binding = {
    sourceId: config.sourceId,
    serviceId: 'api',
    deploymentId: 'portal',
    origin: 'https://api.example',
    routePrefix: '/v1',
    basis: 'admitted-source-review' as const,
    evidence: {
      sourceId: config.sourceId,
      path: config.path,
      hash: config.hash,
      offset: 0,
      reason: 'Fixture review',
    },
  };
  const run = (changes = {}) =>
    analyzePortalServiceConnections({
      sources,
      modules,
      routingBindings: [{ ...binding, ...changes }],
    });
  expect(run().connections.filter(connection => connection.kind === 'http-contract')).toHaveLength(
    1,
  );
  expect(JSON.stringify(run())).not.toContain('not-retained');
  expect(run({ origin: 'https://api.example:8443' }).connections).toHaveLength(0);
  expect(
    run({ origin: 'https://user:password@api.example' }).issues.some(
      item => item.code === 'ROUTING_EVIDENCE_INVALID',
    ),
  ).toBe(true);
  expect(
    run({ evidence: { ...binding.evidence, hash: 'sha256:wrong' } }).issues.some(
      item => item.code === 'ROUTING_EVIDENCE_INVALID',
    ),
  ).toBe(true);
});

it('enforces evidence budgets and records opaque runtime sources rather than declaring absence', () => {
  const text = `fetch('/one'); fetch('/two');`,
    source: PortalConnectionSource = {
      sourceId: 'reference:0',
      serviceId: 'web',
      path: 'web.ts',
      text,
      hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      role: 'runtime',
    };
  const result = analyzePortalServiceConnections({
    sources: [source],
    modules: [{ sourceId: source.sourceId, complete: true, references: [] }],
    limits: { maxEvidence: 1 },
  });
  expect(result.clients).toHaveLength(1);
  expect(result.issues.some(item => item.code === 'EVIDENCE_LIMIT')).toBe(true);
  expect(
    analyze({ 'web/page.mdx': '# Unparsed behavior' }).issues.some(
      item => item.code === 'UNSUPPORTED_RUNTIME_SOURCE',
    ),
  ).toBe(true);
});

it('does not treat Express settings reads or unsupported chained/client factory forms as proven routes', () => {
  const settings = analyze({
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.ts': `import express from 'express'; const app = express(); app.get('/setting');`,
  });
  expect(settings.producers).toHaveLength(0);
  for (const code of [
    `import express from 'express'; express().get('/docs', () => {});`,
    `import axios from 'axios'; axios('/docs');`,
    `import fastify from 'fastify'; const app = await fastify(options); app.get('/docs', () => {});`,
  ]) {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5","axios":"1","fastify":"5"}}',
      'api/main.mts': code,
    });
    expect(result.complete).toBe(false);
    expect(result.producers).toHaveLength(0);
  }
});

it('retains router-cycle, duplicate-scope and provider-pattern uncertainty', () => {
  const result = analyze({
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.ts': `import { Router } from 'express'; const a = Router(); const b = Router(); a.use('/a', b); b.use('/b', a); a.get('/docs', () => {});`,
  });
  expect(result.issues.some(item => item.code === 'MOUNT_CYCLE_OR_LIMIT')).toBe(true);
  expect(result.producers).toHaveLength(0);
  const patterns = analyze({
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.ts': `import express from 'express'; const app = express(); app.get('/docs?bad', () => {}); app.get('/docs/:id', () => {});`,
  });
  expect(patterns.complete).toBe(false);
  expect(patterns.producers).toHaveLength(0);
  const text = 'export const value = 1;',
    source: PortalConnectionSource = {
      sourceId: 'r:0',
      serviceId: 'web',
      path: 'web.ts',
      text,
      hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      role: 'runtime',
    };
  const duplicates = analyzePortalServiceConnections({
    sources: [source, source, source],
    modules: [],
  });
  expect(duplicates.issues.filter(item => item.code === 'DUPLICATE_SOURCE')).toHaveLength(2);
});

it('requires the exact Express use mount API and retains additional middleware uncertainty', () => {
  for (const mount of [`app.route('/api', r);`, `app.use('/api', r, customMiddleware);`]) {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5"}}',
      'api/main.ts': `import express from 'express'; const app = express(); const r = express.Router(); r.get('/docs', () => {}); ${mount}`,
    });
    expect(result.complete).toBe(false);
    expect(result.issues.some(item => item.code === 'UNRESOLVED_MOUNT')).toBe(true);
    expect(result.producers).toHaveLength(0);
  }
  for (const mount of [
    `app.use('/api', r);`,
    `app.use(express.json()); app.get('/docs', () => {});`,
  ]) {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5","fastify":"5"}}',
      'api/main.ts': `import express from 'express'; import fastify from 'fastify'; const app = fastify(); const r = express.Router(); r.get('/docs', () => {}); ${mount}`,
    });
    expect(result.complete).toBe(false);
    expect(result.producers).toHaveLength(0);
  }
});

it('retains unsupported route chains rooted in an existing recognized receiver', () => {
  const result = analyze({
    'api/package.json': '{"dependencies":{"express":"5"}}',
    'api/main.ts': `import express from 'express'; const app = express(); app.get('/one', () => {}).post('/two', () => {}).get('/three', () => {});`,
  });
  expect(result.complete).toBe(false);
  expect(result.issues.some(item => item.code === 'UNSUPPORTED_CHAINED_HTTP')).toBe(true);
  expect(result.producers.map(item => item.route)).toEqual(['/one']);
});

it.each([
  {
    name: 'function',
    expression: `function express() { const app = express(); app.get('/docs', () => {}); }`,
  },
  {
    name: 'class',
    expression: `class express { static setup() { const app = new express(); app.get('/docs', () => {}); } }`,
  },
])(
  'includes named $name expression bindings when rejecting factory shadowing',
  ({ expression }) => {
    const result = analyze({
      'api/package.json': '{"dependencies":{"express":"5"}}',
      'api/main.ts': `import express from 'express'; const local = ${expression};`,
    });
    expect(result.complete).toBe(false);
    expect(result.issues.some(item => item.code === 'UNKNOWN_HTTP_RECEIVER')).toBe(true);
    expect(result.producers).toHaveLength(0);
  },
);

it.each([512, 513])(
  'distinguishes complete retained diagnostics from loss at %s uncertain calls',
  count => {
    const result = analyze({
      'web/main.ts': Array.from(
        { length: count },
        (_, index) => `fetch('/api',options${index});`,
      ).join('\n'),
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(512);
    expect(result.issuesTruncated).toBe(count > 512);
    expect(
      result.issues.every(issue => issue.code === 'DYNAMIC_HTTP_OPTIONS' && issue.evidence),
    ).toBe(true);
  },
);
