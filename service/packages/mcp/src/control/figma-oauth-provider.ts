import { randomUUID } from 'node:crypto';

import type { FetchLike } from '@modelcontextprotocol/client';
import { parseActorContext, type ActorContext } from '@sfp/shared';

import type { OfficialFigmaCredentialLease } from '../official-figma-mcp.js';
import {
  OfficialFigmaOAuthEngine,
  type OfficialFigmaOAuthConfiguration,
} from '../official-figma-oauth.js';
import type { BoundStatePermissions } from '../security/state-permissions.js';
import { FigmaOAuthCallbackListener } from './figma-oauth-callback.js';
import {
  FigmaOAuthCleanupInputSchema,
  FigmaOAuthConfigureInputSchema,
  FigmaOAuthConfigurationSchema,
  FigmaOAuthHandoffInputSchema,
  FigmaOAuthStartInputSchema,
  FigmaOAuthRefreshInputSchema,
  FigmaOAuthStatusSchema,
  FigmaOAuthCodeSchema,
  figmaOAuthError,
  parseFigmaOAuth,
  type FigmaOAuthCode,
  type FigmaOAuthConfiguration,
  type FigmaOAuthStatus,
  type FigmaOAuthBinding,
} from './figma-oauth-contract.js';
import { boundedFigmaOAuthFetch, discoverFigmaOAuthMetadata } from './figma-oauth-metadata.js';
import { FigmaOAuthState, figmaOAuthClientIdDigest } from './figma-oauth-state.js';

type Flow = {
  id: string;
  principal: ActorContext;
  controller: AbortController;
  deadlineAt: number;
  listener: FigmaOAuthCallbackListener | undefined;
  uri: string | undefined;
  handedOff: boolean;
  completed: boolean;
  timer: ReturnType<typeof setTimeout>;
};
export interface FigmaOAuthProviderOptions {
  stateRoot: string;
  permissions: Pick<BoundStatePermissions, 'verifySecure' | 'ensureSecure'>;
  ownerActorId: ActorContext['actorId'];
  environment?: Readonly<Record<string, string | undefined>>;
  fetch?: FetchLike;
  now?: () => number;
}
const envName = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value);
const safeCode = (error: unknown, fallback: FigmaOAuthCode): FigmaOAuthCode => {
  try {
    const code = FigmaOAuthCodeSchema.safeParse((error as { code?: unknown })?.code);
    if (code.success) return code.data;
  } catch {
    /* Closed fallback. */
  }
  return fallback;
};
const rejectPublicFigmaResult = (
  code: 'FIGMA_MCP_READ_PRIVATE_DATA' | 'FIGMA_MCP_READ_TOO_LARGE',
): never => {
  throw Object.assign(new Error(code), { code });
};

