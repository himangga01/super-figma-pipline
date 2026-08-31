import type { Server as HttpServer } from 'node:http';

import {
  ActivityParamsSchema,
  AuthenticatedHelloSchema,
  type AuthenticatedHelloResult,
  createError,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  checkPluginCompatibility,
  type Envelope,
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSES,
  HeartbeatMonitor,
  type HelloResult,
  newId,
  pluginSkewNotice,
  pluginSkewSummary,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@sfp/shared';
import { WebSocketServer, type WebSocket } from 'ws';

import { isAllowedHost, isAllowedWsOrigin } from '../security/local-access.js';
import { WS_FRAME_MAX_BYTES } from '../security/request-limits.js';
import { DEFAULT_DISCONNECT_GRACE_MS, type Session, SessionManager } from './session.js';

export interface RelayAuthenticator {
  authenticateHello?(
    input: unknown,
    context: { requestedSessionId: string },
  ): Promise<AuthenticatedHelloResult>;
  prepareHello?(input: unknown): Promise<{
    preparationId: string;
    result: AuthenticatedHelloResult;
  }>;
  commitHello?(preparationId: string, signal?: AbortSignal): Promise<void>;
  drain?(): Promise<void>;
}

export interface RelayOptions {
  serverVersion: string;
  server: HttpServer;
  log?: (msg: string) => void;
  heartbeatIntervalMs?: number;
  heartbeatMaxMisses?: number;
  disconnectGraceMs?: number;
  maxPayloadBytes?: number;
  helloTimeoutMs?: number;
  decodeFrame?: (bytes: Uint8Array) => Envelope;
  /** Test seam after provisional registration and before the hello response write. */
  beforeHelloResponse?: () => Promise<void>;
  authenticator: RelayAuthenticator;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  params: unknown;
  dispatched: boolean;
  // When set, this request is pinned to one session: it only dispatches/flushes to that session,
  // never to whoever happens to be most-active. Used to keep a multi-call tool's sub-calls together.
  pinnedSessionId: string | undefined;
  // The session this request was actually dispatched to (set in dispatchPending). Scanned by
  // sessionHasInflight so a busy plugin's heartbeat timeout is deferred rather than closing the socket.
  dispatchedToSessionId: string | undefined;
  // Filled with that session as the response lands, and read by the awaiting caller — per request,
  // so concurrent calls cannot observe each other's. See sendRequest's `onServed`.
  served: { sessionId: string | undefined };
}

export const DEFAULT_PLUGIN_REQUEST_TIMEOUT_MS = 30_000;

export class Relay {
  readonly sessions = new SessionManager();
  private readonly wss: WebSocketServer;
  private readonly opts: Required<Omit<RelayOptions, 'server'>>;
  private readonly pending = new Map<string, Pending>();
  private heartbeatDeferrals = 0;
  private lastRequestAtMs = 0;
  private readonly helloTasks = new Set<Promise<void>>();

  constructor(opts: RelayOptions) {
    this.opts = {
      serverVersion: opts.serverVersion,
      log: opts.log ?? (() => {}),
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatMaxMisses: opts.heartbeatMaxMisses ?? HEARTBEAT_MAX_MISSES,
      disconnectGraceMs: opts.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS,
      maxPayloadBytes: opts.maxPayloadBytes ?? WS_FRAME_MAX_BYTES,
      helloTimeoutMs: opts.helloTimeoutMs ?? 5_000,
      decodeFrame: opts.decodeFrame ?? decodeEnvelope,
      beforeHelloResponse: opts.beforeHelloResponse ?? (async () => {}),
      authenticator: opts.authenticator,
    };
    this.wss = new WebSocketServer({
      server: opts.server,
      path: '/ws',
      maxPayload: this.opts.maxPayloadBytes,
      // Refuse the upgrade before it becomes a session: an accepted socket can claim a plugin
      // identity via $hello and then win routing via $activity, which would put a web page between
      // the agent and the real file.
      verifyClient: ({ req }, done) => {
        if (req.url !== '/ws') {
          this.opts.log('[relay] refused WebSocket upgrade for a non-exact path');
          done(false, 403, 'Forbidden');
          return;
        }
        if (!isAllowedHost(req.headers.host)) {
          this.opts.log('[relay] refused WebSocket upgrade (HOST_REJECTED)');
          done(false, 403, 'Forbidden');
          return;
        }
        const origin = req.headers.origin;
        if (isAllowedWsOrigin(origin)) {
          done(true);
          return;
        }
        this.opts.log('[relay] refused WebSocket upgrade (ORIGIN_REJECTED)');
        done(false, 403, 'Forbidden');
      },
    });
    this.wss.on('connection', socket => this.handleConnection(socket));
  }

  async stop(): Promise<void> {
    for (const [, p] of this.pending) {
      this.clearPending(p);
      p.reject(new Error(`relay stopping (pending ${p.method})`));
    }
    this.pending.clear();
    this.sessions.clear();
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await Promise.allSettled(this.helloTasks);
    await this.opts.authenticator.drain?.();
    await new Promise<void>(resolve => this.wss.close(() => resolve()));
  }

  async sendRequest(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_PLUGIN_REQUEST_TIMEOUT_MS,
    sessionId?: string,
    /**
     * Called with the session that served this request, once it is answered.
     *
     * Recorded per request as the response lands, then invoked here — after the await, inside
     * `sendRequest`'s own async context, which is the caller's. Both halves of that matter and each
     * was got wrong once:
     *
     * - Recording per request rather than in a shared "who served last?" field means two concurrent
     *   calls to plugins on different builds cannot read each other's answer.
     * - Invoking it _here_ rather than from the socket handler is what lets the caller attribute the
     *   result at all. The handler runs in the socket's async context, so anything context-scoped a
     *   caller set up (`captureSkew`) is invisible from there — a callback fired at that point
     *   reaches nobody, which is precisely what shipped until an end-to-end test caught it.
     */
    onServed?: (servingSessionId: string | undefined) => void,
    // Dispatched cancellation is bound to one operation/action nonce and never retried.
    // A transport subscriber disconnect remains independent from operation cancellation.
    // Plugins that finish after cancellation are reconciled as outcome-unknown by the executor.
    cancellation?: RelayCancellation,
  ): Promise<unknown> {
    const id = newId();
    this.lastRequestAtMs = Date.now();
    const served: { sessionId: string | undefined } = { sessionId: undefined };
    try {
      return await new Promise<unknown>((resolve, reject) => {
        if (cancellation?.signal.aborted === true) return reject(cancellation.signal.reason);
        const timer = setTimeout(() => {
          // Attributed like any other outcome: the call reached a plugin, it just never answered.
          // An old plugin is a plausible cause rather than a bystander here — `get_design_context`
          // arms its pre-serialization bail with `budget`, one of the arguments such a plugin drops,
          // so a large tree it would have refused up front gets serialized in full instead. Without
          // this the agent reads a bare timeout and blames the size of the file.
          const pending = this.takePending(id);
          if (pending !== undefined) served.sessionId = pending.dispatchedToSessionId;
          reject(new Error(`plugin request timeout (method=${method})`));
        }, timeoutMs);
        const entry: Pending = {
          resolve,
          reject,
          timer,
          method,
          params,
          dispatched: false,
          pinnedSessionId: sessionId,
          dispatchedToSessionId: undefined,
          served,
        };
        this.pending.set(id, entry);
        this.bindCancellation(id, entry, cancellation);

        if (sessionId !== undefined) {
          // Pinned: route only to this session. If it's fully gone (not even within the disconnect
          // grace window) fail fast — silently re-routing to another plugin is the drift bug we're
          // fixing. If it exists but is momentarily socket-less, queue and flushQueue will deliver it
          // when that same session reconnects (session ids survive resume).
          const target = this.sessions.get(sessionId);
          if (target === undefined) {
            this.takePending(id);
            reject(
              new Error(`pinned session not connected (sessionId=${sessionId}, method=${method})`),
            );
            return;
          }
          if (target.socket !== null && target.state === 'connected') {
            this.dispatchPending(id, entry, target);
          } else {
            this.opts.log(`[relay] queued ${method} (pinned session ${sessionId} reconnecting)`);
          }
          return;
        }

        const session = this.pickActiveSession();
        if (session !== undefined && session.socket !== null) {
          this.dispatchPending(id, entry, session);
        } else {
          this.opts.log(`[relay] queued ${method} (no plugin connected)`);
        }
      });
    } finally {
      // In `finally`, so a failed call is attributed too. The loudest thing an out-of-date plugin
      // does is answer METHOD_NOT_FOUND for a tool it predates — nine of them for the last shipped
      // build — and an unattributed one reads as "this tool is broken", which is the same
      // misdirection as a silent wrong write, just noisier.
      onServed?.(served.sessionId);
    }
  }

  /**
   * The skew warning for one session, or null when that plugin is current.
   *
   * Takes a session id rather than looking up the active one, because with two Figma files open on
   * different plugin builds "the active session" can differ between dispatching a call and
   * answering it — and a warning attributed to the wrong plugin is worse than none. Callers that
   * have just made a request pass the session that served it (see sendRequest's `onServed`); `ping`
   * passes the one it is reporting on.
   */
  skewNotice(sessionId: string | undefined): string | null {
    if (sessionId === undefined) return null;
    const session = this.sessions.get(sessionId);
    if (session === undefined) return null;
    if (checkPluginCompatibility(session.clientVersion, this.opts.serverVersion)) return null;
    // Full once per session, then the one-liner. The plugin cannot change under a session, so
    // restating ~120 tokens on every call of a fifty-call codegen run spends thousands of them on
    // one unchanging fact — and identical text repeated every turn is what teaches a model to skim
    // past it, so paying that cost would also blunt the warning. The short form still carries both
    // versions and the consequence, so a caller that only ever sees it is not misinformed.
    if (session.skewExplained) {
      return pluginSkewSummary(session.clientVersion, this.opts.serverVersion);
    }
    session.skewExplained = true;
    return pluginSkewNotice(session.clientVersion, this.opts.serverVersion);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  queuedCount(): number {
    let n = 0;
    for (const [, p] of this.pending) if (!p.dispatched) n += 1;
    return n;
  }

  /** How many heartbeat timeouts were deferred because the session was mid-request (busy ≠ dead). */
  heartbeatDeferralCount(): number {
    return this.heartbeatDeferrals;
  }

  /**
   * Epoch ms of the most recent sendRequest, 0 if none yet. The abdication handler uses it as a
   * quiet-window signal: a multi-call tool has idle moments _between_ sub-calls where pendingCount
   * is 0, and abdicating in one of those gaps would strand the tool's remaining pinned sub-calls on
   * the takeover window. Recent traffic means "probably mid-sequence — not now".
   */
  lastRequestAt(): number {
    return this.lastRequestAtMs;
  }

  /**
   * Does this session have a request that was dispatched to it and hasn't resolved yet? Scanned
   * (not counted) so it can't desync across resolve/reject/timeout/stop. A plugin busy encoding a
   * huge reply can't answer pings but isn't dead; its in-flight request bounds the deferral — the
   * request's own timer is the backstop, so a plugin that truly died mid-request is still reaped
   * once that fires.
   */
  private sessionHasInflight(sessionId: string): boolean {
    for (const [, p] of this.pending) {
      if (p.dispatched && p.dispatchedToSessionId === sessionId) return true;
    }
    return false;
  }

  /**
   * Pick the connected session with the highest `lastActivityAt`. When the user opens the plugin in
   * a newly-focused Figma file, that fresh session wins routing over an older idle one — the effect
   * a user expects when they "switch which file Claude is looking at". With one plugin it's just
   * that plugin; with N it's the most-recently-active.
   */
  pickActiveSession(): Session | undefined {
    let best: Session | undefined;
    for (const s of this.sessions.connected()) {
      if (best === undefined || s.lastActivityAt > best.lastActivityAt) best = s;
    }
    return best;
  }

  /**
   * The id of the session routing would currently pick. A multi-call tool resolves this once up
   * front and then pins every sub-call to it, so the group can't drift across plugins if activity
   * flips mid-flight. Returns undefined when no plugin is connected (caller falls back to unpinned
   * live routing, which is the right cold-start behavior).
   */
  pickActiveSessionId(): string | undefined {
    return this.pickActiveSession()?.id;
  }

  private dispatchPending(id: string, entry: Pending, session: Session): void {
    if (session.socket === null) return;
    entry.dispatched = true;
    entry.dispatchedToSessionId = session.id;
    session.socket.send(encodeEnvelope(this.createPluginRequest(id, entry, session.id)));
  }

  private flushQueue(session: Session): void {
    if (session.socket === null) return;
    let flushed = 0;
    for (const [id, entry] of this.pending) {
      if (entry.dispatched) continue;
      // A pinned request only flushes to its own session — never to whichever plugin reconnects
      // first. An unpinned queued request flushes to whoever shows up.
      if (entry.pinnedSessionId !== undefined && entry.pinnedSessionId !== session.id) continue;
      this.dispatchPending(id, entry, session);
      flushed += 1;
    }
    if (flushed > 0)
      this.opts.log(`[relay] flushed ${flushed} queued request(s) to session ${session.id}`);
  }

  private handleConnection(socket: WebSocket): void {
    socket.binaryType = 'nodebuffer';

    let session: Session | undefined;
    let authenticating = false;
    let closed = false;
    let terminal = false;
    const connectionLifetime = new AbortController();
    const markTerminal = (): void => {
      terminal = true;
      connectionLifetime.abort();
    };

    const helloTimeout = setTimeout(() => {
      if (session === undefined) {
        markTerminal();
        this.opts.log('[relay] hello timeout, closing socket');
        socket.close(1008, 'hello timeout');
      }
    }, this.opts.helloTimeoutMs);

    socket.on('message', raw => {
      if (terminal) return;
      if (session === undefined && authenticating) {
        markTerminal();
        socket.close(1008, 'non-hello message while authentication is pending');
        return;
      }
      let envelope: Envelope;
      try {
        envelope = this.opts.decodeFrame(raw as Uint8Array);
      } catch {
        markTerminal();
        this.opts.log('[relay] decode error');
        socket.close(1003, 'invalid envelope');
        return;
      }

      if (session === undefined) {
        authenticating = true;
        const helloTask = (async (): Promise<void> => {
          try {
            const authenticated = await this.handleHello(
              socket,
              envelope,
              connectionLifetime.signal,
            );
            clearTimeout(helloTimeout);
            if (authenticated !== null && (closed || socket.readyState !== 1)) {
              this.sessions.remove(authenticated);
              return;
            }
            session = authenticated ?? undefined;
            if (session === undefined) {
              markTerminal();
              socket.close(1008, 'hello failed');
            }
          } catch (error) {
            markTerminal();
            clearTimeout(helloTimeout);
            const errorType = error instanceof Error ? error.name : 'NonError';
            this.opts.log(`[relay] authenticated hello failed internally (${errorType})`);
            socket.close(1011, 'hello failed');
          }
        })();
        this.helloTasks.add(helloTask);
        void helloTask.finally(() => this.helloTasks.delete(helloTask));
        return;
      }

      this.handleEnvelope(session, envelope);
    });

    socket.on('close', () => {
      closed = true;
      markTerminal();
      clearTimeout(helloTimeout);
      if (session !== undefined) {
        this.opts.log(
          `[relay] session ${session.id} disconnected (grace ${this.opts.disconnectGraceMs}ms)`,
        );
        this.sessions.markDisconnected(session, this.opts.disconnectGraceMs);
      }
    });

    socket.on('error', err => {
      this.opts.log(`[relay] socket error: ${err.message}`);
    });
  }

  private async handleHello(
    socket: WebSocket,
    env: Envelope,
    connectionSignal: AbortSignal,
  ): Promise<Session | null> {
    if (env.kind !== 'req' || env.method !== SystemMethod.Hello) {
      this.sendError(socket, env, ErrorCode.InvalidRequest, 'first message must be $hello');
      return null;
    }

    const parsed = AuthenticatedHelloSchema.safeParse(env.params);
    if (!parsed.success) {
      this.sendError(socket, env, 'PAIR_CREDENTIAL_REQUIRED', 'authenticated credential required');
      return null;
    }

    // Two gates, two different questions, both settled at the handshake because this relay is a
    // stateful session — the plugin connects once and is dispatched to for as long as the panel is
    // open, so there is no per-request point at which to answer them.
    //
    // Both rejections carry structured `data` beside the prose, matching the shape MCP specifies for
    // the same situation (`{ supported, requested }` on its version error). The text is written for
    // the panel, since the spec's own note applies here too: for a peer with no way to fall forward,
    // this message may be the only diagnostic a user ever sees.
    //
    // Wire format: can we understand each other's envelopes at all?
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      const message =
        `protocol mismatch: server speaks ${PROTOCOL_VERSION} — ` +
        'update the older Figwright half so both match (server: @figwright/mcp, plugin: re-import ' +
        // The reopen matters: a refused plugin stops retrying (retrying cannot fix it, and a plugin
        // old enough to be refused is old enough to lack any graceful handling of the refusal), so
        // fixing the *server* side leaves the panel sitting on this message until it is reopened.
        'the latest release), then reopen this plugin in Figma';
      this.opts.log('[relay] rejected hello (PROTOCOL_MISMATCH)');
      this.sendError(socket, env, ErrorCode.ProtocolMismatch, message, {
        reason: 'protocol',
        supported: PROTOCOL_VERSION,
      });
      return null;
    }

    let authenticated: AuthenticatedHelloResult;
    let preparationId: string | undefined;
    try {
      if (
        this.opts.authenticator.prepareHello !== undefined &&
        this.opts.authenticator.commitHello !== undefined
      ) {
        const prepared = await this.opts.authenticator.prepareHello(parsed.data);
        authenticated = prepared.result;
        preparationId = prepared.preparationId;
      } else if (this.opts.authenticator.authenticateHello !== undefined) {
        authenticated = await this.opts.authenticator.authenticateHello(parsed.data, {
          requestedSessionId: env.sessionId,
        });
      } else {
        throw Object.assign(new Error('authenticator unavailable'), {
          code: 'PAIR_CREDENTIAL_REQUIRED',
        });
      }
    } catch (error) {
      const rawCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'PAIR_CREDENTIAL_REQUIRED';
      this.opts.log(`[relay] rejected authenticated hello (${code})`);
      this.sendError(socket, env, code, code);
      return null;
    }
    if (socket.readyState !== 1) return null;

    // Feature set: does this plugin still act on everything this server sends? A plugin below the
    // floor silently drops arguments it predates. It is served anyway — refusing it was built,
    // measured against a real v0.3.0 plugin, and abandoned when it produced ~7 rejected handshakes a
    // second forever, because the "stop retrying" half can only ever live in a plugin new enough not
    // to be refused. What the server can do is make sure nobody is misled: every result this session
    // serves carries the notice below.
    const compatible = checkPluginCompatibility(parsed.data.pluginVersion, this.opts.serverVersion);
    if (!compatible) {
      this.opts.log(
        '[relay] authenticated plugin version predates this server; serving it as unverified',
      );
    }

    const resumed =
      this.sessions.get(authenticated.sessionId) !== undefined ||
      parsed.data.credential.kind === 'resume';
    const result: HelloResult = {
      serverVersion: this.opts.serverVersion,
      protocolVersion: PROTOCOL_VERSION,
      sessionResumed: resumed,
      sessionId: authenticated.sessionId,
      rotatedResumeToken: authenticated.rotatedResumeToken,
      resumeExpiresAt: authenticated.resumeExpiresAt,
      ...(compatible
        ? {}
        : { skewNotice: pluginSkewNotice(parsed.data.pluginVersion, this.opts.serverVersion) }),
    };
    if (preparationId !== undefined) {
      await this.opts.authenticator.commitHello?.(preparationId, connectionSignal);
    }
    if (socket.readyState !== 1) return null;

    const { session } = this.sessions.register({
      id: authenticated.sessionId,
      socket,
      clientVersion: parsed.data.pluginVersion,
      pluginGeneration: parsed.data.pluginGeneration,
      editorType: parsed.data.editorType,
      mode: parsed.data.mode,
      fileIdentity: parsed.data.fileIdentity,
      fileName: parsed.data.fileName,
      capabilities: parsed.data.capabilities,
    });

    session.heartbeat = new HeartbeatMonitor({
      intervalMs: this.opts.heartbeatIntervalMs,
      maxMisses: this.opts.heartbeatMaxMisses,
      sendPing: () => this.sendPing(session),
      onTimeout: () => {
        // Busy ≠ dead. A plugin mid-request can be stuck synchronously encoding a huge reply on the
        // same thread that answers pings — it isn't gone. Re-arm a fresh window instead of closing;
        // the request's own timer reaps it if it really died (and a dropped socket fires 'close'
        // regardless). tick() already stopped the timer before calling us, so start() can't double-arm.
        if (this.sessionHasInflight(session.id)) {
          this.heartbeatDeferrals += 1;
          this.opts.log(
            `[relay] heartbeat timeout deferred — session ${session.id} busy (in-flight)`,
          );
          session.heartbeat?.start();
          return;
        }
        this.opts.log(`[relay] session ${session.id} heartbeat timeout`);
        socket.close(1001, 'heartbeat timeout');
      },
    });
    session.heartbeat.start();

    try {
      await this.opts.beforeHelloResponse();
      await this.sendResponseAndWait(socket, env, result, authenticated.sessionId);
    } catch (error) {
      this.sessions.remove(session);
      throw error;
    }

    this.opts.log(`[relay] session ${session.id} hello (resumed=${resumed})`);
    this.flushQueue(session);
    return session;
  }

  private handleEnvelope(session: Session, env: Envelope): void {
    if (env.sessionId !== session.id) {
      session.socket?.close(1008, 'session identity mismatch');
      return;
    }
    session.heartbeat?.notifyReceived();
    // Routing priority: only an explicit $activity event counts as user interaction. Heartbeat
    // replies and tool responses must NOT bump lastActivityAt — both fire on a timer / on
    // server-initiated calls and would race the two sessions to a coin flip every 15s.
    if (env.kind === 'evt' && env.method === SystemMethod.Activity) {
      session.lastActivityAt = Date.now();
      const parsed = ActivityParamsSchema.safeParse(env.params);
      if (parsed.success) {
        // Params carry the current file/page so `ping` can advertise it; routing decision and
        // user-facing label come off the same event.
        session.fileName = parsed.data.fileName;
        session.pageId = parsed.data.pageId;
        session.pageName = parsed.data.pageName;
      }
      return;
    }
    if (env.kind === 'req' && env.method === SystemMethod.Ping) {
      if (session.socket !== null) this.sendResponse(session.socket, env, { ok: true });
      return;
    }
    if (env.kind === 'res') {
      const p = this.takePending(env.id);
      if (p !== undefined) {
        // Recorded, not dispatched: this runs in the socket's async context, where anything the
        // caller scoped to its own tool call is out of reach. sendRequest reports it after the
        // await instead.
        p.served.sessionId = p.dispatchedToSessionId;
        p.resolve(env.result);
      }
      return;
    }
    if (env.kind === 'err') {
      const p = this.takePending(env.id);
      if (p !== undefined) {
        // Recorded on the error path too: a plugin that answers METHOD_NOT_FOUND for a tool it
        // predates is the most visible thing an out-of-date one does, and the least self-explaining.
        p.served.sessionId = p.dispatchedToSessionId;
        p.reject(new Error(`${env.error.code}: ${env.error.message}`));
      }
      return;
    }
    this.opts.log(
      `[relay] session ${session.id} <- ${env.kind} ${'method' in env ? env.method : ''}`,
    );
  }

  private clearPending(entry: Pending): void {
    clearTimeout(entry.timer);
    const cancellation = pendingCancellations.get(entry);
    if (cancellation !== undefined) {
      cancellation.context.signal.removeEventListener('abort', cancellation.listener);
      pendingCancellations.delete(entry);
    }
  }

  private takePending(id: string): Pending | undefined {
    const entry = this.pending.get(id);
    if (entry === undefined) return undefined;
    this.pending.delete(id);
    this.clearPending(entry);
    return entry;
  }

  private bindCancellation(
    id: string,
    entry: Pending,
    context: RelayCancellation | undefined,
  ): void {
    if (context === undefined) return;
    const listener = (): void => {
      const pending = this.takePending(id);
      if (pending === undefined) return;
      const sessionId = pending.dispatchedToSessionId;
      const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
      if (session?.socket !== null && session?.socket !== undefined) {
        session.socket.send(
          encodeEnvelope({
            v: PROTOCOL_VERSION,
            kind: 'evt',
            id: newId(),
            sessionId: session.id,
            ts: Date.now(),
            method: SystemMethod.Cancel,
            params: { operationId: context.operationId, actionNonce: context.actionNonce },
          }),
        );
      }
      const reason = context.signal.reason;
      pending.reject(
        reason instanceof Error
          ? reason
          : Object.assign(new Error('operation cancelled'), { code: 'OPERATION_CANCELLED' }),
      );
    };
    pendingCancellations.set(entry, { context, listener });
    context.signal.addEventListener('abort', listener, { once: true });
    if (context.signal.aborted) listener();
  }

  private createPluginRequest(
    id: string,
    entry: Pending,
    sessionId: string,
  ): ReturnType<typeof createRequest> {
    const cancellation = pendingCancellations.get(entry)?.context;
    return createRequest({
      id,
      sessionId,
      method: entry.method,
      params: entry.params,
      ...(cancellation === undefined
        ? {}
        : { operationId: cancellation.operationId, actionNonce: cancellation.actionNonce }),
    });
  }

  private sendPing(session: Session): void {
    if (session.socket === null) return;
    session.socket.send(
      encodeEnvelope(
        createRequest({
          id: newId(),
          sessionId: session.id,
          method: SystemMethod.Ping,
        }),
      ),
    );
  }

  private sendResponse(
    socket: WebSocket,
    req: Envelope,
    result: unknown,
    sessionId = req.sessionId,
  ): void {
    socket.send(encodeEnvelope(createResponse({ id: req.id, sessionId, result })));
  }

  private sendResponseAndWait(
    socket: WebSocket,
    req: Envelope,
    result: unknown,
    sessionId: string,
  ): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      if (socket.readyState !== 1) {
        reject(new Error('socket closed before authenticated hello response'));
        return;
      }
      socket.send(encodeEnvelope(createResponse({ id: req.id, sessionId, result })), error => {
        if (error == null) resolvePromise();
        else reject(error);
      });
    });
  }

  private sendError(
    socket: WebSocket,
    req: Envelope,
    code: string,
    message: string,
    data?: unknown,
  ): void {
    socket.send(
      encodeEnvelope(
        createError({
          id: req.id || newId(),
          sessionId: req.sessionId || newId(),
          code,
          message,
          ...(data === undefined ? {} : { data }),
        }),
      ),
    );
  }
}

