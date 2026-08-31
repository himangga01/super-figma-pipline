import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createControlStatusEndpoint } from '../../src/control/status-endpoint.js';

describe('authenticated control status', () => {
  it('hashes plugin generation with the fixed domain and returns no raw identity or generation', async () => {
    const endpoint = createControlStatusEndpoint({
      serverVersion: '0.1.0',
      buildId: 7,
      buildIdentityHash: null,
      leaderGeneration: () => 'leader-generation',
      role: () => 'leader',
      sessions: () => ({
        pairedPluginCount: 1,
        active: {
          sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
          fileName: 'Design',
          pageName: 'Home',
          fileIdentityKind: 'figma-file-key',
          pluginVersion: '0.1.0',
          pluginGeneration: 'plugin-generation',
          editorType: 'figjam',
          capabilities: ['read'],
        },
      }),
    });
    const observed = await endpoint();
    const expected = `sha256:${createHash('sha256')
      .update('sfp-control-status-plugin-generation-v1', 'utf8')
      .update(Buffer.from([0]))
      .update('plugin-generation', 'utf8')
      .digest('hex')}`;
    expect(observed.activePlugin).toMatchObject({
      editorType: 'figjam',
      pluginGenerationHash: expected,
    });
    expect(JSON.stringify(observed)).not.toMatch(
      /plugin-generation|figma-file-key.*value|controlToken/,
    );
  });
});
