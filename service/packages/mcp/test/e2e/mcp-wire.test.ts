import { type ChildProcess, spawn } from 'node:child_process';
import { once as onExit } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve as resolvePath } from 'node:path';

import {
  ALL_DATA_CLASSES,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  hashEgressConfig,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
  type EgressConfigV1,
  type Envelope,
  type ResponseEnvelope,
} from '@sfp/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { leaderLockPath } from '../../src/election/leader-lock.js';
import { createEgressConfigStore } from '../../src/policy/policy-engine.js';
import { PROMPT_DEFINITIONS } from '../../src/prompts/registry.js';
import { createStatePermissions } from '../../src/security/state-permissions.js';
import { annotationsFor } from '../../src/tools/annotations.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';
import { toToolDefinition } from '../tool-schema.js';
import { closeSocket, connectFakePlugin } from './_helpers.js';

// The wire gate. Everything else in this repo checks the server from the inside: `tool-schema.ts`
// re-derives JSON Schema with Zod, the other e2e tests drive the relay and never start an MCP
// server at all. None of that observes what an MCP client actually receives — and the SDK is a
// *runtime* dependency that generates every tool's schema and negotiates the protocol version, so
// an SDK release can move the wire while `tsc` stays green. This test is the only thing standing
// between that and a shipped regression.
//
// It speaks raw newline-delimited JSON-RPC at the built dist over real stdio, deliberately NOT
// through the SDK's own `Client`: a probe built out of the package under test can hide that
// package's regression, because both sides move together and the comparison stays silent.
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');

/** What a current client offers. The server may counter-offer; both outcomes are asserted below. */
const LATEST_CLIENT_PROTOCOL = '2025-11-25';
/** The oldest revision the MCP spec still defines — the back-compat floor we promise older clients. */
const OLDEST_CLIENT_PROTOCOL = '2024-11-05';
/** The 2026-era revision `serveStdio` negotiates when a client claims it in its request envelope. */
const MODERN_CLIENT_PROTOCOL = '2026-07-28';

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

const within = <T>(promise: Promise<T>, timeoutMs: number, message: () => string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message())), timeoutMs);
      timer.unref();
    }),
  ]);

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface WireClientOptions {
  port?: number;
  stateBase?: string;
}

const removeTemporaryStateBase = (stateBase: string): void => {
  const temporaryRoot = resolvePath(tmpdir());
  const candidate = resolvePath(stateBase);
  const fromTemporary = relative(temporaryRoot, candidate);
  if (
    fromTemporary === '' ||
    fromTemporary === '..' ||
    fromTemporary.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error('refusing to remove a wire-test path outside the OS temporary directory');
  }
  rmSync(candidate, { recursive: true, force: true });
};

/** A live MCP server process plus the raw JSON-RPC channel to it. */
class WireClient {
  private child!: ChildProcess;
  private buffer = '';
  private readonly pending = new Map<number, (r: JsonRpcResponse) => void>();
  private nextId = 1;
  stderr = '';
  /** Relay port this server owns, so a test can attach a plugin to the process it is driving. */
  port = 0;
  private stateBase = '';
  private stateRoot = '';
  private ownsStateBase = false;

  constructor(
    readonly seedEgress = true,
    private readonly options: Readonly<WireClientOptions> = {},
  ) {}

  egressMode(): string {
    const path = join(this.stateRoot, 'egress.v1.json');
    if (!existsSync(path)) return 'missing';
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as {
      config?: { mode?: unknown };
    };
    return typeof envelope.config?.mode === 'string' ? envelope.config.mode : 'invalid';
  }

  durableInvocationBytes(): number {
    const journal = join(this.stateRoot, 'journal');
    if (!existsSync(journal)) return 0;
    return readdirSync(journal)
      .filter(
        name =>
          name.endsWith('.operations.v1.jsonl') ||
          name.endsWith('.operation-tombstones.v1.jsonl') ||
          name.endsWith('.egress-manifests.v1.jsonl') ||
          name.endsWith('.operation-evidence.v1.jsonl'),
      )
      .reduce((bytes, name) => bytes + statSync(join(journal, name)).size, 0);
  }

