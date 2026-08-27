import { constants as fsConstants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ALL_DATA_CLASSES,
  DEFAULT_EGRESS_CONFIGURATION,
  parseEgressConfiguration,
  type EgressConfiguration,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  authorizeEgress,
  createEgressConfigStore,
  egressConfigPath,
} from '../../src/policy/policy-engine.js';
import type {
  BoundStatePermissions,
  SecurePathIdentity,
} from '../../src/security/state-permissions.js';

const temporaryRoots: string[] = [];

const temporaryStateRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-task5-egress-'));
  temporaryRoots.push(root);
  return root;
};

const identityFor = async (path: string): Promise<SecurePathIdentity> => {
  const metadata = await lstat(path, { bigint: true });
  return {
    canonicalPath: await realpath(path),
    key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
    directory: metadata.isDirectory(),
    file: metadata.isFile(),
  };
};

const permissionsFor = (stateRoot: string): BoundStatePermissions => ({
  stateRoot: resolve(stateRoot),
  ensureSecure: async path => {
    const handle = await open(path, fsConstants.O_RDONLY);
    await handle.close();
  },
  verifySecure: async path => {
    await identityFor(path);
  },
  inspectSecure: identityFor,
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  );
});

describe('explicit persisted egress configuration', () => {
  it('keeps the fail-closed default and canonical class authority immutable at runtime', () => {
    expect(Object.isFrozen(DEFAULT_EGRESS_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(ALL_DATA_CLASSES)).toBe(true);
  });

  it('defaults a missing config to unknown-fail-closed and never infers local trust from MCP', async () => {
    const stateRoot = await temporaryStateRoot();
    const store = createEgressConfigStore(stateRoot, permissionsFor(stateRoot));

    await expect(store.load()).resolves.toEqual(DEFAULT_EGRESS_CONFIGURATION);
    expect(() =>
      authorizeEgress(undefined, {
        source: 'mcp',
        inputClasses: ['public'],
        possibleResultClasses: ['design-text'],
        now: 1_700_000_000_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_MODE_UNKNOWN' }));
  });

  it('persists an explicit local-trusted choice with a null consent id', async () => {
    const stateRoot = await temporaryStateRoot();
    const permissions = permissionsFor(stateRoot);
    const config: EgressConfiguration = {
      version: 1,
      mode: 'local-trusted',
      consent: null,
    };

    await createEgressConfigStore(stateRoot, permissions).save(config);
    await expect(createEgressConfigStore(stateRoot, permissions).load()).resolves.toEqual(config);
    expect(await readFile(egressConfigPath(stateRoot), 'utf8')).toContain('"mode":"local-trusted"');
    expect(
      authorizeEgress(config, {
        source: 'mcp',
        inputClasses: ['design-text'],
        possibleResultClasses: ['design-image', 'project-code'],
        now: 1_700_000_000_000,
      }),
    ).toEqual({
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
    });
  });

  it('requires external-model consent to be non-null, unexpired, and class-complete', () => {
    expect(() =>
      parseEgressConfiguration({ version: 1, mode: 'external-model', consent: null }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_CONFIG_INVALID' }));

    const config: EgressConfiguration = {
      version: 1,
      mode: 'external-model',
      consent: {
        consentId: 'consent-fixture',
        allowedClasses: ['design-text'],
        expiresAt: 1_700_000_010_000,
      },
    };
    expect(() =>
      authorizeEgress(config, {
        source: 'mcp',
        inputClasses: ['design-text'],
        possibleResultClasses: ['design-image'],
        now: 1_700_000_000_000,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EGRESS_CLASS_NOT_ALLOWED', deniedClass: 'design-image' }),
    );
    expect(() =>
      authorizeEgress(config, {
        source: 'mcp',
        inputClasses: ['design-text'],
        possibleResultClasses: [],
        now: 1_700_000_010_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_CONSENT_EXPIRED' }));

    const complete: EgressConfiguration = {
      ...config,
      consent: {
        ...config.consent!,
        allowedClasses: ['design-text', 'design-image'],
      },
    };
    expect(
      authorizeEgress(complete, {
        source: 'mcp',
        inputClasses: ['design-text'],
        possibleResultClasses: ['design-image'],
        now: 1_700_000_000_000,
      }),
    ).toEqual({
      mode: 'external-model',
      consentId: 'consent-fixture',
      allowedClasses: ['design-text', 'design-image'],
    });
  });

  it('treats an explicit empty external class grant as deny-all rather than malformed', () => {
    const denyAll = parseEgressConfiguration({
      version: 1,
      mode: 'external-model',
      consent: {
        consentId: 'consent-deny-all',
        allowedClasses: [],
        expiresAt: 1_700_000_010_000,
      },
    });

    expect(() =>
      authorizeEgress(denyAll, {
        source: 'mcp',
        inputClasses: ['public'],
        possibleResultClasses: [],
        now: 1_700_000_000_000,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EGRESS_CLASS_NOT_ALLOWED', deniedClass: 'public' }),
    );
  });

  it('rejects unknown persisted modes instead of silently selecting a connector', () => {
    expect(() =>
      parseEgressConfiguration({ version: 1, mode: 'automatic', consent: null }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_CONFIG_INVALID' }));
  });
});
