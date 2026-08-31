import { createHash, randomBytes as systemRandomBytes } from 'node:crypto';

import {
  ACTION_NONCE_MAX_BYTES_PER_ACTOR,
  ACTION_NONCE_MAX_ROWS_PER_ACTOR,
  ACTION_NONCE_TTL_MS,
  ActionNonceActionSchema,
  ActionNonceRequestHashSchema,
  parseActorContext,
  type ActionNonceAction,
  type ActionNonceClaims,
  type ActionNonceStore,
  type ActorContext,
  type PrefixedSha256,
  type ResolvedWorkspaceRegistration,
} from '@sfp/shared';

interface StoredNonce {
  claims: ActionNonceClaims;
  authSessionId: ActorContext['authSessionId'];
  rawNonceBytes: Uint8Array;
  registration: Readonly<ResolvedWorkspaceRegistration> | null;
  rowBytes: number;
}

export interface ActionNonceStoreOptions {
  leaderGeneration: string;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  maxRowsPerActor?: number;
  maxBytesPerActor?: number;
}

export class ActionNonceError extends Error {
  constructor(
    readonly code:
      | 'ACTION_NONCE_INVALID'
      | 'ACTION_NONCE_CAPACITY_EXCEEDED'
      | 'ACTION_NONCE_REQUEST_HASH_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ActionNonceError';
  }
}

const immutableClaims = (claims: ActionNonceClaims): Readonly<ActionNonceClaims> =>
  Object.freeze({ ...claims });
const retainedRowSize = (input: {
  claims: ActionNonceClaims;
  authSessionId: ActorContext['authSessionId'];
  rawNonceBytes: Uint8Array;
  registration: Readonly<ResolvedWorkspaceRegistration> | null;
}): number =>
  Buffer.byteLength(
    `${JSON.stringify({
      claims: input.claims,
      authSessionId: input.authSessionId,
      rawNonce: Buffer.from(input.rawNonceBytes).toString('base64url'),
      registration: input.registration,
    })}\n`,
    'utf8',
  );
const sha256 = (...parts: readonly (string | Uint8Array)[]): PrefixedSha256 => {
  const digest = createHash('sha256');
  for (const part of parts) digest.update(part);
  return `sha256:${digest.digest('hex')}`;
};

export interface ActionNonceAuthority extends ActionNonceStore {
  issueWorkspaceAdd(
    actor: Readonly<ActorContext>,
    requestHash: PrefixedSha256,
    registration: Readonly<ResolvedWorkspaceRegistration>,
  ): Promise<Readonly<ActionNonceClaims>>;
  registrationFor(
    actor: Readonly<ActorContext>,
    value: string,
  ): Readonly<ResolvedWorkspaceRegistration> | undefined;
  get(value: string): Readonly<ActionNonceClaims> | undefined;
  claimHash(value: string): PrefixedSha256;
}

