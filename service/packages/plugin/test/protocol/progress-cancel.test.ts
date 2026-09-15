import { describe, expect, it } from 'vitest';

import {
  createToolCancel,
  createToolProgress,
  PLUGIN_BRIDGE_TAG,
  PluginToolCancelSchema,
  PluginToolProgressSchema,
} from '../../protocol/bridge.js';

const binding = Object.freeze({
  requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
  operationId: 'operation-1',
  actionNonce: 'action-nonce-1',
});

describe('strict sandbox progress and cancel protocol', () => {
  it('round-trips one operation-bound progress event', () => {
    const message = createToolProgress({
      id: 'bridge-1',
      binding,
      progress: {
        operationId: binding.operationId,
        phase: 'dispatched',
        completed: 0,
        total: 1,
        message: 'request dispatched',
        emittedAt: 10,
      },
    });

    expect(PluginToolProgressSchema.parse(message)).toEqual(message);
  });

  it('round-trips one exact cancel and rejects open or mismatched shapes', () => {
    const message = createToolCancel({ id: 'bridge-1', binding });
    expect(PluginToolCancelSchema.parse(message)).toEqual(message);
    expect(() => PluginToolCancelSchema.parse({ ...message, actorId: 'forged' })).toThrow(
      'Unrecognized key',
    );
    expect(() =>
      PluginToolProgressSchema.parse({
        tag: PLUGIN_BRIDGE_TAG,
        kind: 'tool-progress',
        id: 'bridge-1',
        binding,
        progress: {
          operationId: 'other-operation',
          phase: 'x',
          completed: 0,
          total: null,
          message: '',
          emittedAt: 1,
        },
      }),
    ).toThrow('sandbox progress operation does not match its execution binding');
  });
});
