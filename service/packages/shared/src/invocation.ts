import { z } from 'zod';

import { Base64Url128Schema, type FileIdentity } from './auth.js';
import type { ConsentContext } from './egress.js';
import type { PolicyInvocationContext } from './operations.js';

export const ToolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]{0,127}$/);
export type ToolName = z.infer<typeof ToolNameSchema>;
export type PrefixedSha256 = `sha256:${string}`;

export const TARGET_SELECTOR_MAX_BYTES = 115 as const;
export const SESSION_ID_A = 'AQAAAAAAAAAAAAAAAAAAAA' as const;
export const SESSION_ID_WITH_UNDERSCORE = '-____________________w' as const;

const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const RequestIdSchema = z.string().regex(/^sfp_req1_[A-Za-z0-9_-]{21}[AQgw]$/);
const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const InvocationTargetSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('active') }).strict(),
  z.object({ kind: z.literal('session'), sessionId: Base64Url128Schema }).strict(),
  z.object({ kind: z.literal('stable-file'), fileIdentityHash: PrefixedSha256Schema }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
]);

export type TargetRequirement = 'forbidden' | 'optional' | 'required';
export type FileExecutionKey =
  | `figma:${string}`
  | `plugin-uuid:${string}`
  | `unstable:${string}:${string}`;

export interface ActorContext {
  actorId: `actor1_${string}`;
  authSessionId: `auth1_${string}`;
  entryPath: 'mcp-direct' | 'mcp-follower' | 'control' | 'internal-system';
}

export const ActorContextSchema = z
  .object({
    actorId: z.string().regex(/^actor1_[A-Za-z0-9_-]{43}$/),
    authSessionId: z.string().regex(/^auth1_[A-Za-z0-9_-]{43}$/),
    entryPath: z.enum(['mcp-direct', 'mcp-follower', 'control', 'internal-system']),
  })
  .strict();

export const parseActorContext = (value: unknown): Readonly<ActorContext> => {
  const parsed = ActorContextSchema.safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error('invocation principal does not match its closed schema'), {
      code: 'INVOCATION_PRINCIPAL_INVALID',
      cause: parsed.error,
    });
  }
  return Object.freeze(parsed.data) as Readonly<ActorContext>;
};

export type InvocationTargetSelector =
  | { kind: 'active' }
  | { kind: 'session'; sessionId: z.infer<typeof Base64Url128Schema> }
  | { kind: 'stable-file'; fileIdentityHash: `sha256:${string}` }
  | { kind: 'none' };

export const InvocationRequestV1Schema = z
  .object({
    version: z.literal(1),
    requestId: RequestIdSchema,
    toolName: ToolNameSchema,
    rawArgs: z.unknown().optional(),
    operationId: z.string().min(1).max(384).optional(),
    workspaceId: WorkspaceIdSchema.nullable().optional(),
    targetSelector: InvocationTargetSelectorSchema,
  })
  .strict();

export type InvocationRequestV1 = z.infer<typeof InvocationRequestV1Schema>;

export class InvocationBoundaryError extends Error {
  constructor(
    readonly code: 'INVOCATION_REQUEST_INVALID' | 'INVOCATION_TARGET_INVALID',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'InvocationBoundaryError';
  }
}

const freezeRecursively = <T>(value: T): Readonly<T> => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  for (const child of Object.values(value)) freezeRecursively(child);
  return Object.freeze(value);
};

export const parseInvocationTargetSelector = (value: unknown): InvocationTargetSelector => {
  const parsed = InvocationTargetSelectorSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvocationBoundaryError(
      'INVOCATION_TARGET_INVALID',
      'invocation target selector does not match its closed schema',
      { cause: parsed.error },
    );
  }
  return freezeRecursively(parsed.data) as InvocationTargetSelector;
};

export const parseInvocationRequest = (value: unknown): InvocationRequestV1 => {
  const parsed = InvocationRequestV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new InvocationBoundaryError(
      'INVOCATION_REQUEST_INVALID',
      'invocation request does not match its closed schema',
      { cause: parsed.error },
    );
  }
  return freezeRecursively(parsed.data) as InvocationRequestV1;
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
      const previous15 = schedule[index - 15]!;
      const previous2 = schedule[index - 2]!;
      const small0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const small1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (schedule[index - 16]! + small0 + schedule[index - 7]! + small1) >>> 0;
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
      } else {
        codePoint = 0xfffd;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = 0xfffd;
    }
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

const lengthPrefixedUtf8 = (value: string): Uint8Array => {
  const bytes = utf8Bytes(value);
  const framed = new Uint8Array(4 + bytes.byteLength);
  new DataView(framed.buffer).setUint32(0, bytes.byteLength, false);
  framed.set(bytes, 4);
  return framed;
};

export const canonicalFileIdentityHash = (identity: FileIdentity): `sha256:${string}` => {
  const domain = utf8Bytes('sfp-file-identity-v1');
  const fields =
    identity.kind === 'unstable-readonly'
      ? [lengthPrefixedUtf8(identity.sessionId), lengthPrefixedUtf8(identity.pluginGeneration)]
      : [lengthPrefixedUtf8(identity.value)];
  const tag =
    identity.kind === 'figma-file-key'
      ? 0x01
      : identity.kind === 'document-plugin-uuid'
        ? 0x02
        : 0x03;
  const total = domain.byteLength + 2 + fields.reduce((sum, field) => sum + field.byteLength, 0);
  const input = new Uint8Array(total);
  input.set(domain);
  input[domain.byteLength] = 0;
  input[domain.byteLength + 1] = tag;
  let offset = domain.byteLength + 2;
  for (const field of fields) {
    input.set(field, offset);
    offset += field.byteLength;
  }
  return `sha256:${sha256Bytes(input)}`;
};

