import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeRemoteDomain,
  RemoteDomainConfigStore,
  remoteDomainConfigPath,
} from '../../src/network/remote-domain-config-store.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

const temporaryRoots: string[] = [];
let stateRoot: string;
let now: number;
const ACTOR_A = `actor1_${'A'.repeat(43)}`;
const ACTOR_B = `actor1_${'B'.repeat(43)}`;
const execFile = promisify(execFileCallback);

const externalSwap = async (
  target: string,
  displaced: string,
  replacement: Uint8Array,
): Promise<'swapped' | 'blocked'> => {
  const script = String.raw`
const { renameSync, writeFileSync } = require('node:fs');
const [target, displaced, encoded] = process.argv.slice(1);
try {
  renameSync(target, displaced);
  writeFileSync(target, Buffer.from(encoded, 'base64'), { flag: 'wx', mode: 0o600 });
  process.stdout.write('swapped');
} catch (error) {
  process.stdout.write('blocked');
}
`;
  const { stdout } = await execFile(
    process.execPath,
    ['-e', script, target, displaced, Buffer.from(replacement).toString('base64')],
    { windowsHide: true },
  );
  return stdout === 'swapped' ? 'swapped' : 'blocked';
};

const readMaybe = (path: string): Promise<Buffer | null> =>
  readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-remote-domains-'));
  temporaryRoots.push(root);
  return root;
};

const identityKey = async (path: string): Promise<string> => {
  const metadata = await stat(path, { bigint: true });
  return `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`;
};

const testPermissions = (root: string): BoundStatePermissions => ({
  stateRoot: resolve(root),
  ensureSecure: async path => {
    if (process.platform !== 'win32')
      await chmod(path, (await lstat(path)).isDirectory() ? 0o700 : 0o600);
  },
  verifySecure: async path => {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw Object.assign(new Error('linked state path'), { code: 'STATE_PATH_REPARSE' });
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw Object.assign(new Error('broad state mode'), { code: 'STATE_MODE_INSECURE' });
    }
  },
  inspectSecure: async path => {
    await testPermissions(root).verifySecure(path);
    const metadata = await stat(path);
    return {
      canonicalPath: await realpath(path),
      key: await identityKey(path),
      directory: metadata.isDirectory(),
      file: metadata.isFile(),
    };
  },
});

const createStore = (
  overrides: Partial<ConstructorParameters<typeof RemoteDomainConfigStore>[0]> = {},
): RemoteDomainConfigStore =>
  new RemoteDomainConfigStore({
    stateRoot,
    permissions: testPermissions(stateRoot),
    now: () => now,
    ...overrides,
  });

const authorize = vi.fn<() => Promise<void>>(async () => undefined);

const canonicalFixtureJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalFixtureJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalFixtureJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fixtureChecksum = (payload: unknown): string =>
  `sha256:${createHash('sha256')
    .update('sfp-remote-domain-state-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalFixtureJson(payload), 'utf8')
    .digest('hex')}`;

const writeStateFixture = async (payload: {
  audit: unknown[];
  generation: number;
  rules: unknown[];
  schemaVersion: 1;
}): Promise<void> => {
  const directory = dirname(remoteDomainConfigPath(stateRoot));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const envelope = { ...payload, checksum: fixtureChecksum(payload) };
  await writeFile(remoteDomainConfigPath(stateRoot), `${canonicalFixtureJson(envelope)}\n`, {
    mode: 0o600,
  });
};

beforeEach(async () => {
  stateRoot = await temporaryRoot();
  await chmod(stateRoot, 0o700).catch(() => undefined);
  now = Date.parse('2026-09-05T01:02:03.000Z');
  authorize.mockClear();
});

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove non-temporary path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('remote domain normalization', () => {
  it.each([
    '',
    ' com',
    'com',
    'co.uk',
    'example.com',
    '*.example.com',
    '.assets.example.com',
    'assets.example.com.',
    'assets..example.com',
    'https://assets.example.com',
    'user@assets.example.com',
    'assets.example.com:443',
    '127.0.0.1',
    '0x7f000001',
    'bad_name.example.com',
    '-bad.example.com',
  ])('rejects non-exact or invalid input %j before persistence', input => {
    expect(() => normalizeRemoteDomain(input)).toThrowError(
      expect.objectContaining({ code: 'REMOTE_FQDN_INVALID' }),
    );
  });

  it('canonicalizes Unicode and case to one lowercase ASCII exact host', () => {
    expect(normalizeRemoteDomain('BÜCHER.Assets.Example')).toBe('xn--bcher-kva.assets.example');
  });
});

