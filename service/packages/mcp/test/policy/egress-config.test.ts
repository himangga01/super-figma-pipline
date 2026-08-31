import { lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ALL_DATA_CLASSES,
  DEFAULT_EGRESS_CONFIG_V1,
  hashEgressConfig,
  parseEgressConfigV1,
  type EgressConfigV1,
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
  const root = await mkdtemp(join(tmpdir(), 'sfp-egress-v2-'));
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
  inspectSecure: identityFor,
  ensureSecure: async path => {
    await lstat(path);
  },
  verifySecure: async path => {
    await lstat(path);
  },
});

const externalConfig = (): EgressConfigV1 => {
  const withoutHash = {
    schemaVersion: 1 as const,
    mode: 'external-model' as const,
    allowedClasses: ['public', 'project-code'] as const,
    consentId: 'sfp_consent1_AQAAAAAAAAAAAAAAAAAAAA' as const,
    configuredAt: '2026-08-31T00:00:00.000Z',
    expiresAt: '2026-08-31T02:00:00.000Z',
  };
  return { ...withoutHash, configHash: hashEgressConfig(withoutHash) };
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});

describe('CAS persisted egress configuration', () => {
  it('keeps the fail-closed default and canonical class authority immutable', () => {
    expect(Object.isFrozen(DEFAULT_EGRESS_CONFIG_V1)).toBe(true);
    expect(DEFAULT_EGRESS_CONFIG_V1).toMatchObject({
      schemaVersion: 1,
      mode: 'unknown-fail-closed',
      allowedClasses: [],
      consentId: null,
      configuredAt: null,
      expiresAt: null,
      configHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(ALL_DATA_CLASSES).toEqual([
      'public',
      'project-code',
      'design-text',
      'design-image',
      'secret',
    ]);
  });

  it('defaults the existing owner-state path and never creates a second policy path', async () => {
    const stateRoot = await temporaryStateRoot();
    const store = createEgressConfigStore(stateRoot, permissionsFor(stateRoot));
    await expect(store.load()).resolves.toEqual({
      config: DEFAULT_EGRESS_CONFIG_V1,
      expired: false,
      storageState: 'missing',
    });
    expect(egressConfigPath(stateRoot)).toBe(join(stateRoot, 'egress.v1.json'));
    await expect(lstat(join(stateRoot, 'policy', 'egress.v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses config-hash CAS for save and reset and preserves the same path across restart', async () => {
    const stateRoot = await temporaryStateRoot();
    const permissions = permissionsFor(stateRoot);
    const first = createEgressConfigStore(stateRoot, permissions);
    const configured = externalConfig();
    await first.save(configured, DEFAULT_EGRESS_CONFIG_V1.configHash);
    await expect(first.save(configured, DEFAULT_EGRESS_CONFIG_V1.configHash)).rejects.toMatchObject(
      {
        code: 'EGRESS_CONFIG_CAS_MISMATCH',
      },
    );
    const restarted = createEgressConfigStore(stateRoot, permissions);
    await expect(restarted.load(Date.parse('2026-08-31T01:59:59.999Z'))).resolves.toEqual({
      config: configured,
      expired: false,
      storageState: 'valid',
    });
    await expect(restarted.load(Date.parse(configured.expiresAt!))).resolves.toEqual({
      config: configured,
      expired: true,
      storageState: 'valid',
    });
    await expect(restarted.reset(configured.configHash)).resolves.toEqual(DEFAULT_EGRESS_CONFIG_V1);
    await expect(restarted.load()).resolves.toEqual({
      config: DEFAULT_EGRESS_CONFIG_V1,
      expired: false,
      storageState: 'valid',
    });
  });

  it('rejects unsorted, duplicate, empty, secret, and unknown external grants', () => {
    const base = {
      schemaVersion: 1,
      mode: 'external-model',
      consentId: 'sfp_consent1_AQAAAAAAAAAAAAAAAAAAAA',
      configuredAt: '2026-08-31T00:00:00.000Z',
      expiresAt: '2026-08-31T02:00:00.000Z',
      configHash: `sha256:${'a'.repeat(64)}`,
    };
    for (const allowedClasses of [
      [],
      ['project-code', 'public'],
      ['public', 'public'],
      ['secret'],
      ['connector-data'],
    ]) {
      expect(parseEgressConfigV1({ ...base, allowedClasses }).success).toBe(false);
    }
  });

  it('fails missing, expired, and insufficient consent before a runtime caller can proceed', () => {
    expect(() =>
      authorizeEgress(DEFAULT_EGRESS_CONFIG_V1, {
        source: 'mcp',
        inputClasses: ['public'],
        possibleResultClasses: ['public'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_CONFIG_REQUIRED' }));
    const configured = externalConfig();
    expect(() =>
      authorizeEgress(configured, {
        source: 'cli-control',
        inputClasses: ['design-image'],
        possibleResultClasses: ['public'],
        now: Date.parse('2026-08-31T01:00:00.000Z'),
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'EGRESS_CONSENT_REQUIRED', deniedClass: 'design-image' }),
    );
    expect(() =>
      authorizeEgress(configured, {
        source: 'follower',
        inputClasses: ['public'],
        possibleResultClasses: ['public'],
        now: Date.parse(configured.expiresAt!),
      }),
    ).toThrowError(expect.objectContaining({ code: 'EGRESS_CONFIG_REQUIRED' }));
  });

  it('treats checksum or schema corruption as fail-closed without rewriting consent', async () => {
    const stateRoot = await temporaryStateRoot();
    const permissions = permissionsFor(stateRoot);
    const store = createEgressConfigStore(stateRoot, permissions);
    const configured = externalConfig();
    await store.save(configured, DEFAULT_EGRESS_CONFIG_V1.configHash);
    const configPath = egressConfigPath(stateRoot);
    const original = await readFile(configPath, 'utf8');
    const opened = await open(configPath, 'w');
    try {
      await opened.writeFile(original.replace(configured.configHash, `sha256:${'f'.repeat(64)}`));
      await opened.sync();
    } finally {
      await opened.close();
    }
    await expect(store.load()).resolves.toEqual({
      config: DEFAULT_EGRESS_CONFIG_V1,
      expired: false,
      storageState: 'corrupt',
    });
    expect(await readFile(configPath, 'utf8')).toBe(
      original.replace(configured.configHash, `sha256:${'f'.repeat(64)}`),
    );
    await writeFile(configPath, '{"schemaVersion":2}\n');
    await expect(store.load()).resolves.toEqual({
      config: DEFAULT_EGRESS_CONFIG_V1,
      expired: false,
      storageState: 'corrupt',
    });
  });
});
