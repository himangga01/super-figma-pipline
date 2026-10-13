import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type AddClientAuthentication,
  type AuthorizationServerMetadata,
  type OAuthProtectedResourceMetadata,
  type OAuthTokens,
  type FetchLike,
} from '@modelcontextprotocol/client';

const RESOURCE = 'https://mcp.figma.com/mcp';
const ISSUER = 'https://api.figma.com';
const AUTHORIZE = 'https://www.figma.com/oauth/mcp';
const TOKEN = 'https://api.figma.com/v1/oauth/token';
const SCOPE = 'mcp:connect';
const MAX_RESPONSE_BYTES = 65_536;

type Code =
  | 'FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED'
  | 'FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED'
  | 'FIGMA_MCP_OAUTH_SECRET_REQUIRED'
  | 'FIGMA_MCP_OAUTH_METADATA_REJECTED'
  | 'FIGMA_MCP_OAUTH_CALLBACK_REJECTED'
  | 'FIGMA_MCP_OAUTH_OWNER_MISMATCH'
  | 'FIGMA_MCP_OAUTH_BUSY'
  | 'FIGMA_MCP_OAUTH_CANCELLED'
  | 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED'
  | 'FIGMA_MCP_OAUTH_SUPERSEDED'
  | 'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED'
  | 'FIGMA_MCP_OAUTH_CONSENT_DENIED'
  | 'FIGMA_MCP_OAUTH_DESTINATION_REJECTED'
  | 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED'
  | 'FIGMA_MCP_OAUTH_TOKEN_REJECTED'
  | 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED'
  | 'FIGMA_MCP_OAUTH_REFRESH_FAILED'
  | 'FIGMA_MCP_OAUTH_TOKEN_REQUIRED'
  | 'FIGMA_MCP_OAUTH_HANDOFF_FAILED';
const safeErrors = new WeakSet<object>();
const failure = (code: Code) => {
  const error = Object.assign(new Error(code), { code, name: 'Error' });
  // Node 24 exposes stack as an accessor whose setter survives Object.freeze. Seal DATA,
  // not just its descriptor, before this marked error can escape to a caller.
  const stack = error.stack;
  Object.defineProperty(error, 'stack', {
    value: typeof stack === 'string' ? stack : code,
    writable: false,
    configurable: false,
    enumerable: false,
  });
  Object.freeze(error);
  safeErrors.add(error);
  return error;
};
const sanitized = (error: unknown, fallback: Code): Error & { code: Code } =>
  typeof error === 'object' && error !== null && safeErrors.has(error)
    ? (error as Error & { code: Code })
    : failure(fallback);

export interface OfficialFigmaOAuthConfiguration {
  client: {
    name: 'super-figma-pipeline';
    /** Operator declaration, not a claim that this module verified Figma catalog eligibility. */
    eligibility: 'operator-attested';
    clientId: string;
    clientSecret: string;
    authenticationMethod: 'client_secret_basic' | 'client_secret_post';
    redirectUri: string;
    redirectApproved: true;
  };
  resourceMetadata: OAuthProtectedResourceMetadata;
  authorizationMetadata: AuthorizationServerMetadata;
  /** Freshness bound supplied by the separate, approved metadata acquisition owner. */
  metadataValidUntil: number;
}
export interface OfficialFigmaOAuthCallbackLease {
  redirectUri: string;
  /** The future callback owner must actually bind its approved listener before begin. */
  assertBound: () => void;
  signal?: AbortSignal | undefined;
}
export interface OfficialFigmaOAuthStatus {
  stage:
    | 'blocked'
    | 'preparing'
    | 'waiting-for-callback'
    | 'exchanging'
    | 'authorized'
    | 'refreshing'
    | 'cancelled'
    | 'logged-out'
    | 'expired'
    | 'login-required';
  code: Code | null;
  generation: number;
  expiresAt: number | null;
  sessionOnly: true;
  clientEligibility: 'operator-attested' | 'unconfigured';
}
type Binding = {
  clientId: string;
  clientSecret: string;
  authenticationMethod: 'client_secret_basic' | 'client_secret_post';
  redirectUri: string;
  metadata: AuthorizationServerMetadata;
  metadataValidUntil: number;
};
type Operation = {
  generation: number;
  deadlineAt: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
  issued: boolean;
  published: boolean;
  publication: Promise<void>;
  resolvePublication: () => void;
};
type Pending = { state: string; verifier: string; lease: OfficialFigmaOAuthCallbackLease };
type Credentials = { access: string; refresh: string | undefined; expiresAt: number };
const text = (value: unknown, maximum: number) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maximum &&
  // eslint-disable-next-line no-control-regex -- reject control and whitespace in credential material
  !/[\u0000-\u0020\u007f]/u.test(value);
