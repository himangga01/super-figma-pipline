import { randomBytes as systemRandomBytes } from 'node:crypto';

import {
  DEFAULT_EGRESS_CONFIG_V1,
  EgressConfigureRequestV1Schema,
  hashActionRequest,
  hashCanonicalJson,
  hashEgressConfig,
  type ActionNonceStore,
  type ActorContext,
  type AdminAuditAppendV1,
  type EgressConfigStatusV1,
  type EgressConfigStore,
  type EgressConfigV1,
  type ExternalModelDataClass,
  type PrefixedSha256,
} from '@sfp/shared';
import { z } from 'zod';

import type { ActionNonceAuthority } from './action-nonce-store.js';
import type { AdminAuditStore } from './admin-audit-store.js';

const ResetRequestSchema = z
  .object({ actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u) })
  .strict();

export interface EgressAuditTransactionInput {
  principal: Readonly<ActorContext>;
  action: 'egress.configure' | 'egress.reset';
  requestHash: PrefixedSha256;
  actionNonceClaimHash: PrefixedSha256;
  expectedConfigHash: PrefixedSha256;
  desiredConfigHash: PrefixedSha256;
  allowedClasses: readonly ExternalModelDataClass[];
  expiresAt: string | null;
}
export interface EgressAuditTransactionOperations {
  validateExpected(): Promise<void>;
  consumeNonce(): Promise<void>;
  commitConfig(): Promise<Readonly<EgressConfigV1>>;
}
export interface EgressAuditTransactionPort {
  transact(
    input: EgressAuditTransactionInput,
    operations: EgressAuditTransactionOperations,
  ): Promise<Readonly<EgressConfigV1>>;
}

