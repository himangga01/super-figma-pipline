import { describe, expect, it } from 'vitest';

import {
  ActionNonceIssueRequestV1Schema,
  ApprovalDecisionV1Schema,
  EgressConfigureRequestV1Schema,
  ToolCallControlEnvelopeV1Schema,
  hashActionRequest,
} from '../src/index.js';

const hash = `sha256:${'a'.repeat(64)}` as const;
const requestId = 'sfp_req1_AQAAAAAAAAAAAAAAAAAAAA' as const;

describe('control wire schemas', () => {
  it('rejects registrationPath on non-workspace nonce requests', () => {
    expect(
      ActionNonceIssueRequestV1Schema.safeParse({
        action: 'egress.reset',
        requestHash: hash,
        registrationPath: 'C:\\forged',
      }).success,
    ).toBe(false);
  });

  it('rejects identity and consent fields in the strict control tool envelope', () => {
    expect(
      ToolCallControlEnvelopeV1Schema.safeParse({
        version: 1,
        invocation: {
          version: 1,
          requestId,
          toolName: 'get_selection',
          targetSelector: { kind: 'active' },
        },
        captureResult: false,
        actorId: `actor1_${'A'.repeat(43)}`,
      }).success,
    ).toBe(false);
  });

  it('requires a strict approval decision and a boolean capture flag', () => {
    expect(
      ApprovalDecisionV1Schema.safeParse({
        version: 1,
        type: 'approval.decision',
        approvalId: 'sfp_ap1_AQAAAAAAAAAAAAAAAAAAAA',
        operationId: 'op',
        promptHash: hash,
        decision: 'approved',
        controlToken: 'secret',
      }).success,
    ).toBe(false);
    expect(
      ToolCallControlEnvelopeV1Schema.safeParse({
        version: 1,
        invocation: {
          version: 1,
          requestId,
          toolName: 'get_selection',
          targetSelector: { kind: 'active' },
        },
        captureResult: 1,
      }).success,
    ).toBe(false);
  });

  it('canonicalizes external-model classes for hashing but rejects duplicates on the wire', () => {
    const left = hashActionRequest('egress.configure', {
      mode: 'external-model',
      allowedClasses: ['project-code', 'public'],
      expiresInSeconds: 7200,
    });
    const right = hashActionRequest('egress.configure', {
      mode: 'external-model',
      allowedClasses: ['public', 'project-code'],
      expiresInSeconds: 7200,
    });
    expect(left).toBe(right);
    expect(
      EgressConfigureRequestV1Schema.safeParse({
        schemaVersion: 1,
        mode: 'external-model',
        allowedClasses: ['public', 'public'],
        expiresInSeconds: 7200,
        actionNonce: `sfp_an1_${'A'.repeat(43)}`,
      }).success,
    ).toBe(false);
  });

  it('accepts only the binding full-class order for external-model configuration', () => {
    const canonical = ['public', 'project-code', 'design-text', 'design-image'] as const;
    expect(
      EgressConfigureRequestV1Schema.safeParse({
        schemaVersion: 1,
        mode: 'external-model',
        allowedClasses: canonical,
        expiresInSeconds: 7200,
        actionNonce: `sfp_an1_${'A'.repeat(43)}`,
      }).success,
    ).toBe(true);
    expect(
      EgressConfigureRequestV1Schema.safeParse({
        schemaVersion: 1,
        mode: 'external-model',
        allowedClasses: ['design-image', 'design-text', 'project-code', 'public'],
        expiresInSeconds: 7200,
        actionNonce: `sfp_an1_${'A'.repeat(43)}`,
      }).success,
    ).toBe(false);
    expect(
      hashActionRequest('egress.configure', {
        mode: 'external-model',
        allowedClasses: ['design-image', 'public', 'project-code', 'design-text'],
        expiresInSeconds: 7200,
      }),
    ).toBe(
      hashActionRequest('egress.configure', {
        mode: 'external-model',
        allowedClasses: canonical,
        expiresInSeconds: 7200,
      }),
    );
  });
});
