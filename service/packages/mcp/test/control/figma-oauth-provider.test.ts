import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchLike } from '@modelcontextprotocol/client';
import type { ActorContext } from '@sfp/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FigmaOAuthCallbackListener } from '../../src/control/figma-oauth-callback.js';
import { FigmaOAuthStatusSchema } from '../../src/control/figma-oauth-contract.js';
import { createFigmaOAuthHandoffHttpHandler } from '../../src/control/figma-oauth-handoff.js';
import { boundedFigmaOAuthFetch } from '../../src/control/figma-oauth-metadata.js';
import { FigmaOAuthProvider } from '../../src/control/figma-oauth-provider.js';
import {
  assertApprovedLoopbackUri,
  figmaOAuthClientIdDigest,
} from '../../src/control/figma-oauth-state.js';
import { createFigmaMcpSettingsEndpoint } from '../../src/control/figma-settings-endpoint.js';
import { registerFigmaMcpSettingsRoutes } from '../../src/control/route-registry.js';
import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import { probeOfficialFigmaMcp, readOfficialFigmaMcp } from '../../src/official-figma-mcp.js';

const principal: ActorContext = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
};
const ID = 'OWN_CLIENT_CANARY';
const SECRET = 'OWN_SECRET_CANARY:+/=';
const ACCESS = 'ACCESS_CANARY';
const REFRESH = 'REFRESH_CANARY';
const ISSUER = 'https://api.figma.com';
const RESOURCE = 'https://mcp.figma.com/mcp';
const TOKEN = 'https://api.figma.com/v1/oauth/token';
const providers: FigmaOAuthProvider[] = [];
const listeners: FigmaOAuthCallbackListener[] = [];
const servers: Server[] = [];
const roots: string[] = [];
const signal = () => new AbortController().signal;
const permissions = { verifySecure: async () => {}, ensureSecure: async () => {} };
const binding = (provider: FigmaOAuthProvider) => {
  const status = provider.status();
  return {
    providerInstanceId: status.providerInstanceId,
    configurationGeneration: status.configurationGeneration,
    authGeneration: status.authGeneration,
  };
};
const cleanup = (provider: FigmaOAuthProvider) => ({
  ...binding(provider),
  flowId: provider.status().flowId,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const resourceMetadata = {
  resource: RESOURCE,
  authorization_servers: [ISSUER],
  scopes_supported: ['mcp:connect'],
};
const authorizationMetadata = {
  issuer: ISSUER,
  authorization_endpoint: 'https://www.figma.com/oauth/mcp',
  token_endpoint: TOKEN,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['mcp:connect'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  authorization_response_iss_parameter_supported: true,
};
async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>(resolve =>
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture port');
  return address.port;
}
async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}
function local(
  uri: string,
  options: { method?: string; host?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const url = new URL(uri);
  expect(url.hostname).toBe('127.0.0.1');
  return new Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          connection: 'close',
          ...(options.host ? { host: options.host } : {}),
          ...options.headers,
        },
        agent: false,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.once('end', () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.once('error', reject);
    req.end(options.body);
  });
}
async function fixture(
  options: {
    environment?: Record<string, string | undefined>;
    method?: 'client_secret_basic' | 'client_secret_post';
    metadata?: typeof authorizationMetadata;
    token?: FetchLike;
    contractChanges?: Record<string, unknown>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'sfp-owned-oauth-'));
  roots.push(root);
  const redirect = `http://127.0.0.1:${await freePort()}/oauth/figma/callback`;
  const contract = {
    schemaVersion: 1,
    serviceName: 'super-figma-pipeline',
    eligibility: 'accepted-own-service-client',
    operatorDeclaration: true,
    evidenceReference: 'fixture-contract',
    clientIdDigest: figmaOAuthClientIdDigest(ID),
    authenticationMethod: options.method ?? 'client_secret_basic',
    redirectUri: redirect,
    callbackMode: 'fixed',
    ...options.contractChanges,
  };
  const bytes = JSON.stringify(contract);
  await mkdir(join(root, 'figma-auth', 'contracts'), { recursive: true });
  const contractPath = join(root, 'figma-auth', 'contracts', 'own-client.json');
  await writeFile(contractPath, bytes);
  const transport = vi.fn<FetchLike>(async (input, init) => {
    if (String(input) === 'https://mcp.figma.com/.well-known/oauth-protected-resource/mcp')
      return json(resourceMetadata);
    if (String(input) === 'https://api.figma.com/.well-known/oauth-authorization-server')
      return json(options.metadata ?? authorizationMetadata);
    if (String(input) === TOKEN)
      return options.token
        ? options.token(input, init)
        : json({
            access_token: ACCESS,
            refresh_token: REFRESH,
            token_type: 'Bearer',
            expires_in: 120,
            scope: 'mcp:connect',
          });
    throw Error('FORBIDDEN_DESTINATION_CANARY');
  });
  const environment = options.environment ?? { OWN_CLIENT_ID: ID, OWN_CLIENT_SECRET: SECRET };
  const provider = await FigmaOAuthProvider.open({
    stateRoot: root,
    permissions,
    ownerActorId: principal.actorId,
    environment,
    fetch: transport,
  });
  providers.push(provider);
  const configuration = {
    endpoint: RESOURCE as 'https://mcp.figma.com/mcp',
    mode: 'own-oauth' as const,
    oauthTokenEnv: null,
    clientIdEnv: 'OWN_CLIENT_ID',
    clientSecretEnv: 'OWN_CLIENT_SECRET',
    contractReference: 'own-client',
    contractDigest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
  };
  const configure = () =>
    provider.configure(principal, { ...binding(provider), configuration }, signal());
  const start = () =>
    provider.start(principal, { ...binding(provider), deadlineAt: Date.now() + 30_000 }, signal());
  const handoff = () => {
    let authorization!: URL;
    provider.handoff(
      principal,
      { ...binding(provider), flowId: provider.status().flowId },
      signal(),
      uri => {
        authorization = uri;
      },
    );
    return authorization;
  };
  const callback = (authorization: URL, extra?: Record<string, string>) => {
    const url = new URL(redirect);
    url.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code: 'CODE_CANARY',
      iss: ISSUER,
      ...extra,
    }).toString();
    return url.href;
  };
  return {
    root,
    redirect,
    contractPath,
    provider,
    transport,
    configure,
    start,
    handoff,
    callback,
    configuration,
  };
}
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw Error('LIVE_HTTP_FORBIDDEN');
  });
});
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.close();
  for (const listener of listeners.splice(0)) await listener.close();
  for (const server of servers.splice(0)) await closeServer(server);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (vi.mocked(globalThis.fetch).mock.calls.length) throw Error('LIVE_HTTP_CALLED');
  vi.restoreAllMocks();
});

