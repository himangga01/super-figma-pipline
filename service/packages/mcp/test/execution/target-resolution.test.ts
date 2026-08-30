import { canonicalFileIdentityHash, SESSION_ID_A, SESSION_ID_WITH_UNDERSCORE } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import {
  TargetResolver,
  type AuthenticatedTargetSession,
} from '../../src/execution/target-resolver.js';

const session = (
  sessionId: string,
  fileKey: string,
  connectedSequence: number,
): AuthenticatedTargetSession => ({
  sessionId,
  pluginGeneration: `plugin-${connectedSequence}`,
  fileIdentity: { kind: 'figma-file-key', value: fileKey },
  connectedSequence,
  healthy: true,
});

describe('authenticated target resolution', () => {
  it('accepts the canonical Base64Url128 session fixture containing underscore', () => {
    const selected = session(SESSION_ID_WITH_UNDERSCORE, 'file-a', 1);
    const resolver = new TargetResolver({ active: () => selected, list: () => [selected] });

    expect(
      resolver.resolve({ kind: 'session', sessionId: SESSION_ID_WITH_UNDERSCORE }, 'required'),
    ).toMatchObject({
      sessionId: SESSION_ID_WITH_UNDERSCORE,
      fileExecutionKey: 'figma:file-a',
    });
  });

  it('selects the newest healthy same-identity session and freezes the target deeply', () => {
    const older = session(SESSION_ID_A, 'same-file', 1);
    const newer = session(SESSION_ID_WITH_UNDERSCORE, 'same-file', 2);
    const resolver = new TargetResolver({ active: () => older, list: () => [older, newer] });
    const target = resolver.resolve(
      { kind: 'stable-file', fileIdentityHash: canonicalFileIdentityHash(older.fileIdentity) },
      'required',
    );

    expect(target.sessionId).toBe(SESSION_ID_WITH_UNDERSCORE);
    expect(target.fileExecutionKey).toBe('figma:same-file');
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.fileIdentity)).toBe(true);
  });

  it('uses registered session and generation for unstable execution keys', () => {
    const selected: AuthenticatedTargetSession = {
      sessionId: SESSION_ID_A,
      pluginGeneration: 'plugin-g1',
      fileIdentity: {
        kind: 'unstable-readonly',
        sessionId: SESSION_ID_A,
        pluginGeneration: 'plugin-g1',
      },
      connectedSequence: 1,
      healthy: true,
    };
    const resolver = new TargetResolver({ active: () => selected, list: () => [selected] });

    expect(resolver.resolve({ kind: 'active' }, 'required').fileExecutionKey).toBe(
      `unstable:${SESSION_ID_A}:plugin-g1`,
    );
  });
});
