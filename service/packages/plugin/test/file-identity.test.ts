import { describe, expect, it, vi } from 'vitest';

import {
  FILE_IDENTITY_KEY,
  FILE_IDENTITY_NAMESPACE,
  resolveReadOnlyFileIdentity,
  type PluginIdentityLifetime,
} from '../src/file-identity.js';

const lifetime = Object.freeze({
  provisionalSessionId: '00112233445566778899aabbccddeeff',
  pluginGeneration: 'ffeeddccbbaa99887766554433221100',
}) satisfies PluginIdentityLifetime;

const source = (fileKey: string | undefined, shared: string) => {
  const getSharedPluginData = vi.fn<(namespace: string, key: string) => string>(() => shared);
  const setSharedPluginData = vi.fn<(namespace: string, key: string, value: string) => void>();
  const commitUndo = vi.fn<() => void>();
  return {
    value: {
      ...(fileKey === undefined ? {} : { fileKey }),
      root: { getSharedPluginData, setSharedPluginData },
      commitUndo,
    },
    getSharedPluginData,
    setSharedPluginData,
    commitUndo,
  };
};

describe('read-only plugin file identity', () => {
  it('prefers a nonempty Figma file key without reading shared plugin data', () => {
    const input = source('Figma-Key-1', '123e4567-e89b-42d3-a456-426614174000');

    expect(resolveReadOnlyFileIdentity(input.value, lifetime)).toEqual({
      kind: 'figma-file-key',
      value: 'Figma-Key-1',
    });
    expect(input.getSharedPluginData).not.toHaveBeenCalled();
  });

  it('reads the exact shared UUID only from the frozen namespace and key', () => {
    const input = source('', '123e4567-e89b-42d3-a456-426614174000');

    expect(resolveReadOnlyFileIdentity(input.value, lifetime)).toEqual({
      kind: 'document-plugin-uuid',
      value: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(input.getSharedPluginData).toHaveBeenCalledWith(
      FILE_IDENTITY_NAMESPACE,
      FILE_IDENTITY_KEY,
    );
  });

  it.each(['', 'not-a-uuid', ' 123e4567-e89b-42d3-a456-426614174000'])(
    'falls back to the exact unstable lifetime for shared value %j',
    shared => {
      const input = source(undefined, shared);

      expect(resolveReadOnlyFileIdentity(input.value, lifetime)).toEqual({
        kind: 'unstable-readonly',
        sessionId: lifetime.provisionalSessionId,
        pluginGeneration: lifetime.pluginGeneration,
      });
      expect(input.setSharedPluginData).not.toHaveBeenCalled();
      expect(input.commitUndo).not.toHaveBeenCalled();
    },
  );

  it('fails read-only to the unstable identity when shared plugin data is unavailable', () => {
    const setSharedPluginData = vi.fn<(namespace: string, key: string, value: string) => void>();
    const commitUndo = vi.fn<() => void>();
    const value = {
      root: {
        getSharedPluginData: () => {
          throw new Error('shared data unavailable');
        },
        setSharedPluginData,
      },
      commitUndo,
    };

    expect(resolveReadOnlyFileIdentity(value, lifetime)).toEqual({
      kind: 'unstable-readonly',
      sessionId: lifetime.provisionalSessionId,
      pluginGeneration: lifetime.pluginGeneration,
    });
    expect(setSharedPluginData).not.toHaveBeenCalled();
    expect(commitUndo).not.toHaveBeenCalled();
  });
});