  async start(): Promise<void> {
    const port = this.options.port ?? (await freePort());
    this.port = port;
    this.stateBase = this.options.stateBase ?? mkdtempSync(join(tmpdir(), 'sfp-wire-state-'));
    this.ownsStateBase = this.options.stateBase === undefined;
    const environment: Record<string, string | undefined> = {
      ...process.env,
      FIGWRIGHT_PORT: String(port),
    };
    if (process.platform === 'win32') {
      environment.LOCALAPPDATA = this.stateBase;
      this.stateRoot = join(this.stateBase, 'SuperFigmaPipeline');
    } else if (process.platform === 'darwin') {
      environment.HOME = this.stateBase;
      const applicationSupport = join(this.stateBase, 'Library', 'Application Support');
      mkdirSync(applicationSupport, { recursive: true, mode: 0o700 });
      this.stateRoot = join(applicationSupport, 'SuperFigmaPipeline');
    } else {
      environment.XDG_STATE_HOME = this.stateBase;
      this.stateRoot = join(this.stateBase, 'super-figma-pipeline');
    }
    mkdirSync(this.stateRoot, { recursive: true, mode: 0o700 });
    if (this.seedEgress) await this.seedLocalTrustedEgress(environment);
    this.child = spawn(process.execPath, [DIST_ENTRY], {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderr += d.toString('utf8');
    });
    this.child.stdout?.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8');
      // Newline-delimited JSON is the stdio binding's framing; anything that isn't a response to a
      // request we sent (notifications, stray output) is ignored rather than failing the parse.
      for (let nl = this.buffer.indexOf('\n'); nl !== -1; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line === '') continue;
        const msg = JSON.parse(line) as JsonRpcResponse;
        const resolve = this.pending.get(msg.id);
        if (resolve !== undefined) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  private async seedLocalTrustedEgress(
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<void> {
    const permissions = createStatePermissions(this.stateRoot, {
      environment,
      ...(process.platform === 'darwin' ? { homeDirectory: this.stateBase } : {}),
    });
    await permissions.ensureSecure(this.stateRoot);
    await permissions.verifySecure(this.stateRoot);
    const store = createEgressConfigStore(this.stateRoot, permissions);
    const current = await store.load();
    const withoutHash = {
      schemaVersion: 1 as const,
      mode: 'local-trusted' as const,
      allowedClasses: ALL_DATA_CLASSES,
      consentId: null,
      configuredAt: '2026-08-31T00:00:00.000Z',
      expiresAt: null,
    };
    const next: EgressConfigV1 = {
      ...withoutHash,
      configHash: hashEgressConfig(withoutHash),
    };
    await store.save(next, current.config.configHash);
  }

  async pairTicket(): Promise<string> {
    const credentials = JSON.parse(
      readFileSync(join(this.stateRoot, 'leader-auth.json'), 'utf8'),
    ) as { generation: string; controlToken: string };
    const controlHeaders = {
      authorization: `Bearer ${credentials.controlToken}`,
      'x-sfp-leader-generation': credentials.generation,
    };
    const challengeResponse = await fetch(`http://127.0.0.1:${this.port}/control/pair/challenge`, {
      method: 'POST',
      headers: controlHeaders,
    });
    if (!challengeResponse.ok) {
      throw new Error(`control pair challenge failed (${challengeResponse.status})`);
    }
    const challenge = (await challengeResponse.json()) as { challengeId: string; code: string };
    const exchangeResponse = await fetch(`http://127.0.0.1:${this.port}/pair/exchange`, {
      method: 'POST',
      headers: { origin: 'null', 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.code }),
    });
    if (!exchangeResponse.ok) {
      throw new Error(`pair exchange failed (${exchangeResponse.status})`);
    }
    const exchange = (await exchangeResponse.json()) as { wsTicket: string };
    return exchange.wsTicket;
  }

  async publicPing(): Promise<Record<string, unknown>> {
    const response = await fetch(`http://127.0.0.1:${this.port}/ping`);
    if (!response.ok) throw new Error(`public ping failed (${response.status})`);
    return (await response.json()) as Record<string, unknown>;
  }

  async controlStatus(): Promise<Record<string, unknown>> {
    const credentials = JSON.parse(
      readFileSync(join(this.stateRoot, 'leader-auth.json'), 'utf8'),
    ) as { generation: string; controlToken: string };
    const response = await fetch(`http://127.0.0.1:${this.port}/control/status`, {
      headers: {
        authorization: `Bearer ${credentials.controlToken}`,
        'x-sfp-leader-generation': credentials.generation,
      },
    });
    if (!response.ok) throw new Error(`control status failed (${response.status})`);
    return (await response.json()) as Record<string, unknown>;
  }

  private cleanupState(): void {
    if (this.stateBase === '') return;
    if (this.ownsStateBase) removeTemporaryStateBase(this.stateBase);
    this.stateBase = '';
    this.stateRoot = '';
    this.ownsStateBase = false;
  }

  begin(
    method: string,
    params: Record<string, unknown> = {},
  ): { id: number; response: Promise<JsonRpcResponse> } {
    const id = this.nextId++;
    const wait = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}\nstderr:\n${this.stderr}`));
      }, 15_000);
      timer.unref();
      this.pending.set(id, r => {
        clearTimeout(timer);
        resolve(r);
      });
    });
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return { id, response: wait };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    return this.begin(method, params).response;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.child.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`,
    );
  }

  operationAuthorityLines(operationId: string): string[] {
    const journal = join(this.stateRoot, 'journal');
    if (!existsSync(journal)) return [];
    return readdirSync(journal)
      .filter(
        name =>
          name.endsWith('.operations.v1.jsonl') || name.endsWith('.operation-tombstones.v1.jsonl'),
      )
      .flatMap(name => readFileSync(join(journal, name), 'utf8').split('\n').filter(Boolean))
      .filter(line => line.includes(operationId));
  }

  /** The opening exchange, returning the server's `initialize` result. */
  async handshake(protocolVersion: string): Promise<Record<string, unknown>> {
    const res = await this.send('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'figwright-wire-gate', version: '0' },
    });
    if (res.result === undefined) {
      throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
    }
    this.notify('notifications/initialized');
    return res.result;
  }

  /**
   * Closes stdin — the real "client went away" signal — and waits for the process to actually go,
   * reporting how it went. Returning the exit code rather than swallowing it is the point: a
   * SIGKILL escalation that silently rescued a stuck shutdown would let a hang pass as a pass.
   */
  async stop(): Promise<{ code: number | null; escalated: boolean }> {
    // Each spawned server leaves a leader note for the random port it owned (election/leader-lock).
    // Production overwrites one file per port forever; a suite would otherwise leave one behind per
    // server, per run, on every dev machine and CI runner. Done here rather than in a hook because
    // this file creates WireClients inside individual tests too, not only in beforeAll.
    rmSync(leaderLockPath(this.port), { force: true });
    if (this.child.exitCode !== null) {
      const result = { code: this.child.exitCode, escalated: false };
      this.cleanupState();
      return result;
    }
    // Subscribe before closing stdin, so a server that exits immediately can't be missed.
    const exited = onExit(this.child, 'exit');
    this.child.stdin?.end();
    let escalated = false;
    const escalate = setTimeout(() => {
      escalated = true;
      this.child.kill('SIGKILL');
    }, 5_000);
    escalate.unref();
    try {
      const [code] = (await exited) as [number | null];
      return { code, escalated };
    } finally {
      clearTimeout(escalate);
      this.cleanupState();
    }
  }
}

