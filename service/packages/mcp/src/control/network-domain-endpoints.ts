import { hashActionRequest, type ActionNonceStore, type ActorContext } from '@sfp/shared';
import { z } from 'zod';

import {
  normalizeRemoteDomain,
  type RemoteDomainRule,
} from '../network/remote-domain-config-store.js';

const ActionNonceSchema = z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u);

export const NetworkDomainAddRequestSchema = z
  .object({
    fqdn: z.string().min(1).max(253),
    actionNonce: ActionNonceSchema,
  })
  .strict();

export const NetworkDomainRemoveRequestSchema = NetworkDomainAddRequestSchema;

export interface NetworkDomainMutationStore {
  list(): Promise<readonly Readonly<RemoteDomainRule>[]>;
  addAuthorized(
    actorId: ActorContext['actorId'],
    fqdnInput: string,
    consumeNonce: () => Promise<void>,
  ): Promise<Readonly<RemoteDomainRule>>;
  removeAuthorized(
    actorId: ActorContext['actorId'],
    fqdnInput: string,
    consumeNonce: () => Promise<void>,
  ): Promise<void>;
}

type CancellationSignal = Readonly<{ aborted: boolean }>;

const assertActive = (signal: CancellationSignal): void => {
  if (!signal.aborted) return;
  throw Object.assign(new Error('network-domain request was cancelled before mutation'), {
    code: 'OPERATION_CANCELLED',
  });
};

export const createNetworkDomainEndpoints = (dependencies: {
  store: NetworkDomainMutationStore;
  nonceStore: ActionNonceStore;
}) =>
  Object.freeze({
    list: async (): Promise<readonly Readonly<RemoteDomainRule>[]> => dependencies.store.list(),
    add: async (
      principal: Readonly<ActorContext>,
      input: unknown,
      signal: CancellationSignal,
    ): Promise<Readonly<RemoteDomainRule>> => {
      const request = NetworkDomainAddRequestSchema.parse(input);
      const fqdnAscii = normalizeRemoteDomain(request.fqdn);
      const requestHash = hashActionRequest('network-domain.add', { domain: fqdnAscii });
      assertActive(signal);
      return dependencies.store.addAuthorized(principal.actorId, fqdnAscii, async () => {
        assertActive(signal);
        await dependencies.nonceStore.consumeCas(
          principal,
          request.actionNonce,
          'network-domain.add',
          requestHash,
          async () => assertActive(signal),
        );
      });
    },
    remove: async (
      principal: Readonly<ActorContext>,
      input: unknown,
      signal: CancellationSignal,
    ): Promise<void> => {
      const request = NetworkDomainRemoveRequestSchema.parse(input);
      const fqdnAscii = normalizeRemoteDomain(request.fqdn);
      const requestHash = hashActionRequest('network-domain.remove', { domain: fqdnAscii });
      assertActive(signal);
      await dependencies.store.removeAuthorized(principal.actorId, fqdnAscii, async () => {
        assertActive(signal);
        await dependencies.nonceStore.consumeCas(
          principal,
          request.actionNonce,
          'network-domain.remove',
          requestHash,
          async () => assertActive(signal),
        );
      });
    },
  });
