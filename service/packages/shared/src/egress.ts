import { z } from 'zod';

import type { PrefixedSha256 } from './invocation.js';

export const ALL_DATA_CLASSES = Object.freeze([
  'public',
  'project-code',
  'design-text',
  'design-image',
  'secret',
] as const);
export const EXTERNAL_MODEL_DATA_CLASSES = Object.freeze([
  'public',
  'project-code',
  'design-text',
  'design-image',
] as const);

export type DataClass = (typeof ALL_DATA_CLASSES)[number];
export type ExternalModelDataClass = Exclude<DataClass, 'secret'>;
export type EgressMode = 'local-trusted' | 'external-model' | 'unknown-fail-closed';
export type EgressSource = 'mcp' | 'cli-control' | 'follower';

export interface ClassifiedPayload<T> {
  value: T;
  classes: readonly DataClass[];
  bytes: number;
  tokens: number;
}

export interface ResultEgressPolicy<I = unknown, O = unknown> {
  possibleInputClasses(args: Readonly<I>): readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  classifyInput(args: Readonly<I>): ClassifiedPayload<Readonly<I>>;
  classifyResult(result: Readonly<O>): ClassifiedPayload<Readonly<O>>;
  redactResult(result: Readonly<O>, allowed: readonly DataClass[]): O;
}

export type ResultEgressPolicyRegistry = Readonly<
  Record<
    string,
    ResultEgressPolicy<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>
  >
>;

export interface ConsentContext {
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
}

const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const ConsentIdSchema = z.string().regex(/^sfp_consent1_[A-Za-z0-9_-]{22}$/u);
const ExternalClassSchema = z.enum(EXTERNAL_MODEL_DATA_CLASSES);
const DataClassSchema = z.enum(ALL_DATA_CLASSES);

export type EgressConfigV1 =
  | {
      schemaVersion: 1;
      mode: 'unknown-fail-closed';
      allowedClasses: readonly [];
      consentId: null;
      configuredAt: null;
      expiresAt: null;
      configHash: PrefixedSha256;
    }
  | {
      schemaVersion: 1;
      mode: 'local-trusted';
      allowedClasses: readonly DataClass[];
      consentId: null;
      configuredAt: string;
      expiresAt: null;
      configHash: PrefixedSha256;
    }
  | {
      schemaVersion: 1;
      mode: 'external-model';
      allowedClasses: readonly ExternalModelDataClass[];
      consentId: `sfp_consent1_${string}`;
      configuredAt: string;
      expiresAt: string;
      configHash: PrefixedSha256;
    };

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('egress value is not JSON serializable');
  return encoded;
};

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_ROUNDS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));
const utf8Bytes = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        index += 1;
      } else codePoint = 0xfffd;
    } else if (first >= 0xdc00 && first <= 0xdfff) codePoint = 0xfffd;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};
const sha256Bytes = (input: Uint8Array): string => {
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;
  const bitLength = BigInt(input.byteLength) * 8n;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Number((bitLength >> 32n) & 0xffffffffn), false);
  view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn), false);
  const state = new Uint32Array(SHA256_INITIAL);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const p15 = schedule[index - 15]!;
      const p2 = schedule[index - 2]!;
      const s0 = rotateRight(p15, 7) ^ rotateRight(p15, 18) ^ (p15 >>> 3);
      const s1 = rotateRight(p2, 17) ^ rotateRight(p2, 19) ^ (p2 >>> 10);
      schedule[index] = (schedule[index - 16]! + s0 + schedule[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + upper1 + choice + SHA256_ROUNDS[index]! + schedule[index]!) >>> 0;
      const upper0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (upper0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map(word => word.toString(16).padStart(8, '0')).join('');
};

export const hashCanonicalJson = (domain: string, value: unknown): PrefixedSha256 => {
  const domainBytes = utf8Bytes(domain);
  const valueBytes = utf8Bytes(canonicalJson(value));
  const input = new Uint8Array(domainBytes.byteLength + 1 + valueBytes.byteLength);
  input.set(domainBytes);
  input[domainBytes.byteLength] = 0;
  input.set(valueBytes, domainBytes.byteLength + 1);
  return `sha256:${sha256Bytes(input)}`;
};

export const compareUtf8Bytes = (left: string, right: string): number => {
  const leftBytes = utf8Bytes(left);
  const rightBytes = utf8Bytes(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
};

export const hashEgressConfig = (
  value: Omit<EgressConfigV1, 'configHash'> | Record<string, unknown>,
): PrefixedSha256 => {
  return hashCanonicalJson('sfp-egress-config-v1', value);
};

const canonicalClassOrder = (values: readonly string[], authority: readonly string[]): boolean =>
  new Set(values).size === values.length &&
  JSON.stringify(values) === JSON.stringify(authority.filter(value => values.includes(value)));

const UnknownEgressConfigV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal('unknown-fail-closed'),
    allowedClasses: z.tuple([]),
    consentId: z.null(),
    configuredAt: z.null(),
    expiresAt: z.null(),
    configHash: PrefixedSha256Schema,
  })
  .strict();
