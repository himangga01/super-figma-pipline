import { describe, expect, it, vi } from 'vitest';

import { createIdentityBootstrap } from '../src/identity-bootstrap.js';
import { settleHandlerOutcome } from '../src/mutation.js';

describe('document identity initialization', () => {
  it('uses a compare-and-set and one Undo, then requires publication and authenticated completion', async () => {
    let stored = '';
    const undo = vi.fn<() => void>(),
      hold = vi.fn<(value: boolean) => void>();
    const page = { id: '0:1', type: 'PAGE', name: 'Page', children: [] };
    const host = {
      currentPage: page,
      root: {
        name: 'Fixture',
        getSharedPluginData: () => stored,
        setSharedPluginData: (_namespace: string, _key: string, value: string) => {
          stored = value;
        },
      },
      getNodeByIdAsync: async () => page,
      commitUndo: undo,
    } as unknown as typeof figma;
    const identity = createIdentityBootstrap(host, () => 'generation', hold);
    const before = (await identity.handlers['$identity.read']!({})) as { rawHash: string };
    const args = {
      expectedRawHash: before.rawHash,
      pluginGeneration: 'generation',
      documentUuid: '11111111-1111-4111-8111-111111111111',
      publishNonce: 'A'.repeat(22),
    };
    const result = settleHandlerOutcome(await identity.handlers['$identity.bootstrap']!(args));
    expect(result).toMatchObject({ mutated: true, fileIdentity: { value: args.documentUuid } });
    expect(stored).toBe(args.documentUuid);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(identity.ready(args.publishNonce)).toBe(false);
    expect(identity.publish('B'.repeat(22))).toBe(false);
    expect(identity.publish(args.publishNonce)).toBe(true);
    expect(identity.ready(args.publishNonce)).toBe(true);
    expect(identity.ready(args.publishNonce)).toBe(false);
    await expect(identity.handlers['$identity.bootstrap']!(args)).rejects.toThrow(
      'identity precondition changed',
    );
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