/** Sole daemon owner. No browser, DCR, automatic refresh or remote credential persistence. */
export class FigmaOAuthProvider {
  readonly providerInstanceId = randomUUID();
  #ownerActorId: ActorContext['actorId'];
  #state: FigmaOAuthState;
  #environment: Readonly<Record<string, string | undefined>>;
  #transport: FetchLike;
  #now: () => number;
  #configuration: FigmaOAuthConfiguration;
  #configurationGeneration = 0;
  #authGeneration = 0;
  #engine: OfficialFigmaOAuthEngine | undefined;
  #engineGeneration = 0;
  #flow: Flow | undefined;
  #busy = false;
  #mutationEpoch = 0;
  #closed = false;
  #fault: FigmaOAuthCode | null = null;
  #eligibility = false;
  #observed = false;
  #expiry: ReturnType<typeof setTimeout> | undefined;
  #dependents = new Set<AbortController>();
  #externalDisabled = false;
  #tokenDeadline = 0;
  #sensitive = new Set<string>();
  private constructor(options: FigmaOAuthProviderOptions) {
    this.#ownerActorId = options.ownerActorId;
    this.#state = new FigmaOAuthState(options.stateRoot, options.permissions);
    this.#environment = options.environment ?? process.env;
    this.#transport = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    const name = this.#environment.SFP_FIGMA_MCP_OAUTH_TOKEN_ENV;
    this.#configuration = {
      endpoint: 'https://mcp.figma.com/mcp',
      mode: name === undefined ? 'own-oauth' : 'external-token',
      oauthTokenEnv: envName(name) ? name : null,
      clientIdEnv: null,
      clientSecretEnv: null,
      contractReference: null,
      contractDigest: null,
    };
    if (name !== undefined && !envName(name)) this.#fault = 'FIGMA_MCP_OAUTH_CONFIGURATION_INVALID';
  }
  static async open(options: FigmaOAuthProviderOptions): Promise<FigmaOAuthProvider> {
    const provider = new FigmaOAuthProvider(options);
    try {
      const stored = await provider.#state.load();
      if (stored) {
        provider.#configuration = stored.configuration;
        provider.#configurationGeneration = stored.configurationGeneration;
      }
    } catch {
      provider.#fault = 'FIGMA_MCP_OAUTH_CONFIGURATION_INVALID';
    }
    await provider.#inspectPrerequisites();
    return provider;
  }
  async #inspectPrerequisites(): Promise<void> {
    this.#eligibility = false;
    if (this.#fault || this.#configuration.mode !== 'own-oauth') return;
    try {
      const contract = await this.#state.contract(this.#configuration);
      const name = this.#configuration.clientIdEnv;
      if (
        name &&
        this.#environment[name] &&
        figmaOAuthClientIdDigest(this.#environment[name]!) !== contract.clientIdDigest
      ) {
        this.#fault = 'FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED';
        return;
      }
      this.#eligibility = true;
    } catch (error) {
      this.#fault = safeCode(error, 'FIGMA_MCP_OAUTH_CONTRACT_INVALID');
    }
  }
  #principal(raw: Readonly<ActorContext>): ActorContext {
    try {
      const principal = parseActorContext(raw);
      if (principal.entryPath === 'control' && principal.actorId === this.#ownerActorId)
        return principal;
    } catch {
      /* Closed failure. */
    }
    throw figmaOAuthError('FIGMA_MCP_OAUTH_OWNER_MISMATCH');
  }
  #binding(input: FigmaOAuthBinding): void {
    this.#sync();
    if (this.#closed) throw figmaOAuthError('FIGMA_MCP_OAUTH_CLOSED');
    if (
      input.providerInstanceId !== this.providerInstanceId ||
      input.configurationGeneration !== this.#configurationGeneration ||
      input.authGeneration !== this.#authGeneration
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_BINDING_MISMATCH');
  }
  #touch(): void {
    this.#authGeneration++;
    for (const dependent of this.#dependents) dependent.abort();
    this.#dependents.clear();
    clearTimeout(this.#expiry);
    this.#expiry = undefined;
  }
  #sync(): void {
    const status = this.#engine?.status();
    if (status && status.generation !== this.#engineGeneration) {
      this.#engineGeneration = status.generation;
      this.#touch();
      if (
        status.stage === 'expired' ||
        status.stage === 'cancelled' ||
        status.stage === 'login-required'
      ) {
        this.#observed = false;
        if (this.#flow) {
          this.#flow.uri = undefined;
          void this.#flow.listener?.close().catch(() => {});
        }
      }
    }
  }
  #token(): string | undefined {
    this.#sync();
    if (this.#closed || this.#fault || this.#configuration.endpoint !== 'https://mcp.figma.com/mcp')
      return undefined;
    if (this.#configuration.mode === 'external-token') {
      if (this.#externalDisabled) return undefined;
      const name = this.#configuration.oauthTokenEnv;
      return name && envName(name) ? this.#environment[name] || undefined : undefined;
    }
    return this.#engine?.bearer(this.#ownerActorId);
  }
  token(): Promise<string | undefined> {
    return Promise.resolve(this.#token());
  }
  assertPublicResult(value: unknown): void {
    let text: string | undefined;
    try {
      text = JSON.stringify(value);
    } catch {
      rejectPublicFigmaResult('FIGMA_MCP_READ_PRIVATE_DATA');
    }
    if (typeof text !== 'string') return;
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      rejectPublicFigmaResult('FIGMA_MCP_READ_TOO_LARGE');
    const secretName = this.#configuration.clientSecretEnv;
    const values = [
      ...this.#sensitive,
      this.#token(),
      secretName ? this.#environment[secretName] : undefined,
    ];
    // JSON escapes quotes/backslashes in both nested string values and property names.
    // Compare the same serialization form as well as raw material, without traversing getters.
    if (
      values.some(
        secret =>
          secret && (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1))),
      )
    )
      rejectPublicFigmaResult('FIGMA_MCP_READ_PRIVATE_DATA');
  }
  acquireCredentialLease(): OfficialFigmaCredentialLease {
    const token = this.#token();
    if (!token)
      throw Object.assign(new Error('FIGMA_MCP_AUTH_REQUIRED'), {
        code: 'FIGMA_MCP_AUTH_REQUIRED',
      });
    const epoch = this.#authGeneration,
      controller = new AbortController();
    this.#dependents.add(controller);
    const assertActive = () => {
      this.#sync();
      if (
        this.#closed ||
        controller.signal.aborted ||
        epoch !== this.#authGeneration ||
        this.#token() !== token
      )
        throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
    };
    return {
      signal: controller.signal,
      assertActive,
      oauthToken: async () => {
        assertActive();
        return token;
      },
      release: () => {
        this.#dependents.delete(controller);
      },
      assertPublicResult: value => {
        assertActive();
        this.assertPublicResult(value);
      },
    };
  }
  status(): FigmaOAuthStatus {
    this.#sync();
    const engine = this.#engine?.status();
    const available = this.#configuration.mode === 'external-token' && Boolean(this.#token());
    const fallback = this.#closed
      ? 'FIGMA_MCP_OAUTH_CLOSED'
      : (this.#fault ??
        (this.#configuration.endpoint !== 'https://mcp.figma.com/mcp'
          ? 'FIGMA_MCP_OAUTH_ENDPOINT_REQUIRED'
          : this.#configuration.mode === 'external-token'
            ? 'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE'
            : !this.#configuration.clientIdEnv || !this.#configuration.clientSecretEnv
              ? 'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE'
              : !this.#environment[this.#configuration.clientIdEnv] ||
                  !this.#environment[this.#configuration.clientSecretEnv]
                ? 'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE'
                : this.#eligibility
                  ? null
                  : 'FIGMA_MCP_OAUTH_CONTRACT_REQUIRED'));
    return FigmaOAuthStatusSchema.parse({
      schemaVersion: 1,
      providerInstanceId: this.providerInstanceId,
      configurationGeneration: this.#configurationGeneration,
      authGeneration: this.#authGeneration,
      configuration: { ...this.#configuration },
      stage:
        this.#fault === 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED'
          ? 'expired'
          : (engine?.stage ??
            (this.#busy
              ? 'preparing'
              : available
                ? 'external-token-configured'
                : this.#externalDisabled
                  ? 'logged-out'
                  : 'blocked')),
      code:
        this.#fault ??
        (engine
          ? engine.code
          : this.#busy || available || this.#externalDisabled
            ? null
            : fallback),
      expiresAt: engine?.expiresAt ?? null,
      flowId: this.#flow?.id ?? null,
      handoffAvailable: Boolean(
        this.#flow?.uri && !this.#flow.handedOff && engine?.stage === 'waiting-for-callback',
      ),
      eligibilitySource: this.#eligibility ? 'operator-contract' : 'none',
      serverAuthorizationObserved: this.#observed,
      sessionOnly: true,
    });
  }
  async #retire(cancel: boolean): Promise<void> {
    const flow = this.#flow;
    this.#flow = undefined;
    this.#touch();
    this.#observed = false;
    this.#sensitive.clear();
    this.#externalDisabled = true;
    if (cancel) this.#engine?.cancel(this.#ownerActorId);
    else this.#engine?.logout(this.#ownerActorId);
    this.#engineGeneration = this.#engine?.status().generation ?? 0;
    if (flow) {
      flow.uri = undefined;
      clearTimeout(flow.timer);
      flow.controller.abort();
      await flow.listener?.close();
    }
  }
  async configure(
    principal: Readonly<ActorContext>,
    raw: unknown,
    signal: AbortSignal,
  ): Promise<FigmaOAuthStatus> {
    this.#principal(principal);
    const input = parseFigmaOAuth(FigmaOAuthConfigureInputSchema, raw);
    this.#binding(input);
    if (this.#busy) throw figmaOAuthError('FIGMA_MCP_OAUTH_BUSY');
    signal.throwIfAborted();
    this.#busy = true;
    const epoch = ++this.#mutationEpoch;
    try {
      await this.#retire(false);
      signal.throwIfAborted();
      await this.#state.save(input.configuration, this.#configurationGeneration + 1);
      if (this.#closed || epoch !== this.#mutationEpoch)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
      signal.throwIfAborted();
      this.#configuration = FigmaOAuthConfigurationSchema.parse(input.configuration);
      this.#configurationGeneration++;
      this.#engine = undefined;
      this.#engineGeneration = 0;
      this.#externalDisabled = false;
      this.#fault = null;
      this.#eligibility = false;
      await this.#inspectPrerequisites();
      if (this.#closed || epoch !== this.#mutationEpoch)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
      this.#busy = false;
      return this.status();
    } catch (error) {
      throw figmaOAuthError(safeCode(error, 'FIGMA_MCP_OAUTH_PERSISTENCE_FAILED'));
    } finally {
      this.#busy = false;
    }
  }
  async start(
    principalRaw: Readonly<ActorContext>,
    raw: unknown,
    signal: AbortSignal,
  ): Promise<FigmaOAuthStatus> {
    const principal = this.#principal(principalRaw);
    const input = parseFigmaOAuth(FigmaOAuthStartInputSchema, raw);
    this.#binding(input);
    if (
      this.#busy ||
      (this.#flow && !this.#flow.completed) ||
      this.#engine?.status().stage === 'exchanging' ||
      this.#engine?.status().stage === 'refreshing'
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_BUSY');
    const deadlineAt = input.deadlineAt;
    if (deadlineAt <= this.#now() || deadlineAt > this.#now() + 600_000)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    const config = this.#configuration;
    if (config.endpoint !== 'https://mcp.figma.com/mcp')
      throw figmaOAuthError('FIGMA_MCP_OAUTH_ENDPOINT_REQUIRED');
    if (config.mode !== 'own-oauth') throw figmaOAuthError('FIGMA_MCP_OAUTH_MODE_REQUIRED');
    if (!config.clientIdEnv || !config.clientSecretEnv)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_ENV_UNAVAILABLE');
    this.#busy = true;
    const epoch = ++this.#mutationEpoch;
    let flow: Flow | undefined;
    let abortSetup: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      const contract = await this.#state.contract(config);
      signal.throwIfAborted();
      if (this.#closed || epoch !== this.#mutationEpoch)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
      const clientId = this.#environment[config.clientIdEnv],
        secret = this.#environment[config.clientSecretEnv];
      if (!clientId || !secret) throw figmaOAuthError('FIGMA_MCP_OAUTH_ENV_UNAVAILABLE');
      if (figmaOAuthClientIdDigest(clientId) !== contract.clientIdDigest)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED');
      await this.#retire(false);
      if (this.#closed || epoch !== this.#mutationEpoch)
        throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
      this.#engine = undefined;
      this.#engineGeneration = 0;
      this.#fault = null;
      this.#eligibility = true;
      this.#externalDisabled = false;
      this.#tokenDeadline = deadlineAt;
      const controller = new AbortController();
      flow = {
        id: randomUUID(),
        principal,
        controller,
        deadlineAt,
        listener: undefined,
        uri: undefined,
        handedOff: false,
        completed: false,
        timer: setTimeout(() => {
          if (this.#flow === flow && !flow?.completed) {
            flow?.controller.abort();
            this.#engine?.cancel(this.#ownerActorId);
            this.#fault = 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED';
          }
        }, deadlineAt - this.#now()),
      };
      flow.timer.unref();
      this.#flow = flow;
      const current = flow;
      const sensitive = new Set<string>();
      sensitive.add(clientId);
      sensitive.add(secret);
      sensitive.add(
        Buffer.from(
          new URLSearchParams({ v: clientId }).toString().slice(2) +
            ':' +
            new URLSearchParams({ v: secret }).toString().slice(2),
        ).toString('base64'),
      );
      this.#sensitive = sensitive;
      abortSetup = () => {
        current.controller.abort();
      };
      signal.addEventListener('abort', abortSetup, { once: true });
      const setup = AbortSignal.any([
        signal,
        controller.signal,
        AbortSignal.timeout(Math.min(20_000, deadlineAt - this.#now())),
      ]);
      const setupCheck = () => {
        if (
          setup.aborted ||
          this.#closed ||
          epoch !== this.#mutationEpoch ||
          this.#flow !== current ||
          this.#now() >= deadlineAt
        )
          throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
      };
      current.listener = await FigmaOAuthCallbackListener.bind({
        redirectUri: contract.redirectUri,
        deadlineAt,
        signal: controller.signal,
        now: this.#now,
        onCallback: async callbackUrl => {
          if (this.#flow !== current || !this.#engine)
            throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
          try {
            await this.#engine.complete({ ownerId: this.#ownerActorId, callbackUrl });
            if (this.#flow !== current) throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
            current.uri = undefined;
            current.completed = true;
            clearTimeout(current.timer);
            this.#sync();
            // Publication retires readiness that began before credentials existed.
            this.#touch();
            this.#observed = true;
            const expiry = this.#engine.status().expiresAt;
            if (expiry !== null)
              this.#expiry = setTimeout(() => this.#sync(), Math.max(1, expiry - this.#now()));
            this.#expiry?.unref();
          } catch {
            if (this.#engine?.status().stage !== 'waiting-for-callback') {
              current.uri = undefined;
              current.completed = true;
              clearTimeout(current.timer);
            }
            this.#sync();
            throw figmaOAuthError('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
          }
        },
      });
      setupCheck();
      const metadata = await discoverFigmaOAuthMetadata(this.#transport, {
        signal: setup,
        deadlineAt: Math.min(deadlineAt, this.#now() + 15_000),
        now: this.#now,
      });
      setupCheck();
      const engine = new OfficialFigmaOAuthEngine({
        ownerId: this.#ownerActorId,
        now: this.#now,
        fetch: async (url, init) => {
          if (this.#flow !== current || controller.signal.aborted)
            throw figmaOAuthError('FIGMA_MCP_OAUTH_SUPERSEDED');
          if (init?.body instanceof URLSearchParams)
            for (const key of ['code', 'code_verifier', 'refresh_token']) {
              const value = init.body.get(key);
              if (value) sensitive.add(value);
            }
          const response = await boundedFigmaOAuthFetch(this.#transport, {
            purpose: 'token',
            signal: init?.signal ?? controller.signal,
            deadlineAt: Math.min(this.#tokenDeadline, this.#now() + 15_000),
            now: this.#now,
          })(url, init);
          try {
            const token: unknown = await response.clone().json();
            if (token && typeof token === 'object')
              for (const key of ['access_token', 'refresh_token']) {
                const value = (token as Record<string, unknown>)[key];
                if (
                  this.#flow === current &&
                  !controller.signal.aborted &&
                  typeof value === 'string' &&
                  value.length <= 8192
                )
                  sensitive.add(value);
              }
          } catch {
            /* SDK will reject malformed token data without public values. */
          }
          return response;
        },
        authorizationHandoff: uri => {
          setupCheck();
          current.uri = uri.href;
          sensitive.add(uri.href);
          sensitive.add(uri.searchParams.get('state')!);
        },
      });
      this.#engine = engine;
      const configuration: OfficialFigmaOAuthConfiguration = {
        client: {
          name: 'super-figma-pipeline',
          eligibility: 'operator-attested',
          clientId,
          clientSecret: secret,
          authenticationMethod: contract.authenticationMethod,
          redirectUri: contract.redirectUri,
          redirectApproved: true,
        },
        ...metadata,
        metadataValidUntil: this.#now() + 8 * 60 * 60 * 1000,
      };
      await engine.begin({
        ownerId: this.#ownerActorId,
        configuration,
        callback: current.listener.lease(),
        deadlineAt,
        signal: controller.signal,
      });
      setupCheck();
      this.#sync();
      return this.status();
    } catch (error) {
      const code = signal.aborted
        ? 'FIGMA_MCP_OAUTH_CANCELLED'
        : safeCode(error, 'FIGMA_MCP_OAUTH_METADATA_REJECTED');
      if (epoch === this.#mutationEpoch && (!flow || this.#flow === flow)) {
        await this.#retire(true);
        this.#fault = code;
        this.#engine = undefined;
      }
      throw figmaOAuthError(code);
    } finally {
      if (abortSetup) signal.removeEventListener('abort', abortSetup);
      this.#busy = false;
    }
  }
  handoff(
    principalRaw: Readonly<ActorContext>,
    raw: unknown,
    signal: AbortSignal,
    deliver: (url: URL) => void,
  ): void {
    const principal = this.#principal(principalRaw);
    const input = parseFigmaOAuth(FigmaOAuthHandoffInputSchema, raw);
    this.#binding(input);
    const flow = this.#flow;
    if (
      !flow ||
      flow.id !== input.flowId ||
      flow.principal.authSessionId !== principal.authSessionId ||
      !flow.uri ||
      flow.handedOff ||
      this.#engine?.status().stage !== 'waiting-for-callback'
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_HANDOFF_UNAVAILABLE');
    if (signal.aborted || this.#now() >= flow.deadlineAt)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_CANCELLED');
    flow.listener?.assertBound();
    const uri = new URL(flow.uri);
    flow.uri = undefined;
    flow.handedOff = true;
    try {
      deliver(uri);
    } catch {
      throw figmaOAuthError('FIGMA_MCP_OAUTH_HANDOFF_FAILED');
    }
  }
  async cleanup(
    principalRaw: Readonly<ActorContext>,
    raw: unknown,
    logout: boolean,
  ): Promise<FigmaOAuthStatus> {
    const principal = this.#principal(principalRaw);
    const input = parseFigmaOAuth(FigmaOAuthCleanupInputSchema, raw);
    this.#binding(input);
    if (
      input.flowId !== (this.#flow?.id ?? null) ||
      (this.#flow && this.#flow.principal.authSessionId !== principal.authSessionId)
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_BINDING_MISMATCH');
    this.#mutationEpoch++;
    await this.#retire(!logout);
    this.#fault = null;
    return this.status();
  }
  async refresh(
    principalRaw: Readonly<ActorContext>,
    raw: unknown,
    signal: AbortSignal,
  ): Promise<FigmaOAuthStatus> {
    const principal = this.#principal(principalRaw);
    const input = parseFigmaOAuth(FigmaOAuthRefreshInputSchema, raw);
    this.#binding(input);
    if (this.#busy) throw figmaOAuthError('FIGMA_MCP_OAUTH_BUSY');
    if (
      !this.#engine ||
      !this.#flow ||
      this.#flow.principal.authSessionId !== principal.authSessionId
    )
      throw figmaOAuthError('FIGMA_MCP_OAUTH_TOKEN_REQUIRED');
    if (input.deadlineAt <= this.#now() || input.deadlineAt > this.#now() + 20_000)
      throw figmaOAuthError('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    this.#busy = true;
    this.#touch();
    this.#tokenDeadline = input.deadlineAt;
    try {
      await this.#engine.refresh({
        ownerId: this.#ownerActorId,
        deadlineAt: input.deadlineAt,
        signal,
      });
      this.#sync();
      this.#observed = true;
      const expiry = this.#engine.status().expiresAt;
      if (expiry !== null) {
        this.#expiry = setTimeout(() => this.#sync(), Math.max(1, expiry - this.#now()));
        this.#expiry.unref();
      }
      return this.status();
    } catch (error) {
      this.#sync();
      throw figmaOAuthError(safeCode(error, 'FIGMA_MCP_OAUTH_REFRESH_FAILED'));
    } finally {
      this.#busy = false;
    }
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#mutationEpoch++;
    await this.#retire(false);
  }
}
