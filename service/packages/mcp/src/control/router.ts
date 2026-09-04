import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseActorContext, type ActorContext, type AuthenticatedControlRoute } from '@sfp/shared';
import { z } from 'zod';

export const CONTROL_LOGICAL_REQUEST_MAX_BYTES = 9_437_184 as const;

export class AuthenticatedControlRouterError extends Error {
  constructor(
    readonly code:
      | 'CONTROL_ROUTE_DUPLICATE'
      | 'CONTROL_ROUTE_FROZEN'
      | 'CONTROL_ROUTE_INVALID'
      | 'CONTROL_ROUTE_NOT_FOUND'
      | 'CONTROL_ROUTE_INPUT_INVALID'
      | 'CONTROL_ROUTE_OUTPUT_INVALID'
      | 'CONTROL_REQUEST_TOO_LARGE'
      | 'CONTROL_RESPONSE_TOO_LARGE',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AuthenticatedControlRouterError';
  }
}

interface ControlDispatchRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  input: unknown;
}

const parseDispatchRequest = (value: unknown): ControlDispatchRequest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthenticatedControlRouterError(
      'CONTROL_ROUTE_INPUT_INVALID',
      'control dispatch request is invalid',
    );
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).toSorted()) !==
      JSON.stringify(['input', 'method', 'path']) ||
    !['GET', 'POST', 'DELETE'].includes(String(record.method)) ||
    typeof record.path !== 'string' ||
    !record.path.startsWith('/control')
  ) {
    throw new AuthenticatedControlRouterError(
      'CONTROL_ROUTE_INPUT_INVALID',
      'control dispatch request is invalid',
    );
  }
  const inputJson = JSON.stringify(record.input);
  if (
    Buffer.byteLength(record.path, 'utf8') +
      Buffer.byteLength(inputJson === undefined ? 'null' : inputJson, 'utf8') >
    CONTROL_LOGICAL_REQUEST_MAX_BYTES
  ) {
    throw new AuthenticatedControlRouterError(
      'CONTROL_REQUEST_TOO_LARGE',
      'control request exceeds its logical byte limit',
    );
  }
  return {
    method: record.method as ControlDispatchRequest['method'],
    path: record.path,
    input: record.input,
  };
};

const validRoutePath = (path: string): boolean =>
  /^\/control(?:\/[a-z0-9-]+|\/:?[A-Za-z][A-Za-z0-9]*)*$/u.test(path);
const routeKey = (method: string, path: string): string => `${method} ${path}`;
const routeShapeKey = (method: string, path: string): string =>
  routeKey(
    method,
    path
      .split('/')
      .map(segment => (segment.startsWith(':') ? ':' : segment))
      .join('/'),
  );
const parameterCount = (path: string): number =>
  path.split('/').filter(segment => segment.startsWith(':')).length;
const matchPath = (
  template: string,
  candidate: string,
): Readonly<Record<string, string>> | undefined => {
  const expected = template.split('/');
  const actual = candidate.split('/');
  if (expected.length !== actual.length) return undefined;
  const parameters: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index]!;
    if (segment.startsWith(':')) {
      try {
        parameters[segment.slice(1)] = decodeURIComponent(actual[index]!);
      } catch {
        return undefined;
      }
    } else if (segment !== actual[index]) return undefined;
  }
  return Object.freeze(parameters);
};
const strictPlainObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthenticatedControlRouterError(
      'CONTROL_ROUTE_INPUT_INVALID',
      'control route input must be a JSON object',
    );
  }
  return value as Record<string, unknown>;
};

export class AuthenticatedControlRouter {
  private readonly routes: AuthenticatedControlRoute<unknown, unknown>[] = [];
  private frozen = false;

