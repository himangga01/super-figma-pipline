import { NO_CAPTURE_OPTIONS, type ActorContext } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { createToolCallEndpoint } from '../../src/control/tool-call-endpoint.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

describe('control tool call endpoint', () => {
  it('passes the strict invocation through one plane with canonical no-capture options', async () => {
    const calls: unknown[] = [];
    const endpoint = createToolCallEndpoint({
      invokeTool: async (...args) => {
        calls.push(args);
        return { ok: true };
      },
    });
    const input = {
      version: 1 as const,
      invocation: {
        version: 1 as const,
        requestId: 'sfp_req1_AQAAAAAAAAAAAAAAAAAAAA' as const,
        operationId: 'operation-1',
        toolName: 'get_selection',
        targetSelector: { kind: 'active' as const },
      },
      captureResult: false,
    };
    await expect(endpoint(principal, input)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([[principal, input.invocation, NO_CAPTURE_OPTIONS]]);
  });
});
