import { decode, encode } from '@msgpack/msgpack';
import {
  ErrorCode,
  newId,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
} from '@sfp/shared';

import {
  createFollowerTransportRequestId,
  type FollowerTransportClient,
  FollowerTransportError,
  type LeaderInfo,
} from '../security/follower-transport.js';

export const DEFAULT_FOLLOWER_RPC_TIMEOUT_MS = 35_000;
export const DEFAULT_PING_TIMEOUT_MS = 2_000;

export type { LeaderInfo } from '../security/follower-transport.js';

export type AbdicationOutcome = 'ok' | 'busy' | 'refused' | 'unsupported' | 'error';

export interface FollowerOptions {
  leaderUrl: string;
  transport: FollowerTransportClient;
  rpcTimeoutMs?: number;
  pingTimeoutMs?: number;
  log?: (msg: string) => void;
}

const oneFinal = async (
  records: AsyncIterable<{ sequence: number; final: boolean; plaintext: Uint8Array }>,
): Promise<Buffer> => {
  let terminal: Buffer | undefined;
  let count = 0;
  for await (const record of records) {
    count += 1;
    if (count !== 1 || record.sequence !== 0 || !record.final || terminal !== undefined) {
      throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
    }
    terminal = Buffer.from(record.plaintext);
  }
  if (terminal === undefined || count !== 1) {
    throw new FollowerTransportError('FOLLOWER_RESPONSE_INVALID');
  }
  return terminal;
};

const transportErrorResponse = (requestId: string, error: unknown): RpcResponse => {
  if (error instanceof FollowerTransportError && error.code === 'FOLLOWER_AUTH_INVALID') {
    return {
      kind: 'err',
      requestId,
      code: ErrorCode.NotLeader,
      message: 'leader identity is not freshly authenticated for this generation',
    };
  }
  const limit =
    error instanceof FollowerTransportError &&
    ['FOLLOWER_RESPONSE_TRUNCATED', 'PAYLOAD_TOO_LARGE'].includes(error.code);
  return {
    kind: 'err',
    requestId,
    code: limit ? ErrorCode.PayloadTooLarge : ErrorCode.Internal,
    message: limit
      ? 'leader response exceeds the authenticated transport limit'
      : 'follower authenticated transport failed',
  };
};

export class Follower {
  private readonly opts: Required<Omit<FollowerOptions, 'log'>> & {
    log: (msg: string) => void;
  };

  constructor(opts: FollowerOptions) {
    this.opts = {
      leaderUrl: opts.leaderUrl,
      transport: opts.transport,
      rpcTimeoutMs: opts.rpcTimeoutMs ?? DEFAULT_FOLLOWER_RPC_TIMEOUT_MS,
      pingTimeoutMs: opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS,
      log: opts.log ?? ((): void => {}),
    };
  }

  get leaderUrl(): string {
    return this.opts.leaderUrl;
  }

  async ping(): Promise<boolean> {
    return (await this.leaderInfo()) !== undefined;
  }

  async leaderInfo(): Promise<LeaderInfo | undefined> {
    return this.opts.transport.leaderInfo(AbortSignal.timeout(this.opts.pingTimeoutMs));
  }

  async requestAbdication(buildId: number): Promise<AbdicationOutcome> {
    try {
      const signal = AbortSignal.timeout(this.opts.pingTimeoutMs);
      const records = await this.opts.transport.open(
        {
          path: '/abdicate',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext: Buffer.from(JSON.stringify({ buildId }), 'utf8'),
        },
        signal,
      );
      const body: unknown = JSON.parse((await oneFinal(records)).toString('utf8')) as unknown;
      if (typeof body !== 'object' || body === null) return 'error';
      if ((body as { ok?: unknown }).ok === true) return 'ok';
      const reason = (body as { reason?: unknown }).reason;
      if (reason === 'busy') return 'busy';
      if (reason === 'stale') return 'refused';
      if (reason === 'unsupported') return 'unsupported';
      return 'error';
    } catch {
      return 'error';
    }
  }

  /** Transitional read-only fallback. Task 7 replaces this with authenticated selector resolution. */
  resolveActiveSession(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  async sendRpc(
    toolName: string,
    args?: unknown,
    requestId?: string,
    sessionId?: string,
    timeoutMs?: number,
    abort?: AbortSignal,
  ): Promise<RpcResponse> {
    const legacyRequestId = requestId ?? newId();
    const rpc: RpcRequest = {
      requestId: legacyRequestId,
      toolName,
      ...(args === undefined ? {} : { args }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
    const budget = AbortSignal.timeout(timeoutMs ?? this.opts.rpcTimeoutMs);
    const signal = abort === undefined ? budget : AbortSignal.any([budget, abort]);
    try {
      const encoded = encode(rpc);
      const records = await this.opts.transport.open(
        {
          path: '/rpc',
          transportRequestId: createFollowerTransportRequestId(),
          plaintext: Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength),
        },
        signal,
      );
      const parsed = RpcResponseSchema.safeParse(decode(await oneFinal(records)));
      if (!parsed.success || parsed.data.requestId !== legacyRequestId) {
        return {
          kind: 'err',
          requestId: legacyRequestId,
          code: ErrorCode.Internal,
          message: 'invalid authenticated RPC response from leader',
        };
      }
      return parsed.data;
    } catch (error) {
      this.opts.log('[follower] authenticated RPC transport failed');
      return transportErrorResponse(legacyRequestId, error);
    }
  }
}
