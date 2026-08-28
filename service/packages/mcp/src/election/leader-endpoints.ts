import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { decode, encode } from '@msgpack/msgpack';
import {
  ErrorCode,
  getRelayBudget,
  PairExchangeRequestSchema,
  PRODUCT_MAGIC,
  PROTOCOL_VERSION,
  RpcRequestSchema,
  type RpcResponse,
} from '@sfp/shared';

import type { Relay } from '../relay/relay.js';
import type { FollowerAuth, OpenedFollowerRequest } from '../security/follower-auth.js';
import {
  hasContentType,
  isAllowedHost,
  isAllowedHttpOrigin,
  isAllowedPluginOrigin,
} from '../security/local-access.js';
import { PairingError, type PairingManager } from '../security/pairing-manager.js';
import {
  fitsHttpResponse,
  PAIR_METADATA_MAX_BYTES,
  readBoundedBody,
  RequestLimitError,
  RPC_REQUEST_MAX_BYTES,
} from '../security/request-limits.js';

export const PING_PATH = '/ping';
export const RPC_PATH = '/rpc';
export const ABDICATE_PATH = '/abdicate';
export const PAIR_EXCHANGE_PATH = '/pair/exchange';
export const CONTROL_PAIR_CHALLENGE_PATH = '/control/pair/challenge';
export const FOLLOWER_CHALLENGE_PATH = '/follower/challenge';

export const ABDICATE_QUIET_WINDOW_MS = 10_000;

export interface LeaderEndpointDeps {
  relay: Relay;
  serverVersion: string;
  buildId?: number;
  leaderGeneration: string;
  auth: Pick<FollowerAuth, 'authorizeFollower' | 'authorizeControl'> &
    Partial<
      Pick<FollowerAuth, 'issueFollowerChallenge' | 'openFollowerRequest' | 'sealFollowerResponse'>
    >;
  pairing: Pick<PairingManager, 'createChallenge' | 'exchange'>;
  controlActor?: string;
  onAbdicate?: () => void;
  log?: (msg: string) => void;
  rpcTimeoutMs?: number;
  abdicateQuietWindowMs?: number;
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

const writeEmpty = (
  res: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { 'content-length': '0', ...headers });
  res.end();
};

const jsonBytes = (body: unknown): Buffer => Buffer.from(JSON.stringify(body), 'utf8');

const writeJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  let bytes = jsonBytes(body);
  let safeStatus = status;
  if (!fitsHttpResponse(bytes.byteLength)) {
    safeStatus = 500;
    bytes = jsonBytes({ code: 'PAYLOAD_TOO_LARGE' });
  }
  res.writeHead(safeStatus, {
    'content-type': 'application/json',
    'content-length': bytes.byteLength.toString(),
    ...headers,
  });
  res.end(bytes);
};

const writeMsgpack = (
  res: ServerResponse,
  status: number,
  body: RpcResponse,
  headers: Record<string, string> = {},
): void => {
  let bytes = Buffer.from(encode(body));
  let safeStatus = status;
  if (!fitsHttpResponse(bytes.byteLength)) {
    safeStatus = 413;
    bytes = Buffer.from(
      encode({
        kind: 'err',
        requestId: body.requestId,
        code: ErrorCode.PayloadTooLarge,
        message: 'leader response exceeds the HTTP response limit',
      } satisfies RpcResponse),
    );
  }
  res.writeHead(safeStatus, {
    'content-type': 'application/msgpack',
    'content-length': bytes.byteLength.toString(),
    ...headers,
  });
  res.end(bytes);
};

const pairHeaders = (origin: string): Record<string, string> => ({
  'access-control-allow-origin': origin,
  'access-control-allow-private-network': 'true',
  'cache-control': 'no-store',
  vary: 'Origin',
});