  register<I, O>(route: AuthenticatedControlRoute<I, O>): void {
    if (this.frozen) {
      throw new AuthenticatedControlRouterError('CONTROL_ROUTE_FROZEN', 'control router is frozen');
    }
    if (
      typeof route.id !== 'string' ||
      route.id.length === 0 ||
      !['GET', 'POST', 'DELETE'].includes(route.method) ||
      !validRoutePath(route.path) ||
      typeof route.handle !== 'function'
    ) {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_INVALID',
        'control route is invalid',
      );
    }
    if (
      this.routes.some(
        existing =>
          existing.id === route.id ||
          routeShapeKey(existing.method, existing.path) === routeShapeKey(route.method, route.path),
      )
    ) {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_DUPLICATE',
        'control route id or method/path is already registered',
      );
    }
    if (route.outputSchema instanceof z.ZodUnknown || route.outputSchema instanceof z.ZodAny) {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_INVALID',
        'control route output requires a closed decoder',
      );
    }
    this.routes.push(route as AuthenticatedControlRoute<unknown, unknown>);
  }

  freeze(): void {
    this.frozen = true;
    Object.freeze(this.routes);
  }

  async dispatch(
    untrustedRequest: unknown,
    untrustedPrincipal: Readonly<ActorContext>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!this.frozen) {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_INVALID',
        'control router must be frozen before dispatch',
      );
    }
    const request = parseDispatchRequest(untrustedRequest);
    const principal = parseActorContext(untrustedPrincipal);
    if (principal.entryPath !== 'control') {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_INPUT_INVALID',
        'control router requires a control principal',
      );
    }
    const url = new URL(request.path, 'http://127.0.0.1');
    const candidates = this.routes.toSorted(
      (left, right) => parameterCount(left.path) - parameterCount(right.path),
    );
    for (const route of candidates) {
      if (route.method !== request.method) continue;
      const parameters = matchPath(route.path, url.pathname);
      if (parameters === undefined) continue;
      const query = Object.fromEntries(url.searchParams.entries());
      const combined = { ...strictPlainObject(request.input), ...query, ...parameters };
      const parsed = route.inputSchema.safeParse(combined);
      if (!parsed.success) {
        throw new AuthenticatedControlRouterError(
          'CONTROL_ROUTE_INPUT_INVALID',
          'control route input does not match its closed schema',
          { cause: parsed.error },
        );
      }
      // Only the first matching route executes; awaiting here preserves single-response semantics.
      // eslint-disable-next-line no-await-in-loop
      const result = await route.handle(principal, parsed.data, signal);
      if (Symbol.asyncIterator in Object(result)) {
        throw new AuthenticatedControlRouterError(
          'CONTROL_ROUTE_OUTPUT_INVALID',
          'async control output cannot bypass its declared decoder',
        );
      }
      const output = route.outputSchema.safeParse(result);
      if (!output.success) {
        throw new AuthenticatedControlRouterError(
          'CONTROL_ROUTE_OUTPUT_INVALID',
          'control route output does not match its closed schema',
          { cause: output.error },
        );
      }
      return output.data;
    }
    throw new AuthenticatedControlRouterError(
      'CONTROL_ROUTE_NOT_FOUND',
      'control route was not found',
    );
  }
}

interface ReadBodyResult {
  value: unknown;
  bytes: number;
}

const readBody = async (
  request: IncomingMessage,
  maximumBytes: number = CONTROL_LOGICAL_REQUEST_MAX_BYTES,
): Promise<ReadBodyResult> => {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      throw new AuthenticatedControlRouterError(
        'CONTROL_ROUTE_INPUT_INVALID',
        'control request body is too large',
      );
    }
    chunks.push(value);
  }
  if (bytes === 0) return { value: {}, bytes: 0 };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown, bytes };
  } catch (error) {
    throw new AuthenticatedControlRouterError(
      'CONTROL_ROUTE_INPUT_INVALID',
      'control request body is invalid JSON',
      { cause: error },
    );
  }
};
const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  let bytes = Buffer.from(JSON.stringify(body === undefined ? null : body), 'utf8');
  let safeStatus = status;
  if (bytes.byteLength > CONTROL_LOGICAL_REQUEST_MAX_BYTES) {
    safeStatus = 500;
    bytes = Buffer.from('{"code":"CONTROL_RESPONSE_TOO_LARGE"}', 'utf8');
  }
  response.writeHead(safeStatus, {
    'content-type': 'application/json',
    'content-length': String(bytes.byteLength),
    'cache-control': 'no-store',
  });
  response.end(bytes);
};
const publicError = (error: unknown): { status: number; code: string } => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'CONTROL_INTERNAL';
  if (Object.hasOwn(PUBLIC_ERROR_STATUS, code)) {
    return { status: PUBLIC_ERROR_STATUS[code] as number, code };
  }
  return { status: 500, code };
};

