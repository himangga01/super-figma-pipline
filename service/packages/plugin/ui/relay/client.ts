import {
  ApprovalPromptV1Schema,
  ApprovalDecisionV1Schema,
  type ApprovalPromptV1,
  type ApprovalDecisionV1,
  DocumentBindingRequestSchema,
  DocumentBindingResultSchema,
  type DocumentBindingRequest,
  type DocumentBindingResult,
  type ActivityParams,
  type AuthenticatedHello,
  AuthenticatedHelloResultSchema,
  AuthenticatedHelloSchema,
  createError,
  createEvent,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSES,
  HeartbeatMonitor,
  HelloResultSchema,
  newId,
  PairErrorCodeSchema,
  type PairExchangeResult,
  PairExchangeResultSchema,
  PluginCancelParamsSchema,
  type PluginProgressParams,
  PluginProgressParamsSchema,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@sfp/shared';
import { z } from 'zod';

import { PluginExecutionBindingSchema } from '../../protocol/bridge.js';
import { extractNodeIds } from './node-ids.js';
import { summarizePayload } from './payload.js';
import {
  type ActivityStatus,
  initialRelayState,
  recordCallEnd,
  recordCallStart,
  type RelayClientState,
  type RelayToolExecutionContext,
  type ToolHandler,
} from './state.js';

export type WebSocketCtor = new (url: string) => WebSocket;

export interface RelayClientOptions {
  ports: readonly number[];
  clientVersion: string;
  sessionId?: string;
  host?: string;
  WS?: WebSocketCtor;
  log?: (msg: string) => void;
  helloTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatMaxMisses?: number;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  scheduleDispatch?: (run: () => void) => () => void;
}

export interface RelayHelloSeed {
  provisionalSessionId: string;
  pluginGeneration: string;
}

export type RelayHelloSnapshot = Omit<AuthenticatedHello, 'credential' | 'nonce'>;

export interface PreparedHelloAttempt {
  epoch: number;
  credential: AuthenticatedHello['credential'];
  nonce: string;
  exactHello: AuthenticatedHello;
  sentAt: number;
  recoverUntil: number;
  requestId: string;
  requestSessionId: string;
}

const AuthenticatedPluginHelloResultSchema = HelloResultSchema.extend({
  sessionId: AuthenticatedHelloResultSchema.shape.sessionId,
  rotatedResumeToken: AuthenticatedHelloResultSchema.shape.rotatedResumeToken,
  resumeExpiresAt: AuthenticatedHelloResultSchema.shape.resumeExpiresAt,
}).strict();

export const PLUGIN_FRAME_MAX_BYTES = 67_108_864;
const HELLO_RECOVERY_MS = 5_000;

export const isAdmittedPluginFrame = (data: unknown): data is ArrayBuffer =>
  data instanceof ArrayBuffer && data.byteLength <= PLUGIN_FRAME_MAX_BYTES;

class RelayAuthenticationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RelayAuthenticationError';
  }
}

class RelayTransportUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayTransportUnknownError';
  }
}