const writeAllowedPairJson = (
  res: ServerResponse,
  origin: string,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void => writeJson(res, status, body, { ...pairHeaders(origin), ...extraHeaders });

const rejectPairOrigin = (res: ServerResponse): void =>
  writeEmpty(res, 403, { connection: 'close', vary: 'Origin' });

const exactPreflight = (req: IncomingMessage): string | undefined => {
  const origin = header(req, 'origin');
  if (
    req.method !== 'OPTIONS' ||
    req.url !== PAIR_EXCHANGE_PATH ||
    !isAllowedPluginOrigin(origin) ||
    header(req, 'access-control-request-method') !== 'POST' ||
    header(req, 'access-control-request-headers')?.toLowerCase() !== 'content-type' ||
    header(req, 'access-control-request-private-network') !== 'true'
  ) {
    return undefined;
  }
  return origin;
};

const pairErrorBody = (error: PairingError): Record<string, unknown> => ({
  code: error.code,
  ...(error.attemptsRemaining === undefined ? {} : { attemptsRemaining: error.attemptsRemaining }),
});

const hasUnreadBody = (req: IncomingMessage): boolean => {
  const contentLength = header(req, 'content-length');
  if (contentLength !== undefined && contentLength !== '0') return true;
  return header(req, 'transfer-encoding') !== undefined;
};

const unreadBodyHeaders = (
  req: IncomingMessage,
  headers: Record<string, string> = {},
): Record<string, string> => (hasUnreadBody(req) ? { ...headers, connection: 'close' } : headers);

const authorize = async (
  req: IncomingMessage,
  kind: 'follower' | 'control',
  deps: LeaderEndpointDeps,
): Promise<boolean> => {
  const authorization = header(req, 'authorization');
  const generation = header(req, 'x-sfp-leader-generation');
  return kind === 'follower'
    ? deps.auth.authorizeFollower(authorization, generation)
    : deps.auth.authorizeControl(authorization, generation);
};

const strictBuildId = (input: unknown): number | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.buildId !== 'number') return undefined;
  return Number.isSafeInteger(record.buildId) && record.buildId >= 0 ? record.buildId : undefined;
};