const LocalEgressConfigV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal('local-trusted'),
    allowedClasses: z.array(DataClassSchema).min(1).max(5).readonly(),
    consentId: z.null(),
    configuredAt: IsoTimestampSchema,
    expiresAt: z.null(),
    configHash: PrefixedSha256Schema,
  })
  .strict()
  .refine(value => canonicalClassOrder(value.allowedClasses, ALL_DATA_CLASSES), {
    message: 'local classes must use canonical authority order and be unique',
  });
const ExternalEgressConfigV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal('external-model'),
    allowedClasses: z.array(ExternalClassSchema).min(1).max(4).readonly(),
    consentId: ConsentIdSchema,
    configuredAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    configHash: PrefixedSha256Schema,
  })
  .strict()
  .refine(value => canonicalClassOrder(value.allowedClasses, EXTERNAL_MODEL_DATA_CLASSES), {
    message: 'external classes must use canonical authority order and be unique',
  })
  .refine(value => Date.parse(value.expiresAt) > Date.parse(value.configuredAt), {
    message: 'external expiry must follow configuration',
  });

const EgressConfigDiscriminatedSchema = z.discriminatedUnion('mode', [
  UnknownEgressConfigV1Schema,
  LocalEgressConfigV1Schema,
  ExternalEgressConfigV1Schema,
]);
export const EgressConfigV1Schema = EgressConfigDiscriminatedSchema.superRefine(
  (value, context) => {
    const { configHash: _configHash, ...withoutHash } = value;
    if (hashEgressConfig(withoutHash) !== value.configHash) {
      context.addIssue({ code: 'custom', message: 'egress config hash does not match' });
    }
  },
) as z.ZodType<EgressConfigV1>;
export const parseEgressConfigV1 = (value: unknown) => EgressConfigV1Schema.safeParse(value);

const defaultWithoutHash = Object.freeze({
  schemaVersion: 1 as const,
  mode: 'unknown-fail-closed' as const,
  allowedClasses: Object.freeze([]) as readonly [],
  consentId: null,
  configuredAt: null,
  expiresAt: null,
});
export const DEFAULT_EGRESS_CONFIG_V1: Readonly<EgressConfigV1> = Object.freeze({
  ...defaultWithoutHash,
  configHash: hashEgressConfig(defaultWithoutHash),
});

export interface EgressConfigLoadResult {
  config: Readonly<EgressConfigV1>;
  expired: boolean;
  storageState: 'valid' | 'missing' | 'corrupt';
}
export interface EgressConfigStore {
  load(now?: number): Promise<Readonly<EgressConfigLoadResult>>;
  save(next: Readonly<EgressConfigV1>, expectedConfigHash: PrefixedSha256): Promise<void>;
  reset(expectedConfigHash: PrefixedSha256): Promise<Readonly<EgressConfigV1>>;
}

export const EgressConfigStatusV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(['local-trusted', 'external-model', 'unknown-fail-closed']),
    allowedClasses: z.array(DataClassSchema).max(5).readonly(),
    configuredAt: IsoTimestampSchema.nullable(),
    expiresAt: IsoTimestampSchema.nullable(),
    configHash: PrefixedSha256Schema,
    expired: z.boolean(),
  })
  .strict();
export type EgressConfigStatusV1 = z.infer<typeof EgressConfigStatusV1Schema>;