const secureToken = (size: number, source?: (size: number) => Uint8Array): string => {
  const bytes = source?.(size) ?? globalThis.crypto?.getRandomValues(new Uint8Array(size));
  if (bytes === undefined || bytes.byteLength !== size)
    throw new RelayAuthenticationError('CRYPTO_UNAVAILABLE');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

// How long a probe waits for the server's $hello reply before abandoning the socket and retrying. A
// healthy leader answers in sub-millisecond on localhost, so a probe that stays silent this long isn't
// a healthy server we're about to reach — it's a port owner mid-handoff (an old leader releasing :3055
// as a new one takes over) or a momentarily CPU-starved event loop. Waiting the old 2s each such
// attempt made a handoff feel like many seconds; 1s halves the per-retry waste while keeping a ~1000×
// margin over a healthy reply, so we never abandon a server that was actually about to answer.
const DEFAULT_HELLO_TIMEOUT_MS = 1_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
/**
 * Cold-start (never-yet-connected) polling is capped far tighter than a true reconnect: when the
 * plugin opened before the server, the user just launched their MCP client and the leader appears
 * within a second, so we want to notice almost immediately. This cap IS the residual latency — once
 * the server is up the plugin connects on its next poll, so the wait averages half this value.
 * Probing the single fixed port is a sub-microsecond refused connection while nothing listens, so
 * polling this fast costs nothing (localhost has no push channel to announce the server — polling
 * is the only way to notice an imminent arrival). A dropped live socket (hasConnected) keeps the
 * gentler exponential ceiling instead — that's a real fault, not an imminent arrival, so no reason
 * to hammer.
 */
const COLD_START_MAX_DELAY_MS = 150;

export class RelayClient {
  private sessionIdValue: string;
  private helloSeedValue: Readonly<RelayHelloSeed> | null = null;
  private helloSnapshot: Readonly<RelayHelloSnapshot> | null = null;
  private credential: AuthenticatedHello['credential'] | null = null;
  private credentialExpiresAt = 0;
  private preparedHello: Readonly<PreparedHelloAttempt> | null = null;
  private connectionEpoch = 0;
  private readonly now: () => number;
  private readonly entropy: ((size: number) => Uint8Array) | undefined;
  private readonly opts: Required<Omit<RelayClientOptions, 'sessionId' | 'now' | 'randomBytes'>>;
  private state: RelayClientState = initialRelayState();
  private socket: WebSocket | null = null;
  private handshakeSocket: WebSocket | null = null;
  private provisionalClose: Readonly<{ socket: WebSocket; cancel(error: Error): void }> | null =
    null;
  private heartbeat: HeartbeatMonitor | null = null;
  private listeners = new Set<(s: RelayClientState) => void>();
  private stopped = false;
  private reconnecting = false;
  /**
   * The in-flight back-off sleep's timer + its resolver, so wake()/disconnect() can cut the sleep
   * short and probe now (or exit). Both null whenever we're not mid-sleep (loop not started, or
   * already probing). settleBackoff() is the single place either one resolves.
   */
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private settleSleep: ((woken: boolean) => void) | null = null;
  /**
   * True once we've established at least one live socket — distinguishes a cold-start retry from a
   * true reconnect.
   */
  private hasConnected = false;
  /**
   * True once a server has refused this build outright — which now means only one thing: a
   * `PROTOCOL_VERSION` mismatch, an envelope format the two sides cannot exchange at all. (Being
   * _older_ than the server is not refused; it connects and every result carries a warning.)
   * Retrying cannot change that answer, so the back-off loop stops instead of running forever.
   *
   * The cost of not stopping is not theoretical: a refused plugin never sets `hasConnected`, so the
   * loop takes the 150ms cold-start ceiling and re-offers the same rejected handshake about seven
   * times a second for as long as the panel is open. Measured at 195 sockets in TIME_WAIT, steady
   * state, from a single tab — which is what ruled out refusing on version skew.
   */
  private refused = false;
  private toolHandler: ToolHandler | null = null;
  private bindingOfferHandler: ((fileKey: string, readOnly: boolean) => void) | null = null;
  private readonly bindingRequests = new Map<
    string,
    {
      resolve(value: DocumentBindingResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private approvalHandler: ((prompt: ApprovalPromptV1) => Promise<ApprovalDecisionV1>) | null =
    null;
  private toolCancelHandler: ((context: RelayToolExecutionContext) => boolean) | null = null;
  private readonly pendingTools = new Map<
    string,
    Readonly<{ context: RelayToolExecutionContext; controller: AbortController }>
  >();
  private readonly progressRates = new Map<string, { startedAt: number; count: number }>();
  private readonly queuedDispatches = new Map<string, () => void>();

  constructor(opts: RelayClientOptions) {
    this.sessionIdValue = opts.sessionId ?? newId();
    this.now = opts.now ?? Date.now;
    this.entropy = opts.randomBytes;
    this.opts = {
      ports: opts.ports,
      clientVersion: opts.clientVersion,
      host: opts.host ?? '127.0.0.1',
      WS: opts.WS ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket!,
      log: opts.log ?? ((): void => {}),
      helloTimeoutMs: opts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatMaxMisses: opts.heartbeatMaxMisses ?? HEARTBEAT_MAX_MISSES,
      reconnectInitialDelayMs: opts.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS,
      reconnectMaxDelayMs: opts.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
      scheduleDispatch:
        opts.scheduleDispatch ??
        (run => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        }),
    };
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get helloSeed(): Readonly<RelayHelloSeed> | null {
    return this.helloSeedValue;
  }

  configureHelloSeed(
    input: Readonly<{
      pluginGeneration: string;
      provisionalSessionId?: string;
    }>,
  ): Readonly<RelayHelloSeed> {
    if (
      typeof input.pluginGeneration !== 'string' ||
      input.pluginGeneration.length < 1 ||
      input.pluginGeneration.length > 256
    ) {
      throw new RelayAuthenticationError('PAIR_GENERATION_MISMATCH');
    }
    const provisionalSessionId = input.provisionalSessionId ?? secureToken(16, this.entropy);
    if (provisionalSessionId.length < 1 || provisionalSessionId.length > 256) {
      throw new RelayAuthenticationError('PAIR_BODY_INVALID');
    }
    if (
      this.helloSeedValue !== null &&
      (this.helloSeedValue.pluginGeneration !== input.pluginGeneration ||
        this.helloSeedValue.provisionalSessionId !== provisionalSessionId)
    ) {
      throw new RelayAuthenticationError('PAIR_GENERATION_MISMATCH');
    }
    this.helloSeedValue = Object.freeze({
      pluginGeneration: input.pluginGeneration,
      provisionalSessionId,
    });
    this.sessionIdValue = provisionalSessionId;
    return this.helloSeedValue;
  }

  getState(): RelayClientState {
    return this.state;
  }

  setToolHandler(handler: ToolHandler | null): void {
    this.toolHandler = handler;
  }

  setApprovalHandler(
    handler: ((prompt: ApprovalPromptV1) => Promise<ApprovalDecisionV1>) | null,
  ): void {
    this.approvalHandler = handler;
  }

  setBindingOfferHandler(handler: ((fileKey: string, readOnly: boolean) => void) | null): void {
    this.bindingOfferHandler = handler;
  }
  requestDocumentBinding(input: DocumentBindingRequest): Promise<DocumentBindingResult> {
    const request = DocumentBindingRequestSchema.parse(input);
    const socket = this.socket;
    if (socket === null || this.state.status !== 'connected')
      return Promise.reject(new Error('PLUGIN_NOT_CONNECTED'));
    if (this.bindingRequests.size > 0) return Promise.reject(new Error('IDENTITY_BOOTSTRAP_BUSY'));
    const id = newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.bindingRequests.delete(id);
        reject(new Error('IDENTITY_BINDING_TIMEOUT'));
      }, 300_000);
      this.bindingRequests.set(id, { resolve, reject, timer });
      try {
        socket.send(
          encodeEnvelope(
            createRequest({
              id,
              sessionId: this.sessionId,
              method: SystemMethod.BindDocument,
              params: request,
            }),
          ),
        );
      } catch (error) {
        clearTimeout(timer);
        this.bindingRequests.delete(id);
        reject(error);
      }
    });
  }
  private clearBindingRequests(): void {
    for (const pending of this.bindingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('IDENTITY_BINDING_DISCONNECTED'));
    }
    this.bindingRequests.clear();
  }

  setToolCancelHandler(handler: ((context: RelayToolExecutionContext) => boolean) | null): void {
    this.toolCancelHandler = handler;
  }

  async connectWithTicket(
    untrustedTicket: PairExchangeResult,
    untrustedHello: RelayHelloSnapshot,
  ): Promise<void> {
    const parsedTicket = PairExchangeResultSchema.safeParse(untrustedTicket);
    if (!parsedTicket.success) throw new RelayAuthenticationError('PAIR_BODY_INVALID');
    const ticket = parsedTicket.data;
    if (ticket.expiresAt <= this.now()) {
      throw new RelayAuthenticationError('PAIR_TICKET_EXPIRED');
    }
    const seed = this.helloSeedValue;
    if (seed === null) throw new RelayAuthenticationError('PAIR_CREDENTIAL_REQUIRED');
    if (untrustedHello.pluginGeneration !== seed.pluginGeneration) {
      throw new RelayAuthenticationError('PAIR_GENERATION_MISMATCH');
    }
    if (
      untrustedHello.fileIdentity.kind === 'unstable-readonly' &&
      (untrustedHello.fileIdentity.sessionId !== seed.provisionalSessionId ||
        untrustedHello.fileIdentity.pluginGeneration !== seed.pluginGeneration)
    ) {
      throw new RelayAuthenticationError('PAIR_GENERATION_MISMATCH');
    }
    const credential = Object.freeze({ kind: 'ticket' as const, value: ticket.wsTicket });
    const parsedHello = AuthenticatedHelloSchema.safeParse({
      ...untrustedHello,
      credential,
      nonce: 'A'.repeat(22),
    });
    if (!parsedHello.success) throw new RelayAuthenticationError('PAIR_BODY_INVALID');
    const verified = parsedHello.data;
    const { credential: _credential, nonce: _nonce, ...hello } = verified;
    this.helloSnapshot = Object.freeze(hello);
    this.credential = credential;
    this.credentialExpiresAt = ticket.expiresAt;
    this.preparedHello = null;
    this.refused = false;
    await this.connect();
    if (this.credential === null && this.state.status !== 'connected') {
      throw new RelayAuthenticationError(this.state.lastError ?? 'PAIR_CREDENTIAL_REQUIRED');
    }
  }

  sendProgress(
    context: RelayToolExecutionContext,
    untrustedProgress: PluginProgressParams,
  ): boolean {
    const socket = this.socket;
    const pending = this.pendingTools.get(context.requestId);
    if (
      socket === null ||
      this.state.status !== 'connected' ||
      pending === undefined ||
      pending.context.operationId !== context.operationId ||
      pending.context.actionNonce !== context.actionNonce ||
      this.queuedDispatches.has(context.requestId) ||
      pending.controller.signal.aborted
    ) {
      return false;
    }
    const progress = PluginProgressParamsSchema.parse(untrustedProgress);
    if (progress.operationId !== context.operationId) return false;
    const now = this.now();
    const observed = this.progressRates.get(context.requestId);
    const rate =
      observed === undefined || now - observed.startedAt >= 1_000
        ? { startedAt: now, count: 0 }
        : observed;
    if (rate.count >= 20) return false;
    rate.count += 1;
    this.progressRates.set(context.requestId, rate);
    const bytes = encodeEnvelope(
      createEvent({
        id: context.requestId,
        sessionId: this.sessionIdValue,
        method: SystemMethod.Progress,
        params: progress,
      }),
    );
    if (bytes.byteLength > 16_384) return false;
    socket.send(bytes);
    return true;
  }

  /**
   * Tell the leader that this session just saw user interaction (sandbox sent a context event for
   * selection/page change). The leader uses this to pick the most-recently-active session when more
   * than one plugin is connected. `params` also carry file + page identity so the leader can report
   * "routed to file X, page Y" back through `ping` — the routing decision and the user-facing label
   * both live on the same signal. Silently no-ops while disconnected.
   */
  notifyActivity(params: ActivityParams): void {
    if (this.socket === null || this.state.status !== 'connected') return;
    this.socket.send(
      encodeEnvelope(
        createEvent({
          id: newId(),
          sessionId: this.sessionId,
          method: SystemMethod.Activity,
          params,
        }),
      ),
    );
  }

  subscribe(fn: (s: RelayClientState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async connect(): Promise<void> {
    if (this.credential === null || this.helloSnapshot === null || this.helloSeedValue === null) {
      return;
    }
    if (
      this.state.status === 'connecting' ||
      this.state.status === 'connected' ||
      this.state.status === 'reconnecting'
    ) {
      return;
    }
    this.stopped = false;
    this.update({ status: 'connecting', lastError: null });

    if (await this.probeAllPorts()) return;

    // No server is listening yet — most commonly the plugin was opened before the MCP server (i.e.
    // before the user's MCP client launched it). Don't treat this as terminal: keep retrying in the
    // background with the same back-off loop used after a live socket drops, so the plugin connects
    // on its own once the server appears. Failing the initial probe is not a reconnect, so the loop
    // must not bump `reconnectCount`.
    // Preserve a specific rejection reason captured during the probe (e.g. a protocol mismatch
    // recorded by attemptPort) — masking it with the generic "no server" message would be wrong when a
    // server was found but turned us away.
    this.update({
      status: 'disconnected',
      port: null,
      // A browser WebSocket can't tell "nothing is listening" from "a non-WebSocket process holds the
      // port", so word this to cover both without over-claiming: it connects on its own once the MCP
      // server starts, and if it never does, a foreign process on that port is the likely culprit.
      lastError:
        this.state.lastError ??
        `no Figwright server on :${this.opts.ports.join(', ')} yet — it connects automatically once ` +
          `the MCP server starts; if it never does, another process may be holding that port`,
    });
    // A typed authentication refusal consumes the credential and cannot be retried.
    if (!this.stopped && !this.refused && this.credential !== null) void this.runReconnectLoop();
  }

  /**
   * Probe the candidate port(s) in order; resolve true on the first successful hello, false if all
   * fail. In production `ports` is just [DEFAULT_PORT]: figwright's leader always binds that one
   * fixed port (the server never hops to a fallback), so there's no range to sweep — a miss simply
   * means the server isn't up yet and the caller retries. Probing that single port is a
   * sub-millisecond refused connection when nothing is listening, which is what lets the reconnect
   * loop poll quickly without ever stalling on an unrelated service that happens to hold a nearby
   * port.
   */
  private async probeAllPorts(): Promise<boolean> {
    for (const port of this.opts.ports) {
      if (this.stopped) return false;
      try {
        // eslint-disable-next-line no-await-in-loop -- probe candidate ports in order
        await this.attemptAuthenticatedPort(port);
        return true;
      } catch (err) {
        this.opts.log(`[relay-client] port ${port} failed: ${(err as Error).message}`);
        if (this.credential === null || this.refused) return false;
      }
    }
    return false;
  }

  async disconnect(options: Readonly<{ forgetCredential?: boolean }> = {}): Promise<void> {
    this.clearBindingRequests();
    this.stopped = true;
    // Cut short any in-flight back-off sleep so the reconnect loop sees `stopped` and exits now instead
    // of waiting out the full delay.
    this.settleBackoff(true);
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.abortPendingTools();
    this.connectionEpoch += 1;
    if (this.handshakeSocket !== null) {
      try {
        this.handshakeSocket.close(1000, 'client disconnect');
      } catch {
        // Continue clearing credentials even when the transport is already invalid.
      }
      this.handshakeSocket = null;
    }
    const provisionalClose = this.provisionalClose;
    if (provisionalClose !== null) {
      try {
        provisionalClose.socket.close(1000, 'client disconnect');
      } catch {
        // The owned close waiter is still settled below.
      }
      provisionalClose.cancel(new RelayAuthenticationError('PAIR_CREDENTIAL_REQUIRED'));
    }
    this.provisionalClose = null;
    if (this.socket !== null) {
      this.socket.close(1000, 'client disconnect');
      this.socket = null;
    }
    const forgetCredential = options.forgetCredential !== false;
    if (forgetCredential) this.clearAuthentication();
    this.update({
      status: 'disconnected',
      sessionResumed: false,
      connectedAt: null,
      ...(forgetCredential ? { lastError: null, versionNotice: null } : {}),
    });
  }

  /**
   * Cut the current reconnect back-off short and probe now. Browsers throttle — and after a few
   * minutes of a hidden tab, freeze — timers, so a back-off sleep that began while the user
   * switched away (e.g. to launch their MCP client) can stall long past when the server actually
   * came up. The UI calls this when the plugin tab returns to the foreground (and on any sandbox
   * context event) to collapse that dead time to ~immediate. No-op unless we're mid-reconnect: a
   * live or in-progress connection needs no nudge, and after disconnect() there's nothing to
   * resume.
   */
  wake(): void {
    if (this.stopped) return;
    if (this.state.status === 'connected' || this.state.status === 'connecting') return;
    this.settleBackoff(true);
  }

  private async attemptAuthenticatedPort(port: number): Promise<void> {
    const first = await this.openAuthenticatedSocket(port);
    if (this.stopped || this.credential === null) {
      first.ws.close(1000, 'authentication superseded');
      throw new RelayAuthenticationError('PAIR_CREDENTIAL_REQUIRED');
    }
    if (
      first.credentialKind === 'ticket' &&
      this.helloSnapshot?.fileIdentity.kind === 'unstable-readonly'
    ) {
      await this.closeProvisionalSocket(first.ws);
      if (this.stopped || this.credential === null) {
        throw new RelayAuthenticationError('PAIR_CREDENTIAL_REQUIRED');
      }
      const resumed = await this.openAuthenticatedSocket(port);
      if (this.stopped || this.credential === null) {
        resumed.ws.close(1000, 'authentication superseded');
        throw new RelayAuthenticationError('PAIR_CREDENTIAL_REQUIRED');
      }
      if (resumed.result.sessionId !== first.result.sessionId) {
        resumed.ws.close(1008, 'session identity mismatch');
        this.clearAuthentication();
        throw new RelayAuthenticationError('PAIR_RESUME_INVALID');
      }
      this.publishLiveSocket(port, resumed.ws, resumed.result);
      return;
    }
    this.publishLiveSocket(port, first.ws, first.result);
  }

  private openAuthenticatedSocket(port: number): Promise<{
    ws: WebSocket;
    result: z.infer<typeof AuthenticatedPluginHelloResultSchema>;
    credentialKind: AuthenticatedHello['credential']['kind'];
  }> {
    return new Promise((resolve, reject) => {
      const ws = new this.opts.WS(`ws://${this.opts.host}:${port}`);
      const socketEpoch = ++this.connectionEpoch;
      this.handshakeSocket = ws;
      ws.binaryType = 'arraybuffer';
      let sent = false;
      let attempt: Readonly<PreparedHelloAttempt> | null = null;
      let settled = false;

      const cleanup = (): void => {
        ws.onopen = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onclose = null;
        clearTimeout(timer);
        if (this.handshakeSocket === ws) this.handshakeSocket = null;
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {
          // The transport is already unusable.
        }
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new RelayTransportUnknownError(`hello timeout on port ${port}`)),
        this.opts.helloTimeoutMs,
      );

      ws.onopen = () => {
        try {
          attempt = this.prepareHelloAttempt();
          sent = true;
          ws.send(
            encodeEnvelope(
              createRequest({
                id: attempt.requestId,
                sessionId: attempt.requestSessionId,
                method: SystemMethod.Hello,
                params: attempt.exactHello,
              }),
            ),
          );
        } catch (error) {
          fail(error as Error);
        }
      };
      ws.onerror = () => fail(new RelayTransportUnknownError(`socket error on port ${port}`));
      ws.onclose = () =>
        fail(
          new RelayTransportUnknownError(
            sent
              ? `socket closed after hello on port ${port}`
              : `socket closed before hello on port ${port}`,
          ),
        );
      ws.onmessage = (event: MessageEvent) => {
        if (socketEpoch !== this.connectionEpoch) return;
        let envelope: Envelope;
        try {
          envelope = this.decodeSocketFrame(event.data);
        } catch {
          this.failAuthentication('PAIR_BODY_INVALID');
          fail(new RelayAuthenticationError('PAIR_BODY_INVALID'));
          return;
        }
        if (attempt === null || socketEpoch !== this.connectionEpoch) return;
        if (envelope.kind !== 'res' && envelope.kind !== 'err') return;
        if (envelope.id !== attempt.requestId) {
          this.failAuthentication('PAIR_BODY_INVALID');
          fail(new RelayAuthenticationError('PAIR_BODY_INVALID'));
          return;
        }
        if (envelope.kind === 'err') {
          if (envelope.v !== PROTOCOL_VERSION || envelope.sessionId !== attempt.requestSessionId) {
            this.failAuthentication('PAIR_BODY_INVALID');
            fail(new RelayAuthenticationError('PAIR_BODY_INVALID'));
            return;
          }
          const parsedCode = PairErrorCodeSchema.safeParse(envelope.error.code);
          const code =
            envelope.error.code === ErrorCode.ProtocolMismatch
              ? ErrorCode.ProtocolMismatch
              : parsedCode.success
                ? parsedCode.data
                : 'PAIR_BODY_INVALID';
          this.refused = code === ErrorCode.ProtocolMismatch;
          this.failAuthentication(code);
          fail(new RelayAuthenticationError(code));
          return;
        }
        const parsed = AuthenticatedPluginHelloResultSchema.safeParse(envelope.result);
        if (
          !parsed.success ||
          envelope.v !== PROTOCOL_VERSION ||
          envelope.sessionId !== parsed.data.sessionId ||
          parsed.data.protocolVersion !== PROTOCOL_VERSION ||
          (attempt.credential.kind === 'resume' && parsed.data.sessionId !== this.sessionIdValue)
        ) {
          this.failAuthentication('PAIR_BODY_INVALID');
          fail(new RelayAuthenticationError('PAIR_BODY_INVALID'));
          return;
        }
        settled = true;
        cleanup();
        this.acceptHelloSuccess(attempt, parsed.data);
        resolve({ ws, result: parsed.data, credentialKind: attempt.credential.kind });
      };
    });
  }

  private prepareHelloAttempt(): Readonly<PreparedHelloAttempt> {
    const now = this.now();
    if (this.preparedHello !== null) {
      if (now < this.preparedHello.recoverUntil) return this.preparedHello;
      this.failAuthentication('PAIR_RESUME_EXPIRED');
      throw new RelayAuthenticationError('PAIR_RESUME_EXPIRED');
    }
    const credential = this.credential;
    const hello = this.helloSnapshot;
    if (credential === null || hello === null || now >= this.credentialExpiresAt) {
      const code = credential?.kind === 'resume' ? 'PAIR_RESUME_EXPIRED' : 'PAIR_TICKET_EXPIRED';
      this.failAuthentication(code);
      throw new RelayAuthenticationError(code);
    }
    const nonce = secureToken(16, this.entropy);
    const parsedHello = AuthenticatedHelloSchema.safeParse({ ...hello, credential, nonce });
    if (!parsedHello.success) {
      this.failAuthentication('PAIR_BODY_INVALID');
      throw new RelayAuthenticationError('PAIR_BODY_INVALID');
    }
    const exactHello = parsedHello.data;
    const attempt = Object.freeze({
      epoch: this.connectionEpoch,
      credential,
      nonce,
      exactHello,
      sentAt: now,
      recoverUntil: Math.min(this.credentialExpiresAt, now + HELLO_RECOVERY_MS),
      requestId: newId(),
      requestSessionId: this.sessionIdValue,
    });
    this.preparedHello = attempt;
    return attempt;
  }

  private acceptHelloSuccess(
    attempt: Readonly<PreparedHelloAttempt>,
    result: z.infer<typeof AuthenticatedPluginHelloResultSchema>,
  ): void {
    if (this.preparedHello !== attempt) return;
    this.preparedHello = null;
    this.credential = Object.freeze({ kind: 'resume', value: result.rotatedResumeToken });
    this.credentialExpiresAt = result.resumeExpiresAt;
    this.sessionIdValue = result.sessionId;
    if (this.helloSnapshot?.fileIdentity.kind === 'unstable-readonly') {
      this.helloSnapshot = Object.freeze({
        ...this.helloSnapshot,
        fileIdentity: Object.freeze({
          ...this.helloSnapshot.fileIdentity,
          sessionId: result.sessionId,
        }),
      });
    }
  }

  private closeProvisionalSocket(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onclose = null;
        ws.onerror = null;
        if (this.provisionalClose?.socket === ws) this.provisionalClose = null;
        if (error === undefined) resolve();
        else reject(error);
      };
      const timer = setTimeout(
        () => {
          this.failAuthentication('PAIR_RESUME_EXPIRED');
          finish(new RelayAuthenticationError('PAIR_RESUME_EXPIRED'));
        },
        Math.min(this.opts.helloTimeoutMs, HELLO_RECOVERY_MS),
      );
      this.provisionalClose = Object.freeze({ socket: ws, cancel: finish });
      ws.onmessage = null;
      ws.onerror = () => {
        try {
          ws.close(1000, 'provisional close failed');
        } catch {
          this.failAuthentication('PAIR_RESUME_EXPIRED');
          finish(new RelayAuthenticationError('PAIR_RESUME_EXPIRED'));
        }
      };
      ws.onopen = null;
      ws.onclose = () => finish();
      try {
        ws.close(1000, 'provisional hello complete');
      } catch {
        this.failAuthentication('PAIR_RESUME_EXPIRED');
        finish(new RelayAuthenticationError('PAIR_RESUME_EXPIRED'));
        return;
      }
      if (ws.readyState === 3) finish();
    });
  }

  private publishLiveSocket(
    port: number,
    ws: WebSocket,
    result: z.infer<typeof AuthenticatedPluginHelloResultSchema>,
  ): void {
    this.hasConnected = true;
    this.refused = false;
    this.socket = ws;
    this.startHeartbeat(ws);
    this.bindLiveHandlers(ws);
    this.update({
      status: 'connected',
      port,
      sessionResumed: result.sessionResumed,
      serverVersion: result.serverVersion,
      lastError: null,
      versionNotice: result.skewNotice ?? null,
      connectedAt: this.now(),
    });
    this.opts.log(`[relay-client] connected to :${port} (resumed=${result.sessionResumed})`);
  }

  private decodeSocketFrame(data: unknown): Envelope {
    if (!isAdmittedPluginFrame(data)) {
      throw new RelayAuthenticationError('PAYLOAD_TOO_LARGE');
    }
    return decodeEnvelope(data);
  }

  private bindLiveHandlers(ws: WebSocket): void {
    const liveEpoch = this.connectionEpoch;
    const current = (): boolean => this.socket === ws && this.connectionEpoch === liveEpoch;
    ws.onmessage = (msgEvt: MessageEvent) => {
      if (!current()) return;
      let env: Envelope;
      try {
        env = this.decodeSocketFrame(msgEvt.data);
      } catch {
        ws.close(1008, 'invalid authenticated frame');
        return;
      }
      if (env.v !== PROTOCOL_VERSION || env.sessionId !== this.sessionIdValue) {
        ws.close(1008, 'session identity mismatch');
        return;
      }
      this.heartbeat?.notifyReceived();
      if ((env.kind === 'res' || env.kind === 'err') && this.bindingRequests.has(env.id)) {
        const pending = this.bindingRequests.get(env.id)!;
        this.bindingRequests.delete(env.id);
        clearTimeout(pending.timer);
        if (env.kind === 'err') pending.reject(new Error(env.error.message));
        else {
          const result = DocumentBindingResultSchema.safeParse(env.result);
          if (result.success) pending.resolve(result.data);
          else pending.reject(new Error('IDENTITY_BINDING_INVALID'));
        }
        return;
      }
      if (env.kind === 'req' && env.method === SystemMethod.BindingOffer) {
        const value = z
          .object({
            fileKey: DocumentBindingRequestSchema.shape.fileKey,
            readOnly: z.boolean().default(true),
          })
          .strict()
          .safeParse(env.params);
        if (!value.success || this.bindingOfferHandler === null) {
          ws.send(
            encodeEnvelope(
              createError({
                id: env.id,
                sessionId: env.sessionId,
                code: 'IDENTITY_BINDING_UNAVAILABLE',
                message: 'identity setup UI unavailable',
              }),
            ),
          );
        } else {
          this.bindingOfferHandler(value.data.fileKey, value.data.readOnly);
          ws.send(
            encodeEnvelope(
              createResponse({ id: env.id, sessionId: env.sessionId, result: { offered: true } }),
            ),
          );
        }
        return;
      }
      if (env.kind === 'req' && env.method === SystemMethod.Ping) {
        ws.send(
          encodeEnvelope(
            createResponse({ id: env.id, sessionId: env.sessionId, result: { ok: true } }),
          ),
        );
        return;
      }
      if (env.kind === 'evt' && env.method === SystemMethod.Cancel) {
        const parsed = PluginCancelParamsSchema.safeParse(env.params);
        if (!parsed.success) return;
        const pending = [...this.pendingTools.values()].find(
          entry =>
            entry.context.operationId === parsed.data.operationId &&
            entry.context.actionNonce === parsed.data.actionNonce,
        );
        if (pending === undefined || pending.controller.signal.aborted) return;
        pending.controller.abort();
        const cancelQueued = this.queuedDispatches.get(pending.context.requestId);
        if (cancelQueued !== undefined) {
          try {
            cancelQueued();
          } catch {
            // Queue ownership is still removed below; a throwing canceller cannot revive dispatch.
          }
          this.queuedDispatches.delete(pending.context.requestId);
          this.pendingTools.delete(pending.context.requestId);
          this.progressRates.delete(pending.context.requestId);
          return;
        }
        this.toolCancelHandler?.(pending.context);
        return;
      }
      if (env.kind === 'req' && env.method === SystemMethod.Approval) {
        const prompt = ApprovalPromptV1Schema.safeParse(env.params);
        const handler = this.approvalHandler;
        if (
          !prompt.success ||
          prompt.data.channel !== 'plugin-session' ||
          prompt.data.expiresAt <= this.now() ||
          handler === null
        ) {
          ws.send(
            encodeEnvelope(
              createError({
                id: env.id,
                sessionId: env.sessionId,
                code: 'APPROVAL_CHANNEL_UNAVAILABLE',
                message: 'approval prompt unavailable or expired',
              }),
            ),
          );
          return;
        }
        void Promise.resolve()
          .then(() => handler(prompt.data))
          .then(input => {
            const decision = ApprovalDecisionV1Schema.parse(input);
            if (
              decision.approvalId !== prompt.data.approvalId ||
              decision.operationId !== prompt.data.operationId ||
              decision.promptHash !== prompt.data.promptHash
            )
              throw new Error('APPROVAL_HASH_MISMATCH');
            if (current())
              ws.send(
                encodeEnvelope(
                  createResponse({ id: env.id, sessionId: env.sessionId, result: decision }),
                ),
              );
            return undefined;
          })
          .catch(() => {
            if (current())
              ws.send(
                encodeEnvelope(
                  createError({
                    id: env.id,
                    sessionId: env.sessionId,
                    code: 'APPROVAL_REJECTED',
                    message: 'approval was cancelled or expired',
                  }),
                ),
              );
          });
        return;
      }
      if (env.kind === 'req') {
        const binding = PluginExecutionBindingSchema.safeParse({
          requestId: env.id,
          operationId: env.operationId,
          actionNonce: env.actionNonce,
        });
        if (!binding.success) {
          ws.send(
            encodeEnvelope(
              createError({
                id: env.id,
                sessionId: env.sessionId,
                code: ErrorCode.InvalidRequest,
                message: 'tool request requires one exact execution binding',
              }),
            ),
          );
          return;
        }
        const context = Object.freeze(binding.data);
        if (
          this.pendingTools.has(context.requestId) ||
          [...this.pendingTools.values()].some(
            pending =>
              pending.context.operationId === context.operationId &&
              pending.context.actionNonce === context.actionNonce,
          )
        ) {
          ws.send(
            encodeEnvelope(
              createError({
                id: env.id,
                sessionId: env.sessionId,
                code: ErrorCode.InvalidRequest,
                message: 'duplicate active tool request',
              }),
            ),
          );
          return;
        }
        const controller = new AbortController();
        this.pendingTools.set(context.requestId, Object.freeze({ context, controller }));
        let started = false;
        try {
          const cancel = this.opts.scheduleDispatch(() => {
            started = true;
            this.queuedDispatches.delete(context.requestId);
            const currentPending = this.pendingTools.get(context.requestId);
            if (
              !current() ||
              currentPending?.controller !== controller ||
              controller.signal.aborted
            ) {
              return;
            }
            void this.dispatchToolRequest(
              ws,
              env.id,
              env.sessionId,
              env.method,
              env.params,
              context,
              controller,
            );
          });
          if (!started) this.queuedDispatches.set(context.requestId, cancel);
        } catch {
          this.pendingTools.delete(context.requestId);
          ws.send(
            encodeEnvelope(
              createError({
                id: env.id,
                sessionId: env.sessionId,
                code: ErrorCode.Internal,
                message: 'tool dispatch scheduling failed',
              }),
            ),
          );
        }
        return;
      }
      this.opts.log(`[relay-client] <- ${env.kind} ${'method' in env ? env.method : ''}`);
    };
    ws.onclose = () => {
      if (!current()) return;
      this.clearBindingRequests();
      this.heartbeat?.stop();
      this.heartbeat = null;
      this.socket = null;
      this.abortPendingTools();
      this.update({ status: 'disconnected', sessionResumed: false, connectedAt: null });
      if (!this.stopped) void this.runReconnectLoop();
    };
    ws.onerror = () => {
      if (!current()) return;
      this.update({ lastError: 'socket error' });
    };
  }

  private async dispatchToolRequest(
    ws: WebSocket,
    id: string,
    sessionId: string,
    method: string,
    params: unknown,
    context: RelayToolExecutionContext,
    controller: AbortController,
  ): Promise<void> {
    this.update(
      recordCallStart(this.state, {
        id,
        method,
        startedAt: Date.now(),
        ...(method.startsWith('$identity.') ? {} : { request: summarizePayload(params) }),
        nodeIds: extractNodeIds(params),
      }),
    );
    const handler = this.toolHandler;
    if (handler === null) {
      const message = `no tool handler registered (method=${method})`;
      this.opts.log(`[relay-client] ${message}`);
      this.settle(id, 'error', { error: message });
      ws.send(
        encodeEnvelope(createError({ id, sessionId, code: ErrorCode.MethodNotFound, message })),
      );
      this.pendingTools.delete(id);
      this.progressRates.delete(id);
      return;
    }
    try {
      const result = await handler(method, params, context);
      if (controller.signal.aborted) return;
      // A create call only names the node it made in its result, so fold those ids in too.
      this.settle(id, 'ok', {
        ...(method.startsWith('$identity.') ? {} : { payload: summarizePayload(result) }),
        nodeIds: extractNodeIds(result),
      });
      ws.send(encodeEnvelope(createResponse({ id, sessionId, result })));
      // Sending the reply proves we're alive. Encoding a huge result blocks this single thread, so the
      // heartbeat's setInterval couldn't fire meanwhile; that coalesced tick runs right after this
      // synchronous block. Reset the clock now (before it runs) so it doesn't read the stall as death
      // and self-close the socket. Single-threaded ordering guarantees this lands first.
      this.heartbeat?.notifyReceived();
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`[relay-client] tool handler threw for ${method}: ${message}`);
      this.settle(id, 'error', { error: message });
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        ['PLUGIN_PARTIAL_CHANGE', 'UNDO_FAILED'].includes(String(err.code))
          ? String(err.code)
          : ErrorCode.Internal;
      ws.send(encodeEnvelope(createError({ id, sessionId, code, message })));
      this.heartbeat?.notifyReceived();
    } finally {
      if (this.pendingTools.get(id)?.controller === controller) {
        this.pendingTools.delete(id);
        this.progressRates.delete(id);
      }
    }
  }

  /** Stamp a settled call with the wall clock and fold its outcome into the recent list. */
  private settle(
    id: string,
    status: ActivityStatus,
    outcome: Omit<Parameters<typeof recordCallEnd>[1], 'id' | 'status' | 'settledAt'>,
  ): void {
    this.update(recordCallEnd(this.state, { id, status, settledAt: Date.now(), ...outcome }));
  }

  private async runReconnectLoop(): Promise<void> {
    if (this.reconnecting || this.stopped || this.refused || this.credential === null) return;
    this.reconnecting = true;
    // A live socket that dropped is a true reconnect; retrying a never-established cold-start connect
    // is not. Capture the distinction now so a successful retry only bumps `reconnectCount` in the
    // former case (keeps the diagnostic count honest), and so cold-start uses the tighter ceiling —
    // the server is imminent, so we probe more eagerly. (hasConnected only flips false→true, and a
    // successful probe returns, so it's stable for this loop's lifetime.)
    const countSuccessAsReconnect = this.hasConnected;
    const maxDelay = this.hasConnected ? this.opts.reconnectMaxDelayMs : COLD_START_MAX_DELAY_MS;
    try {
      let attempt = 0;
      while (!this.stopped && this.credential !== null) {
        const delay = Math.min(this.opts.reconnectInitialDelayMs * 2 ** attempt, maxDelay);
        this.update({ status: 'reconnecting' });
        // eslint-disable-next-line no-await-in-loop -- back-off pacing requires sequential awaits
        const woken = await this.backoffSleep(delay);
        if (this.stopped) return;
        // eslint-disable-next-line no-await-in-loop -- back-off pacing requires sequential awaits
        if (await this.probeAllPorts()) {
          if (countSuccessAsReconnect) {
            this.update({ reconnectCount: this.state.reconnectCount + 1 });
          }
          return;
        }
        // That probe reached a server that cannot exchange envelopes with this build at all.
        // Retrying re-offers the same handshake to the same answer, so leave the loop and let the
        // banner stand until the plugin is replaced.
        if (this.refused) {
          this.update({ status: 'disconnected' });
          return;
        }
        // A wake (tab refocus) means the user is back and expecting a live connection — restart the
        // back-off from the floor so we keep probing quickly rather than easing back to the ceiling.
        attempt = woken ? 0 : attempt + 1;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Sleep `ms`, or resolve early if wake()/disconnect() fires. Resolves true when cut short, false
   * on a natural timeout — the loop resets its back-off on a wake so a post-foreground probe starts
   * fast.
   */
  private backoffSleep(ms: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.settleSleep = resolve;
      this.wakeTimer = setTimeout(() => this.settleBackoff(false), ms);
    });
  }

  /**
   * Resolve the in-flight back-off sleep exactly once, from whichever source fires first — the
   * timer (woken=false) or wake()/disconnect() (woken=true). Nulling `settleSleep` first makes it
   * idempotent, so the losing source is a no-op. Also the single place the pending timer is
   * cleared.
   */
  private settleBackoff(woken: boolean): void {
    const resolve = this.settleSleep;
    if (resolve === null) return;
    this.settleSleep = null;
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    resolve(woken);
  }

  private startHeartbeat(ws: WebSocket): void {
    this.heartbeat?.stop();
    this.heartbeat = new HeartbeatMonitor({
      intervalMs: this.opts.heartbeatIntervalMs,
      maxMisses: this.opts.heartbeatMaxMisses,
      sendPing: () => {
        ws.send(
          encodeEnvelope(
            createRequest({
              id: newId(),
              sessionId: this.sessionId,
              method: SystemMethod.Ping,
            }),
          ),
        );
      },
      onTimeout: () => {
        this.opts.log('[relay-client] heartbeat timeout, closing socket');
        ws.close(4000, 'heartbeat timeout');
      },
    });
    this.heartbeat.start();
  }

  private abortPendingTools(): void {
    const queued = new Set(this.queuedDispatches.keys());
    for (const cancel of this.queuedDispatches.values()) {
      try {
        cancel();
      } catch {
        // Continue aborting every owned entry even if one scheduler canceller is faulty.
      }
    }
    this.queuedDispatches.clear();
    for (const [requestId, pending] of this.pendingTools) {
      if (!pending.controller.signal.aborted) pending.controller.abort();
      if (!queued.has(requestId)) {
        try {
          this.toolCancelHandler?.(pending.context);
        } catch {
          // One faulty sandbox cancellation must not retain or revive later owned entries.
        }
      }
    }
    this.pendingTools.clear();
    this.progressRates.clear();
  }

  private clearAuthentication(): void {
    this.credential = null;
    this.credentialExpiresAt = 0;
    this.preparedHello = null;
    this.helloSnapshot = null;
  }

  private failAuthentication(code: string): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.abortPendingTools();
    this.clearAuthentication();
    this.update({
      status: 'disconnected',
      port: null,
      sessionResumed: false,
      connectedAt: null,
      lastError: code,
      versionNotice: code === ErrorCode.ProtocolMismatch ? code : null,
    });
  }

  private update(partial: Partial<RelayClientState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn(this.state);
  }
}