describe('durable remote domain state', () => {
  it('rejects a non-principal actor before consuming authorization', async () => {
    const store = createStore();
    await store.recover();

    await expect(
      store.addAuthorized('actor-1', 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_CONFIG_INVALID' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('treats a missing file as an empty immutable list only after recovery', async () => {
    const store = createStore();

    await expect(store.list()).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_STORE_NOT_RECOVERED' });
    await store.recover();
    const rules = await store.list();

    expect(rules).toEqual([]);
    expect(Object.isFrozen(rules)).toBe(true);
  });

  it('validates semantics before authorization and invokes authorization immediately before commit', async () => {
    const store = createStore();
    await store.recover();
    const configPath = remoteDomainConfigPath(stateRoot);
    let absentDuringAuthorization = false;

    const rule = await store.addAuthorized(ACTOR_A, 'ASSETS.Example.COM', async () => {
      authorize();
      absentDuringAuthorization = await readFile(configPath).then(
        () => false,
        (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
      );
    });

    expect(absentDuringAuthorization).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(rule).toEqual({
      fqdnAscii: 'assets.example.com',
      addedBy: ACTOR_A,
      addedAt: '2026-09-05T01:02:03.000Z',
    });
    expect(await store.list()).toEqual([rule]);
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(await store.list())).toBe(true);
  });

  it('does not consume authorization for invalid, duplicate, missing, or over-cap mutations', async () => {
    const store = createStore();
    await store.recover();
    await expect(store.addAuthorized(ACTOR_A, 'example.com', authorize)).rejects.toMatchObject({
      code: 'REMOTE_FQDN_INVALID',
    });
    await store.addAuthorized(ACTOR_A, 'assets.example.com', authorize);
    authorize.mockClear();

    await expect(
      store.addAuthorized(ACTOR_A, 'ASSETS.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_ALREADY_EXISTS' });
    await expect(
      store.removeAuthorized(ACTOR_A, 'missing.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_NOT_FOUND' });

    for (let index = 0; index < 255; index += 1) {
      await store.addAuthorized(
        ACTOR_A,
        `asset-${index.toString().padStart(3, '0')}.example.com`,
        async () => undefined,
      );
    }
    authorize.mockClear();
    await expect(
      store.addAuthorized(ACTOR_A, 'overflow.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_CAPACITY_EXCEEDED' });
    expect(authorize).not.toHaveBeenCalled();
  }, 30_000);

  it('rejects the 4,097th audit mutation before consuming authorization', async () => {
    const audit = Array.from({ length: 4_096 }, (_, index) => ({
      action: index % 2 === 0 ? 'add' : 'remove',
      actorId: ACTOR_A,
      at: '2026-09-05T01:02:03.000Z',
      fqdnAscii: 'a.b.example',
      result: 'committed',
    }));
    await writeStateFixture({ schemaVersion: 1, generation: 4_096, rules: [], audit });
    const store = createStore();
    await store.recover();

    await expect(
      store.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_CAPACITY_EXCEEDED' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('leaves state unchanged when authorization rejects', async () => {
    const store = createStore();
    await store.recover();

    await expect(
      store.addAuthorized(ACTOR_A, 'assets.example.com', async () => {
        throw Object.assign(new Error('nonce rejected'), { code: 'ACTION_NONCE_REUSED' });
      }),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_REUSED' });

    await expect(store.list()).resolves.toEqual([]);
    await expect(readFile(remoteDomainConfigPath(stateRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('sorts by UTF-8 bytes and returns frozen snapshots that cannot mutate store state', async () => {
    const store = createStore();
    await store.recover();
    await store.addAuthorized(ACTOR_A, 'z.assets.example', authorize);
    await store.addAuthorized(ACTOR_A, 'a.assets.example', authorize);
    const snapshot = await store.list();

    expect(snapshot.map(rule => rule.fqdnAscii)).toEqual(['a.assets.example', 'z.assets.example']);
    expect(snapshot.every(Object.isFrozen)).toBe(true);
    expect(() =>
      (snapshot as unknown as RemoteDomainRuleForMutation[]).push({ fqdnAscii: 'x' }),
    ).toThrow(/not extensible|read only/u);
    await expect(store.list()).resolves.toHaveLength(2);
  });

  it('serializes two store instances without losing either update', async () => {
    const first = createStore();
    const second = createStore();
    await Promise.all([first.recover(), second.recover()]);

    await Promise.all([
      first.addAuthorized(ACTOR_A, 'a.assets.example', async () => undefined),
      second.addAuthorized(ACTOR_B, 'b.assets.example', async () => undefined),
    ]);

    expect((await first.list()).map(rule => rule.fqdnAscii)).toEqual([
      'a.assets.example',
      'b.assets.example',
    ]);
  });

  it('persists only redacted committed audit fields and removes through the same transaction', async () => {
    const store = createStore();
    await store.recover();
    await store.addAuthorized(ACTOR_A, 'BÜCHER.Assets.Example', authorize);
    now += 1_000;
    await store.removeAuthorized(ACTOR_B, 'xn--bcher-kva.assets.example', authorize);

    const raw = await readFile(remoteDomainConfigPath(stateRoot), 'utf8');
    const parsed = JSON.parse(raw) as { audit: unknown[]; rules: unknown[] };
    expect(parsed.rules).toEqual([]);
    expect(parsed.audit).toEqual([
      {
        action: 'add',
        actorId: ACTOR_A,
        at: '2026-09-05T01:02:03.000Z',
        fqdnAscii: 'xn--bcher-kva.assets.example',
        result: 'committed',
      },
      {
        action: 'remove',
        actorId: ACTOR_B,
        at: '2026-09-05T01:02:04.000Z',
        fqdnAscii: 'xn--bcher-kva.assets.example',
        result: 'committed',
      },
    ]);
    expect(raw).not.toContain('BÜCHER');
    expect(raw).not.toContain('nonce');
    expect(raw).not.toContain('url');
  });

  it('fails closed on checksum corruption instead of resetting the allowlist', async () => {
    const store = createStore();
    await store.recover();
    await store.addAuthorized(ACTOR_A, 'assets.example.com', authorize);
    const path = remoteDomainConfigPath(stateRoot);
    const raw = JSON.parse(await readFile(path, 'utf8')) as { checksum: string; rules: unknown[] };
    raw.rules = [];
    await writeFile(path, `${JSON.stringify(raw)}\n`, { mode: 0o600 });

    const restarted = createStore();
    await expect(restarted.recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_CONFIG_INVALID',
    });
  });

  it('fails closed when a recomputed checksum hides an audit history inconsistent with rules', async () => {
    const store = createStore();
    await store.recover();
    await store.addAuthorized(ACTOR_A, 'assets.example.com', authorize);
    const parsed = JSON.parse(await readFile(remoteDomainConfigPath(stateRoot), 'utf8')) as {
      audit: Array<{ action: string }>;
      checksum: string;
      generation: number;
      rules: unknown[];
      schemaVersion: 1;
    };
    parsed.audit[0]!.action = 'remove';
    const { checksum: _checksum, ...payload } = parsed;
    parsed.checksum = fixtureChecksum(payload);
    await writeFile(remoteDomainConfigPath(stateRoot), `${canonicalFixtureJson(parsed)}\n`, {
      mode: 0o600,
    });

    await expect(createStore().recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_CONFIG_INVALID',
    });
  });

  it('fails closed when the state file is a symlink', async context => {
    const outside = join(await temporaryRoot(), 'outside.json');
    await writeFile(outside, '{}\n', { mode: 0o600 });
    const path = remoteDomainConfigPath(stateRoot);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await symlink(outside, path, 'file');
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Windows file symlinks require Developer Mode or symlink privilege');
      }
      throw error;
    }
    const store = createStore();

    await expect(store.recover()).rejects.toMatchObject({
      code: expect.stringMatching(/REMOTE_DOMAIN_CONFIG_INVALID|STATE_PATH_REPARSE/),
    });
  });

  it('rejects replacement of the owner root after permission inspection and before authority retention', async () => {
    const basePermissions = testPermissions(stateRoot);
    const displacedRoot = `${stateRoot}.displaced`;
    temporaryRoots.push(displacedRoot);
    let replaced = false;
    const adversarialPermissions: BoundStatePermissions = {
      ...basePermissions,
      inspectSecure: async path => {
        const inspected = await basePermissions.inspectSecure(path);
        if (!replaced && resolve(path) === resolve(stateRoot)) {
          replaced = true;
          await rename(stateRoot, displacedRoot);
          await mkdir(stateRoot, { mode: 0o700 });
          await chmod(stateRoot, 0o700).catch(() => undefined);
        }
        return inspected;
      },
    };
    const store = createStore({ permissions: adversarialPermissions });

    await expect(store.recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_CONFIG_INVALID',
    });
  });

  it.runIf(process.platform !== 'win32')(
    'fails closed when the persisted file mode is widened',
    async () => {
      const store = createStore();
      await store.recover();
      await store.addAuthorized(ACTOR_A, 'assets.example.com', authorize);
      await chmod(remoteDomainConfigPath(stateRoot), 0o644);

      await expect(createStore().recover()).rejects.toMatchObject({ code: 'STATE_MODE_INSECURE' });
    },
  );
});

describe('bounded recovery', () => {
  it('does not misclassify a stale path-lock temporary as an authorized state generation', async () => {
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    await writeFile(
      join(directory, `.remote-domains.v1.json.sfp-lock.${'a'.repeat(32)}.sfp-tmp`),
      'stale-lock-owner',
      { mode: 0o600 },
    );

    const store = createStore();
    await store.recover();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('recovers one fsynced authorized temporary generation after a pre-rename crash', async () => {
    const crashing = createStore({
      hooks: {
        afterTemporaryFsync: async () => {
          throw new Error('simulated process crash');
        },
      },
    });
    await crashing.recover();

    await expect(
      crashing.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN', committed: false });
    const restarted = createStore();
    await restarted.recover();

    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({ fqdnAscii: 'assets.example.com' }),
    ]);
  });

  it('reports a post-rename crash as committed truth and does not duplicate its audit', async () => {
    const crashing = createStore({
      hooks: {
        afterRenameBeforeDirectoryFsync: async () => {
          throw new Error('simulated process crash');
        },
      },
    });
    await crashing.recover();

    await expect(
      crashing.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN', committed: true });
    const restarted = createStore();
    await restarted.recover();
    await expect(restarted.list()).resolves.toHaveLength(1);
    const persisted = JSON.parse(await readFile(remoteDomainConfigPath(stateRoot), 'utf8')) as {
      audit: unknown[];
    };
    expect(persisted.audit).toHaveLength(1);
  });

  it('never deletes a pre-existing file when a prepared-name race loses exclusive creation', async () => {
    const entropy = Buffer.alloc(16, 0xaa);
    const store = createStore({ randomBytes: () => entropy });
    await store.recover();
    const rule = {
      fqdnAscii: 'assets.example.com',
      addedBy: ACTOR_A,
      addedAt: '2026-09-05T01:02:03.000Z',
    };
    const payload = {
      schemaVersion: 1 as const,
      generation: 1,
      rules: [rule],
      audit: [
        {
          action: 'add',
          actorId: ACTOR_A,
          at: '2026-09-05T01:02:03.000Z',
          fqdnAscii: 'assets.example.com',
          result: 'committed',
        },
      ],
    };
    const envelope = { ...payload, checksum: fixtureChecksum(payload) };
    const expectedBytes = Buffer.from(`${canonicalFixtureJson(envelope)}\n`);
    const digest = createHash('sha256').update(expectedBytes).digest('hex');
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    const racedPath = join(
      directory,
      `.remote-domain-state.v1.${digest}.${entropy.toString('hex')}.sfp-tmp`,
    );

    await expect(
      store.addAuthorized(ACTOR_A, 'assets.example.com', async () => {
        await writeFile(racedPath, 'foreign', { mode: 0o600 });
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(readFile(racedPath, 'utf8')).resolves.toBe('foreign');
  });

  it('retains both inodes when an external process swaps the created temp before permission verification', async () => {
    const basePermissions = testPermissions(stateRoot);
    let outcome: 'swapped' | 'blocked' | undefined;
    let displaced = '';
    let temporary = '';
    const permissions: BoundStatePermissions = {
      ...basePermissions,
      inspectSecure: async path => {
        if (outcome === undefined && basename(path).startsWith('.remote-domain-state.v1.')) {
          temporary = path;
          displaced = `${path}.owned-displaced`;
          outcome = await externalSwap(path, displaced, Buffer.from('foreign-pre-permission'));
          if (outcome === 'blocked') throw new Error('external replacement was blocked');
        }
        return basePermissions.inspectSecure(path);
      },
    };
    const store = createStore({ permissions });
    await store.recover();

    const failure = await store
      .addAuthorized(ACTOR_A, 'assets.example.com', authorize)
      .catch(error => error as unknown);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(outcome).toBeDefined();
    await expect(readFile(remoteDomainConfigPath(stateRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const [temporaryBytes, displacedBytes] = await Promise.all([
      readMaybe(temporary),
      readMaybe(displaced),
    ]);
    expect({
      temporaryExists: temporaryBytes !== null,
      temporaryIsForeign: temporaryBytes?.toString('utf8') === 'foreign-pre-permission',
      displacedExists: displacedBytes !== null,
    }).toEqual(
      outcome === 'swapped'
        ? { temporaryExists: true, temporaryIsForeign: true, displacedExists: true }
        : { temporaryExists: false, temporaryIsForeign: false, displacedExists: false },
    );
  });

  it('does not publish an external post-reread temp replacement', async () => {
    let outcome: 'swapped' | 'blocked' | undefined;
    let displaced = '';
    let temporary = '';
    const store = createStore({
      hooks: {
        afterTemporaryFsync: async path => {
          temporary = path;
          displaced = `${path}.owned-displaced`;
          outcome = await externalSwap(path, displaced, Buffer.from('foreign-before-rename'));
          if (outcome === 'blocked') throw new Error('external replacement was blocked');
        },
      },
    });
    await store.recover();

    await expect(
      store.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toBeDefined();
    expect(outcome).toBeDefined();
    await expect(readFile(remoteDomainConfigPath(stateRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const [temporaryBytes, displacedBytes] = await Promise.all([
      readMaybe(temporary),
      readMaybe(displaced),
    ]);
    expect({
      temporaryExists: temporaryBytes !== null,
      temporaryIsForeign: temporaryBytes?.toString('utf8') === 'foreign-before-rename',
      displacedExists: displacedBytes !== null,
    }).toEqual(
      outcome === 'swapped'
        ? { temporaryExists: true, temporaryIsForeign: true, displacedExists: true }
        : { temporaryExists: true, temporaryIsForeign: false, displacedExists: false },
    );
  });

  it('cleanup never unlinks a foreign replacement introduced by an external process', async () => {
    const basePermissions = testPermissions(stateRoot);
    let temporary = '';
    let displaced = '';
    let outcome: 'swapped' | 'blocked' | undefined;
    const permissions: BoundStatePermissions = {
      ...basePermissions,
      inspectSecure: async path => {
        if (basename(path).startsWith('.remote-domain-state.v1.')) {
          temporary = path;
          throw new Error('fail before temp admission');
        }
        return basePermissions.inspectSecure(path);
      },
    };
    const store = createStore({
      permissions,
      hooks: {
        beforeOwnedTemporaryCleanup: async path => {
          displaced = `${path}.owned-displaced`;
          outcome = await externalSwap(path, displaced, Buffer.from('foreign-before-cleanup'));
        },
      },
    });
    await store.recover();

    const failure = await store
      .addAuthorized(ACTOR_A, 'assets.example.com', authorize)
      .catch(error => error as unknown);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(outcome).toBeDefined();
    await expect(readFile(remoteDomainConfigPath(stateRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const [temporaryBytes, displacedBytes] = await Promise.all([
      readMaybe(temporary),
      readMaybe(displaced),
    ]);
    expect({
      temporaryExists: temporaryBytes !== null,
      temporaryIsForeign: temporaryBytes?.toString('utf8') === 'foreign-before-cleanup',
      displacedExists: displacedBytes !== null,
    }).toEqual(
      outcome === 'swapped'
        ? { temporaryExists: true, temporaryIsForeign: true, displacedExists: true }
        : { temporaryExists: false, temporaryIsForeign: false, displacedExists: false },
    );
  });

  it('recovery retains its descriptor and refuses an external read-to-rename replacement', async () => {
    const crashing = createStore({
      hooks: {
        afterTemporaryFsync: async () => {
          throw new Error('simulated process crash');
        },
      },
    });
    await crashing.recover();
    await expect(
      crashing.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN' });
    let outcome: 'swapped' | 'blocked' | undefined;
    let temporary = '';
    let displaced = '';
    const restarted = createStore({
      hooks: {
        afterRecoveryTemporaryRead: async path => {
          temporary = path;
          displaced = `${path}.owned-displaced`;
          outcome = await externalSwap(path, displaced, Buffer.from('foreign-recovery-temp'));
          if (outcome === 'blocked') throw new Error('external replacement was blocked');
        },
      },
    });

    await expect(restarted.recover()).rejects.toBeDefined();
    expect(outcome).toBeDefined();
    await expect(readFile(remoteDomainConfigPath(stateRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const [temporaryBytes, displacedBytes] = await Promise.all([
      readMaybe(temporary),
      readMaybe(displaced),
    ]);
    expect({
      temporaryExists: temporaryBytes !== null,
      temporaryIsForeign: temporaryBytes?.toString('utf8') === 'foreign-recovery-temp',
      displacedExists: displacedBytes !== null,
    }).toEqual(
      outcome === 'swapped'
        ? { temporaryExists: true, temporaryIsForeign: true, displacedExists: true }
        : { temporaryExists: true, temporaryIsForeign: false, displacedExists: false },
    );
  });

  it('fails closed instead of choosing between multiple prepared temporary generations', async () => {
    const crashing = createStore({
      hooks: {
        afterTemporaryFsync: async () => {
          throw new Error('simulated process crash');
        },
      },
    });
    await crashing.recover();
    await expect(
      crashing.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN' });
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    const temporary = (await readdir(directory)).find(name => name.endsWith('.sfp-tmp'));
    if (temporary === undefined) throw new Error('expected prepared temporary generation');
    const duplicate = temporary.replace(/[0-9a-f]{32}\.sfp-tmp$/u, `${'f'.repeat(32)}.sfp-tmp`);
    await copyFile(join(directory, temporary), join(directory, duplicate));
    await chmod(join(directory, duplicate), 0o600).catch(() => undefined);

    await expect(createStore().recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
    });
  });

  it('rejects a checksummed prepared generation whose audit does not describe its rule delta', async () => {
    const crashing = createStore({
      hooks: {
        afterTemporaryFsync: async () => {
          throw new Error('simulated process crash');
        },
      },
    });
    await crashing.recover();
    await expect(
      crashing.addAuthorized(ACTOR_A, 'assets.example.com', authorize),
    ).rejects.toMatchObject({ code: 'REMOTE_DOMAIN_COMMIT_OUTCOME_UNKNOWN' });
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    const temporary = (await readdir(directory)).find(name => name.endsWith('.sfp-tmp'));
    if (temporary === undefined) throw new Error('expected prepared temporary generation');
    const parsed = JSON.parse(await readFile(join(directory, temporary), 'utf8')) as {
      audit: unknown[];
      checksum: string;
      generation: number;
      rules: unknown[];
      schemaVersion: 1;
    };
    parsed.rules = [];
    const { checksum: _checksum, ...payload } = parsed;
    parsed.checksum = fixtureChecksum(payload);
    const bytes = Buffer.from(`${canonicalFixtureJson(parsed)}\n`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const replacementName = temporary.replace(/[0-9a-f]{64}(?=\.[0-9a-f]{32}\.sfp-tmp$)/u, digest);
    const replacementPath = join(directory, replacementName);
    await writeFile(replacementPath, bytes, { mode: 0o600 });
    if (replacementName !== temporary) {
      await rename(join(directory, temporary), `${join(directory, temporary)}.invalid`);
      await rm(`${join(directory, temporary)}.invalid`);
    }

    await expect(createStore().recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_RECOVERY_AMBIGUOUS',
    });
  });

  it('rejects an owned temporary namespace above 32 candidates before inspecting unbounded input', async () => {
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    for (let index = 0; index < 33; index += 1) {
      const digest = createHash('sha256').update(String(index)).digest('hex');
      const token = index.toString(16).padStart(32, '0');
      await writeFile(
        join(directory, `.remote-domain-state.v1.${digest}.${token}.sfp-tmp`),
        '{}\n',
        { mode: 0o600 },
      );
    }

    await expect(createStore().recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_TEMP_LIMIT_EXCEEDED',
    });
  });

  it('admits at most 4,096 directory entries including the live authority lock', async () => {
    const directory = dirname(remoteDomainConfigPath(stateRoot));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    for (let index = 0; index < 4_095; index += 1) {
      await writeFile(join(directory, `.clutter-${index.toString().padStart(4, '0')}`), '', {
        mode: 0o600,
      });
    }
    await expect(createStore().recover()).resolves.toBeUndefined();
    await writeFile(join(directory, '.clutter-overflow'), '', { mode: 0o600 });

    await expect(createStore().recover()).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_CONFIG_INVALID',
    });
  }, 30_000);
});

type RemoteDomainRuleForMutation = { fqdnAscii: string };