const captureRelativePath = (
  verifiedOperationId: string,
): `.sfp/operation-evidence/${string}/result.v1.json` => {
  const domain = utf8Bytes('sfp-operation-evidence-path-v1');
  const operation = utf8Bytes(verifiedOperationId);
  const input = new Uint8Array(domain.byteLength + 1 + operation.byteLength);
  input.set(domain);
  input[domain.byteLength] = 0;
  input.set(operation, domain.byteLength + 1);
  const segment = sha256Bytes(input);
  return `.sfp/operation-evidence/${segment}/result.v1.json`;
};

export interface PluginTarget {
  readonly sessionId: string | null;
  readonly pluginGeneration: string | null;
  readonly fileIdentity: Readonly<FileIdentity> | null;
  readonly fileExecutionKey: FileExecutionKey | null;
  readonly editorType?: 'figma' | 'figjam' | 'dev' | null;
  readonly capabilities?: readonly string[] | null;
}

export interface ResolvedInvocationScope extends PolicyInvocationContext {
  readonly requestId: `sfp_req1_${string}`;
  readonly leaderGeneration: string;
  readonly actor: Readonly<ActorContext>;
  readonly target: Readonly<PluginTarget>;
}

export interface RuntimeExecutionScope extends ResolvedInvocationScope {
  readonly consent: Readonly<ConsentContext>;
}

export type CaptureIntentV1 =
  | { captureResult: false; relativePath: null }
  | {
      captureResult: true;
      relativePath: `.sfp/operation-evidence/${string}/result.v1.json`;
    };
export type VerifiedCaptureIntentV1 = Readonly<CaptureIntentV1> & {
  readonly __verifiedCaptureIntent: unique symbol;
};
export interface ToolInvocationOptionsV1 {
  captureIntent: VerifiedCaptureIntentV1;
}
interface CaptureCapabilityBinding {
  operationId: string;
  workspaceId: string;
}
const issuedCaptureIntents = new WeakMap<object, CaptureCapabilityBinding | null>();
const issuedInvocationOptions = new WeakMap<object, CaptureCapabilityBinding | null>();

export const NO_CAPTURE_INTENT = Object.freeze({
  captureResult: false,
  relativePath: null,
}) as VerifiedCaptureIntentV1;
export const NO_CAPTURE_OPTIONS = Object.freeze({
  captureIntent: NO_CAPTURE_INTENT,
}) as Readonly<ToolInvocationOptionsV1>;
issuedCaptureIntents.set(NO_CAPTURE_INTENT, null);
issuedInvocationOptions.set(NO_CAPTURE_OPTIONS, null);

export const createToolInvocationOptions = (
  captureResult: boolean,
  verifiedOperationId: string,
  verifiedWorkspaceId: string | null,
): Readonly<ToolInvocationOptionsV1> => {
  if (!captureResult) return NO_CAPTURE_OPTIONS;
  if (verifiedWorkspaceId === null) {
    throw Object.assign(new Error('captured results require a verified workspace'), {
      code: 'CAPTURE_WORKSPACE_REQUIRED',
    });
  }
  const captureIntent = Object.freeze({
    captureResult: true,
    relativePath: captureRelativePath(verifiedOperationId),
  }) as VerifiedCaptureIntentV1;
  const options = Object.freeze({ captureIntent }) as Readonly<ToolInvocationOptionsV1>;
  const binding = Object.freeze({
    operationId: verifiedOperationId,
    workspaceId: verifiedWorkspaceId,
  });
  issuedCaptureIntents.set(captureIntent, binding);
  issuedInvocationOptions.set(options, binding);
  return options;
};

export const validateToolInvocationOptions = (
  value: unknown,
  verifiedOperationId: string,
  verifiedWorkspaceId: string | null,
): Readonly<ToolInvocationOptionsV1> => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !issuedInvocationOptions.has(value) ||
    !('captureIntent' in value) ||
    typeof value.captureIntent !== 'object' ||
    value.captureIntent === null ||
    !issuedCaptureIntents.has(value.captureIntent)
  ) {
    throw Object.assign(new Error('capture intent was not issued by the admission authority'), {
      code: 'CAPTURE_INTENT_INVALID',
    });
  }
  const options = value as Readonly<ToolInvocationOptionsV1>;
  if (options === NO_CAPTURE_OPTIONS) return NO_CAPTURE_OPTIONS;
  const optionsBinding = issuedInvocationOptions.get(value);
  const intentBinding = issuedCaptureIntents.get(options.captureIntent);
  if (
    verifiedWorkspaceId === null ||
    optionsBinding === null ||
    optionsBinding === undefined ||
    intentBinding === null ||
    intentBinding === undefined ||
    optionsBinding.operationId !== verifiedOperationId ||
    optionsBinding.workspaceId !== verifiedWorkspaceId ||
    intentBinding.operationId !== verifiedOperationId ||
    intentBinding.workspaceId !== verifiedWorkspaceId ||
    options.captureIntent.captureResult !== true ||
    options.captureIntent.relativePath !== captureRelativePath(verifiedOperationId)
  ) {
    throw Object.assign(new Error('capture intent does not match the admitted operation'), {
      code: 'CAPTURE_INTENT_INVALID',
    });
  }
  return options;
};

export type { FileIdentity } from './auth.js';