const lockTails = new WeakMap<object, Map<string, Promise<void>>>();
const withActorConfigLock = async <T>(
  authority: object,
  actorId: `actor1_${string}`,
  operation: () => Promise<T>,
): Promise<T> => {
  let tails = lockTails.get(authority);
  if (tails === undefined) {
    tails = new Map();
    lockTails.set(authority, tails);
  }
  const previous = tails.get(actorId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(actorId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (tails.get(actorId) === tail) tails.delete(actorId);
  }
};

export const createEgressAdminAuditTransactions = (options: {
  store: AdminAuditStore;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}): EgressAuditTransactionPort => {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? (size => systemRandomBytes(size));
  const transactions: EgressAuditTransactionPort = {
    transact: (input, operations) =>
      withActorConfigLock(options.store, input.principal.actorId, async () => {
        const entropy = Uint8Array.from(randomBytes(16));
        if (entropy.byteLength !== 16) throw new Error('admin audit transaction entropy failed');
        const auditTransactionId =
          `sfp_atx1_${Buffer.from(entropy).toString('base64url')}` as const;
        const reservation = await options.store.reserveTransaction(
          input.principal.actorId,
          auditTransactionId,
        );
        const common = {
          schemaVersion: 1 as const,
          auditTransactionId,
          kind: 'egress' as const,
          actorId: input.principal.actorId,
          authSessionId: input.principal.authSessionId,
          action: input.action,
          actionNonceClaimHash: input.actionNonceClaimHash,
          requestHash: input.requestHash,
          expectedConfigHash: input.expectedConfigHash,
          allowedClasses: input.allowedClasses,
          expiresAt: input.expiresAt,
        };
        await options.store.appendAndFsync(reservation.handle, {
          ...common,
          stage: 'pending',
          desiredConfigHash: null,
          configHash: null,
          createdAt: new Date(now()).toISOString(),
        });
        let intentWritten = false;
        try {
          await operations.validateExpected();
          await operations.consumeNonce();
          await options.store.appendAndFsync(reservation.handle, {
            ...common,
            stage: 'cas-intent',
            desiredConfigHash: input.desiredConfigHash,
            configHash: null,
            createdAt: new Date(now()).toISOString(),
          });
          intentWritten = true;
          const configured = await operations.commitConfig();
          if (configured.configHash !== input.desiredConfigHash) {
            throw Object.assign(new Error('egress config CAS returned an unexpected hash'), {
              code: 'EGRESS_CONFIG_CAS_MISMATCH',
            });
          }
          await options.store.appendAndFsync(reservation.handle, {
            ...common,
            stage: 'committed',
            desiredConfigHash: input.desiredConfigHash,
            configHash: input.desiredConfigHash,
            createdAt: new Date(now()).toISOString(),
          });
          await options.store.releaseTransaction(reservation.handle);
          return configured;
        } catch (error) {
          const knownUncommitted =
            !intentWritten ||
            (typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              ['ACTION_NONCE_INVALID', 'EGRESS_CONFIG_CAS_MISMATCH'].includes(String(error.code)));
          if (knownUncommitted) {
            const aborted: AdminAuditAppendV1 = {
              ...common,
              stage: 'aborted',
              desiredConfigHash: intentWritten ? input.desiredConfigHash : null,
              configHash: input.expectedConfigHash,
              abortReason: String(
                typeof error === 'object' && error !== null && 'code' in error
                  ? error.code
                  : 'transaction-aborted',
              ).slice(0, 256),
              createdAt: new Date(now()).toISOString(),
            };
            await options.store.appendAndFsync(reservation.handle, aborted);
            await options.store.releaseTransaction(reservation.handle);
          }
          throw error;
        }
      }),
  };
  return Object.freeze(transactions);
};

const redactedStatus = (
  config: Readonly<EgressConfigV1>,
  expired: boolean,
): Readonly<EgressConfigStatusV1> =>
  Object.freeze({
    schemaVersion: 1,
    mode: config.mode,
    allowedClasses: Object.freeze([...config.allowedClasses]),
    configuredAt: config.configuredAt,
    expiresAt: config.expiresAt,
    configHash: config.configHash,
    expired,
  });

export const createEgressControl = (dependencies: {
  store: EgressConfigStore;
  nonceStore: ActionNonceStore & Partial<Pick<ActionNonceAuthority, 'claimHash'>>;
  audit: EgressAuditTransactionPort;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}) => {
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? (size => systemRandomBytes(size));
  const claimHash = (nonce: string): PrefixedSha256 =>
    dependencies.nonceStore.claimHash?.(nonce) ??
    hashCanonicalJson('sfp-action-nonce-claim-redacted-v1', {
      nonceId: hashCanonicalJson('sfp-action-nonce-id-v1', nonce),
    });
  return Object.freeze({
    status: async (): Promise<Readonly<EgressConfigStatusV1>> => {
      const loaded = await dependencies.store.load(now());
      return redactedStatus(loaded.config, loaded.expired);
    },
    configure: async (
      principal: Readonly<ActorContext>,
      input: unknown,
    ): Promise<Readonly<EgressConfigStatusV1>> => {
      const request = EgressConfigureRequestV1Schema.parse(input);
      const requestHash = hashActionRequest('egress.configure', {
        mode: request.mode,
        allowedClasses: request.allowedClasses,
        expiresInSeconds: request.expiresInSeconds,
      });
      return withActorConfigLock(dependencies.store, principal.actorId, async () => {
        const loaded = await dependencies.store.load(now());
        const configuredAtMs = now();
        const entropy = Uint8Array.from(randomBytes(16));
        if (entropy.byteLength !== 16) throw new Error('egress consent entropy source failed');
        const withoutHash = {
          schemaVersion: 1 as const,
          mode: 'external-model' as const,
          allowedClasses: Object.freeze([...request.allowedClasses]),
          consentId: `sfp_consent1_${Buffer.from(entropy).toString('base64url')}` as const,
          configuredAt: new Date(configuredAtMs).toISOString(),
          expiresAt: new Date(configuredAtMs + request.expiresInSeconds * 1_000).toISOString(),
        };
        const desired = Object.freeze({
          ...withoutHash,
          configHash: hashEgressConfig(withoutHash),
        }) satisfies Readonly<EgressConfigV1>;
        const configured = await dependencies.audit.transact(
          {
            principal,
            action: 'egress.configure',
            requestHash,
            actionNonceClaimHash: claimHash(request.actionNonce),
            expectedConfigHash: loaded.config.configHash,
            desiredConfigHash: desired.configHash,
            allowedClasses: desired.allowedClasses,
            expiresAt: desired.expiresAt,
          },
          {
            validateExpected: async () => {
              const observed = await dependencies.store.load(now());
              if (observed.config.configHash !== loaded.config.configHash) {
                throw Object.assign(new Error('stale expected egress config'), {
                  code: 'EGRESS_CONFIG_CAS_MISMATCH',
                });
              }
            },
            consumeNonce: () =>
              dependencies.nonceStore.consumeCas(
                principal,
                request.actionNonce,
                'egress.configure',
                requestHash,
              ),
            commitConfig: async () => {
              await dependencies.store.save(desired, loaded.config.configHash);
              return desired;
            },
          },
        );
        return redactedStatus(configured, false);
      });
    },
    reset: async (
      principal: Readonly<ActorContext>,
      input: unknown,
    ): Promise<Readonly<EgressConfigStatusV1>> => {
      const request = ResetRequestSchema.parse(input);
      const requestHash = hashActionRequest('egress.reset', {});
      return withActorConfigLock(dependencies.store, principal.actorId, async () => {
        const loaded = await dependencies.store.load(now());
        const reset = await dependencies.audit.transact(
          {
            principal,
            action: 'egress.reset',
            requestHash,
            actionNonceClaimHash: claimHash(request.actionNonce),
            expectedConfigHash: loaded.config.configHash,
            desiredConfigHash: DEFAULT_EGRESS_CONFIG_V1.configHash,
            allowedClasses: [],
            expiresAt: null,
          },
          {
            validateExpected: async () => {
              const observed = await dependencies.store.load(now());
              if (observed.config.configHash !== loaded.config.configHash) {
                throw Object.assign(new Error('stale expected egress config'), {
                  code: 'EGRESS_CONFIG_CAS_MISMATCH',
                });
              }
            },
            consumeNonce: () =>
              dependencies.nonceStore.consumeCas(
                principal,
                request.actionNonce,
                'egress.reset',
                requestHash,
              ),
            commitConfig: () => dependencies.store.reset(loaded.config.configHash),
          },
        );
        return redactedStatus(reset, false);
      });
    },
  });
};
