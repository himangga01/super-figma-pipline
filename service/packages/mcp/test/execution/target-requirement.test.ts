import { SESSION_ID_A } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { TargetResolver } from '../../src/execution/target-resolver.js';

const connected = {
  sessionId: SESSION_ID_A,
  pluginGeneration: 'plugin-g1',
  fileIdentity: { kind: 'figma-file-key' as const, value: 'file-a' },
  connectedSequence: 1,
  healthy: true,
};

describe('target requirements', () => {
  const resolver = new TargetResolver({ active: () => connected, list: () => [connected] });

  it('rejects a selected target for forbidden operations before runtime', () => {
    expect(() => resolver.resolve({ kind: 'active' }, 'forbidden')).toThrowError(
      expect.objectContaining({ code: 'TARGET_FORBIDDEN' }),
    );
  });

  it('rejects none for required operations and accepts it for optional or forbidden operations', () => {
    expect(() => resolver.resolve({ kind: 'none' }, 'required')).toThrowError(
      expect.objectContaining({ code: 'TARGET_REQUIRED' }),
    );
    expect(resolver.resolve({ kind: 'none' }, 'optional')).toEqual({
      sessionId: null,
      pluginGeneration: null,
      fileIdentity: null,
      fileExecutionKey: null,
    });
    expect(resolver.resolve({ kind: 'none' }, 'forbidden')).toEqual({
      sessionId: null,
      pluginGeneration: null,
      fileIdentity: null,
      fileExecutionKey: null,
    });
  });

  it('fails required active selection when no plugin is connected', () => {
    const empty = new TargetResolver({ active: () => undefined, list: () => [] });
    expect(() => empty.resolve({ kind: 'active' }, 'required')).toThrowError(
      expect.objectContaining({ code: 'PLUGIN_NOT_CONNECTED' }),
    );
  });
});