interface AdvertisedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Stable stringify for comparing two JSON Schemas. Member order carries no meaning in JSON Schema
 * and the SDK does not promise one — it emits `type` before `$schema` where Zod emits the reverse —
 * so comparing raw `JSON.stringify` output would fail on a difference no client can observe.
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );

describe.skipIf(!existsSync(DIST_ENTRY))('MCP wire contract (built dist)', () => {
  let client: WireClient;
  let failClosedClient: WireClient;
  let initResult: Record<string, unknown>;
  let tools: AdvertisedTool[];

  beforeAll(async () => {
    client = new WireClient();
    failClosedClient = new WireClient(false);
    await Promise.all([client.start(), failClosedClient.start()]);
    [initResult] = await Promise.all([
      client.handshake(LATEST_CLIENT_PROTOCOL),
      failClosedClient.handshake(LATEST_CLIENT_PROTOCOL),
    ]);
    const res = await client.send('tools/list');
    tools = (res.result?.tools ?? []) as AdvertisedTool[];
    await Promise.all([client.controlStatus(), failClosedClient.controlStatus()]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([client?.stop(), failClosedClient?.stop()]);
  });

  it('negotiates the protocol version and advertises its capabilities', () => {
    expect(initResult.protocolVersion).toBe(LATEST_CLIENT_PROTOCOL);
    expect(initResult.serverInfo).toMatchObject({ name: 'figwright' });
    // Both primitives Figwright serves must be advertised, or a client never lists them.
    expect(initResult.capabilities).toMatchObject({ tools: {}, prompts: {} });
  });

  it('answers the transport-level ping this era still defines', async () => {
    // The protocol method, not the `ping` tool this server also exposes — clients use it as a
    // liveness probe, and the spec has the receiver answer promptly or risk being dropped. It is
    // also the cleanest probe for era dispatch: the SDK's 2025 method registry lists `ping` and its
    // 2026 one deletes it, so this assertion and its counterpart in the 2026 test below are the
    // only things here that prove `serveStdio` serves two different method sets rather than one
    // superset. Every other method this file exercises exists in both eras.
    const res = await client.send('ping');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({});
  });

  it('exposes exactly the seven public daemon identity fields over HTTP', async () => {
    expect(Object.keys(await client.publicPing()).toSorted()).toEqual([
      'buildId',
      'leaderGeneration',
      'ok',
      'product',
      'protocolVersion',
      'role',
      'serverVersion',
    ]);
  });

  it('sends instructions a client can fold into the model prompt', () => {
    // The only channel that reaches every client. Claude Code users get this guidance from the
    // skills; Cursor and Codex users get it from nowhere else, and without it the likeliest first
    // move on a design is to eyeball an image — the one failure this project exists to prevent.
    const instructions = initResult.instructions as string | undefined;
    expect(instructions).toBeTypeOf('string');
    expect(instructions).toContain('get_design_context');
    expect(instructions).toContain('get_screenshot');
    // Clients may put this in the system prompt of every session, so its size is a running cost.
    expect(instructions?.length).toBeLessThan(2_000);

    // Every tool it names must exist. Guidance that points at a renamed or removed tool is worse
    // than none: the model follows it and calls something that is not there.
    const cited = [...new Set([...(instructions ?? '').matchAll(/`([a-z_]+)`/g)].map(m => m[1]))];
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter(name => !tools.some(t => t.name === name))).toEqual([]);
  });

  it('advertises exactly the registered tool set', () => {
    expect(tools.map(t => t.name).toSorted()).toEqual(ALL_TOOL_SPECS.map(s => s.name).toSorted());
  });

  it('advertises each tool with the JSON Schema its spec declares', () => {
    // The expected side is derived from the spec's own schema independently of the SDK, so this catches an
    // SDK release that changes schema generation — the failure mode with no other gate in the repo.
    // Report the first real difference rather than a bare list of names: when this fails, what
    // matters is *how* the generated schema moved, and that is what the next audit needs to read.
    const mismatched = ALL_TOOL_SPECS.flatMap(spec => {
      const advertised = tools.find(t => t.name === spec.name);
      const expected = toToolDefinition(spec);
      if (advertised === undefined) return [{ tool: spec.name, got: '<not advertised>', want: '' }];
      const got = canonical(advertised.inputSchema);
      const want = canonical(expected.inputSchema);
      if (advertised.description === expected.description && got === want) return [];
      return [{ tool: spec.name, got, want }];
    });
    expect(mismatched.slice(0, 2)).toEqual([]);
  });

  it('advertises the JSON Schema dialect the current spec revision expects', () => {
    const dialects = new Set(tools.map(t => t.inputSchema.$schema));
    expect([...dialects]).toEqual(['https://json-schema.org/draft/2020-12/schema']);
  });

  it('advertises the annotation values each tool kind is supposed to carry', () => {
    // Pinned as literals on purpose. The check below compares the wire against `annotationsFor`,
    // which cannot tell a correct derivation from a broken one — flip the function and both sides
    // move together and it stays green. These are what the MCP spec means, so they are what the
    // wire has to say: a client uses readOnly/destructive to shape confirmation, idempotent to
    // judge repeat safety, and openWorld to distinguish the conditional URL-import surface.
    const advertised = (name: string): unknown => tools.find(t => t.name === name)?.annotations;
    expect(advertised('get_node')).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(advertised('analyze_project')).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(advertised('set_fills')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(advertised('delete_nodes')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(advertised('save_screenshots')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(advertised('import_image')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(advertised('navigate_to_page')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('advertises annotations derived from each spec', () => {
    const mismatched = ALL_TOOL_SPECS.filter(
      spec =>
        JSON.stringify(tools.find(t => t.name === spec.name)?.annotations) !==
        JSON.stringify(annotationsFor(spec)),
    );
    expect(mismatched.map(s => s.name)).toEqual([]);
  });

  it('advertises every registered prompt with its argument list', async () => {
    const res = await client.send('prompts/list');
    const prompts = (res.result?.prompts ?? []) as { name: string }[];
    expect(prompts.map(p => p.name)).toEqual(PROMPT_DEFINITIONS.map(p => p.name));
    expect(prompts).toEqual(PROMPT_DEFINITIONS.map(p => expect.objectContaining({ ...p })));
  });

  it('answers a real tools/call without a plugin connected', async () => {
    const res = await client.send('tools/call', { name: 'ping', arguments: {} });
    const content = res.result?.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    // ping answers from the server itself, so it reports server-only reachability and no plugin —
    // proof the handler ran end to end rather than the SDK short-circuiting the call.
    expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      hop: 'server-only',
      plugin: null,
      server: { role: 'leader' },
    });
  });

  it('has explicit local-trusted owner state before successful tool calls', () => {
    expect(client.egressMode()).toBe('local-trusted');
  });

  it('keeps a missing default fail-closed with a durable pre-egress row and no runtime', async () => {
    expect(failClosedClient.egressMode()).toBe('missing');
    const response = await failClosedClient.send('tools/call', {
      name: 'ping',
      arguments: {},
    });
    expect(response.result?.isError).toBe(true);
    const content = response.result?.content as { text: string }[];
    expect(content.map(row => row.text).join('')).toMatch(/egress is not explicitly configured/i);
    expect(failClosedClient.durableInvocationBytes()).toBeGreaterThan(0);
  });

  it('warns on a real tools/call when the connected plugin is out of date', async () => {
    // The assembled product, over real stdio, against a real plugin socket. Every piece of this had
    // unit coverage and the wiring in index.ts had none: deleting the append there left all 1387
    // tests green. A warning that is not actually attached reaches nobody.
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const wsTicket = await server.pairTicket();
    const plugin = await connectFakePlugin({
      port: server.port,
      credential: { kind: 'ticket', value: wsTicket },
      clientVersion: '0.0.1',
      handlers: { get_selection: () => ({ pageId: '1:1', pageName: 'Page 1', nodes: [] }) },
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });
      const content = res.result?.content as { type: string; text: string }[];

      // The result the agent asked for is untouched and still first.
      expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ pageName: 'Page 1' });
      // The warning rides alongside it, not inside it.
      expect(content).toHaveLength(2);
      expect(content[1]?.text).toMatch(/OUT OF DATE/);
      expect(content[1]?.text).toMatch(/older than this server/i);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('explains a METHOD_NOT_FOUND from an out-of-date plugin instead of leaving it bare', async () => {
    // What an old plugin does loudest: nine tools in the last shipped build have no handler in it.
    // Bare, that error reads as "this tool is broken" and the agent goes looking for another way
    // round; attributed, the user gets told to update.
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const wsTicket = await server.pairTicket();
    const plugin = await connectFakePlugin({
      port: server.port,
      credential: { kind: 'ticket', value: wsTicket },
      clientVersion: '0.0.1',
      // No handler for the tool called below — exactly what a plugin that predates it does.
      handlers: {},
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });

      expect(res.result?.isError).toBe(true);
      const content = res.result?.content as { type: string; text: string }[];
      const text = content.map(c => c.text).join('');
      expect(text).toMatch(/OUT OF DATE/);
      expect(text).toMatch(/older than this server/i);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('leaves a real tools/call alone when the plugin is current', async () => {
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const wsTicket = await server.pairTicket();
    const plugin = await connectFakePlugin({
      port: server.port,
      credential: { kind: 'ticket', value: wsTicket },
      handlers: { get_selection: () => ({ pageId: '1:1', pageName: 'Page 1', nodes: [] }) },
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });
      const content = res.result?.content as { type: string; text: string }[];

      expect(content).toHaveLength(1);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('turns a real MCP request abort into one Relay cancel and one durable unknown terminal', async () => {
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const ticket = await server.pairTicket();
    const sessionId = newId();
    const plugin = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { origin: 'null' });
    await new Promise<void>((resolve, reject) => {
      plugin.once('open', () => resolve());
      plugin.once('error', reject);
    });
    let resolveHello!: (value: ResponseEnvelope) => void;
    let resolveInvocation!: (value: Envelope) => void;
    let resolveCancel!: (value: Envelope) => void;
    const hello = new Promise<ResponseEnvelope>(resolve => {
      resolveHello = resolve;
    });
    const invocation = new Promise<Envelope>(resolve => {
      resolveInvocation = resolve;
    });
    const cancellation = new Promise<Envelope>(resolve => {
      resolveCancel = resolve;
    });
    plugin.on('message', raw => {
      const envelope = decodeEnvelope(raw as Uint8Array);
      if (envelope.kind === 'res' && envelope.id === 'mcp-cancel-hello') {
        resolveHello(envelope);
        return;
      }
      if (envelope.kind === 'req' && envelope.method === SystemMethod.Ping) {
        plugin.send(
          encodeEnvelope(
            createResponse({
              id: envelope.id,
              sessionId: envelope.sessionId,
              result: { ok: true },
            }),
          ),
        );
        return;
      }
      if (envelope.kind === 'req' && envelope.method === 'get_selection') {
        resolveInvocation(envelope);
        return;
      }
      if (envelope.kind === 'evt' && envelope.method === SystemMethod.Cancel) {
        resolveCancel(envelope);
      }
    });
    plugin.send(
      encodeEnvelope(
        createRequest({
          id: 'mcp-cancel-hello',
          sessionId,
          method: SystemMethod.Hello,
          params: {
            credential: { kind: 'ticket', value: ticket },
            nonce: Buffer.alloc(16, 2).toString('base64url'),
            protocolVersion: PROTOCOL_VERSION,
            productVersion: '0.1.0',
            pluginVersion: MIN_PLUGIN_VERSION,
            pluginGeneration: 'plugin-generation-mcp-cancel',
            editorType: 'figma',
            mode: 'default',
            fileIdentity: { kind: 'figma-file-key', value: 'file-key-mcp-cancel' },
            fileName: 'MCP Cancel',
            capabilities: [],
          },
        }),
      ),
    );
    await hello;

    let call: { id: number; response: Promise<JsonRpcResponse> } | undefined;
    let pluginRequest: Envelope | undefined;
    let failure: unknown;
    try {
      call = server.begin('tools/call', { name: 'get_selection', arguments: {} });
      pluginRequest = await invocation;
      if (pluginRequest.kind !== 'req')
        throw new Error('plugin request was not a request envelope');
      server.notify('notifications/cancelled', {
        requestId: call.id,
        reason: 'test request abort',
      });
      const cancel = await Promise.race([
        cancellation,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('actual MCP abort did not reach Relay cancel')),
            1_000,
          );
          timer.unref();
        }),
      ]);
      expect(pluginRequest).toMatchObject({
        operationId: expect.any(String),
        actionNonce: expect.any(String),
      });
      expect(cancel).toMatchObject({
        kind: 'evt',
        method: SystemMethod.Cancel,
        params: {
          operationId: pluginRequest.operationId,
          actionNonce: pluginRequest.actionNonce,
        },
      });

      plugin.send(
        encodeEnvelope(
          createResponse({
            id: pluginRequest.id,
            sessionId: pluginRequest.sessionId,
            result: { pageId: '1:1', pageName: 'late', nodes: [] },
          }),
        ),
      );
      void call.response.catch(() => undefined);
      const operationId = String(pluginRequest.operationId);
      await vi.waitFor(() => {
        const authorities = server.operationAuthorityLines(operationId);
        const terminals = authorities.filter(line =>
          /"status":"(?:pre-egress-rejected|rejected|succeeded|failed|outcome-unknown|resolved-applied|resolved-not-applied|abandoned)"/u.test(
            line,
          ),
        );
        expect(terminals).toHaveLength(1);
        expect(terminals[0]).toContain('"status":"outcome-unknown"');
      });
    } catch (error) {
      failure = error;
    } finally {
      if (pluginRequest?.kind === 'req') {
        plugin.send(
          encodeEnvelope(
            createResponse({
              id: pluginRequest.id,
              sessionId: pluginRequest.sessionId,
              result: { pageId: '1:1', pageName: 'cleanup', nodes: [] },
            }),
          ),
        );
      }
      void call?.response.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 25));
      closeSocket(plugin);
      await server.stop();
    }
    if (failure !== undefined) throw failure;
  }, 30_000);

  it('cancels a real follower-role MCP call through the matching authenticated authority', async () => {
    const sharedPort = await freePort();
    const sharedStateBase = mkdtempSync(join(tmpdir(), 'sfp-wire-follower-state-'));
    const leader = new WireClient(true, { port: sharedPort, stateBase: sharedStateBase });
    const follower = new WireClient(false, { port: sharedPort, stateBase: sharedStateBase });
    let leaderStarted = false;
    let followerStarted = false;
    let plugin: WebSocket | undefined;
    let call: { id: number; response: Promise<JsonRpcResponse> } | undefined;
    let pluginRequest: Envelope | undefined;
    let failure: unknown;
    try {
      await leader.start();
      leaderStarted = true;
      await leader.handshake(LATEST_CLIENT_PROTOCOL);
      await leader.controlStatus();

      await follower.start();
      followerStarted = true;
      await follower.handshake(LATEST_CLIENT_PROTOCOL);
      expect(follower.stderr).toContain('became FOLLOWER');

      const ticket = await leader.pairTicket();
      const sessionId = newId();
      plugin = new WebSocket(`ws://127.0.0.1:${sharedPort}/ws`, { origin: 'null' });
      await new Promise<void>((resolve, reject) => {
        plugin?.once('open', () => resolve());
        plugin?.once('error', reject);
      });
      let resolveHello!: (value: ResponseEnvelope) => void;
      let resolveInvocation!: (value: Envelope) => void;
      let resolveCancel!: (value: Envelope) => void;
      const hello = new Promise<ResponseEnvelope>(resolve => {
        resolveHello = resolve;
      });
      const invocation = new Promise<Envelope>(resolve => {
        resolveInvocation = resolve;
      });
      const cancellation = new Promise<Envelope>(resolve => {
        resolveCancel = resolve;
      });
      let cancellationCount = 0;
      plugin.on('message', raw => {
        const envelope = decodeEnvelope(raw as Uint8Array);
        if (envelope.kind === 'res' && envelope.id === 'follower-mcp-cancel-hello') {
          resolveHello(envelope);
          return;
        }
        if (envelope.kind === 'req' && envelope.method === SystemMethod.Ping) {
          plugin?.send(
            encodeEnvelope(
              createResponse({
                id: envelope.id,
                sessionId: envelope.sessionId,
                result: { ok: true },
              }),
            ),
          );
          return;
        }
        if (envelope.kind === 'req' && envelope.method === 'get_selection') {
          resolveInvocation(envelope);
          return;
        }
        if (envelope.kind === 'evt' && envelope.method === SystemMethod.Cancel) {
          cancellationCount += 1;
          resolveCancel(envelope);
        }
      });
      plugin.send(
        encodeEnvelope(
          createRequest({
            id: 'follower-mcp-cancel-hello',
            sessionId,
            method: SystemMethod.Hello,
            params: {
              credential: { kind: 'ticket', value: ticket },
              nonce: Buffer.alloc(16, 3).toString('base64url'),
              protocolVersion: PROTOCOL_VERSION,
              productVersion: '0.1.0',
              pluginVersion: MIN_PLUGIN_VERSION,
              pluginGeneration: 'plugin-generation-follower-mcp-cancel',
              editorType: 'figma',
              mode: 'default',
              fileIdentity: { kind: 'figma-file-key', value: 'file-key-follower-mcp-cancel' },
              fileName: 'Follower MCP Cancel',
              capabilities: [],
            },
          }),
        ),
      );
      await within(
        hello,
        5_000,
        () =>
          `follower cancel plugin hello timed out\nleader:\n${leader.stderr}\nfollower:\n${follower.stderr}`,
      );

      call = follower.begin('tools/call', { name: 'get_selection', arguments: {} });
      pluginRequest = await within(
        invocation,
        10_000,
        () =>
          `follower cancel invocation timed out\nleader:\n${leader.stderr}\nfollower:\n${follower.stderr}`,
      );
      if (pluginRequest.kind !== 'req') {
        throw new Error('follower plugin request was not a request envelope');
      }
      follower.notify('notifications/cancelled', {
        requestId: call.id,
        reason: 'test follower request abort',
      });
      const cancelEnvelope = await Promise.race([
        cancellation,
        call.response.then(response => {
          throw new Error(
            `follower MCP response settled before Relay cancel: ${JSON.stringify(response)}\n` +
              `leader:\n${leader.stderr}\nfollower:\n${follower.stderr}`,
          );
        }),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  `follower MCP abort did not reach Relay cancel\n` +
                    `leader:\n${leader.stderr}\nfollower:\n${follower.stderr}`,
                ),
              ),
            5_000,
          );
          timer.unref();
        }),
      ]);
      expect(pluginRequest).toMatchObject({
        operationId: expect.any(String),
        actionNonce: expect.any(String),
      });
      expect(cancelEnvelope).toMatchObject({
        kind: 'evt',
        sessionId: pluginRequest.sessionId,
        method: SystemMethod.Cancel,
        params: {
          operationId: pluginRequest.operationId,
          actionNonce: pluginRequest.actionNonce,
        },
      });

      plugin.send(
        encodeEnvelope(
          createResponse({
            id: pluginRequest.id,
            sessionId: pluginRequest.sessionId,
            result: { pageId: '1:1', pageName: 'late follower result', nodes: [] },
          }),
        ),
      );
      void call.response.catch(() => undefined);
      const operationId = String(pluginRequest.operationId);
      await vi.waitFor(() => {
        const authorities = leader.operationAuthorityLines(operationId);
        const terminals = authorities.filter(line =>
          /"status":"(?:pre-egress-rejected|rejected|succeeded|failed|outcome-unknown|resolved-applied|resolved-not-applied|abandoned)"/u.test(
            line,
          ),
        );
        expect(terminals).toHaveLength(1);
        expect(terminals[0]).toContain('"status":"outcome-unknown"');
      });
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(cancellationCount).toBe(1);
    } catch (error) {
      failure = error;
    } finally {
      if (pluginRequest?.kind === 'req') {
        plugin?.send(
          encodeEnvelope(
            createResponse({
              id: pluginRequest.id,
              sessionId: pluginRequest.sessionId,
              result: { pageId: '1:1', pageName: 'cleanup', nodes: [] },
            }),
          ),
        );
      }
      void call?.response.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 25));
      if (plugin !== undefined) closeSocket(plugin);
      if (followerStarted) await follower.stop();
      if (leaderStarted) await leader.stop();
      removeTemporaryStateBase(sharedStateBase);
    }
    if (failure !== undefined) throw failure;
  }, 60_000);

  it('surfaces a bad-argument call as a tool error the model can read, not a transport failure', async () => {
    const res = await client.send('tools/call', {
      name: 'get_node',
      arguments: { nodeId: 42 },
    });
    // isError keeps the failure inside the tool result so the model sees it and can correct itself;
    // a JSON-RPC error would surface as a client-level failure instead.
    expect(res.result?.isError).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('rejects a call to a tool it does not advertise', async () => {
    const res = await client.send('tools/call', { name: 'no_such_tool', arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });

  it('still serves a client that opens with the oldest supported protocol revision', async () => {
    // Clients ship wildly different SDK versions; the failure mode of a protocol-constant change is
    // exactly that an older client stops being served, and it is invisible from the newest one.
    const old = new WireClient();
    await old.start();
    try {
      const result = await old.handshake(OLDEST_CLIENT_PROTOCOL);
      expect(result.protocolVersion).toBe(OLDEST_CLIENT_PROTOCOL);
      const res = await old.send('tools/list');
      expect((res.result?.tools as unknown[] | undefined)?.length).toBe(ALL_TOOL_SPECS.length);
    } finally {
      await old.stop();
    }
  }, 30_000);

  it('serves the 2026-07-28 revision to a client that claims it', async () => {
    // This is the whole reason `src/index.ts` hands a factory to `serveStdio` instead of wiring a
    // `StdioServerTransport` itself: the era is chosen per connection from the opening exchange.
    // On stdio there is no header layer, so the signal is the request's `_meta` envelope claim — a
    // claim-less message is 2025-era traffic and never reaches the modern arm.
    const modern = new WireClient();
    await modern.start();
    try {
      const meta = {
        'io.modelcontextprotocol/protocolVersion': MODERN_CLIENT_PROTOCOL,
        'io.modelcontextprotocol/clientCapabilities': {},
      };
      const discover = await modern.send('server/discover', { _meta: meta });
      expect(discover.result?.supportedVersions).toEqual([MODERN_CLIENT_PROTOCOL]);
      expect(discover.result?.capabilities).toMatchObject({ tools: {}, prompts: {} });

      // The same registrations must serve both eras — a modern client sees the identical tool set.
      const res = await modern.send('tools/list', { _meta: meta });
      expect((res.result?.tools as unknown[] | undefined)?.length).toBe(ALL_TOOL_SPECS.length);

      // ...but the method set is not the same: 2026-07-28 deleted `ping`, so the era has to
      // withhold it. Serving it here would mean era selection degraded into a union of both
      // registries — a change `tsc` cannot see, since neither registry is a type this repo names.
      const gone = await modern.send('ping', { _meta: meta });
      expect(gone.result).toBeUndefined();
      expect(gone.error?.code).toBe(-32_601);
    } finally {
      await modern.stop();
    }
  }, 30_000);

  it('exits cleanly when the client goes away mid-session', async () => {
    // The transport is owned by `serveStdio`, which pins a server instance for the connection and
    // has to be closed on the way out. Shutdown also tears down the relay, and this process holds
    // the port until it exits — a shutdown that stalls here is the zombie-leader failure that
    // `lifecycle.ts` exists to prevent, one layer down from where `process-lifecycle.test.ts`
    // checks it (that one never opens an MCP session, so it never has an instance to close).
    const live = new WireClient();
    await live.start();
    await live.handshake(LATEST_CLIENT_PROTOCOL);
    await live.send('tools/call', { name: 'ping', arguments: {} });

    const started = Date.now();
    const { code, escalated } = await live.stop();
    expect(escalated).toBe(false);
    expect(code).toBe(0);
    // The hard-exit backstop fires at 5s; a graceful exit should be far inside that.
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 30_000);
});