const PUBLIC_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  CONTROL_ROUTE_NOT_FOUND: 404,
  REMOTE_DOMAIN_NOT_FOUND: 404,
  CONTROL_REQUEST_TOO_LARGE: 413,
  APPROVAL_ALREADY_SETTLED: 409,
  EGRESS_CONFIG_CAS_MISMATCH: 409,
  OPERATION_ALREADY_SETTLED: 409,
  OPERATION_CANCELLED: 409,
  REMOTE_DOMAIN_ALREADY_EXISTS: 409,
  REMOTE_DOMAIN_CAPACITY_EXCEEDED: 409,
  REMOTE_DOMAIN_CAS_MISMATCH: 409,
  REMOTE_DOMAIN_TEMP_LIMIT_EXCEEDED: 409,
  TERMINAL_ALREADY_SETTLED: 409,
  WORKSPACE_ALREADY_CONFIGURED: 409,
  WORKSPACE_DEFAULT_IN_USE: 409,
  WORKSPACE_IN_USE: 409,
  ACTION_NONCE_INVALID: 400,
  ACTION_NONCE_REQUEST_HASH_MISMATCH: 400,
  ADMIN_AUDIT_CURSOR_INVALID: 400,
  ADMIN_AUDIT_QUERY_INVALID: 400,
  ADMIN_AUDIT_RESERVATION_INVALID: 400,
  ADMIN_AUDIT_ROW_INVALID: 400,
  APPROVAL_CONTROL_SESSION_MISMATCH: 400,
  APPROVAL_EXPIRED: 400,
  APPROVAL_GENERATION_MISMATCH: 400,
  APPROVAL_HASH_MISMATCH: 400,
  APPROVAL_ID_INVALID: 400,
  APPROVAL_RESUME_INVALID: 400,
  APPROVAL_SESSION_MISMATCH: 400,
  APPROVAL_TARGET_MISMATCH: 400,
  APPROVAL_TERMINAL_INVALID: 400,
  CANCEL_AUTH_SESSION_MISMATCH: 400,
  CONTROL_ROUTE_INPUT_INVALID: 400,
  CONTROL_ROUTE_INVALID: 400,
  CONTROL_ROUTE_OUTPUT_INVALID: 400,
  DEMOTION_TICKET_INVALID: 400,
  EGRESS_CONFIG_INVALID: 400,
  EGRESS_CONFIG_REQUIRED: 400,
  EGRESS_CONSENT_EXPIRED: 400,
  EGRESS_CONSENT_REQUIRED: 400,
  EGRESS_RESULT_INVALID: 400,
  EVIDENCE_FINALIZER_MISMATCH: 400,
  EXECUTION_PLANE_ALREADY_BOUND: 409,
  INVOCATION_ARGS_INVALID: 400,
  INVOCATION_CONSENT_INVALID: 400,
  INVOCATION_ORIGIN_INVALID: 400,
  INVOCATION_PRINCIPAL_INVALID: 400,
  INVOCATION_TARGET_INVALID: 400,
  INVOCATION_WORKSPACE_INVALID: 400,
  JOURNAL_TRANSITION_INVALID: 400,
  LEADER_GENERATION_CLOSE_TIMEOUT_INVALID: 400,
  LEADER_GENERATION_MISMATCH: 400,
  MCP_WORKSPACE_DEFAULT_INVALID: 400,
  MCP_WORKSPACE_REQUIRED: 400,
  OPERATION_EVIDENCE_INVALID: 400,
  OPERATION_ID_EXPIRED: 400,
  OPERATION_ID_INVALID: 400,
  OPERATION_ID_REQUIRED: 400,
  OPERATION_RESOLUTION_CONFIRMATION_INVALID: 400,
  PLUGIN_RESULT_INVALID: 400,
  POLICY_WORKSPACE_REQUIRED: 400,
  PRE_EGRESS_TERMINAL_INVALID: 400,
  REMOTE_CONTENT_LENGTH_INVALID: 400,
  REMOTE_CONTENT_LENGTH_MISMATCH: 400,
  REMOTE_DNS_ANSWER_INVALID: 400,
  REMOTE_DOMAIN_CONFIG_INVALID: 400,
  REMOTE_FQDN_INVALID: 400,
  REMOTE_HEADERS_INVALID: 400,
  REMOTE_MIME_INVALID: 400,
  REMOTE_POLICY_INVALID: 400,
  REMOTE_REDIRECT_INVALID: 400,
  REMOTE_SIGNATURE_INVALID: 400,
  REMOTE_STATUS_INVALID: 400,
  REMOTE_TIMEOUTS_INVALID: 400,
  REMOTE_URL_INVALID: 400,
  RESOLUTION_INTENT_INVALID: 400,
  SERVER_RESULT_INVALID: 400,
  SNAPSHOT_AUTHORITY_MISMATCH: 400,
  TARGET_ALREADY_EXISTS: 409,
  TARGET_REQUIRED: 400,
  TARGET_SESSION_INVALID: 400,
  WORKSPACE_AUTH_REQUIRED: 400,
  WORKSPACE_CONFIG_INVALID: 400,
  WORKSPACE_DEFAULT_INVALID: 400,
  WORKSPACE_DIRECTORY_REQUIRED: 400,
  WORKSPACE_PATH_INVALID: 400,
  WORKSPACE_REQUIRED: 400,
});