interface RelayCancellation {
  signal: AbortSignal;
  operationId: string;
  actionNonce: string;
}

const pendingCancellations = new WeakMap<
  Pending,
  { context: RelayCancellation; listener: () => void }
>();

export const handleLegacyFollowerRpc = async (
  relay: Pick<Relay, 'sendRequest' | 'skewNotice'>,
  plaintext: Uint8Array,
  timeoutMs?: number,
): Promise<Uint8Array> => {
  const { decode, encode } = await import('@msgpack/msgpack');
  const { getRelayBudget, RpcRequestSchema } = await import('@sfp/shared');
  let decoded: unknown;
  try {
    decoded = decode(plaintext);
  } catch {
    return encode({
      kind: 'err',
      requestId: '',
      code: ErrorCode.InvalidRequest,
      message: 'invalid msgpack body',
    });
  }
  const rpc = RpcRequestSchema.safeParse(decoded);
  if (!rpc.success) {
    return encode({
      kind: 'err',
      requestId: '',
      code: ErrorCode.InvalidParams,
      message: 'invalid rpc request',
    });
  }
  const { requestId, toolName, args, sessionId } = rpc.data;
  let body: unknown;
  try {
    let notice: string | null = null;
    const result = await relay.sendRequest(
      toolName,
      args,
      timeoutMs ?? getRelayBudget(toolName),
      sessionId,
      served => {
        notice = relay.skewNotice(served);
      },
    );
    body = { kind: 'ok', requestId, result, ...(notice === null ? {} : { notice }) };
  } catch (error) {
    const message = (error as Error).message;
    const code =
      message.startsWith('no plugin connected') || message.startsWith('pinned session')
        ? ErrorCode.PluginDisconnected
        : message.includes('timeout')
          ? ErrorCode.Timeout
          : ErrorCode.Internal;
    body = { kind: 'err', requestId, code, message };
  }
  return encode(body);
};
