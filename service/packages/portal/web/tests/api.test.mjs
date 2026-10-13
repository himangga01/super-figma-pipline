import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { test } from 'vitest';

import { createApi, PortalError } from '../api.js';

test('API mutation uses bootstrap integrity token and strips routing metadata from strict save payload', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/bootstrap') {
      response.end(JSON.stringify({ csrfToken: 'test-integrity-token' }));
      return;
    }
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      const value = JSON.parse(body);
      if (
        request.url !== '/api/workflows/workflow-1' ||
        request.method !== 'PUT' ||
        request.headers['x-sfp-csrf'] !== 'test-integrity-token' ||
        'id' in value
      ) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({ error: { code: 'INVALID_TRANSPORT', message: 'Unexpected request' } }),
        );
      } else {
        response.end(JSON.stringify({ savedName: value.name, savedRevision: value.revision }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const api = createApi((path, options) =>
      fetch(`http://127.0.0.1:${server.address().port}${path}`, options),
    );
    await api.bootstrap();
    assert.deepEqual(await api.save({ id: 'workflow-1', name: 'Edited workflow', revision: 4 }), {
      savedName: 'Edited workflow',
      savedRevision: 4,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('an audit warning preserves the successful service result and activity filters are encoded', async () => {
  let warned = 0;
  const api = createApi(
    async (path, options) => {
      if (path.startsWith('/api/activities?')) {
        const query = new URL(path, 'http://127.0.0.1').searchParams;
        assert.equal(query.get('type'), 'guide.open');
        assert.equal(query.get('source'), 'client');
        assert.equal(query.has('status'), false);
        return new Response(JSON.stringify({ activities: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assert.equal(path, '/api/runs/run-1/actions');
      assert.equal(options.method, 'POST');
      return new Response(JSON.stringify({ id: 'run-1', status: 'cancelled' }), {
        headers: { 'Content-Type': 'application/json', 'x-sfp-activity-warning': 'AUDIT_BLOCKED' },
      });
    },
    () => {
      warned++;
    },
  );
  assert.deepEqual(await api.action('run-1', 'cancel'), { id: 'run-1', status: 'cancelled' });
  assert.equal(warned, 1);
  assert.deepEqual(await api.activities({ type: 'guide.open', source: 'client', status: '' }), {
    activities: [],
  });
});

test('API preserves actionable revision-conflict code and issues instead of reporting a successful save', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(409, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Reload the saved workflow',
          issues: [{ path: 'revision', message: 'Stale revision' }],
        },
      }),
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const api = createApi((path, options) =>
      fetch(`http://127.0.0.1:${server.address().port}${path}`, options),
    );
    await assert.rejects(
      api.save({ id: 'workflow-1', name: 'Draft', revision: 4 }),
      error =>
        error instanceof PortalError &&
        error.code === 'REVISION_CONFLICT' &&
        error.issues[0].path === 'revision',
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
