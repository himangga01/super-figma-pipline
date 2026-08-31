import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_EGRESS_CONFIG_V1 } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createAdminAuditStore } from '../../src/control/admin-audit-store.js';

const roots: string[] = [];
const actorId = `actor1_${'A'.repeat(43)}` as const;
const authSessionId = `auth1_${'B'.repeat(43)}` as const;
const hash = (char: string) => `sha256:${char.repeat(64)}` as const;
const publicationSteps = [
  'temp-log-fsync',
  'temp-checkpoint-fsync',
  'temp-anchor-fsync',
  'link-log',
  'link-checkpoint',
  'link-anchor',
  'directory-fsync-before-pointer',
  'pointer-replace',
  'directory-fsync-after-pointer',
  'temp-cleanup',
] as const;
const pointerCommitted = (step: (typeof publicationSteps)[number]): boolean =>
  publicationSteps.indexOf(step) >= publicationSteps.indexOf('pointer-replace');
const expectOnlySelectedGeneration = async (stateRoot: string): Promise<void> => {
  const files = await readdir(join(stateRoot, 'journal'));
  expect(files.filter(name => name.includes('.compact-'))).toHaveLength(3);
  expect(files.filter(name => name.endsWith('.current'))).toHaveLength(1);
  expect(files.some(name => name.includes('.publish-'))).toBe(false);
};
const publicationUuid = '10000000-0000-4000-8000-000000000001';
const generationUuid = '20000000-0000-4000-8000-000000000002';
const initializePublicationFixture = async (prefix: string) => {
  const stateRoot = await mkdtemp(join(tmpdir(), prefix));
  roots.push(stateRoot);
  const options = { stateRoot, cursorKey: Buffer.alloc(32, 7) };
  const store = createAdminAuditStore(options);
  await store.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
  const journal = join(stateRoot, 'journal');
  const files = await readdir(journal);
  const currentName = files.find(name => name.endsWith('.current'))!;
  const baseName = currentName.slice(0, -'.current'.length);
  const basePath = join(journal, baseName);
  const selectedNames = files.filter(name => name.startsWith(`${baseName}.compact-`)).toSorted();
  const selectedBytes = new Map(
    await Promise.all(
      selectedNames.map(async name => [name, await readFile(join(journal, name))] as const),
    ),
  );
  const sourceFor = (kind: 'jsonl' | 'checkpoint.json' | 'anchor.json' | 'current') =>
    kind === 'current'
      ? join(journal, currentName)
      : join(
          journal,
          selectedNames.find(name => name.endsWith(`.${kind}`))!,
        );
  const tempPath = (
    kind: 'jsonl' | 'checkpoint.json' | 'anchor.json' | 'current',
    uuid = publicationUuid,
  ) => `${basePath}.publish-4242-${uuid}.${kind}.tmp`;
  return {
    options,
    stateRoot,
    journal,
    baseName,
    basePath,
    selectedNames,
    selectedBytes,
    sourceFor,
    tempPath,
  };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('admin audit store', () => {
  it.each([
    ['pre-link partial temps', ['jsonl', 'checkpoint.json']],
    ['complete unselected temp set', ['jsonl', 'checkpoint.json', 'anchor.json', 'current']],
    ['pointer temp', ['current']],
  ] as const)(
    'removes recognized actor-scoped %s only after selected verification',
    async (_label, kinds) => {
      const fixture = await initializePublicationFixture('sfp-admin-audit-real-crash-');
      const tempPaths = await Promise.all(
        kinds.map(async kind => {
          const path = fixture.tempPath(kind);
          await copyFile(fixture.sourceFor(kind), path);
          return path;
        }),
      );
      const foreignName = `foreign.admin-audit.v1.publish-4242-${publicationUuid}.jsonl.tmp`;
      await writeFile(join(fixture.journal, foreignName), 'operator-owned');

      const restarted = createAdminAuditStore(fixture.options);
      await expect(
        restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
      ).resolves.toMatchObject({ chainVerified: true, rows: [] });
      for (const path of tempPaths) {
        await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      for (const [name, bytes] of fixture.selectedBytes) {
        expect(await readFile(join(fixture.journal, name))).toEqual(bytes);
      }
      await expect(readFile(join(fixture.journal, foreignName), 'utf8')).resolves.toBe(
        'operator-owned',
      );
    },
  );

  it('removes a complete hard-linked unselected generation and its publication temps', async () => {
    const fixture = await initializePublicationFixture('sfp-admin-audit-real-linked-crash-');
    const linkedPaths: string[] = [];
    for (const kind of ['jsonl', 'checkpoint.json', 'anchor.json'] as const) {
      const temp = fixture.tempPath(kind);
      await copyFile(fixture.sourceFor(kind), temp);
      const generation = `${fixture.basePath}.compact-${generationUuid}.${kind}`;
      await link(temp, generation);
      linkedPaths.push(temp, generation);
    }
    const pointerTemp = fixture.tempPath('current');
    await copyFile(fixture.sourceFor('current'), pointerTemp);
    linkedPaths.push(pointerTemp);

    const restarted = createAdminAuditStore(fixture.options);
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).resolves.toMatchObject({ chainVerified: true, rows: [] });
    for (const path of linkedPaths) {
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expectOnlySelectedGeneration(fixture.stateRoot);
  });

  it('removes post-pointer temp links without deleting the selected generation', async () => {
    const fixture = await initializePublicationFixture('sfp-admin-audit-selected-links-');
    const tempPaths: string[] = [];
    for (const kind of ['jsonl', 'checkpoint.json', 'anchor.json'] as const) {
      const temp = fixture.tempPath(kind);
      await link(fixture.sourceFor(kind), temp);
      tempPaths.push(temp);
    }
    const pointerTemp = fixture.tempPath('current');
    await copyFile(fixture.sourceFor('current'), pointerTemp);
    tempPaths.push(pointerTemp);

    const restarted = createAdminAuditStore(fixture.options);
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).resolves.toMatchObject({ chainVerified: true, rows: [] });
    for (const path of tempPaths) {
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    for (const [name, bytes] of fixture.selectedBytes) {
      expect(await readFile(join(fixture.journal, name))).toEqual(bytes);
    }
  });

  it('removes repeated large crash logs before they can persist outside the actor cap', async () => {
    const fixture = await initializePublicationFixture('sfp-admin-audit-large-crash-');
    const tempPaths = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const uuid = `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        const path = fixture.tempPath('jsonl', uuid);
        await writeFile(path, Buffer.alloc(262_144, index));
        return path;
      }),
    );

    const restarted = createAdminAuditStore({ ...fixture.options, maximumBytes: 131_072 });
    await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
    await expect(
      restarted.reserveTransaction(actorId, 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toMatchObject({ bytes: 131_072, rows: 4 });
    for (const path of tempPaths) {
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('verifies the selected generation before cleaning recognized publication temps', async () => {
    const fixture = await initializePublicationFixture('sfp-admin-audit-verify-first-');
    const temp = fixture.tempPath('jsonl');
    await copyFile(fixture.sourceFor('jsonl'), temp);
    const selectedAnchor = join(
      fixture.journal,
      fixture.selectedNames.find(name => name.endsWith('.anchor.json'))!,
    );
    await writeFile(selectedAnchor, '{"corrupt":true}\n');

    const restarted = createAdminAuditStore(fixture.options);
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CORRUPT' });
    await expect(lstat(temp)).resolves.toMatchObject({ size: 0 });
  });

  it.each([
    'ambiguous-temp',
    'ambiguous-generation',
    'directory',
    'symlink',
    'foreign-hardlink',
  ] as const)('fails closed without deleting %s publication artifacts', async fault => {
    const fixture = await initializePublicationFixture('sfp-admin-audit-unsafe-crash-');
    const foreignFile = join(fixture.journal, 'operator-owned.keep');
    await writeFile(foreignFile, 'operator-owned');
    let unsafePath: string;
    if (fault === 'ambiguous-temp') {
      unsafePath = `${fixture.basePath}.publish-4242-not-a-uuid.jsonl.tmp`;
      await writeFile(unsafePath, 'ambiguous');
    } else if (fault === 'ambiguous-generation') {
      unsafePath = `${fixture.basePath}.compact-${generationUuid}.jsonl.backup`;
      await writeFile(unsafePath, 'ambiguous');
    } else if (fault === 'directory') {
      unsafePath = fixture.tempPath('jsonl');
      await mkdir(unsafePath);
    } else if (fault === 'symlink') {
      const foreignDirectory = join(fixture.journal, 'operator-owned-dir');
      await mkdir(foreignDirectory);
      await writeFile(join(foreignDirectory, 'marker'), 'foreign-marker');
      unsafePath = fixture.tempPath('jsonl');
      await symlink(foreignDirectory, unsafePath, 'junction');
    } else {
      unsafePath = fixture.tempPath('jsonl');
      await link(foreignFile, unsafePath);
    }

    const restarted = createAdminAuditStore(fixture.options);
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CORRUPT' });
    await expect(lstat(unsafePath)).resolves.toBeDefined();
    await expect(readFile(foreignFile, 'utf8')).resolves.toBe('operator-owned');
    for (const [name, bytes] of fixture.selectedBytes) {
      expect(await readFile(join(fixture.journal, name))).toEqual(bytes);
    }
  });

  it.each(publicationSteps)(
    'keeps one selected generation when ordinary append crashes at %s',
    async crashStep => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-append-crash-'));
      roots.push(stateRoot);
      const baseOptions = { stateRoot, cursorKey: Buffer.alloc(32, 7) };
      const initialized = createAdminAuditStore(baseOptions);
      await initialized.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
      const crashing = createAdminAuditStore({
        ...baseOptions,
        publicationHook: async (event: { kind: string; step: string }) => {
          if (event.kind === 'append' && event.step === crashStep) throw new Error('CRASH');
        },
      } as never);
      const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
      const reservation = await crashing.reserveTransaction(actorId, transactionId);

      await expect(
        crashing.appendAndFsync(reservation.handle, {
          schemaVersion: 1,
          auditTransactionId: transactionId,
          kind: 'egress',
          actorId,
          authSessionId,
          stage: 'pending',
          action: 'egress.reset',
          actionNonceClaimHash: hash('a'),
          requestHash: hash('b'),
          expectedConfigHash: hash('c'),
          desiredConfigHash: null,
          configHash: null,
          allowedClasses: [],
          expiresAt: null,
          createdAt: '2026-08-31T00:00:00.000Z',
        }),
      ).rejects.toThrow('CRASH');

      const restarted = createAdminAuditStore(baseOptions);
      const result = await restarted.queryEgress(actorId, {
        since: null,
        cursor: null,
        limit: 1000,
      });
      expect(result.rows).toHaveLength(pointerCommitted(crashStep) ? 1 : 0);
      await expectOnlySelectedGeneration(stateRoot);
    },
  );

  it.each(publicationSteps)(
    'keeps one selected generation when compaction crashes at %s',
    async crashStep => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-compact-crash-'));
      roots.push(stateRoot);
      let now = 0;
      const baseOptions = {
        stateRoot,
        cursorKey: Buffer.alloc(32, 7),
        now: () => now,
        maximumRows: 10,
        maximumBytes: 1_000_000,
        compactAtRows: 3,
        compactAtBytes: 1_000_000,
        retentionMs: 2_592_000_000,
      };
      const seeded = createAdminAuditStore(baseOptions);
      const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
      const reservation = await seeded.reserveTransaction(actorId, transactionId);
      const common = {
        schemaVersion: 1 as const,
        auditTransactionId: transactionId,
        kind: 'egress' as const,
        actorId,
        authSessionId,
        action: 'egress.reset' as const,
        actionNonceClaimHash: hash('a'),
        requestHash: hash('b'),
        expectedConfigHash: hash('c'),
        allowedClasses: [] as const,
        expiresAt: null,
        createdAt: new Date(now).toISOString(),
      };
      await seeded.appendAndFsync(reservation.handle, {
        ...common,
        stage: 'pending',
        desiredConfigHash: null,
        configHash: null,
      });
      await seeded.appendAndFsync(reservation.handle, {
        ...common,
        stage: 'cas-intent',
        desiredConfigHash: hash('d'),
        configHash: null,
      });
      await seeded.appendAndFsync(reservation.handle, {
        ...common,
        stage: 'committed',
        desiredConfigHash: hash('d'),
        configHash: hash('d'),
      });
      await seeded.releaseTransaction(reservation.handle);
      now = 2_592_000_000;
      const crashing = createAdminAuditStore({
        ...baseOptions,
        publicationHook: async (event: { kind: string; step: string }) => {
          if (event.kind === 'compaction' && event.step === crashStep) throw new Error('CRASH');
        },
      } as never);

      await expect(
        crashing.reserveTransaction(actorId, 'sfp_atx1_-____________________w'),
      ).rejects.toThrow('CRASH');

      const restarted = createAdminAuditStore(baseOptions);
      const result = await restarted.queryEgress(actorId, {
        since: null,
        cursor: null,
        limit: 1000,
      });
      expect(result.rows).toHaveLength(pointerCommitted(crashStep) ? 0 : 3);
      await expectOnlySelectedGeneration(stateRoot);
    },
  );

  it('fsyncs a reserved transaction and exposes only the redacted verified projection', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const reservation = await store.reserveTransaction(actorId, transactionId);
    await store.appendAndFsync(reservation.handle, {
      schemaVersion: 1,
      auditTransactionId: transactionId,
      kind: 'egress',
      actorId,
      authSessionId,
      stage: 'pending',
      action: 'egress.reset',
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash: hash('c'),
      desiredConfigHash: null,
      configHash: null,
      allowedClasses: [],
      expiresAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const result = await store.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
    expect(result).toMatchObject({ schemaVersion: 1, chainVerified: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).not.toHaveProperty('actorId');
    expect(result.rows[0]).not.toHaveProperty('authSessionId');

    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).resolves.toMatchObject({
      chainVerified: true,
      rows: [expect.objectContaining({ auditTransactionId: transactionId, stage: 'pending' })],
    });
  });

  it('recovers a pending transaction by appending only its terminal abort', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-recovery-'));
    roots.push(stateRoot);
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const expectedConfigHash = hash('c');
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const reservation = await store.reserveTransaction(actorId, transactionId);
    await store.appendAndFsync(reservation.handle, {
      schemaVersion: 1,
      auditTransactionId: transactionId,
      kind: 'egress',
      actorId,
      authSessionId,
      stage: 'pending',
      action: 'egress.reset',
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash,
      desiredConfigHash: null,
      configHash: null,
      allowedClasses: [],
      expiresAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
    await restarted.recover({
      config: {
        schemaVersion: 1,
        mode: 'unknown-fail-closed',
        allowedClasses: [],
        consentId: null,
        configuredAt: null,
        expiresAt: null,
        configHash: expectedConfigHash,
      },
      expired: false,
      storageState: 'valid',
    });
    const result = await restarted.queryEgress(actorId, {
      since: null,
      cursor: null,
      limit: 1000,
    });

    expect(result.rows.map(row => row.stage)).toEqual(['pending', 'aborted']);
  });

  it.each(['pending', 'cas-intent'] as const)(
    'aborts configure %s against normal missing default storage',
    async durableStage => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-missing-expected-'));
      roots.push(stateRoot);
      const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
      const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
      const reservation = await store.reserveTransaction(actorId, transactionId);
      const common = {
        schemaVersion: 1 as const,
        auditTransactionId: transactionId,
        kind: 'egress' as const,
        actorId,
        authSessionId,
        action: 'egress.configure' as const,
        actionNonceClaimHash: hash('a'),
        requestHash: hash('b'),
        expectedConfigHash: DEFAULT_EGRESS_CONFIG_V1.configHash,
        allowedClasses: ['public'] as const,
        expiresAt: '2026-08-31T01:00:00.000Z',
        createdAt: '2026-08-31T00:00:00.000Z',
      };
      await store.appendAndFsync(reservation.handle, {
        ...common,
        stage: 'pending',
        desiredConfigHash: null,
        configHash: null,
      });
      if (durableStage === 'cas-intent') {
        await store.appendAndFsync(reservation.handle, {
          ...common,
          stage: 'cas-intent',
          desiredConfigHash: hash('d'),
          configHash: null,
        });
      }
      const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
      await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });

      await expect(
        restarted.recover({
          config: DEFAULT_EGRESS_CONFIG_V1,
          expired: false,
          storageState: 'missing',
        }),
      ).resolves.toBeUndefined();
      const result = await restarted.queryEgress(actorId, {
        since: null,
        cursor: null,
        limit: 1000,
      });
      expect(result.rows.at(-1)).toMatchObject({
        stage: 'aborted',
        configHash: DEFAULT_EGRESS_CONFIG_V1.configHash,
      });
      expect(result.rows.some(row => row.stage === 'recovered')).toBe(false);
    },
  );

  it('recovers a durable cas-intent only when valid storage has the exact desired hash', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-valid-desired-'));
    roots.push(stateRoot);
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const expectedConfigHash = hash('c');
    const desiredConfigHash = hash('d');
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const reservation = await store.reserveTransaction(actorId, transactionId);
    const common = {
      schemaVersion: 1 as const,
      auditTransactionId: transactionId,
      kind: 'egress' as const,
      actorId,
      authSessionId,
      action: 'egress.configure' as const,
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash,
      allowedClasses: ['public'] as const,
      expiresAt: '2026-08-31T01:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'pending',
      desiredConfigHash: null,
      configHash: null,
    });
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'cas-intent',
      desiredConfigHash,
      configHash: null,
    });
    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });

    await restarted.recover({
      config: {
        schemaVersion: 1,
        mode: 'external-model',
        allowedClasses: ['public'],
        consentId: `sfp_consent1_${'A'.repeat(22)}`,
        configuredAt: '2026-08-31T00:00:00.000Z',
        expiresAt: '2026-08-31T01:00:00.000Z',
        configHash: desiredConfigHash,
      },
      expired: false,
      storageState: 'valid',
    });
    const rows = (await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }))
      .rows;
    expect(rows.map(row => [row.stage, row.configHash])).toEqual([
      ['pending', null],
      ['cas-intent', null],
      ['recovered', desiredConfigHash],
    ]);
    expect(JSON.stringify(rows)).not.toContain('sfp_consent1_');
  });

  it('rejects noncanonical external classes before appending audit bytes', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-classes-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const reservation = await store.reserveTransaction(actorId, transactionId);

    await expect(
      store.appendAndFsync(reservation.handle, {
        schemaVersion: 1,
        auditTransactionId: transactionId,
        kind: 'egress',
        actorId,
        authSessionId,
        stage: 'pending',
        action: 'egress.configure',
        actionNonceClaimHash: hash('a'),
        requestHash: hash('b'),
        expectedConfigHash: hash('c'),
        desiredConfigHash: null,
        configHash: null,
        allowedClasses: ['project-code', 'public'],
        expiresAt: '2026-08-31T01:00:00.000Z',
        createdAt: '2026-08-31T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_RESERVATION_INVALID' });
  });

  it('fails closed when the durable anchor is corrupted across restart', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-anchor-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await store.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
    const journal = join(stateRoot, 'journal');
    const anchor = (await readdir(journal)).find(name => name.endsWith('.anchor.json'))!;
    await writeFile(join(journal, anchor), '{"corrupt":true}\n');

    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CORRUPT' });
  });

  it('rejects deletion of a valid row-boundary suffix on restart', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-suffix-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const reservation = await store.reserveTransaction(actorId, transactionId);
    const common = {
      schemaVersion: 1 as const,
      auditTransactionId: transactionId,
      kind: 'egress' as const,
      actorId,
      authSessionId,
      action: 'egress.reset' as const,
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash: hash('c'),
      allowedClasses: [] as const,
      expiresAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'pending',
      desiredConfigHash: null,
      configHash: null,
    });
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'cas-intent',
      desiredConfigHash: hash('d'),
      configHash: null,
    });
    const journal = join(stateRoot, 'journal');
    const logName = (await readdir(journal)).find(name => name.endsWith('.jsonl'))!;
    const logPath = join(journal, logName);
    const rows = (await readFile(logPath, 'utf8')).trimEnd().split('\n');
    await writeFile(logPath, `${rows[0]}\n`);

    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await expect(
      restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CORRUPT' });
  });

  it('recovers a durable pending reservation at the four-row hard boundary', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-cap-recovery-'));
    roots.push(stateRoot);
    const options = {
      stateRoot,
      cursorKey: Buffer.alloc(32, 7),
      maximumRows: 4,
      maximumBytes: 131_072,
    };
    const store = createAdminAuditStore(options);
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const expectedConfigHash = hash('c');
    const reservation = await store.reserveTransaction(actorId, transactionId);
    await store.appendAndFsync(reservation.handle, {
      schemaVersion: 1,
      auditTransactionId: transactionId,
      kind: 'egress',
      actorId,
      authSessionId,
      stage: 'pending',
      action: 'egress.reset',
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash,
      desiredConfigHash: null,
      configHash: null,
      allowedClasses: [],
      expiresAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const restarted = createAdminAuditStore(options);
    await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });

    await expect(
      restarted.recover({
        config: { ...DEFAULT_EGRESS_CONFIG_V1, configHash: expectedConfigHash },
        expired: false,
        storageState: 'valid',
      }),
    ).resolves.toBeUndefined();
    const result = await restarted.queryEgress(actorId, {
      since: null,
      cursor: null,
      limit: 1000,
    });
    expect(result.rows.map(row => row.stage)).toEqual(['pending', 'aborted']);
  });

  it('compacts terminal transactions at the threshold and removes retention-expired rows', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-compaction-'));
    roots.push(stateRoot);
    let now = 0;
    const store = createAdminAuditStore({
      stateRoot,
      cursorKey: Buffer.alloc(32, 7),
      now: () => now,
      maximumRows: 10,
      maximumBytes: 1_000_000,
      compactAtRows: 3,
      compactAtBytes: 1_000_000,
      retentionMs: 2_592_000_000,
    } as never);
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const reservation = await store.reserveTransaction(actorId, transactionId);
    const common = {
      schemaVersion: 1 as const,
      auditTransactionId: transactionId,
      kind: 'egress' as const,
      actorId,
      authSessionId,
      action: 'egress.reset' as const,
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash: hash('c'),
      allowedClasses: [] as const,
      expiresAt: null,
      createdAt: new Date(now).toISOString(),
    };
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'pending',
      desiredConfigHash: null,
      configHash: null,
    });
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'cas-intent',
      desiredConfigHash: hash('d'),
      configHash: null,
    });
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'committed',
      desiredConfigHash: hash('d'),
      configHash: hash('d'),
    });
    await store.releaseTransaction(reservation.handle);
    now = 2_592_000_000;

    await store.reserveTransaction(actorId, 'sfp_atx1_-____________________w');
    const result = await store.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });
    expect(result.rows).toEqual([]);
  });

  it('never recovers a reset from missing or corrupt config state', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-reset-recovery-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    const transactionId = 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA' as const;
    const reservation = await store.reserveTransaction(actorId, transactionId);
    const common = {
      schemaVersion: 1 as const,
      auditTransactionId: transactionId,
      kind: 'egress' as const,
      actorId,
      authSessionId,
      action: 'egress.reset' as const,
      actionNonceClaimHash: hash('a'),
      requestHash: hash('b'),
      expectedConfigHash: hash('c'),
      allowedClasses: [] as const,
      expiresAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'pending',
      desiredConfigHash: null,
      configHash: null,
    });
    await store.appendAndFsync(reservation.handle, {
      ...common,
      stage: 'cas-intent',
      desiredConfigHash: DEFAULT_EGRESS_CONFIG_V1.configHash,
      configHash: null,
    });
    const restarted = createAdminAuditStore({ stateRoot, cursorKey: Buffer.alloc(32, 7) });
    await restarted.queryEgress(actorId, { since: null, cursor: null, limit: 1000 });

    await expect(
      restarted.recover({
        config: DEFAULT_EGRESS_CONFIG_V1,
        expired: false,
        storageState: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CORRUPT' });
    const result = await restarted.queryEgress(actorId, {
      since: null,
      cursor: null,
      limit: 1000,
    });
    expect(result.rows.some(row => row.stage === 'recovered')).toBe(false);
  });

  it('serializes concurrent four-row reservations without over-admitting the hard cap', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-concurrency-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({
      stateRoot,
      cursorKey: Buffer.alloc(32, 7),
      maximumRows: 4,
      maximumBytes: 262_144,
    });

    const attempts = await Promise.allSettled([
      store.reserveTransaction(actorId, 'sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA'),
      store.reserveTransaction(actorId, 'sfp_atx1_-____________________w'),
    ]);

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('binds bounded query cursors to actor, filter, and the next retained row', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-admin-audit-cursor-'));
    roots.push(stateRoot);
    const store = createAdminAuditStore({
      stateRoot,
      cursorKey: Buffer.alloc(32, 7),
      compactAtRows: 2,
    });
    for (const [transactionId, createdAt] of [
      ['sfp_atx1_AQAAAAAAAAAAAAAAAAAAAA', '2026-08-31T00:00:00.000Z'],
      ['sfp_atx1_-____________________w', '2026-08-31T00:00:01.000Z'],
    ] as const) {
      const reservation = await store.reserveTransaction(actorId, transactionId);
      await store.appendAndFsync(reservation.handle, {
        schemaVersion: 1,
        auditTransactionId: transactionId,
        kind: 'egress',
        actorId,
        authSessionId,
        stage: 'pending',
        action: 'egress.reset',
        actionNonceClaimHash: hash('a'),
        requestHash: hash('b'),
        expectedConfigHash: hash('c'),
        desiredConfigHash: null,
        configHash: null,
        allowedClasses: [],
        expiresAt: null,
        createdAt,
      });
    }
    const first = await store.queryEgress(actorId, { since: null, cursor: null, limit: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await store.queryEgress(actorId, {
      since: null,
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.auditTransactionId).not.toBe(first.rows[0]?.auditTransactionId);
    const staleCursor = (await store.queryEgress(actorId, { since: null, cursor: null, limit: 1 }))
      .nextCursor;
    await store.reserveTransaction(actorId, 'sfp_atx1_AgAAAAAAAAAAAAAAAAAAAA');
    await expect(
      store.queryEgress(actorId, { since: null, cursor: staleCursor, limit: 1 }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CURSOR_INVALID' });
    await expect(
      store.queryEgress(`actor1_${'C'.repeat(43)}`, {
        since: null,
        cursor: first.nextCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_AUDIT_CURSOR_INVALID' });
  });
});