const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
const bearerToken = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 8192 &&
  /^[A-Za-z0-9._~+/-]+=*$/u.test(value);
const advertised = (values: unknown, expected: string) =>
  Array.isArray(values) &&
  values.length <= 64 &&
  values.every(value => typeof value === 'string' && value.length <= 256) &&
  values.includes(expected);

function binding(input: OfficialFigmaOAuthConfiguration | undefined, now: number): Binding {
  if (!input || input.client?.eligibility !== 'operator-attested')
    throw failure('FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED');
  const client = input.client;
  if (client.name !== 'super-figma-pipeline' || !text(client.clientId, 512))
    throw failure('FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED');
  if (!text(client.clientSecret, 4096)) throw failure('FIGMA_MCP_OAUTH_SECRET_REQUIRED');
  const auth = input.authorizationMetadata,
    resource = input.resourceMetadata;
  if (
    !auth ||
    !resource ||
    resource.resource !== RESOURCE ||
    resource.authorization_servers?.length !== 1 ||
    resource.authorization_servers[0] !== ISSUER ||
    auth.issuer !== ISSUER ||
    auth.authorization_endpoint !== AUTHORIZE ||
    auth.token_endpoint !== TOKEN ||
    !advertised(resource.scopes_supported, SCOPE) ||
    !advertised(auth.scopes_supported, SCOPE) ||
    !advertised(auth.response_types_supported, 'code') ||
    !advertised(auth.grant_types_supported, 'authorization_code') ||
    !advertised(auth.code_challenge_methods_supported, 'S256') ||
    !['client_secret_basic', 'client_secret_post'].includes(client.authenticationMethod) ||
    !advertised(auth.token_endpoint_auth_methods_supported, client.authenticationMethod) ||
    !Number.isSafeInteger(input.metadataValidUntil) ||
    input.metadataValidUntil <= now ||
    (auth.authorization_response_iss_parameter_supported !== undefined &&
      typeof auth.authorization_response_iss_parameter_supported !== 'boolean')
  )
    throw failure('FIGMA_MCP_OAUTH_METADATA_REJECTED');
  const redirect = new URL(client.redirectUri);
  if (
    client.redirectApproved !== true ||
    redirect.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(redirect.hostname) ||
    !redirect.port ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname === '/' ||
    redirect.href !== client.redirectUri
  )
    throw failure('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
  // Copy only closed fields. Caller mutation cannot replace an issuer/destination during a login.
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    authenticationMethod: client.authenticationMethod,
    redirectUri: redirect.href,
    metadataValidUntil: input.metadataValidUntil,
    metadata: {
      issuer: ISSUER,
      authorization_endpoint: AUTHORIZE,
      token_endpoint: TOKEN,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [SCOPE],
      grant_types_supported: auth.grant_types_supported!.slice(),
      token_endpoint_auth_methods_supported: [client.authenticationMethod],
      ...(auth.authorization_response_iss_parameter_supported === undefined
        ? {}
        : {
            authorization_response_iss_parameter_supported:
              auth.authorization_response_iss_parameter_supported,
          }),
    },
  };
}