export const createActionNonceStore = (options: ActionNonceStoreOptions): ActionNonceAuthority => {
  if (
    typeof options.leaderGeneration !== 'string' ||
    options.leaderGeneration.length === 0 ||
    options.leaderGeneration.length > 256
  ) {
    throw new ActionNonceError('ACTION_NONCE_INVALID', 'leader generation is invalid');
  }
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? (size => systemRandomBytes(size));
  const maxRows = options.maxRowsPerActor ?? ACTION_NONCE_MAX_ROWS_PER_ACTOR;
  const maxBytes = options.maxBytesPerActor ?? ACTION_NONCE_MAX_BYTES_PER_ACTOR;
  const rows = new Map<string, StoredNonce>();
  let mutation = Promise.resolve();

  const exclusive = <T>(operation: () => T | Promise<T>): Promise<T> => {
    const result = mutation.then(operation);
    mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const validActor = (value: Readonly<ActorContext>): Readonly<ActorContext> => {
    const actor = parseActorContext(value);
    if (actor.entryPath !== 'control') {
      throw new ActionNonceError(
        'ACTION_NONCE_INVALID',
        'action nonces require an authenticated control principal',
      );
    }
    return actor;
  };
  const purgeExpired = (timestamp: number): void => {
    for (const [value, stored] of rows) {
      if (timestamp >= stored.claims.expiresAt) rows.delete(value);
    }
  };
  const actorUsage = (actorId: string): { rows: number; bytes: number } => {
    let actorRows = 0;
    let actorBytes = 0;
    for (const stored of rows.values()) {
      if (stored.claims.actorId !== actorId) continue;
      actorRows += 1;
      actorBytes += stored.rowBytes;
    }
    return { rows: actorRows, bytes: actorBytes };
  };
  const issue = (
    untrustedActor: Readonly<ActorContext>,
    untrustedAction: ActionNonceAction,
    untrustedHash: PrefixedSha256,
    registration: Readonly<ResolvedWorkspaceRegistration> | null,
  ): Promise<Readonly<ActionNonceClaims>> =>
    exclusive(() => {
      const actor = validActor(untrustedActor);
      const action = ActionNonceActionSchema.parse(untrustedAction);
      const requestHash = ActionNonceRequestHashSchema.parse(untrustedHash) as PrefixedSha256;
      if ((action === 'workspace.add') !== (registration !== null)) {
        throw new ActionNonceError(
          'ACTION_NONCE_INVALID',
          'workspace.add nonce binding is incomplete',
        );
      }
      const issuedAt = now();
      purgeExpired(issuedAt);
      let bytes = Uint8Array.from(randomBytes(32));
      if (bytes.byteLength !== 32) {
        throw new ActionNonceError('ACTION_NONCE_INVALID', 'nonce entropy source failed');
      }
      let value = `sfp_an1_${Buffer.from(bytes).toString('base64url')}` as const;
      while (rows.has(value)) {
        bytes = Uint8Array.from(randomBytes(32));
        if (bytes.byteLength !== 32) {
          throw new ActionNonceError('ACTION_NONCE_INVALID', 'nonce entropy source failed');
        }
        value = `sfp_an1_${Buffer.from(bytes).toString('base64url')}`;
      }
      const claims: ActionNonceClaims = {
        value,
        actorId: actor.actorId,
        leaderGeneration: options.leaderGeneration,
        action,
        requestHash,
        issuedAt,
        expiresAt: issuedAt + ACTION_NONCE_TTL_MS,
        state: 'issued',
      };
      const retainedRegistration =
        registration === null ? null : Object.freeze({ ...registration });
      const bytesForRow = retainedRowSize({
        claims,
        authSessionId: actor.authSessionId,
        rawNonceBytes: bytes,
        registration: retainedRegistration,
      });
      const usage = actorUsage(actor.actorId);
      if (usage.rows + 1 > maxRows || usage.bytes + bytesForRow > maxBytes) {
        throw new ActionNonceError(
          'ACTION_NONCE_CAPACITY_EXCEEDED',
          'action nonce capacity is exhausted',
        );
      }
      rows.set(value, {
        claims,
        authSessionId: actor.authSessionId,
        rawNonceBytes: bytes,
        registration: retainedRegistration,
        rowBytes: bytesForRow,
      });
      return immutableClaims(claims);
    });

  const consumeCas = (
    untrustedActor: Readonly<ActorContext>,
    value: string,
    untrustedAction: ActionNonceAction,
    untrustedHash: PrefixedSha256,
    beforeConsume?: (() => Promise<void>) | undefined,
  ): Promise<void> =>
    exclusive(async () => {
      const actor = validActor(untrustedActor);
      const action = ActionNonceActionSchema.parse(untrustedAction);
      const requestHash = ActionNonceRequestHashSchema.parse(untrustedHash) as PrefixedSha256;
      const timestamp = now();
      const stored = rows.get(value);
      if (
        stored === undefined ||
        timestamp >= stored.claims.expiresAt ||
        stored.claims.state !== 'issued' ||
        stored.claims.actorId !== actor.actorId ||
        stored.authSessionId !== actor.authSessionId ||
        stored.claims.leaderGeneration !== options.leaderGeneration ||
        stored.claims.action !== action ||
        stored.claims.requestHash !== requestHash
      ) {
        if (stored !== undefined && timestamp >= stored.claims.expiresAt) rows.delete(value);
        throw new ActionNonceError(
          'ACTION_NONCE_INVALID',
          'action nonce is expired, consumed, foreign, or mismatched',
        );
      }
      await beforeConsume?.();
      if (now() >= stored.claims.expiresAt || stored.claims.state !== 'issued') {
        throw new ActionNonceError(
          'ACTION_NONCE_INVALID',
          'action nonce expired or changed during guarded consumption',
        );
      }
      const consumed = { ...stored.claims, state: 'consumed' as const };
      const consumedBytes = retainedRowSize({
        claims: consumed,
        authSessionId: stored.authSessionId,
        rawNonceBytes: stored.rawNonceBytes,
        registration: stored.registration,
      });
      const usage = actorUsage(actor.actorId);
      if (usage.bytes - stored.rowBytes + consumedBytes > maxBytes) {
        throw new ActionNonceError(
          'ACTION_NONCE_CAPACITY_EXCEEDED',
          'action nonce retained-byte capacity is exhausted',
        );
      }
      stored.claims = consumed;
      stored.rowBytes = consumedBytes;
    });

  const authority: ActionNonceAuthority = {
    issue: (actor, action, requestHash) => issue(actor, action, requestHash, null),
    issueWorkspaceAdd: (actor, requestHash, registration) =>
      issue(actor, 'workspace.add', requestHash, registration),
    consumeCas,
    registrationFor: (actor, value) => {
      const parsed = validActor(actor);
      const stored = rows.get(value);
      if (
        stored?.claims.actorId !== parsed.actorId ||
        stored.authSessionId !== parsed.authSessionId ||
        stored.registration === null
      )
        return undefined;
      return stored.registration;
    },
    get: value => {
      const stored = rows.get(value);
      return stored === undefined ? undefined : immutableClaims(stored.claims);
    },
    claimHash: value => {
      const stored = rows.get(value);
      if (stored === undefined) {
        throw new ActionNonceError('ACTION_NONCE_INVALID', 'action nonce was not issued here');
      }
      const nonceIdHash = sha256('sfp-action-nonce-id-v1', Uint8Array.of(0), stored.rawNonceBytes);
      return sha256(
        'sfp-action-nonce-claim-v1',
        Uint8Array.of(0),
        JSON.stringify({
          nonceIdHash,
          actorId: stored.claims.actorId,
          authSessionId: stored.authSessionId,
          leaderGeneration: stored.claims.leaderGeneration,
          action: stored.claims.action,
          requestHash: stored.claims.requestHash,
          expiresAt: stored.claims.expiresAt,
        }),
      );
    },
  };
  return Object.freeze(authority);
};
