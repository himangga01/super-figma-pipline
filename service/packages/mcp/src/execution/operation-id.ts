import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ActorContext } from '@sfp/shared';
import { Base64Url128Schema } from '@sfp/shared';

import {
  loadOrCreatePersistentKey,
  type PersistentKeyOptions,
} from '../security/principal-derivation.js';

export const OPERATION_ID_KEY_RELATIVE_PATH = 'auth/operation-id-key.v1' as const;

export const loadOrCreateOperationIdIssuer = async (
  options: PersistentKeyOptions,
): Promise<OperationIdIssuer> =>
  operationIdIssuerFromKey(
    await loadOrCreatePersistentKey(options, OPERATION_ID_KEY_RELATIVE_PATH),
  );

export interface OperationIdClaims {
  v: 1;
  issuedAt: number;
  keyId: `opk1_${string}`;
  nonce: string;
  actorHash: `sha256:${string}`;
}

export interface OperationIdIssuer {
  issue(
    actorId: ActorContext['actorId'],
    now?: number,
    options?: { nonce?: string },
  ): `sfp_op1_${string}.${string}`;
  verify(actorId: ActorContext['actorId'], operationId: string, now?: number): OperationIdClaims;
}

export class OperationIdError extends Error {
  constructor(
    readonly code: 'OPERATION_ID_INVALID' | 'OPERATION_ID_EXPIRED',
    message: string,
  ) {
    super(message);
    this.name = 'OperationIdError';
  }
}

const zero = Buffer.from([0]);
const horizonMilliseconds = 2_592_000_000;
const maximumFutureSkewMilliseconds = 300_000;
const operationIdPattern = /^sfp_op1_([A-Za-z0-9_-]{1,332})\.([A-Za-z0-9_-]{43})$/;

const sha256 = (...parts: readonly (string | Uint8Array)[]): Buffer => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};

const actorHashFor = (actorId: string): `sha256:${string}` =>
  `sha256:${sha256('sfp-operation-actor-v1', zero, actorId).toString('hex')}`;

const invalid = (message: string): never => {
  throw new OperationIdError('OPERATION_ID_INVALID', message);
};

export const operationIdIssuerFromKey = (inputKey: Uint8Array): OperationIdIssuer => {
  if (inputKey.byteLength !== 32) throw new Error('operation ID key must contain 32 bytes');
  const key = Buffer.from(inputKey);
  const keyId = `opk1_${sha256(key).subarray(0, 16).toString('base64url')}` as const;

  const macFor = (payload: Uint8Array): Buffer =>
    createHmac('sha256', key)
      .update('sfp-operation-id-v1', 'utf8')
      .update(zero)
      .update(payload)
      .digest();

  const issuer: OperationIdIssuer = {
    issue: (actorId: ActorContext['actorId'], now = Date.now(), options = {}) => {
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('operation issue time is invalid');
      const nonce = options.nonce ?? randomBytes(16).toString('base64url');
      if (!Base64Url128Schema.safeParse(nonce).success) {
        throw new Error('operation nonce must be canonical Base64Url128');
      }
      const claims: OperationIdClaims = {
        v: 1,
        issuedAt: now,
        keyId,
        nonce,
        actorHash: actorHashFor(actorId),
      };
      const payload = Buffer.from(JSON.stringify(claims), 'utf8');
      return `sfp_op1_${payload.toString('base64url')}.${macFor(payload).toString('base64url')}` as const;
    },
    verify: (actorId: ActorContext['actorId'], operationId: string, now = Date.now()) => {
      if (
        typeof operationId !== 'string' ||
        Buffer.byteLength(operationId, 'ascii') > 384 ||
        !Number.isSafeInteger(now) ||
        now < 0
      ) {
        return invalid('operation ID envelope is invalid');
      }
      const match = operationIdPattern.exec(operationId);
      if (match === null) return invalid('operation ID grammar is invalid');
      const encodedPayload = match[1]!;
      const encodedMac = match[2]!;
      const payload = Buffer.from(encodedPayload, 'base64url');
      const receivedMac = Buffer.from(encodedMac, 'base64url');
      if (
        payload.toString('base64url') !== encodedPayload ||
        receivedMac.byteLength !== 32 ||
        receivedMac.toString('base64url') !== encodedMac ||
        !timingSafeEqual(receivedMac, macFor(payload))
      ) {
        return invalid('operation ID authentication failed');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.toString('utf8'));
      } catch {
        return invalid('operation ID payload is not JSON');
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return invalid('operation ID payload is invalid');
      }
      const claims = parsed as Partial<OperationIdClaims>;
      if (
        JSON.stringify(parsed) !== payload.toString('utf8') ||
        JSON.stringify(Object.keys(parsed)) !==
          JSON.stringify(['v', 'issuedAt', 'keyId', 'nonce', 'actorHash']) ||
        claims.v !== 1 ||
        !Number.isSafeInteger(claims.issuedAt) ||
        (claims.issuedAt ?? -1) < 0 ||
        claims.keyId !== keyId ||
        !Base64Url128Schema.safeParse(claims.nonce).success ||
        claims.actorHash !== actorHashFor(actorId)
      ) {
        return invalid('operation ID claims are invalid');
      }
      const issuedAt = claims.issuedAt!;
      if (now - issuedAt >= horizonMilliseconds) {
        throw new OperationIdError('OPERATION_ID_EXPIRED', 'operation ID has expired');
      }
      if (issuedAt - now > maximumFutureSkewMilliseconds) {
        return invalid('operation ID future skew is invalid');
      }
      return claims as OperationIdClaims;
    },
  };
  return Object.freeze(issuer);
};