/** Internal, session-only engine. No listener, browser, DCR, persistence or public portal wiring. */
export class OfficialFigmaOAuthEngine {
  #owner: string;
  #fetch: FetchLike;
  #now: () => number;
  #handoff: (authorizationUrl: URL) => void | Promise<void>;
  #generation = 0;
  #stage: OfficialFigmaOAuthStatus['stage'] = 'blocked';
  #code: Code | null = 'FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED';
  #binding: Binding | undefined;
  #active: Operation | undefined;
  #pending: Pending | undefined;
  #credentials: Credentials | undefined;
  #tokenTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(options: {
    ownerId: string;
    fetch: FetchLike;
    now?: () => number;
    /** Private owner handoff only. Never serialize this URL into public status/activity/logs. */
    authorizationHandoff: (authorizationUrl: URL) => void | Promise<void>;
  }) {
    if (!text(options.ownerId, 256)) throw failure('FIGMA_MCP_OAUTH_OWNER_MISMATCH');
    if (typeof options.fetch !== 'function' || typeof options.authorizationHandoff !== 'function')
      throw failure('FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED');
    this.#owner = options.ownerId;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
    this.#handoff = options.authorizationHandoff;
  }
  #requireOwner(owner: string) {
    if (owner !== this.#owner) throw failure('FIGMA_MCP_OAUTH_OWNER_MISMATCH');
  }
  #retire(stage: OfficialFigmaOAuthStatus['stage'], code: Code | null) {
    this.#generation++;
    const active = this.#active;
    this.#active = undefined;
    clearTimeout(this.#tokenTimer);
    this.#tokenTimer = undefined;
    this.#binding = undefined;
    this.#pending = undefined;
    this.#credentials = undefined;
    this.#stage = stage;
    this.#code = code;
    if (active) this.#finish(active);
    // Clear local credentials before synchronous abort observers can read a stale bearer.
    active?.controller.abort();
  }
  #expire() {
    if (
      (this.#active && this.#now() >= this.#active.deadlineAt) ||
      (this.#credentials && this.#now() >= this.#credentials.expiresAt)
    )
      this.#retire('expired', 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
  }
  status(): OfficialFigmaOAuthStatus {
    this.#expire();
    return {
      stage: this.#stage,
      code: this.#code,
      generation: this.#generation,
      expiresAt: this.#credentials?.expiresAt ?? this.#active?.deadlineAt ?? null,
      sessionOnly: true,
      clientEligibility: this.#binding ? 'operator-attested' : 'unconfigured',
    };
  }
  cancel(ownerId: string): void {
    this.#requireOwner(ownerId);
    this.#retire('cancelled', 'FIGMA_MCP_OAUTH_CANCELLED');
  }
  logout(ownerId: string): void {
    this.#requireOwner(ownerId);
    this.#retire('logged-out', null);
  }
  /** Private-purpose callback for future transport wiring. Never refreshes or opens consent. */
  bearer(ownerId: string): string | undefined {
    this.#requireOwner(ownerId);
    this.#expire();
    return this.#credentials?.access;
  }
  #operation(deadlineAt: number, signals: Array<AbortSignal | undefined>): Operation {
    const now = this.#now();
    if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= now)
      throw failure('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    let resolvePublication!: () => void;
    const publication = new Promise<void>(resolve => {
      resolvePublication = resolve;
    });
    const operation: Operation = {
      generation: ++this.#generation,
      deadlineAt,
      controller: new AbortController(),
      timer: setTimeout(
        () => {
          if (this.#active === operation)
            this.#retire('expired', 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
        },
        Math.min(deadlineAt - now, 2_147_483_647),
      ),
      detach: () => {},
      issued: false,
      published: false,
      publication,
      resolvePublication,
    };
    operation.timer.unref();
    this.#active = operation;
    const onAbort = () => {
      if (this.#active === operation) this.#retire('cancelled', 'FIGMA_MCP_OAUTH_CANCELLED');
    };
    const inputs = signals.filter((signal): signal is AbortSignal => signal !== undefined);
    for (const signal of inputs) signal.addEventListener('abort', onAbort, { once: true });
    operation.detach = () => {
      for (const signal of inputs) signal.removeEventListener('abort', onAbort);
    };
    if (inputs.some(signal => signal.aborted)) onAbort();
    this.#check(operation);
    return operation;
  }
  #finish(operation: Operation) {
    clearTimeout(operation.timer);
    operation.detach();
    if (this.#active === operation) this.#active = undefined;
  }
  #check(operation: Operation) {
    if (this.#active !== operation || this.#generation !== operation.generation) {
      if (this.#stage === 'expired') throw failure('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
      if (this.#stage === 'cancelled' || this.#stage === 'logged-out')
        throw failure('FIGMA_MCP_OAUTH_CANCELLED');
      throw failure('FIGMA_MCP_OAUTH_SUPERSEDED');
    }
    if (this.#now() >= operation.deadlineAt) {
      this.#retire('expired', 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
      throw failure('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    }
    if (operation.controller.signal.aborted) throw failure('FIGMA_MCP_OAUTH_CANCELLED');
  }
  async #bounded<T>(
    operation: Operation,
    action: () => Promise<T>,
    acceptPublication = false,
  ): Promise<T> {
    this.#check(operation);
    const signal = operation.controller.signal;
    let abort!: () => void;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () =>
          reject(
            failure(
              this.#stage === 'expired'
                ? 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED'
                : 'FIGMA_MCP_OAUTH_CANCELLED',
            ),
          );
        signal.addEventListener('abort', abort, { once: true });
      });
      const value = await Promise.race([action(), interrupted]);
      if (acceptPublication && operation.published && operation.generation === this.#generation) {
        this.#expire();
        if (this.#stage === 'authorized' && this.#credentials) return value;
      }
      this.#check(operation);
      return value;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  #boundLease(lease: OfficialFigmaOAuthCallbackLease, config: Binding) {
    if (lease.redirectUri !== config.redirectUri || typeof lease.assertBound !== 'function')
      throw failure('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
    try {
      lease.assertBound();
    } catch {
      throw failure('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
    }
  }
  async begin(input: {
    ownerId: string;
    configuration?: OfficialFigmaOAuthConfiguration;
    callback: OfficialFigmaOAuthCallbackLease;
    deadlineAt: number;
    signal?: AbortSignal | undefined;
  }): Promise<OfficialFigmaOAuthStatus> {
    this.#requireOwner(input.ownerId);
    this.#expire();
    if (this.#active) throw failure('FIGMA_MCP_OAUTH_BUSY');
    let config: Binding;
    let lease: OfficialFigmaOAuthCallbackLease;
    try {
      if (!Number.isSafeInteger(input.deadlineAt) || input.deadlineAt <= this.#now())
        throw failure('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
      config = binding(input.configuration, this.#now());
      lease = {
        redirectUri: input.callback.redirectUri,
        assertBound: input.callback.assertBound,
        signal: input.callback.signal,
      };
      this.#boundLease(lease, config);
    } catch (error) {
      const safe = sanitized(error, 'FIGMA_MCP_OAUTH_METADATA_REJECTED');
      if (!this.#credentials) {
        this.#stage = 'blocked';
        this.#code = safe.code;
      }
      throw safe;
    }
    this.#retire('preparing', null);
    this.#binding = config;
    let operation: Operation | undefined;
    try {
      operation = this.#operation(Math.min(input.deadlineAt, config.metadataValidUntil), [
        input.signal,
        lease.signal,
      ]);
      const state = randomBytes(32).toString('base64url');
      const authorization = await this.#bounded(operation, () =>
        startAuthorization(ISSUER, {
          metadata: config.metadata,
          clientInformation: { client_id: config.clientId },
          redirectUrl: config.redirectUri,
          scope: SCOPE,
          state,
          resource: new URL(RESOURCE),
        }),
      );
      this.#boundLease(lease, config);
      this.#pending = { state, verifier: authorization.codeVerifier, lease };
      this.#stage = 'waiting-for-callback';
      const current = operation;
      await this.#bounded(
        current,
        () =>
          Promise.race([
            Promise.resolve().then(async () => {
              this.#check(current);
              try {
                await this.#handoff(authorization.authorizationUrl);
                return true;
              } catch {
                throw failure('FIGMA_MCP_OAUTH_HANDOFF_FAILED');
              }
            }),
            current.publication,
          ]),
        true,
      );
      return this.status();
    } catch (error) {
      const safe = sanitized(error, 'FIGMA_MCP_OAUTH_HANDOFF_FAILED');
      if (this.#binding === config && (!operation || this.#active === operation))
        this.#retire('login-required', safe.code);
      throw safe;
    }
  }
  #authentication(config: Binding): AddClientAuthentication {
    return (headers, params, url) => {
      if (String(url) !== TOKEN) throw failure('FIGMA_MCP_OAUTH_DESTINATION_REJECTED');
      if (config.authenticationMethod === 'client_secret_basic') {
        headers.set(
          'Authorization',
          'Basic ' +
            Buffer.from(
              `${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`,
            ).toString('base64'),
        );
      } else {
        params.set('client_id', config.clientId);
        params.set('client_secret', config.clientSecret);
      }
    };
  }
  #tokenFetch(operation: Operation, config: Binding): FetchLike {
    return async (input, init) => {
      this.#check(operation);
      if (String(input) !== TOKEN || init?.method !== 'POST' || operation.issued)
        throw failure('FIGMA_MCP_OAUTH_DESTINATION_REJECTED');
      const params = init.body;
      const headers = new Headers(init.headers);
      if (
        !(params instanceof URLSearchParams) ||
        params.getAll('resource').length !== 1 ||
        params.get('resource') !== RESOURCE ||
        headers.has('cookie') ||
        !['authorization_code', 'refresh_token'].includes(params.get('grant_type') ?? '') ||
        (params.get('grant_type') === 'authorization_code' &&
          params.get('redirect_uri') !== config.redirectUri)
      )
        throw failure('FIGMA_MCP_OAUTH_DESTINATION_REJECTED');
      operation.issued = true;
      const response = await this.#bounded(operation, async () => {
        try {
          return await this.#fetch(input, {
            ...init,
            redirect: 'manual',
            signal: operation.controller.signal,
          });
        } catch {
          // An injected transport cannot launder a retained public factory error as internal authority.
          throw failure(
            params.get('grant_type') === 'refresh_token'
              ? 'FIGMA_MCP_OAUTH_REFRESH_FAILED'
              : 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED',
          );
        }
      });
      if (
        response.redirected ||
        (response.url && response.url !== TOKEN) ||
        (response.status >= 300 && response.status < 400)
      )
        throw failure('FIGMA_MCP_OAUTH_DESTINATION_REJECTED');
      if (
        !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') ||
        !response.body
      )
        throw failure('FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let total = 0;
      try {
        /* eslint-disable no-await-in-loop -- one bounded private token response */
        while (true) {
          const chunk = await this.#bounded(operation, async () => {
            try {
              return await reader.read();
            } catch {
              throw failure('FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
            }
          });
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > MAX_RESPONSE_BYTES) throw failure('FIGMA_MCP_OAUTH_RESPONSE_REJECTED');
          chunks.push(chunk.value);
        }
        /* eslint-enable no-await-in-loop */
      } finally {
        void reader.cancel().catch(() => {});
      }
      this.#check(operation);
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    };
  }
  #publish(operation: Operation, config: Binding, tokens: OAuthTokens) {
    this.#check(operation);
    const seconds = tokens.expires_in;
    if (
      !bearerToken(tokens.access_token) ||
      tokens.token_type.toLowerCase() !== 'bearer' ||
      !Number.isSafeInteger(seconds) ||
      seconds! <= 0 ||
      (tokens.refresh_token !== undefined && !text(tokens.refresh_token, 8192)) ||
      (tokens.scope !== undefined && tokens.scope !== SCOPE)
    )
      throw failure('FIGMA_MCP_OAUTH_TOKEN_REJECTED');
    const expiresAt = Math.min(this.#now() + seconds! * 1000, config.metadataValidUntil);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.#now())
      throw failure('FIGMA_MCP_OAUTH_TOKEN_REJECTED');
    this.#credentials = { access: tokens.access_token, refresh: tokens.refresh_token, expiresAt };
    this.#pending = undefined;
    this.#stage = 'authorized';
    this.#code = null;
    this.#finish(operation);
    operation.published = true;
    operation.resolvePublication();
    const generation = this.#generation;
    this.#tokenTimer = setTimeout(
      () => {
        if (generation === this.#generation)
          this.#retire('expired', 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
      },
      Math.min(expiresAt - this.#now(), 2_147_483_647),
    );
    this.#tokenTimer.unref();
  }
  async complete(input: {
    ownerId: string;
    callbackUrl: string;
  }): Promise<OfficialFigmaOAuthStatus> {
    this.#requireOwner(input.ownerId);
    this.#expire();
    const operation = this.#active,
      pending = this.#pending,
      config = this.#binding;
    if (!operation || !pending || !config || this.#stage !== 'waiting-for-callback')
      throw failure(
        this.#stage === 'expired'
          ? 'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED'
          : 'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED',
      );
    let url: URL;
    try {
      if (typeof input.callbackUrl !== 'string' || Buffer.byteLength(input.callbackUrl) > 8192)
        throw failure('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
      url = new URL(input.callbackUrl);
      const keys = [...url.searchParams.keys()];
      const state = url.searchParams.get('state');
      if (
        input.callbackUrl.split('?')[0] !== config.redirectUri ||
        url.hash ||
        keys.some(key => !['state', 'code', 'iss', 'error'].includes(key)) ||
        url.searchParams.getAll('state').length !== 1 ||
        !state ||
        Buffer.byteLength(state) !== Buffer.byteLength(pending.state) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) ||
        url.searchParams.getAll('iss').length > 1 ||
        (url.searchParams.has('iss') && url.searchParams.get('iss') !== ISSUER) ||
        (config.metadata.authorization_response_iss_parameter_supported &&
          !url.searchParams.has('iss')) ||
        (url.searchParams.has('error')
          ? url.searchParams.getAll('error').length !== 1 || url.searchParams.has('code')
          : url.searchParams.getAll('code').length !== 1 ||
            !text(url.searchParams.get('code'), 4096))
      )
        throw failure('FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
      this.#boundLease(pending.lease, config);
      this.#check(operation);
    } catch (error) {
      throw sanitized(error, 'FIGMA_MCP_OAUTH_CALLBACK_REJECTED');
    }
    this.#pending = undefined; // Consume the valid state before any token request.
    if (url.searchParams.has('error')) {
      this.#retire('login-required', 'FIGMA_MCP_OAUTH_CONSENT_DENIED');
      throw failure('FIGMA_MCP_OAUTH_CONSENT_DENIED');
    }
    this.#stage = 'exchanging';
    try {
      const tokens = await this.#bounded(operation, () =>
        exchangeAuthorization(ISSUER, {
          metadata: config.metadata,
          clientInformation: {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            token_endpoint_auth_method: config.authenticationMethod,
          },
          authorizationCode: url.searchParams.get('code')!,
          ...(url.searchParams.has('iss') ? { iss: url.searchParams.get('iss')! } : {}),
          codeVerifier: pending.verifier,
          redirectUri: config.redirectUri,
          resource: new URL(RESOURCE),
          addClientAuthentication: this.#authentication(config),
          fetchFn: this.#tokenFetch(operation, config),
        }),
      );
      this.#publish(operation, config, tokens);
      return this.status();
    } catch (error) {
      const safe = sanitized(error, 'FIGMA_MCP_OAUTH_EXCHANGE_FAILED');
      if (this.#active === operation) this.#retire('login-required', safe.code);
      throw safe;
    } finally {
      this.#finish(operation);
    }
  }
  async refresh(input: {
    ownerId: string;
    deadlineAt: number;
    signal?: AbortSignal | undefined;
  }): Promise<OfficialFigmaOAuthStatus> {
    this.#requireOwner(input.ownerId);
    this.#expire();
    if (this.#active) throw failure('FIGMA_MCP_OAUTH_BUSY');
    if (!Number.isSafeInteger(input.deadlineAt)) throw failure('FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED');
    const config = this.#binding,
      credentials = this.#credentials;
    if (
      !config ||
      !credentials?.refresh ||
      !advertised(config.metadata.grant_types_supported, 'refresh_token')
    )
      throw failure('FIGMA_MCP_OAUTH_TOKEN_REQUIRED');
    const refreshToken = credentials.refresh;
    const operation = this.#operation(Math.min(input.deadlineAt, credentials.expiresAt), [
      input.signal,
    ]);
    clearTimeout(this.#tokenTimer);
    this.#tokenTimer = undefined;
    this.#credentials = undefined;
    this.#stage = 'refreshing';
    try {
      const tokens = await this.#bounded(operation, () =>
        refreshAuthorization(ISSUER, {
          metadata: config.metadata,
          clientInformation: {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            token_endpoint_auth_method: config.authenticationMethod,
          },
          refreshToken,
          resource: new URL(RESOURCE),
          addClientAuthentication: this.#authentication(config),
          fetchFn: this.#tokenFetch(operation, config),
        }),
      );
      this.#publish(operation, config, tokens);
      return this.status();
    } catch (error) {
      const safe = sanitized(error, 'FIGMA_MCP_OAUTH_REFRESH_FAILED');
      if (this.#active === operation) this.#retire('login-required', safe.code);
      throw safe;
    } finally {
      this.#finish(operation);
    }
  }
}