export const attachLeaderEndpoints = (http: HttpServer, deps: LeaderEndpointDeps): (() => void) => {
  const log = deps.log ?? ((): void => {});

  const routePairExchange = async (
    req: IncomingMessage,
    res: ServerResponse,
    origin: string,
  ): Promise<void> => {
    if (!hasContentType(header(req, 'content-type'), 'application/json')) {
      writeAllowedPairJson(res, origin, 400, { code: 'PAIR_BODY_INVALID' }, unreadBodyHeaders(req));
      return;
    }
    try {
      const body = await readBoundedBody(req, PAIR_METADATA_MAX_BYTES);
      let decoded: unknown;
      try {
        decoded = JSON.parse(body.toString('utf8')) as unknown;
      } catch {
        throw new PairingError('PAIR_BODY_INVALID', 400);
      }
      const parsed = PairExchangeRequestSchema.safeParse(decoded);
      if (!parsed.success) throw new PairingError('PAIR_BODY_INVALID', 400);
      const result = await deps.pairing.exchange(parsed.data.challengeId, parsed.data.code);
      writeAllowedPairJson(res, origin, 200, result);
    } catch (error) {
      if (error instanceof RequestLimitError) {
        writeAllowedPairJson(
          res,
          origin,
          error.status,
          { code: error.code },
          { connection: 'close' },
        );
        return;
      }
      if (error instanceof PairingError) {
        writeAllowedPairJson(res, origin, error.status, pairErrorBody(error));
        return;
      }
      log('[leader] pair exchange failed (PAIR_INTERNAL)');
      writeAllowedPairJson(res, origin, 500, { code: 'PAIR_INTERNAL' });
    }
  };

  const openFollowerBody = async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    maxBytes: number,
  ): Promise<OpenedFollowerRequest | undefined> => {
    if (!hasContentType(header(req, 'content-type'), 'application/sfp-encrypted')) {
      writeEmpty(res, 401, { connection: 'close' });
      return undefined;
    }
    const ciphertext = await readBoundedBody(req, maxBytes);
    try {
      if (deps.auth.openFollowerRequest === undefined) throw new Error('follower auth unavailable');
      return await deps.auth.openFollowerRequest({
        method: 'POST',
        path,
        headers: {
          'x-sfp-leader-generation': header(req, 'x-sfp-leader-generation'),
          'x-sfp-follower-nonce': header(req, 'x-sfp-follower-nonce'),
          'x-sfp-follower-proof': header(req, 'x-sfp-follower-proof'),
          'x-sfp-follower-iv': header(req, 'x-sfp-follower-iv'),
          'x-sfp-follower-tag': header(req, 'x-sfp-follower-tag'),
          'x-sfp-request-digest': header(req, 'x-sfp-request-digest'),
          'x-sfp-request-id': header(req, 'x-sfp-request-id'),
        },
        ciphertext,
      });
    } catch {
      writeEmpty(res, 401, { connection: 'close' });
      return undefined;
    }
  };

  const writeFollowerBytes = (
    res: ServerResponse,
    status: number,
    opened: OpenedFollowerRequest,
    requestId: string,
    plaintext: Buffer,
  ): void => {
    if (deps.auth.sealFollowerResponse === undefined) {
      writeEmpty(res, 500, { connection: 'close' });
      return;
    }
    const sealed = deps.auth.sealFollowerResponse(opened.context, status, requestId, plaintext);
    res.writeHead(status, {
      ...sealed.headers,
      'content-length': sealed.body.byteLength.toString(),
      'cache-control': 'no-store',
    });
    res.end(sealed.body);
  };

  const writeFollowerJson = (
    res: ServerResponse,
    status: number,
    opened: OpenedFollowerRequest,
    body: unknown,
  ): void => writeFollowerBytes(res, status, opened, opened.context.requestId, jsonBytes(body));

  const writeFollowerMsgpack = (
    res: ServerResponse,
    status: number,
    opened: OpenedFollowerRequest,
    body: RpcResponse,
  ): void => {
    let safeStatus = status;
    let bytes = Buffer.from(encode(body));
    if (!fitsHttpResponse(bytes.byteLength)) {
      safeStatus = 413;
      bytes = Buffer.from(
        encode({
          kind: 'err',
          requestId: opened.context.requestId,
          code: ErrorCode.PayloadTooLarge,
          message: 'leader response exceeds the HTTP response limit',
        } satisfies RpcResponse),
      );
    }
    writeFollowerBytes(res, safeStatus, opened, opened.context.requestId, bytes);
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void (async (): Promise<void> => {
      if (!isAllowedHost(header(req, 'host'))) {
        log(`[leader] refused ${req.method ?? '?'} request for a non-loopback Host`);
        writeEmpty(res, 403, { connection: 'close' });
        return;
      }

      if (req.method === 'OPTIONS' && hasUnreadBody(req)) {
        writeEmpty(res, 403, { connection: 'close' });
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && hasUnreadBody(req)) {
        writeJson(res, 400, { error: 'request body not allowed' }, { connection: 'close' });
        return;
      }

      if (req.method === 'OPTIONS') {
        const origin = exactPreflight(req);
        if (origin === undefined) {
          writeEmpty(res, 403);
          return;
        }
        writeEmpty(res, 204, {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-private-network': 'true',
          'access-control-max-age': '0',
          vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
        });
        return;
      }

      if (req.method === 'POST' && req.url === PAIR_EXCHANGE_PATH) {
        const origin = header(req, 'origin');
        if (!isAllowedPluginOrigin(origin)) {
          rejectPairOrigin(res);
          return;
        }
        await routePairExchange(req, res, origin);
        return;
      }

      if (!isAllowedHttpOrigin(header(req, 'origin'))) {
        writeEmpty(res, 403, { connection: 'close' });
        return;
      }

      if (req.method === 'GET' && req.url === PING_PATH) {
        writeJson(res, 200, {
          ok: true,
          product: PRODUCT_MAGIC,
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: deps.serverVersion,
          buildId: deps.buildId ?? 0,
          leaderGeneration: deps.leaderGeneration,
          role: 'leader',
          plugins: deps.relay.sessions.connected().length,
          activeSessionId: deps.relay.pickActiveSessionId() ?? null,
        });
        return;
      }

      if (req.method === 'GET' && req.url === FOLLOWER_CHALLENGE_PATH) {
        try {
          if (deps.auth.issueFollowerChallenge === undefined) {
            throw new Error('follower challenge unavailable');
          }
          writeJson(res, 200, await deps.auth.issueFollowerChallenge(), {
            'cache-control': 'no-store',
          });
        } catch {
          writeJson(res, 503, { code: 'FOLLOWER_AUTH_UNAVAILABLE' }, { connection: 'close' });
        }
        return;
      }

      if (req.url === '/control' || req.url?.startsWith('/control/') === true) {
        if (!(await authorize(req, 'control', deps))) {
          writeEmpty(res, 401, { connection: 'close' });
          return;
        }
        if (req.method === 'POST' && req.url === CONTROL_PAIR_CHALLENGE_PATH) {
          if (hasUnreadBody(req)) {
            writeJson(
              res,
              400,
              { code: 'PAIR_BODY_INVALID' },
              unreadBodyHeaders(req, { 'cache-control': 'no-store' }),
            );
            return;
          }
          try {
            const challenge = await deps.pairing.createChallenge(
              deps.controlActor ?? 'owner-local',
            );
            writeJson(res, 200, challenge, { 'cache-control': 'no-store' });
          } catch (error) {
            if (error instanceof PairingError) {
              writeJson(res, error.status, pairErrorBody(error), {
                'cache-control': 'no-store',
              });
            } else {
              log('[leader] control pair challenge failed (PAIR_INTERNAL)');
              writeJson(res, 500, { code: 'PAIR_INTERNAL' }, { 'cache-control': 'no-store' });
            }
          }
          return;
        }
        writeJson(res, 404, { error: 'not found' }, unreadBodyHeaders(req));
        return;
      }

      if (req.method === 'POST' && req.url === ABDICATE_PATH) {
        let opened: OpenedFollowerRequest | undefined;
        let requesterBuildId: number | undefined;
        try {
          opened = await openFollowerBody(req, res, ABDICATE_PATH, PAIR_METADATA_MAX_BYTES);
          if (opened === undefined) return;
          requesterBuildId = strictBuildId(
            JSON.parse(opened.plaintext.toString('utf8')) as unknown,
          );
        } catch (error) {
          if (error instanceof RequestLimitError) {
            writeJson(res, error.status, { code: error.code }, { connection: 'close' });
            return;
          }
        }
        if (opened === undefined) return;
        if (requesterBuildId === undefined) {
          writeFollowerJson(res, 400, opened, { ok: false, reason: 'invalid' });
          return;
        }
        if (requesterBuildId <= (deps.buildId ?? 0)) {
          writeFollowerJson(res, 200, opened, { ok: false, reason: 'stale' });
          return;
        }
        if (deps.onAbdicate === undefined) {
          writeFollowerJson(res, 200, opened, { ok: false, reason: 'unsupported' });
          return;
        }
        const quietWindowMs = deps.abdicateQuietWindowMs ?? ABDICATE_QUIET_WINDOW_MS;
        const lastRequestAt = deps.relay.lastRequestAt();
        if (
          deps.relay.pendingCount() > 0 ||
          (lastRequestAt !== 0 && Date.now() - lastRequestAt < quietWindowMs)
        ) {
          writeFollowerJson(res, 200, opened, { ok: false, reason: 'busy' });
          return;
        }
        log(`[leader] abdicating to a newer build (${requesterBuildId} > ${deps.buildId ?? 0})`);
        res.once('finish', () => deps.onAbdicate?.());
        writeFollowerJson(res, 200, opened, { ok: true });
        return;
      }

      if (req.method === 'POST' && req.url === RPC_PATH) {
        let opened: OpenedFollowerRequest | undefined;
        let body: Buffer;
        try {
          opened = await openFollowerBody(req, res, RPC_PATH, RPC_REQUEST_MAX_BYTES);
          if (opened === undefined) return;
          body = opened.plaintext;
        } catch (error) {
          if (error instanceof RequestLimitError) {
            writeMsgpack(
              res,
              error.status,
              {
                kind: 'err',
                requestId: '',
                code: ErrorCode.PayloadTooLarge,
                message: 'RPC request exceeds the payload limit',
              },
              { connection: 'close' },
            );
          } else {
            writeMsgpack(res, 400, {
              kind: 'err',
              requestId: '',
              code: ErrorCode.InvalidRequest,
              message: 'request body failed',
            });
          }
          return;
        }
        if (opened === undefined) return;
        let decoded: unknown;
        try {
          decoded = decode(body);
        } catch {
          writeFollowerMsgpack(res, 400, opened, {
            kind: 'err',
            requestId: opened.context.requestId,
            code: ErrorCode.InvalidRequest,
            message: 'invalid msgpack body',
          });
          return;
        }
        const rpc = RpcRequestSchema.safeParse(decoded);
        if (!rpc.success) {
          writeFollowerMsgpack(res, 400, opened, {
            kind: 'err',
            requestId: opened.context.requestId,
            code: ErrorCode.InvalidParams,
            message: 'invalid rpc request',
          });
          return;
        }
        const { requestId, toolName, args, sessionId } = rpc.data;
        if (requestId !== opened.context.requestId) {
          writeFollowerMsgpack(res, 400, opened, {
            kind: 'err',
            requestId: opened.context.requestId,
            code: ErrorCode.InvalidRequest,
            message: 'transport requestId does not match RPC requestId',
          });
          return;
        }
        try {
          let notice: string | null = null;
          const result = await deps.relay.sendRequest(
            toolName,
            args,
            deps.rpcTimeoutMs ?? getRelayBudget(toolName),
            sessionId,
            served => {
              notice = deps.relay.skewNotice(served);
            },
          );
          writeFollowerMsgpack(res, 200, opened, {
            kind: 'ok',
            requestId,
            result,
            ...(notice === null ? {} : { notice }),
          });
        } catch (error) {
          const message = (error as Error).message;
          const code =
            message.startsWith('no plugin connected') || message.startsWith('pinned session')
              ? ErrorCode.PluginDisconnected
              : message.includes('timeout')
                ? ErrorCode.Timeout
                : ErrorCode.Internal;
          writeFollowerMsgpack(res, 200, opened, {
            kind: 'err',
            requestId,
            code,
            message,
          });
        }
        return;
      }

      writeJson(res, 404, { error: 'not found' }, unreadBodyHeaders(req));
    })().catch(() => {
      if (!res.headersSent) writeJson(res, 500, { error: 'internal' });
      else res.destroy();
    });
  };

  http.on('request', handler);
  return (): void => {
    http.removeListener('request', handler);
  };
};
