import { describe, expect, it } from 'vitest';

import {
  createPluginHelloIdentityFacts,
  createPluginIdentityLifetime,
} from '../src/file-identity.js';

describe('initial read-only hello identity facts', () => {
  it('creates one cryptographic lifetime and freezes the empty 9A capability set', () => {
    let next = 0;
    const lifetime = createPluginIdentityLifetime(bytes => {
      bytes.fill(next);
      next += 1;
    });
    const facts = createPluginHelloIdentityFacts(
      { root: { getSharedPluginData: () => '' } },
      lifetime,
    );

    expect(lifetime).toEqual({
      provisionalSessionId: '00000000000000000000000000000000',
      pluginGeneration: '01010101010101010101010101010101',
    });
    expect(facts).toEqual({
      pluginGeneration: lifetime.pluginGeneration,
      fileIdentity: {
        kind: 'unstable-readonly',
        sessionId: lifetime.provisionalSessionId,
        pluginGeneration: lifetime.pluginGeneration,
      },
      capabilities: [],
    });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.capabilities)).toBe(true);
  });

  it('observes a later shared UUID without mutating the already-built hello facts', () => {
    let shared = '';
    const lifetime = createPluginIdentityLifetime(bytes => bytes.fill(7));
    const source = { root: { getSharedPluginData: () => shared } };
    const first = createPluginHelloIdentityFacts(source, lifetime);
    shared = '123e4567-e89b-42d3-a456-426614174000';
    const second = createPluginHelloIdentityFacts(source, lifetime);

    expect(first.fileIdentity.kind).toBe('unstable-readonly');
    expect(second.fileIdentity).toEqual({
      kind: 'document-plugin-uuid',
      value: shared,
    });
    expect(first.fileIdentity.kind).toBe('unstable-readonly');
  });
});
