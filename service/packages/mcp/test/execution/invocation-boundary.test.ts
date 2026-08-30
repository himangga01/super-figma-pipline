import * as shared from '@sfp/shared';
import { describe, expect, it } from 'vitest';

const api = shared as typeof shared & {
  parseInvocationRequest?: (value: unknown) => unknown;
  parseInvocationTargetSelector?: (value: unknown) => unknown;
  TARGET_SELECTOR_MAX_BYTES?: number;
  createToolInvocationOptions?: (
    captureResult: boolean,
    verifiedOperationId: string,
    verifiedWorkspaceId: string | null,
  ) => { captureIntent: { captureResult: boolean; relativePath: string | null } };
  validateToolInvocationOptions?: (
    value: unknown,
    verifiedOperationId: string,
    verifiedWorkspaceId: string | null,
  ) => unknown;
};

const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA';

describe('strict invocation boundary', () => {
  it.each([
    'actorId',
    'authSessionId',
    'principal',
    'consent',
    'mode',
    'allowedClasses',
    'workspaceRoot',
    'target',
    'FileIdentity',
    'fileExecutionKey',
    'pluginGeneration',
    'editorType',
    'capabilities',
  ])('rejects body-derived invocation context key %s', forbidden => {
    expect(() =>
      api.parseInvocationRequest?.({
        version: 1,
        requestId,
        toolName: 'get_selection',
        targetSelector: { kind: 'active' },
        [forbidden]: 'forged',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVOCATION_REQUEST_INVALID' }));
  });

  it('accepts the reachable exact 115-byte stable-file selector and rejects unknown keys', () => {
    const selector = {
      kind: 'stable-file',
      fileIdentityHash: `sha256:${'a'.repeat(64)}`,
    } as const;

    expect(Buffer.byteLength(JSON.stringify(selector), 'utf8')).toBe(115);
    expect(api.TARGET_SELECTOR_MAX_BYTES).toBe(115);
    expect(api.parseInvocationTargetSelector?.(selector)).toEqual(selector);
    expect(() => api.parseInvocationTargetSelector?.({ ...selector, extra: true })).toThrowError(
      expect.objectContaining({ code: 'INVOCATION_TARGET_INVALID' }),
    );
  });

  it('rejects malformed request IDs and dotted tool names before accepting an invocation', () => {
    for (const value of [
      {
        version: 1,
        requestId: 'r-1',
        toolName: 'get_selection',
        targetSelector: { kind: 'active' },
      },
      { version: 1, requestId, toolName: 'snapshot.capture', targetSelector: { kind: 'none' } },
    ]) {
      expect(() => api.parseInvocationRequest?.(value)).toThrowError(
        expect.objectContaining({ code: 'INVOCATION_REQUEST_INVALID' }),
      );
    }
  });

  it('derives one immutable evidence path and never accepts an arbitrary output path', () => {
    const disabled = api.createToolInvocationOptions?.(false, 'verified-operation', null);
    expect(disabled).toBe(shared.NO_CAPTURE_OPTIONS);

    const enabled = api.createToolInvocationOptions?.(
      true,
      'verified-operation',
      '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(enabled?.captureIntent.relativePath).toMatch(
      /^\.sfp\/operation-evidence\/[0-9a-f]{64}\/result\.v1\.json$/,
    );
    expect(Object.isFrozen(enabled)).toBe(true);
    expect(Object.isFrozen(enabled?.captureIntent)).toBe(true);
    expect(() => api.createToolInvocationOptions?.(true, 'verified-operation', null)).toThrowError(
      expect.objectContaining({ code: 'CAPTURE_WORKSPACE_REQUIRED' }),
    );
  });

  it('accepts only the issued capture capability bound to the exact operation and workspace', () => {
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const issued = api.createToolInvocationOptions?.(true, 'operation-a', workspaceId);
    expect(api.validateToolInvocationOptions?.(issued, 'operation-a', workspaceId)).toBe(issued);
    expect(() =>
      api.validateToolInvocationOptions?.(issued, 'operation-b', workspaceId),
    ).toThrowError(expect.objectContaining({ code: 'CAPTURE_INTENT_INVALID' }));
    expect(() =>
      api.validateToolInvocationOptions?.(
        {
          captureIntent: {
            captureResult: true,
            relativePath: issued?.captureIntent.relativePath,
          },
        },
        'operation-a',
        workspaceId,
      ),
    ).toThrowError(expect.objectContaining({ code: 'CAPTURE_INTENT_INVALID' }));
    expect(() =>
      api.validateToolInvocationOptions?.(
        { captureIntent: { captureResult: false, relativePath: null } },
        'operation-a',
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: 'CAPTURE_INTENT_INVALID' }));
    expect(
      api.validateToolInvocationOptions?.(shared.NO_CAPTURE_OPTIONS, 'operation-a', null),
    ).toBe(shared.NO_CAPTURE_OPTIONS);
  });
});
