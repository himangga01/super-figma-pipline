import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../mcp/src/security/state-permissions.js', () => ({
  createStatePermissions: () => ({ verifySecure: async () => {} }),
}));
vi.mock('../../mcp/src/security/follower-auth.js', () => ({
  createFollowerAuth: async () => ({
    authorization: async () => ({
      value: 'SYNTHETIC_PRIVATE_BEARER',
      generation: 'fixture-generation',
    }),
  }),
}));
import { ControlClient } from '../src/control-client.js';

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw Error('GLOBAL_REMOTE_NETWORK_FORBIDDEN');
  });
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});
const input = {
  providerInstanceId: '00000000-0000-4000-8000-000000000001',
  configurationGeneration: 1,
  authGeneration: 2,
  flowId: '00000000-0000-4000-8000-000000000002',
};
const owner = { pid: 1234, processStartedAt: 1000, leaderGeneration: 'fixture-generation' };
const location = () => {
  const value = new URL('https://www.figma.com/oauth/mcp');
  for (const [key, item] of Object.entries({
    client_id: 'own-synthetic-client',
    redirect_uri: 'http://127.0.0.1:41234/callback',
    response_type: 'code',
    scope: 'mcp:connect',
    state: 'A'.repeat(43),
    code_challenge: 'B'.repeat(43),
    code_challenge_method: 'S256',
    resource: 'https://mcp.figma.com/mcp',
  }))
    value.searchParams.set(key, item);
  return value;
};
async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  proof: (port: number) => Promise<typeof owner> = async () => owner,
) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  return new ControlClient({
    stateRoot: 'owned-fixture',
    port: address.port,
    handoffOwnerProof: proof,
  });
}
it('delivers one validated private 303 only through the owner callback without following it or returning JSON', async () => {
  let calls = 0;
  let received: unknown;
  const proof = vi.fn<() => Promise<typeof owner>>(async () => owner);
  const client = await fixture((request, response) => {
    calls++;
    expect(request.url).toBe('/control/figma-mcp/auth/handoff');
    expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe('SYNTHETIC_PRIVATE_BEARER');
    let body = '';
    request.on('data', data => {
      body += data;
    });
    request.on('end', () => {
      received = JSON.parse(body);
      response.writeHead(303, { location: location().href });
      response.end();
    });
  }, proof);
  const delivered = vi.fn<(value: URL) => void>();
  expect(await client.officialFigmaOAuthHandoff(input, delivered)).toBeUndefined();
  expect(received).toEqual(input);
  expect(calls).toBe(1);
  expect(delivered).toHaveBeenCalledOnce();
  expect(delivered.mock.calls[0]![0]).toBeInstanceOf(URL);
  expect(proof).toHaveBeenCalledTimes(4);
  expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
});
it.each([
  'foreign-origin',
  'userinfo',
  'wrong-resource',
  'wrong-callback',
  'duplicate-state',
  'unknown-field',
  'wrong-status',
  'body',
])('rejects %s without forwarding a private location or retries', async mode => {
  let calls = 0;
  const value = location();
  if (mode === 'foreign-origin') value.hostname = 'unowned.invalid';
  if (mode === 'userinfo') value.username = 'PRIVATE_CANARY';
  if (mode === 'wrong-resource') value.searchParams.set('resource', 'https://unowned.invalid');
  if (mode === 'wrong-callback')
    value.searchParams.set('redirect_uri', 'https://unowned.invalid/callback');
  if (mode === 'duplicate-state') value.searchParams.append('state', 'PRIVATE_CANARY');
  if (mode === 'unknown-field') value.searchParams.set('code', 'PRIVATE_CANARY');
  const client = await fixture((_request, response) => {
    calls++;
    response.writeHead(mode === 'wrong-status' ? 302 : 303, { location: value.href });
    response.end(mode === 'body' ? 'PRIVATE_CANARY' : '');
  });
  const deliver = vi.fn<(value: URL) => void>();
  const error = await client.officialFigmaOAuthHandoff(input, deliver).catch(reason => reason);
  expect(deliver).not.toHaveBeenCalled();
  expect(calls).toBe(1);
  expect(String(error) + JSON.stringify(error) + error.stack).not.toContain('PRIVATE_CANARY');
  expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
});
it('requires owned daemon proof before any authenticated request and rejects changed proof before delivery', async () => {
  let calls = 0;
  const unavailable = await fixture(
    (_request, response) => {
      calls++;
      response.end();
    },
    async () => {
      throw Error('PRIVATE_PROOF_CANARY');
    },
  );
  const first = await unavailable.officialFigmaOAuthHandoff(input, () => {}).catch(error => error);
  expect(calls).toBe(0);
  expect(first.message).not.toContain('CANARY');
  let proofs = 0;
  const changed = await fixture(
    (_request, response) => {
      calls++;
      response.writeHead(303, { location: location().href });
      response.end();
    },
    async () => (++proofs < 4 ? owner : { ...owner, pid: 9999 }),
  );
  const deliver = vi.fn<(value: URL) => void>();
  await expect(changed.officialFigmaOAuthHandoff(input, deliver)).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
  });
  expect(calls).toBe(1);
  expect(deliver).not.toHaveBeenCalled();
});
it('consumes only one POST after a lost response or cancellation and does not expose callback errors', async () => {
  let calls = 0;
  const lost = await fixture(request => {
    calls++;
    request.socket.destroy();
  });
  await expect(lost.officialFigmaOAuthHandoff(input, () => {})).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_HANDOFF_FAILED',
  });
  expect(calls).toBe(1);
  const callback = await fixture((_request, response) => {
    response.writeHead(303, { location: location().href });
    response.end();
  });
  const error = await callback
    .officialFigmaOAuthHandoff(input, () => {
      throw Error('PRIVATE_OWNER_CALLBACK_CANARY');
    })
    .catch(reason => reason);
  expect(String(error) + error.stack).not.toContain('CANARY');
  const abort = new AbortController();
  abort.abort(Error('PRIVATE_ABORT_CANARY'));
  await expect(
    callback.officialFigmaOAuthHandoff(input, () => {}, { signal: abort.signal }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
});
it('rejects changed ownership during awaited admission before sending any private bearer', async () => {
  let calls = 0;
  let changed = false;
  const client = await fixture(
    (_request, response) => {
      calls++;
      response.end();
    },
    async () => (changed ? { ...owner, pid: 9999 } : owner),
  );
  const delivered = vi.fn<(value: URL) => void>();
  await expect(
    client.officialFigmaOAuthHandoff(input, delivered, {
      beforeRequest: async () => {
        await Promise.resolve();
        changed = true;
      },
    }),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_BINDING_MISMATCH' });
  expect(calls).toBe(0);
  expect(delivered).not.toHaveBeenCalled();
});
it('rechecks admission after held identity work and sends zero authenticated requests when a new fence appears', async () => {
  let calls = 0,
    proofs = 0,
    entered!: () => void,
    release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  const observed = new Promise<void>(resolve => {
    entered = resolve;
  });
  const client = await fixture(
    (_request, response) => {
      calls++;
      response.end();
    },
    async () => {
      if (++proofs === 2) {
        entered();
        await pending;
      }
      return owner;
    },
  );
  let fenced = false;
  const result = client
    .officialFigmaOAuthHandoff(input, () => {}, {
      beforeRequest: async () => {
        if (fenced)
          throw Object.assign(Error('SERVICE_JOB_OUTCOME_UNKNOWN'), {
            code: 'SERVICE_JOB_OUTCOME_UNKNOWN',
          });
      },
    })
    .catch(error => error);
  await observed;
  fenced = true;
  release();
  expect(await result).toMatchObject({ code: 'SERVICE_JOB_OUTCOME_UNKNOWN' });
  expect(calls).toBe(0);
});
