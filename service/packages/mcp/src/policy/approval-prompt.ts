import { randomBytes as systemRandomBytes } from 'node:crypto';

import {
  ApprovalPromptV1Schema,
  canonicalFileIdentityHash,
  hashCanonicalJson,
  type ApprovalPromptV1,
  type Effect,
  type ResolvedInvocationScope,
  type ToolName,
} from '@sfp/shared';

import type { ApprovalChannel } from './approval-gate.js';

export const APPROVAL_TTL_MS = 120_000 as const;

const summarizeEffect = (effect: Effect): string => {
  switch (effect.type) {
    case 'figma-read':
      return 'figma-read';
    case 'figma-write':
      return `figma-write:${effect.destructive ? 'destructive' : 'non-destructive'}:${effect.broad ? 'broad' : 'scoped'}`;
    case 'figma-ui':
      return 'figma-ui';
    case 'figma-library-import':
      return 'figma-library-import';
    case 'filesystem-read':
      return `filesystem-read:${effect.pathArgs.join(',')}`;
    case 'filesystem-write':
      return `filesystem-write:${effect.destructive ? 'destructive' : 'non-destructive'}:${effect.pathArgs.join(',')}`;
    case 'network':
      return `network:${effect.urlArg}`;
  }
};

export const createApprovalPrompt = (input: {
  scope: Readonly<ResolvedInvocationScope>;
  operationName: ToolName;
  effects: readonly Effect[];
  operationId: string;
  channel: ApprovalChannel;
  now?: number;
  randomBytes?: (size: number) => Uint8Array;
}): Readonly<ApprovalPromptV1> => {
  const issuedAt = input.now ?? Date.now();
  const entropy = Uint8Array.from((input.randomBytes ?? (size => systemRandomBytes(size)))(16));
  if (entropy.byteLength !== 16) throw new Error('approval entropy source failed');
  const approvalId = `sfp_ap1_${Buffer.from(entropy).toString('base64url')}` as const;
  const fileIdentityHash =
    input.scope.target.fileIdentity === null
      ? null
      : canonicalFileIdentityHash(input.scope.target.fileIdentity);
  const withoutHash = {
    version: 1 as const,
    type: 'approval.prompt' as const,
    approvalId,
    operationId: input.operationId,
    operationKind: 'tool' as const,
    operationName: input.operationName,
    channel: input.channel,
    effectSummary: Object.freeze(input.effects.map(summarizeEffect)),
    target: Object.freeze({
      fileIdentityHash,
      label: fileIdentityHash === null ? 'Owner control operation' : 'Authenticated Figma target',
      targetCount: fileIdentityHash === null ? null : 1,
    }),
    issuedAt,
    expiresAt: issuedAt + APPROVAL_TTL_MS,
  };
  const prompt = ApprovalPromptV1Schema.parse({
    ...withoutHash,
    promptHash: hashCanonicalJson('sfp-approval-prompt-v1', withoutHash),
  });
  return Object.freeze({
    ...prompt,
    effectSummary: Object.freeze([...prompt.effectSummary]),
    target: Object.freeze({ ...prompt.target }),
  });
};