export const createControlHttpHandler =
  (dependencies: {
    router: AuthenticatedControlRouter;
    principalForRequest(request: IncomingMessage): Promise<Readonly<ActorContext>>;
  }) =>
  async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.url !== '/control' && request.url?.startsWith('/control/') !== true) return false;
    try {
      const method = request.method;
      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
        writeJson(response, 405, { code: 'CONTROL_ROUTE_INPUT_INVALID' });
        return true;
      }
      const pathBytes = Buffer.byteLength(request.url ?? '/control', 'utf8');
      if (pathBytes > CONTROL_LOGICAL_REQUEST_MAX_BYTES) {
        throw new AuthenticatedControlRouterError(
          'CONTROL_REQUEST_TOO_LARGE',
          'control path and query exceed their logical byte limit',
        );
      }
      const requestUrl = new URL(request.url ?? '/control', 'http://127.0.0.1');
      const isNetworkDomainDelete =
        method === 'DELETE' && /^\/control\/network\/domains\/[^/]+$/u.test(requestUrl.pathname);
      const isNetworkDomainPost =
        method === 'POST' && requestUrl.pathname === '/control/network/domains';
      const body =
        method === 'GET'
          ? { value: {}, bytes: 0 }
          : await readBody(request, CONTROL_LOGICAL_REQUEST_MAX_BYTES - pathBytes);
      let input = strictPlainObject(body.value);
      const actionNonce = request.headers['x-sfp-action-nonce'];
      if (isNetworkDomainDelete) {
        if (requestUrl.search.length !== 0 || body.bytes !== 0 || typeof actionNonce !== 'string') {
          throw new AuthenticatedControlRouterError(
            'CONTROL_ROUTE_INPUT_INVALID',
            'network-domain deletion requires one header nonce and no body or query fields',
          );
        }
        input = { actionNonce };
      } else if (
        isNetworkDomainPost &&
        (requestUrl.search.length !== 0 || actionNonce !== undefined)
      ) {
        throw new AuthenticatedControlRouterError(
          'CONTROL_ROUTE_INPUT_INVALID',
          'network-domain addition requires one body nonce and no query or header aliases',
        );
      } else if (method === 'DELETE' && typeof actionNonce === 'string') {
        input = { ...input, actionNonce };
      }
      const principal = await dependencies.principalForRequest(request);
      const result = await dependencies.router.dispatch(
        { method, path: request.url ?? '/control', input },
        principal,
        AbortSignal.timeout(30_000),
      );
      if (Symbol.asyncIterator in Object(result)) {
        writeJson(response, 501, { code: 'CONTROL_STREAM_NOT_AVAILABLE' });
      } else writeJson(response, 200, result);
    } catch (error) {
      const projected = publicError(error);
      writeJson(response, projected.status, { code: projected.code });
    }
    return true;
  };

export type ControlHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/** Keep expensive owner-state authorities behind the already-authenticated control seam. */
export const createLazyControlHttpHandler = (
  factory: () => Promise<ControlHttpHandler>,
): ControlHttpHandler => {
  let initialized: Promise<ControlHttpHandler> | null = null;
  return async (request, response) => {
    initialized ??= factory();
    const handler = await initialized;
    return handler(request, response);
  };
};