export const EgressConfigureRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal('external-model'),
    allowedClasses: z.array(ExternalClassSchema).min(1).max(4).readonly(),
    expiresInSeconds: z.number().int().min(60).max(28_800),
    actionNonce: z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u),
  })
  .strict()
  .refine(value => canonicalClassOrder(value.allowedClasses, EXTERNAL_MODEL_DATA_CLASSES), {
    message: 'external classes must use canonical authority order and be unique',
  });
export type EgressConfigureRequestV1 = z.infer<typeof EgressConfigureRequestV1Schema>;

export type EgressPolicyErrorCode =
  | 'EGRESS_CLASS_NOT_ALLOWED'
  | 'EGRESS_CONFIG_CAS_MISMATCH'
  | 'EGRESS_CONFIG_COMMIT_UNKNOWN'
  | 'EGRESS_CONFIG_INVALID'
  | 'EGRESS_CONFIG_REQUIRED'
  | 'EGRESS_CONFIG_WRITE_FAILED'
  | 'EGRESS_CONSENT_EXPIRED'
  | 'EGRESS_CONSENT_REQUIRED'
  | 'EGRESS_RESULT_INVALID';

export class EgressPolicyError extends Error {
  readonly deniedClass?: DataClass;
  readonly committed?: boolean;

  constructor(
    readonly code: EgressPolicyErrorCode,
    message: string,
    options: { cause?: unknown; deniedClass?: DataClass; committed?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EgressPolicyError';
    if (options.deniedClass !== undefined) this.deniedClass = options.deniedClass;
    if (options.committed !== undefined) this.committed = options.committed;
  }
}

export type AdminAuditStage = 'pending' | 'cas-intent' | 'committed' | 'recovered' | 'aborted';
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never;
interface AdminAuditCommonV1 {
  schemaVersion: 1;
  auditId: `sfp_audit1_${string}`;
  auditTransactionId: `sfp_atx1_${string}`;
  kind: 'egress';
  actorId: `actor1_${string}`;
  authSessionId: `auth1_${string}`;
  action: 'egress.configure' | 'egress.reset';
  actionNonceClaimHash: PrefixedSha256;
  requestHash: PrefixedSha256;
  expectedConfigHash: PrefixedSha256;
  allowedClasses: readonly ExternalModelDataClass[];
  expiresAt: string | null;
  createdAt: string;
  previousRecordHash: PrefixedSha256 | null;
  contentHash: PrefixedSha256;
  recordHash: PrefixedSha256;
}
export type AdminAuditRecordV1 = AdminAuditCommonV1 &
  (
    | { stage: 'pending'; desiredConfigHash: null; configHash: null }
    | { stage: 'cas-intent'; desiredConfigHash: PrefixedSha256; configHash: null }
    | {
        stage: 'committed' | 'recovered';
        desiredConfigHash: PrefixedSha256;
        configHash: PrefixedSha256;
      }
    | {
        stage: 'aborted';
        desiredConfigHash: PrefixedSha256 | null;
        configHash: PrefixedSha256;
        abortReason: string;
      }
  );
export type AdminAuditAppendV1 = DistributiveOmit<
  AdminAuditRecordV1,
  'auditId' | 'previousRecordHash' | 'contentHash' | 'recordHash'
>;
export type AdminAuditPublicRecordV1 = Omit<
  AdminAuditRecordV1,
  'actorId' | 'authSessionId' | 'previousRecordHash' | 'contentHash'
>;
export interface AdminAuditQueryResultV1 {
  schemaVersion: 1;
  chainVerified: true;
  checkpointContentHash: PrefixedSha256;
  anchorContentHash: PrefixedSha256;
  rows: readonly AdminAuditPublicRecordV1[];
  nextCursor: `sfp_ac1_${string}` | null;
}
export const ADMIN_AUDIT_LIMITS = Object.freeze({
  maxRowBytes: 32_768,
  compactAtRows: 50_000,
  compactAtBytes: 67_108_864,
  maxRowsPerActor: 65_536,
  maxBytesPerActor: 100_663_296,
  reservationRowsPerTransaction: 4,
  reservationBytesPerTransaction: 131_072,
  maxActiveTransactionsPerActor: 1_024,
  retentionDays: 30,
} as const);