it('missing configuration is safe blocked status and start performs zero discovery/token/handoff', async () => {
  const f = await fixture();
  expect(FigmaOAuthStatusSchema.parse(f.provider.status())).toMatchObject({
    stage: 'blocked',
    eligibilitySource: 'none',
    handoffAvailable: false,
  });
  await expect(f.start()).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE' });
  expect(f.transport).not.toHaveBeenCalled();
  expect(JSON.stringify(f.provider.status())).not.toMatch(
    /OWN_CLIENT_CANARY|OWN_SECRET_CANARY|CODE_CANARY/,
  );
});
it('configured contract is declared only, persists names, and remains startable without network', async () => {
  const f = await fixture();
  expect(await f.configure()).toMatchObject({
    stage: 'blocked',
    code: null,
    eligibilitySource: 'operator-contract',
    serverAuthorizationObserved: false,
  });
  const persisted = await readFile(join(f.root, 'figma-auth', 'configuration.json'), 'utf8');
  expect(persisted).toContain('OWN_CLIENT_ID');
  expect(persisted).not.toMatch(/OWN_CLIENT_CANARY|OWN_SECRET_CANARY|ACCESS_CANARY|REFRESH_CANARY/);
  expect(f.transport).not.toHaveBeenCalled();
});
it.each(['client_secret_basic', 'client_secret_post'] as const)(
  'owns actual SDK metadata, PKCE callback, credential lease and explicit refresh with %s',
  async method => {
    const f = await fixture({ method });
    await f.configure();
    const started = await f.start();
    expect(started).toMatchObject({
      stage: 'waiting-for-callback',
      handoffAvailable: true,
      serverAuthorizationObserved: false,
    });
    expect(f.transport).toHaveBeenCalledTimes(2);
    const authorization = f.handoff();
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = await local(f.callback(authorization));
    expect(callback.status).toBe(200);
    expect(callback.text).not.toContain('CODE_CANARY');
    expect(f.provider.status()).toMatchObject({
      stage: 'authorized',
      serverAuthorizationObserved: true,
      handoffAvailable: false,
    });
    const lease = f.provider.acquireCredentialLease();
    expect(await lease.oauthToken()).toBe(ACCESS);
    const before = binding(f.provider);
    await f.provider.refresh(principal, { ...before, deadlineAt: Date.now() + 10_000 }, signal());
    expect(lease.signal.aborted).toBe(true);
    expect(() => lease.assertActive()).toThrow('FIGMA_MCP_OAUTH_SUPERSEDED');
    expect(f.provider.status().authGeneration).toBeGreaterThan(before.authGeneration);
    const requests = f.transport.mock.calls.filter(([input]) => String(input) === TOKEN);
    expect(requests).toHaveLength(2);
    expect((requests[1]![1]!.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
    await f.provider.cleanup(principal, cleanup(f.provider), true);
    expect(await f.provider.token()).toBeUndefined();
    await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    lease.release();
  },
);
it.each([
  { environment: {}, code: 'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE' },
  {
    environment: { OWN_CLIENT_ID: 'BORROWED_CLIENT', OWN_CLIENT_SECRET: SECRET },
    code: 'FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED',
  },
  {
    contractChanges: { serviceName: 'borrowed-application' },
    code: 'FIGMA_MCP_OAUTH_CONTRACT_INVALID',
  },
  { contractChanges: { operatorDeclaration: false }, code: 'FIGMA_MCP_OAUTH_CONTRACT_INVALID' },
  { contractChanges: { authenticationMethod: 'none' }, code: 'FIGMA_MCP_OAUTH_CONTRACT_INVALID' },
  { contractChanges: { callbackMode: 'ephemeral' }, code: 'FIGMA_MCP_OAUTH_CONTRACT_INVALID' },
])('blocks own-client prerequisite %# before external calls', async options => {
  const f = await fixture(options);
  await f.configure();
  await expect(f.start()).rejects.toMatchObject({ code: options.code });
  expect(f.transport).not.toHaveBeenCalled();
});
it('rechecks operator record digest before listener/discovery', async () => {
  const f = await fixture();
  await f.configure();
  await writeFile(f.contractPath, '{}');
  await expect(f.start()).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_CONTRACT_CHANGED' });
  expect(f.transport).not.toHaveBeenCalled();
});
it.each(['logout', 'close'] as const)(
  'retires a pending local contract read on %s without late listener/discovery publication',
  async action => {
    const f = await fixture();
    await f.configure();
    let armed = false;
    let entered!: () => void;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      entered = resolve;
    });
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const provider = await FigmaOAuthProvider.open({
      stateRoot: f.root,
      permissions: {
        ensureSecure: async () => {},
        verifySecure: async path => {
          if (armed && path === f.contractPath) {
            entered();
            await held;
          }
        },
      },
      ownerActorId: principal.actorId,
      environment: { OWN_CLIENT_ID: ID, OWN_CLIENT_SECRET: SECRET },
      fetch: f.transport,
    });
    providers.push(provider);
    armed = true;
    const pending = provider
      .start(principal, { ...binding(provider), deadlineAt: Date.now() + 10_000 }, signal())
      .catch(error => error as Error);
    await gate;
    if (action === 'logout') await provider.cleanup(principal, cleanup(provider), true);
    else await provider.close();
    release();
    expect(await pending).toMatchObject({ code: 'FIGMA_MCP_OAUTH_SUPERSEDED' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(provider.status().handoffAvailable).toBe(false);
    await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  },
);
it('actual credential expiry retires dependent leases without refresh or consent calls', async () => {
  const f = await fixture({
    token: async () =>
      json({
        access_token: ACCESS,
        refresh_token: REFRESH,
        token_type: 'Bearer',
        expires_in: 1,
        scope: 'mcp:connect',
      }),
  });
  await f.configure();
  await f.start();
  await local(f.callback(f.handoff()));
  const lease = f.provider.acquireCredentialLease();
  await vi.waitFor(() => expect(f.provider.status().stage).toBe('expired'), { timeout: 3_000 });
  expect(lease.signal.aborted).toBe(true);
  expect(await f.provider.token()).toBeUndefined();
  expect(f.transport).toHaveBeenCalledTimes(3);
  lease.release();
});
it('rejects wrong control owner, generation and hostile fields without effects', async () => {
  const f = await fixture();
  await f.configure();
  await expect(
    f.provider.start(
      { ...principal, actorId: `actor1_${'C'.repeat(43)}` },
      { ...binding(f.provider), deadlineAt: Date.now() + 10_000 },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_OWNER_MISMATCH' });
  await expect(
    f.provider.start(
      principal,
      { ...binding(f.provider), authGeneration: 0, deadlineAt: Date.now() + 10_000 },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_BINDING_MISMATCH' });
  await expect(
    f.provider.start(
      principal,
      { ...binding(f.provider), deadlineAt: Date.now() + 10_000, secret: SECRET },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_INPUT_INVALID' });
  expect(f.transport).not.toHaveBeenCalled();
});
it('one-use handoff belongs to authenticated control session and its original flow', async () => {
  const f = await fixture();
  await f.configure();
  await f.start();
  const input = { ...binding(f.provider), flowId: f.provider.status().flowId };
  expect(() =>
    f.provider.handoff(
      { ...principal, authSessionId: `auth1_${'C'.repeat(43)}` },
      input,
      signal(),
      () => {},
    ),
  ).toThrow('FIGMA_MCP_OAUTH_HANDOFF_UNAVAILABLE');
  f.handoff();
  expect(() => f.provider.handoff(principal, input, signal(), () => {})).toThrow(
    'FIGMA_MCP_OAUTH_HANDOFF_UNAVAILABLE',
  );
  expect(f.transport).toHaveBeenCalledTimes(2);
});
it('duplicate starts do not replace an active transaction or renew its deadline', async () => {
  const f = await fixture();
  await f.configure();
  const started = await f.start();
  await expect(f.start()).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_BUSY' });
  expect(f.provider.status()).toEqual(started);
  expect(f.transport).toHaveBeenCalledTimes(2);
});
it('expiry retains the original interactive deadline and closes its physical listener', async () => {
  const f = await fixture();
  await f.configure();
  const originalDeadline = Date.now() + 350;
  const started = await f.provider.start(
    principal,
    { ...binding(f.provider), deadlineAt: originalDeadline },
    signal(),
  );
  expect(started.expiresAt).toBe(originalDeadline);
  await vi.waitFor(() => expect(f.provider.status().stage).toBe('expired'), { timeout: 2_000 });
  expect(f.provider.status().handoffAvailable).toBe(false);
  await vi.waitFor(async () => {
    await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
  expect(f.transport).toHaveBeenCalledTimes(2);
});
it('pre-authorization callback GET cannot begin a transaction or exchange a code', async () => {
  const f = await fixture();
  await f.configure();
  await expect(local(f.redirect + '?code=CODE_CANARY&state=STATE_CANARY')).rejects.toMatchObject({
    code: 'ECONNREFUSED',
  });
  expect(f.transport).not.toHaveBeenCalled();
});
it.each(['state', 'iss', 'code'] as const)(
  'rejects callback cardinality/binding %s before exchange and retains valid original attempt',
  async key => {
    const f = await fixture();
    await f.configure();
    await f.start();
    const authorization = f.handoff();
    const uri = new URL(f.callback(authorization));
    if (key === 'code') uri.searchParams.append('code', 'SECOND_CODE_CANARY');
    else uri.searchParams.set(key, 'WRONG_CANARY');
    expect((await local(uri.href)).status).toBe(400);
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect((await local(f.callback(authorization))).status).toBe(200);
    expect(f.transport).toHaveBeenCalledTimes(3);
  },
);
it('lost token exchange cannot replay its code or retain a handoff and listener is closed on cleanup', async () => {
  const f = await fixture({
    token: async () => {
      throw Error('TOKEN_RESPONSE_LOSS_CANARY');
    },
  });
  await f.configure();
  await f.start();
  const authorization = f.handoff();
  expect((await local(f.callback(authorization))).status).toBe(400);
  expect(f.provider.status()).toMatchObject({ stage: 'login-required', handoffAvailable: false });
  await expect(local(f.callback(authorization))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  expect(f.transport).toHaveBeenCalledTimes(3);
  await f.provider.cleanup(principal, cleanup(f.provider), true);
  await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});
it('cancel preserves original binding protection and proves actual listener closure', async () => {
  const f = await fixture();
  await f.configure();
  await f.start();
  const old = cleanup(f.provider);
  await f.provider.cleanup(principal, old, false);
  expect(f.provider.status()).toMatchObject({
    stage: 'cancelled',
    flowId: null,
    handoffAvailable: false,
  });
  await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  await expect(f.provider.cleanup(principal, old, true)).rejects.toMatchObject({
    code: 'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
  });
});
it('logout aborts an in-flight token fetch and fences late successful publication', async () => {
  let release!: (value: Response) => void;
  let entered!: () => void;
  let actualSignal: AbortSignal | null | undefined;
  const gate = new Promise<void>(resolve => {
    entered = resolve;
  });
  const f = await fixture({
    token: async (_input, init) => {
      actualSignal = init?.signal;
      entered();
      return new Promise<Response>(resolve => {
        release = resolve;
      });
    },
  });
  await f.configure();
  await f.start();
  const authorization = f.handoff();
  const callback = local(f.callback(authorization));
  await gate;
  await f.provider.cleanup(principal, cleanup(f.provider), true);
  expect(actualSignal?.aborted).toBe(true);
  release(json({ access_token: ACCESS, token_type: 'Bearer', expires_in: 60 }));
  expect((await callback).status).toBe(400);
  expect(await f.provider.token()).toBeUndefined();
  expect(f.provider.status().serverAuthorizationObserved).toBe(false);
});
it('external-token compatibility is explicit, logout retires held leases and Desktop receives no credential', async () => {
  const f = await fixture({
    environment: { SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'OWN_ACCESS', OWN_ACCESS: ACCESS },
  });
  expect(f.provider.status()).toMatchObject({
    stage: 'external-token-configured',
    eligibilitySource: 'none',
  });
  const endpoint = createFigmaMcpSettingsEndpoint({
    oauth: f.provider,
    probe: async (_endpoint, options) => {
      expect(options?.oauthToken).toBeUndefined();
      expect(options?.acquireCredentialLease).toBeUndefined();
      return {
        source: 'official-figma-mcp',
        endpoint: 'http://127.0.0.1:3845/mcp',
        connected: true,
        server: undefined,
        tools: [],
        captureCapability: { supported: false, reason: 'fixture', liveVerified: false },
        fullCapture: false,
      };
    },
  });
  expect(endpoint.status()).toMatchObject({
    providerInstanceId: f.provider.providerInstanceId,
    oauthLoginImplemented: true,
  });
  await endpoint.probe({ endpoint: 'http://127.0.0.1:3845/mcp' }, signal());
  const lease = f.provider.acquireCredentialLease();
  await f.provider.cleanup(principal, cleanup(f.provider), true);
  expect(lease.signal.aborted).toBe(true);
  expect(await f.provider.token()).toBeUndefined();
  lease.release();
});
it('endpoint rejects late injected probe/read results after credential generation retirement', async () => {
  const f = await fixture({
    environment: { SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'OWN_ACCESS', OWN_ACCESS: ACCESS },
  });
  let finish!: () => void;
  const held = new Promise<void>(resolve => {
    finish = resolve;
  });
  const endpoint = createFigmaMcpSettingsEndpoint({
    oauth: f.provider,
    probe: async () => {
      await held;
      return {
        source: 'official-figma-mcp',
        endpoint: RESOURCE,
        connected: true,
        server: undefined,
        tools: [],
        captureCapability: { supported: false, reason: 'fixture', liveVerified: false },
        fullCapture: false,
      };
    },
  });
  const result = endpoint.probe({ endpoint: RESOURCE }, signal());
  await f.provider.cleanup(principal, cleanup(f.provider), true);
  finish();
  expect(await result).toMatchObject({ status: 'unavailable', code: 'FIGMA_MCP_OAUTH_SUPERSEDED' });
});
it.each(['probe', 'read'] as const)(
  'actual SDK %s aborts held official RPC on logout and rejects its late response',
  async operation => {
    const f = await fixture({
      environment: { SFP_FIGMA_MCP_OAUTH_TOKEN_ENV: 'OWN_ACCESS', OWN_ACCESS: ACCESS },
    });
    const endpoint = createFigmaMcpSettingsEndpoint({ oauth: f.provider });
    let entered!: () => void;
    let complete!: (value: Response) => void;
    const gate = new Promise<void>(resolve => {
      entered = resolve;
    });
    const requests: string[] = [];
    let actualSignal: AbortSignal | null | undefined;
    const rpcFetch: FetchLike = async (_input, init) => {
      if (init?.method === 'GET') return new Response(null, { status: 405 });
      const message = JSON.parse(String(init?.body)) as { method: string; id?: number };
      requests.push(message.method);
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'Figma fixture', version: '1' },
            }
          : message.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'get_metadata',
                    inputSchema: {
                      type: 'object',
                      properties: { fileKey: { type: 'string' }, nodeId: { type: 'string' } },
                      required: ['fileKey', 'nodeId'],
                    },
                  },
                ],
              }
            : { content: [{ type: 'text', text: 'fixture read' }] };
      const response = json({ jsonrpc: '2.0', id: message.id, result });
      if (
        (operation === 'probe' && message.method === 'tools/list') ||
        message.method === 'tools/call'
      ) {
        actualSignal = init?.signal;
        entered();
        return new Promise<Response>(resolve => {
          complete = resolve;
        });
      }
      return response;
    };
    const options = { ...endpoint.connection, fetch: rpcFetch };
    const pending =
      operation === 'probe'
        ? probeOfficialFigmaMcp(RESOURCE, options)
        : readOfficialFigmaMcp(
            {
              endpoint: RESOURCE,
              target: { fileKey: 'abcdefghij123456', nodeId: '12:34' },
              tool: 'get_metadata',
            },
            options,
          );
    const observed = pending.catch(error => error as Error);
    await gate;
    await f.provider.cleanup(principal, cleanup(f.provider), true);
    expect(actualSignal?.aborted).toBe(true);
    complete(json({ jsonrpc: '2.0', id: 3, result: { content: [] } }));
    expect(await observed).toMatchObject({ code: 'FIGMA_MCP_OAUTH_SUPERSEDED' });
    expect(requests.filter(method => method === 'tools/list')).toHaveLength(1);
    expect(requests.filter(method => method === 'tools/call')).toHaveLength(
      operation === 'read' ? 1 : 0,
    );
  },
);
it('private result guards reject original credentials, state, code and verifier without reflecting values', async () => {
  const f = await fixture();
  await f.configure();
  await f.start();
  const authorization = f.handoff();
  await local(f.callback(authorization));
  const tokenBody = f.transport.mock.calls.find(([input]) => String(input) === TOKEN)![1]!
    .body as URLSearchParams;
  for (const value of [
    ID,
    SECRET,
    ACCESS,
    REFRESH,
    authorization.href,
    authorization.searchParams.get('state'),
    'CODE_CANARY',
    tokenBody.get('code_verifier'),
  ]) {
    expect(() => f.provider.assertPublicResult({ value })).toThrow('FIGMA_MCP_READ_PRIVATE_DATA');
  }
  expect(JSON.stringify(f.provider.status())).not.toMatch(
    /OWN_CLIENT_CANARY|OWN_SECRET_CANARY|ACCESS_CANARY|REFRESH_CANARY|CODE_CANARY/,
  );
});
it.each(['nested', 'key'] as const)(
  'rejects JSON-escaped own-secret reflection through the guard in a %s',
  async placement => {
    const secret = 'QUOTED_OWN_SECRET_CANARY:"\\suffix';
    const f = await fixture({ environment: { OWN_CLIENT_ID: ID, OWN_CLIENT_SECRET: secret } });
    await f.configure();
    await f.start();
    await local(f.callback(f.handoff()));
    const payload =
      placement === 'nested' ? { layers: [{ reflected: secret }] } : { [secret]: 'fixture value' };
    expect(() => f.provider.assertPublicResult(payload)).toThrow('FIGMA_MCP_READ_PRIVATE_DATA');
  },
);
it.each(['nested', 'key'] as const)(
  'rejects JSON-escaped own-secret reflection through the read endpoint in a %s',
  async placement => {
    const secret = 'QUOTED_OWN_SECRET_CANARY:"\\suffix';
    const f = await fixture({ environment: { OWN_CLIENT_ID: ID, OWN_CLIENT_SECRET: secret } });
    await f.configure();
    await f.start();
    await local(f.callback(f.handoff()));
    const payload =
      placement === 'nested' ? { layers: [{ reflected: secret }] } : { [secret]: 'fixture value' };
    const endpoint = createFigmaMcpSettingsEndpoint({
      oauth: f.provider,
      read: async input => ({
        source: 'official-figma-mcp',
        endpoint: input.endpoint,
        requestedTarget: input.target,
        tool: input.tool,
        identityBinding: 'request-only',
        result: { content: [], ...payload },
        fullCapture: false,
      }),
    });
    await expect(
      endpoint.read(
        {
          endpoint: RESOURCE,
          target: { fileKey: 'abcdefghij123456', nodeId: '12:34' },
          tool: 'get_metadata',
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'FIGMA_MCP_READ_PRIVATE_DATA' });
  },
);
it('public result guard bounds serialization and closes hostile serialization failures', async () => {
  const f = await fixture();
  expect(() => f.provider.assertPublicResult({ text: 'x'.repeat(2 * 1024 * 1024) })).toThrow(
    'FIGMA_MCP_READ_TOO_LARGE',
  );
  expect(() =>
    f.provider.assertPublicResult({
      toJSON: () => {
        throw Error('SERIALIZATION_SECRET_CANARY');
      },
    }),
  ).toThrow('FIGMA_MCP_READ_PRIVATE_DATA');
});
it('typed routes expose read-only status and POST-only actions from the same generation provider', async () => {
  const f = await fixture();
  const router = new AuthenticatedControlRouter();
  registerFigmaMcpSettingsRoutes(router, createFigmaMcpSettingsEndpoint({ oauth: f.provider }));
  router.freeze();
  const status = await router.dispatch(
    { method: 'GET', path: '/control/figma-mcp/auth/status', input: {} },
    principal,
    signal(),
  );
  expect(status).toEqual(f.provider.status());
  await expect(
    router.dispatch(
      { method: 'GET', path: '/control/figma-mcp/auth/start', input: {} },
      principal,
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'CONTROL_ROUTE_NOT_FOUND' });
  await expect(
    router.dispatch(
      {
        method: 'POST',
        path: '/control/figma-mcp/auth/configure',
        input: { ...binding(f.provider), configuration: f.configuration },
      },
      principal,
      signal(),
    ),
  ).resolves.toMatchObject({ stage: 'blocked', code: null });
  expect(f.transport).not.toHaveBeenCalled();
});
it('actual authenticated control HTTP status/configure/start/logout keeps values private and listener ownership exact', async () => {
  const f = await fixture();
  const router = new AuthenticatedControlRouter();
  registerFigmaMcpSettingsRoutes(router, createFigmaMcpSettingsEndpoint({ oauth: f.provider }));
  router.freeze();
  const logs: string[] = [];
  const handler = createControlHttpHandler({
    router,
    principalForRequest: async () => principal,
    log: line => {
      logs.push(line);
    },
  });
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer private-control-fixture') {
      res.statusCode = 401;
      res.end();
      return;
    }
    void handler(req, res);
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const headers = {
    authorization: 'Bearer private-control-fixture',
    'content-type': 'application/json',
  };
  const call = (path: string, input?: unknown) =>
    local(origin + '/control/figma-mcp/auth/' + path, {
      headers,
      ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
    });
  expect((await call('status')).status).toBe(200);
  expect(f.transport).not.toHaveBeenCalled();
  expect(
    (await call('configure', { ...binding(f.provider), configuration: f.configuration })).status,
  ).toBe(200);
  expect(
    (await call('start', { ...binding(f.provider), deadlineAt: Date.now() + 10_000 })).status,
  ).toBe(200);
  expect(f.provider.status().handoffAvailable).toBe(true);
  expect((await call('start')).status).toBe(404);
  expect(
    (
      await call('configure', {
        ...binding(f.provider),
        configuration: { ...f.configuration, secret: SECRET },
      })
    ).text,
  ).not.toContain(SECRET);
  const logout = await call('logout', cleanup(f.provider));
  expect(logout.status).toBe(200);
  expect(JSON.stringify(logs) + logout.text).not.toMatch(
    /OWN_CLIENT_CANARY|OWN_SECRET_CANARY|ACCESS_CANARY|REFRESH_CANARY|CODE_CANARY/,
  );
  await expect(local(f.redirect)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  expect(f.transport).toHaveBeenCalledTimes(2);
});
it('held explicit refresh excludes duplicates, aborts on logout and never replays a refresh token', async () => {
  let entered!: () => void;
  let release!: (value: Response) => void;
  let heldSignal: AbortSignal | null | undefined;
  const gate = new Promise<void>(resolve => {
    entered = resolve;
  });
  const f = await fixture({
    token: async (_input, init) => {
      if ((init!.body as URLSearchParams).get('grant_type') === 'refresh_token') {
        heldSignal = init?.signal;
        entered();
        return new Promise<Response>(resolve => {
          release = resolve;
        });
      }
      return json({
        access_token: ACCESS,
        refresh_token: REFRESH,
        token_type: 'Bearer',
        expires_in: 120,
        scope: 'mcp:connect',
      });
    },
  });
  await f.configure();
  await f.start();
  await local(f.callback(f.handoff()));
  const refresh = f.provider
    .refresh(principal, { ...binding(f.provider), deadlineAt: Date.now() + 10_000 }, signal())
    .catch(error => error as Error);
  await gate;
  await expect(
    f.provider.refresh(
      principal,
      { ...binding(f.provider), deadlineAt: Date.now() + 10_000 },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_BUSY' });
  expect(await f.provider.token()).toBeUndefined();
  await f.provider.cleanup(principal, cleanup(f.provider), true);
  expect(heldSignal?.aborted).toBe(true);
  release(
    json({
      access_token: 'LATE_ACCESS_CANARY',
      refresh_token: 'LATE_REFRESH_CANARY',
      token_type: 'Bearer',
      expires_in: 60,
    }),
  );
  expect(await refresh).toMatchObject({ code: 'FIGMA_MCP_OAUTH_CANCELLED' });
  expect(await f.provider.token()).toBeUndefined();
  expect(f.transport.mock.calls.filter(([input]) => String(input) === TOKEN)).toHaveLength(2);
});
it('private authenticated HTTP handoff delivers only one 303 header, never JSON or a GET effect', async () => {
  const f = await fixture();
  await f.configure();
  await f.start();
  const handler = createFigmaOAuthHandoffHttpHandler({
    provider: f.provider,
    principalForRequest: async req => {
      if (req.headers.authorization !== 'Bearer fixture-private-control')
        throw Error('AUTH_CANARY');
      return principal;
    },
  });
  const server = createServer((req, res) => {
    void handler(req, res).then(handled => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
      return undefined;
    });
  });
  const uri = `http://127.0.0.1:${await listen(server)}/control/figma-mcp/auth/handoff`;
  expect((await local(uri)).status).toBe(409);
  expect(f.provider.status().handoffAvailable).toBe(true);
  const body = JSON.stringify({ ...binding(f.provider), flowId: f.provider.status().flowId });
  expect(
    (await local(uri, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))
      .status,
  ).toBe(409);
  expect(f.provider.status().handoffAvailable).toBe(true);
  const reply = await local(uri, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer fixture-private-control',
    },
  });
  expect(reply.status).toBe(303);
  expect(reply.text).toBe('');
  expect(new URL(reply.headers.location!).origin).toBe('https://www.figma.com');
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(
    (
      await local(uri, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer fixture-private-control',
        },
      })
    ).status,
  ).toBe(409);
});
it.each([
  'http://localhost:41234/callback',
  'http://0.0.0.0:41234/callback',
  'https://127.0.0.1:41234/callback',
  'http://127.0.0.1:0/callback',
  'http://127.0.0.1:41234/callback?x=1',
  'http://127.0.0.1:41234/callback#x',
  'http://user@127.0.0.1:41234/callback',
  'http://127.0.0.1:41234/',
])('rejects an unapproved loopback identity %s', uri => {
  expect(() => assertApprovedLoopbackUri(uri)).toThrow('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
});
it('occupied exact callback port fails closed without discovery or another port', async () => {
  const f = await fixture();
  await f.configure();
  const occupied = createServer();
  servers.push(occupied);
  await new Promise<void>(resolve =>
    occupied.listen(
      { host: '127.0.0.1', port: Number(new URL(f.redirect).port), exclusive: true },
      resolve,
    ),
  );
  await expect(f.start()).rejects.toMatchObject({ code: 'FIGMA_MCP_OAUTH_PORT_UNAVAILABLE' });
  expect(f.transport).not.toHaveBeenCalled();
});
it('callback listener rejects method, Host, path and envelope before its private callback seam', async () => {
  const uri = `http://127.0.0.1:${await freePort()}/approved/callback`;
  const callback = vi.fn<(url: string) => Promise<void>>(async () => {});
  const listener = await FigmaOAuthCallbackListener.bind({
    redirectUri: uri,
    deadlineAt: Date.now() + 20_000,
    signal: signal(),
    onCallback: callback,
  });
  listeners.push(listener);
  for (const [destination, options] of [
    [uri, { method: 'POST' }],
    [uri, { host: 'attacker.test' }],
    [uri.replace('/approved/', '/other/'), {}],
    [uri, { headers: { 'content-length': '1' }, body: 'x' }],
  ] as const) {
    expect((await local(destination, options)).status).toBe(400);
  }
  expect(callback).not.toHaveBeenCalled();
  await listener.close();
  await expect(local(uri)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});
it('listener shutdown signal and original deadline close the physical socket', async () => {
  const uri = `http://127.0.0.1:${await freePort()}/approved/callback`;
  const controller = new AbortController();
  const listener = await FigmaOAuthCallbackListener.bind({
    redirectUri: uri,
    deadlineAt: Date.now() + 20_000,
    signal: controller.signal,
    onCallback: async () => {},
  });
  listeners.push(listener);
  controller.abort();
  await listener.close();
  expect(listener.lease.bind(listener)).toThrow('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
  await expect(local(uri)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});
it.each(['redirect', 'cookie', 'oversize', 'body-throw'] as const)(
  'bounded auth transport sanitizes %s responses',
  async mode => {
    const transport = vi.fn<FetchLike>(async () => {
      if (mode === 'redirect')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.test/SECRET_CANARY' },
        });
      if (mode === 'cookie')
        return new Response('{}', {
          headers: { 'content-type': 'application/json', 'set-cookie': 'SECRET_CANARY' },
        });
      if (mode === 'oversize')
        return new Response('x'.repeat(65_537), {
          headers: { 'content-type': 'application/json' },
        });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(Error('BODY_SECRET_CANARY'));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const bounded = boundedFigmaOAuthFetch(transport, {
      purpose: 'metadata',
      deadlineAt: Date.now() + 5_000,
      now: Date.now,
      signal: signal(),
    });
    await expect(
      bounded('https://api.figma.com/.well-known/oauth-authorization-server'),
    ).rejects.toMatchObject({
      message: 'FIGMA_MCP_OAUTH_METADATA_REJECTED',
      code: 'FIGMA_MCP_OAUTH_METADATA_REJECTED',
    });
  },
);
