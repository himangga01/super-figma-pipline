import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { decode, encode } from '@msgpack/msgpack';
import {
  ErrorCode,
  getRelayBudget,
  PairExchangeRequestSchema,
  PRODUCT_MAGIC,
  PROTOCOL_VERSION,
  type PublicPingV1,
  RpcRequestSchema,
  type RpcResponse,
} from '@sfp/shared';

import type { Relay } from '../relay/relay.js';
import type { FollowerAuthenticatedTransport } from '../security/follower-transport.js';
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
  transport: Pick<FollowerAuthenticatedTransport, 'server' | 'control'>;
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
        const ping: PublicPingV1 = {
          ok: true,
          product: PRODUCT_MAGIC,
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: deps.serverVersion,
          buildId: deps.buildId ?? 0,
          leaderGeneration: deps.leaderGeneration,
          role: 'leader',
        };
        writeJson(res, 200, ping);
        return;
      }

      if (req.method === 'GET' && req.url === FOLLOWER_CHALLENGE_PATH) {
        await deps.transport.server.serveChallengeHttp(req, res);
        return;
      }

      if (req.url === '/control' || req.url?.startsWith('/control/') === true) {
        if (!(await deps.transport.control.authorizeHttp(req))) {
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
        await deps.transport.server.serveHttp(req, res, ABDICATE_PATH, async (opened, response) => {
          let requesterBuildId: number | undefined;
          try {
            requesterBuildId = strictBuildId(
              JSON.parse(Buffer.from(opened.plaintext).toString('utf8')) as unknown,
            );
          } catch {
            // Invalid JSON is the same authenticated invalid request as an invalid buildId.
          }
          if (requesterBuildId === undefined) {
            await response.write(jsonBytes({ ok: false, reason: 'invalid' }), { final: true });
            return;
          }
          if (requesterBuildId <= (deps.buildId ?? 0)) {
            await response.write(jsonBytes({ ok: false, reason: 'stale' }), { final: true });
            return;
          }
          if (deps.onAbdicate === undefined) {
            await response.write(jsonBytes({ ok: false, reason: 'unsupported' }), { final: true });
            return;
          }
          const quietWindowMs = deps.abdicateQuietWindowMs ?? ABDICATE_QUIET_WINDOW_MS;
          const lastRequestAt = deps.relay.lastRequestAt();
          if (
            deps.relay.pendingCount() > 0 ||
            (lastRequestAt !== 0 && Date.now() - lastRequestAt < quietWindowMs)
          ) {
            await response.write(jsonBytes({ ok: false, reason: 'busy' }), { final: true });
            return;
          }
          log(`[leader] abdicating to a newer build (${requesterBuildId} > ${deps.buildId ?? 0})`);
          res.once('finish', () => deps.onAbdicate?.());
          await response.write(jsonBytes({ ok: true }), { final: true });
        });
        return;
      }

      if (req.method === 'POST' && req.url === RPC_PATH) {
        await deps.transport.server.serveHttp(req, res, RPC_PATH, async (opened, response) => {
          let decoded: unknown;
          try {
            decoded = decode(opened.plaintext);
          } catch {
            await response.write(
              Buffer.from(
                encode({
                  kind: 'err',
                  requestId: '',
                  code: ErrorCode.InvalidRequest,
                  message: 'invalid msgpack body',
                } satisfies RpcResponse),
              ),
              { final: true },
            );
            return;
          }
          const rpc = RpcRequestSchema.safeParse(decoded);
          if (!rpc.success) {
            await response.write(
              Buffer.from(
                encode({
                  kind: 'err',
                  requestId: '',
                  code: ErrorCode.InvalidParams,
                  message: 'invalid rpc request',
                } satisfies RpcResponse),
              ),
              { final: true },
            );
            return;
          }
          const { requestId, toolName, args, sessionId } = rpc.data;
          let body: RpcResponse;
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
            body = {
              kind: 'ok',
              requestId,
              result,
              ...(notice === null ? {} : { notice }),
            };
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
          await response.write(Buffer.from(encode(body)), { final: true });
        });
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
