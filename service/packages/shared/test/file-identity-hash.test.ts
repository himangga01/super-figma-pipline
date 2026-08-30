import { describe, expect, it } from 'vitest';

import * as invocation from '../src/invocation.js';

const canonicalFileIdentityHash = (
  invocation as typeof invocation & {
    canonicalFileIdentityHash?: (identity: invocation.FileIdentity) => `sha256:${string}`;
  }
).canonicalFileIdentityHash;

describe('canonical FileIdentity hash', () => {
  it.each([
    [
      { kind: 'figma-file-key', value: 'AbC-123' },
      'sha256:4e9a4e8ebf1713dfa4046c8e43980ee33e8a14eeb48f2f063cb473d09dfb6ad5',
    ],
    [
      { kind: 'document-plugin-uuid', value: '123e4567-e89b-42d3-a456-426614174000' },
      'sha256:fa39239997c2eacc82f800232887d820f64241c1625f7aa09a9aa8cad6193bdb',
    ],
    [
      {
        kind: 'unstable-readonly',
        sessionId: '-____________________w',
        pluginGeneration: 'plugin-gen-1',
      },
      'sha256:5b1fcbb1f0272484c98b1ccf8c7ad364de7da1097f377b23b06a0054374f5b6c',
    ],
  ] as const)('matches the independent %s vector', (identity, expected) => {
    expect(canonicalFileIdentityHash?.(identity)).toBe(expected);
  });

  it('does not normalize Unicode or collapse identity kinds and field order', () => {
    expect(canonicalFileIdentityHash?.({ kind: 'figma-file-key', value: 'é' })).toBe(
      'sha256:0a4c0f64d1fa8dcab9b96e5888c35cf295aab20acded7535133715f530e77de4',
    );
    expect(canonicalFileIdentityHash?.({ kind: 'figma-file-key', value: 'e\u0301' })).toBe(
      'sha256:6ee2eee412d74f9321e2fc8effb53b686321dd83c4b73891eaa1ed331c38afd8',
    );
    expect(
      canonicalFileIdentityHash?.({
        kind: 'unstable-readonly',
        sessionId: 'plugin-gen-1',
        pluginGeneration: '-____________________w',
      }),
    ).not.toBe('sha256:5b1fcbb1f0272484c98b1ccf8c7ad364de7da1097f377b23b06a0054374f5b6c');
  });
});
