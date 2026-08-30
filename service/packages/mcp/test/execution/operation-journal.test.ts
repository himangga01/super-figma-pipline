import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrefixedSha256 } from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  OperationJournal,
  hashOperationFingerprint,
  type NewOperationRecord,
} from '../../src/execution/operation-journal.js';
import { OperationResolutionIntentStore } from '../../src/execution/operation-resolution-intent.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const hash = (character: string) => `sha256:${character.repeat(64)}` as PrefixedSha256;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const record = (operationId: string, workspaceId = '123e4567-e89b-42d3-a456-426614174000') => {
  const fingerprint = {
    actorId,
    operationId,
    operationKind: 'tool' as const,
    operationName: 'create_text' as const,
    argsHash: hash('a'),
    workspaceId,
    fileExecutionKeyHash: hash('b'),
    targetBindingHash: hash('c'),
    captureIntentHash: hash('d'),
  };
  return {
    ...fingerprint,
    originAuthSessionId: authSessionId,
    origin: {
      kind: 'entry' as const,
      entryPath: 'mcp-direct' as const,
      authSessionId,
    },
    issuedAt: 1_724_803_200_000,
    operationFingerprintHash: hashOperationFingerprint(fingerprint),
    resultHash: null,
    resultBytes: null,
    fileExecutionKey: 'figma:file-a' as const,
    pluginGeneration: null,
    policyId: 'tool:create_text:v1',
    effectSummary: ['figma-write'],
    approvalId: null,
    preExecutionConsentManifestHash: null,
    finalEgressManifestHash: null,
    operationEvidenceReceiptHash: null,
  } satisfies NewOperationRecord;
};

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-journal-'));
  roots.push(root);
  return root;
};

describe('owner-state operation journal', () => {
  it('durably transitions without persisting raw args or results', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => 1_724_803_200_000,
    });
    await journal.recover();
    await journal.appendInitial(record('op-1'), 'queued');
    await journal.transition('op-1', 'dispatched');
    await journal.transition('op-1', 'succeeded', { resultHash: hash('e'), resultBytes: 11 });

    expect(journal.get('op-1')).toMatchObject({
      status: 'succeeded',
      resultHash: hash('e'),
      expiresAt: record('op-1').issuedAt + 2_592_000_000,
    });
    const durable = await readFile(journal.logPath, 'utf8');
    expect(durable).not.toContain('sensitive text');
    expect(durable).not.toContain('rawArgs');
    expect(durable).not.toContain('rawResult');
  });

  it('fsyncs the state root once when creating journal before any journal file barrier', async () => {
    const root = await createRoot();
    const firstSyncs: string[] = [];
    const first = new OperationJournal({
      stateRoot: root,
      actorId,
      syncDirectory: async path => {
        firstSyncs.push(path);
      },
    });
    await first.recover();
    expect(firstSyncs[0]).toBe(root);
    expect(firstSyncs.slice(1).every(path => path === join(root, 'journal'))).toBe(true);

    const restartSyncs: string[] = [];
    const restarted = new OperationJournal({
      stateRoot: root,
      actorId,
      syncDirectory: async path => {
        restartSyncs.push(path);
      },
    });
    await restarted.recover();
    expect(restartSyncs).not.toContain(root);
  });

  it('rejects an illegal state transition without appending or mutating the active record', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    await journal.appendInitial(record('op-invalid-transition'), 'queued');
    const before = await readFile(journal.logPath);

    await expect(
      journal.transition('op-invalid-transition', 'succeeded', {
        resultHash: hash('e'),
        resultBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'JOURNAL_TRANSITION_INVALID' });
    expect(await readFile(journal.logPath)).toEqual(before);
    expect(journal.get('op-invalid-transition')).toMatchObject({
      status: 'queued',
      sequence: 1,
    });
  });

  it('rejects a hash-valid row whose strict operation record contains an unknown key', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    await journal.appendInitial(record('op-strict-row'), 'queued');
    const row = JSON.parse((await readFile(journal.logPath, 'utf8')).trim()) as {
      schemaVersion: 1;
      record: Record<string, unknown>;
      previousRecordHash: PrefixedSha256 | null;
      recordHash: PrefixedSha256;
    };
    row.record.rawArgs = { secret: 'must-not-load' };
    row.recordHash = `sha256:${createHash('sha256')
      .update('sfp-operation-journal-record-v1')
      .update(Buffer.from([0]))
      .update(
        canonicalJson({
          schemaVersion: row.schemaVersion,
          record: row.record,
          previousRecordHash: row.previousRecordHash,
        }),
      )
      .digest('hex')}`;
    await writeFile(journal.logPath, `${canonicalJson(row)}\n`);

    const restarted = new OperationJournal({ stateRoot: root, actorId });
    await expect(restarted.recover()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
  });

  it('rejects a hash-valid restart row that persists raw entry plugin generation', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    const base = record('op-plugin-generation');
    await journal.appendInitial(base, 'queued');
    const row = JSON.parse((await readFile(journal.logPath, 'utf8')).trim()) as {
      schemaVersion: 1;
      record: Record<string, unknown>;
      previousRecordHash: PrefixedSha256 | null;
      recordHash: PrefixedSha256;
    };
    row.record.pluginGeneration = 'plugin-g2';
    row.recordHash = `sha256:${createHash('sha256')
      .update('sfp-operation-journal-record-v1')
      .update(Buffer.from([0]))
      .update(
        canonicalJson({
          schemaVersion: row.schemaVersion,
          record: row.record,
          previousRecordHash: row.previousRecordHash,
        }),
      )
      .digest('hex')}`;
    await writeFile(journal.logPath, `${canonicalJson(row)}\n`);

    const restarted = new OperationJournal({ stateRoot: root, actorId });
    await expect(restarted.recover()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
  });

  it('discards one final truncated row and recovers dispatched work as outcome-unknown', async () => {
    const root = await createRoot();
    const first = new OperationJournal({ stateRoot: root, actorId, now: () => 1_724_803_200_000 });
    await first.recover();
    await first.appendInitial(record('op-2'), 'queued');
    await first.transition('op-2', 'dispatched');
    await appendFile(first.logPath, '{"truncated":', 'utf8');

    const restarted = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => 1_724_803_200_100,
    });
    await restarted.recover();
    expect(restarted.get('op-2')).toMatchObject({
      status: 'outcome-unknown',
      errorCode: 'PROCESS_RESTARTED_AFTER_DISPATCH',
    });
  });

  it('deterministically settles every generation-bound state on restart and keeps unknown work blocking', async () => {
    const root = await createRoot();
    const first = new OperationJournal({ stateRoot: root, actorId, now: () => 1_724_803_200_000 });
    await first.recover();
    await first.appendInitial(record('op-pending'), 'pending-approval');
    await first.appendInitial(record('op-queued'), 'queued');
    await first.appendInitial(record('op-dispatched'), 'queued');
    await first.transition('op-dispatched', 'dispatched');

    const restarted = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => 1_724_803_200_100,
    });
    await restarted.recover();

    expect(restarted.get('op-pending')).toMatchObject({
      status: 'rejected',
    });
    expect(restarted.get('op-queued')).toMatchObject({
      status: 'failed',
    });
    expect(restarted.get('op-dispatched')).toMatchObject({
      status: 'outcome-unknown',
      errorCode: 'PROCESS_RESTARTED_AFTER_DISPATCH',
    });
    await expect(restarted.hasUnsettled('123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(
      true,
    );
  });

  it('fails the next ordinary append at capacity while status and workspace guard remain available', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      capacity: { maxRows: 1, maxBytes: 1_000_000, compactAtRows: 1_000, compactAtBytes: 900_000 },
    });
    await journal.recover();
    await journal.appendInitial(record('op-3'), 'queued');
    await expect(journal.appendInitial(record('op-4'), 'queued')).rejects.toMatchObject({
      code: 'JOURNAL_CAPACITY_EXCEEDED',
    });
    expect(journal.get('op-3')).toBeDefined();
    await expect(journal.hasUnsettled('123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(true);
  });

  it('uses settlement capacity at the normal row cap and moves known terminal work to a durable tombstone', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      capacity: { maxRows: 2, maxBytes: 1_000_000, compactAtRows: 2, compactAtBytes: 900_000 },
    });
    await journal.recover();
    await journal.appendInitial(record('op-terminal-at-cap'), 'queued');
    await journal.transition('op-terminal-at-cap', 'dispatched');
    await expect(
      journal.transition('op-terminal-at-cap', 'succeeded', {
        resultHash: hash('e'),
        resultBytes: 11,
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });

    expect(await readFile(journal.logPath, 'utf8')).not.toContain('op-terminal-at-cap');
    expect(await readFile(journal.tombstoneLogPath, 'utf8')).toContain('op-terminal-at-cap');
    await expect(journal.hasUnsettled('123e4567-e89b-42d3-a456-426614174000')).resolves.toBe(false);

    const restarted = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => record('op-terminal-at-cap').issuedAt + 1,
    });
    await restarted.recover();
    expect(restarted.get('op-terminal-at-cap')).toMatchObject({
      status: 'succeeded',
      resultHash: hash('e'),
      expiresAt: record('op-terminal-at-cap').issuedAt + 2_592_000_000,
    });
    expect(restarted.get('op-terminal-at-cap')).not.toHaveProperty('sequence');
  });

  it('recovers a tombstone-fsynced active overlap without replay after a crash', async () => {
    const root = await createRoot();
    let crash = true;
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      afterTombstoneFsync: async () => {
        if (crash) throw new Error('simulated crash after tombstone fsync');
      },
    });
    await journal.recover();
    await journal.appendInitial(record('op-overlap'), 'queued');
    await journal.transition('op-overlap', 'dispatched');
    await expect(
      journal.transition('op-overlap', 'succeeded', {
        resultHash: hash('e'),
        resultBytes: 1,
      }),
    ).rejects.toThrow('simulated crash');
    crash = false;

    const restarted = new OperationJournal({ stateRoot: root, actorId });
    await restarted.recover();
    expect(restarted.get('op-overlap')).toMatchObject({
      status: 'succeeded',
      resultHash: hash('e'),
      expiresAt: record('op-overlap').issuedAt + 2_592_000_000,
    });
    expect(await readFile(restarted.logPath, 'utf8')).not.toContain('op-overlap');
  });

  it('reserves tombstone bytes before admission and purges at the exact signed horizon', async () => {
    const root = await createRoot();
    const tooSmall = new OperationJournal({
      stateRoot: join(root, 'small'),
      actorId,
      tombstoneCapacity: { maxRows: 10, maxBytes: 32_767 },
    });
    await tooSmall.recover();
    await expect(tooSmall.appendInitial(record('op-no-reserve'), 'queued')).rejects.toMatchObject({
      code: 'JOURNAL_CAPACITY_EXCEEDED',
    });

    let clock = record('op-purge').issuedAt;
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => clock,
    });
    await journal.recover();
    await journal.appendInitial(record('op-purge'), 'queued');
    await journal.transition('op-purge', 'dispatched');
    await journal.transition('op-purge', 'succeeded', {
      resultHash: hash('e'),
      resultBytes: 1,
    });
    clock += 2_592_000_000 - 1;
    await expect(journal.purgeExpiredTombstones()).resolves.toBe(0);
    expect(journal.get('op-purge')).toBeDefined();
    clock += 1;
    await expect(journal.purgeExpiredTombstones()).resolves.toBe(1);
    expect(journal.get('op-purge')).toBeUndefined();
  });

  it('rejects hash-valid sequence jumps and bounds operation listing to 1000 rows', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    await journal.appendInitial(record('op-sequence'), 'queued');
    await journal.transition('op-sequence', 'dispatched');
    const lines = (await readFile(journal.logPath, 'utf8')).trim().split('\n');
    const second = JSON.parse(lines[1]!) as {
      schemaVersion: 1;
      record: Record<string, unknown>;
      previousRecordHash: PrefixedSha256;
      recordHash: PrefixedSha256;
    };
    second.record.sequence = 3;
    second.recordHash = `sha256:${createHash('sha256')
      .update('sfp-operation-journal-record-v1')
      .update(Buffer.from([0]))
      .update(
        canonicalJson({
          schemaVersion: second.schemaVersion,
          record: second.record,
          previousRecordHash: second.previousRecordHash,
        }),
      )
      .digest('hex')}`;
    await writeFile(journal.logPath, `${lines[0]}\n${canonicalJson(second)}\n`);
    const corrupt = new OperationJournal({ stateRoot: root, actorId });
    await expect(corrupt.recover()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });

    expect(() => journal.list({ limit: 1001 })).toThrowError(
      expect.objectContaining({ code: 'JOURNAL_TRANSITION_INVALID' }),
    );
    expect(journal.list({ limit: 1 }).rows).toHaveLength(1);
  });

  it('traverses a stable bounded operation cursor without duplicating rows', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    for (const operationId of ['op-list-a', 'op-list-b', 'op-list-c', 'op-list-d', 'op-list-e']) {
      // eslint-disable-next-line no-await-in-loop -- durable insertion order is the cursor fixture
      await journal.appendInitial(record(operationId), 'queued');
    }
    const observed: string[] = [];
    let cursor: string | undefined;
    do {
      const page = journal.list({ limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      expect(page.rows.length).toBeLessThanOrEqual(2);
      observed.push(...page.rows.map(row => row.operationId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(observed).toEqual(['op-list-a', 'op-list-b', 'op-list-c', 'op-list-d', 'op-list-e']);
    expect(new Set(observed).size).toBe(observed.length);
    expect(() => journal.list({ cursor: 'sfp_oc1_invalid!', limit: 2 })).toThrow(
      'operation list cursor is invalid',
    );
  });

  it('continues after a purged tombstone that preceded the page cursor without skips or duplicates', async () => {
    const root = await createRoot();
    let clock = record('op-list-expired').issuedAt;
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => clock });
    await journal.recover();
    await journal.appendInitial(record('op-list-expired'), 'queued');
    await journal.transition('op-list-expired', 'dispatched');
    await journal.transition('op-list-expired', 'succeeded', {
      resultHash: hash('e'),
      resultBytes: 1,
    });
    for (const operationId of ['op-list-b', 'op-list-c', 'op-list-d']) {
      // eslint-disable-next-line no-await-in-loop -- durable insertion order is the cursor fixture
      await journal.appendInitial(record(operationId), 'queued');
    }

    const first = journal.list({ limit: 2 });
    expect(first.rows.map(row => row.operationId)).toEqual(['op-list-expired', 'op-list-b']);
    expect(first.nextCursor).not.toBeNull();
    clock += 2_592_000_000;
    await expect(journal.purgeExpiredTombstones()).resolves.toBe(1);

    const second = journal.list({ cursor: first.nextCursor!, limit: 2 });
    const observed = [...first.rows, ...second.rows].map(row => row.operationId);
    expect(second.rows.map(row => row.operationId)).toEqual(['op-list-c', 'op-list-d']);
    expect(second.nextCursor).toBeNull();
    expect(new Set(observed).size).toBe(observed.length);
  });

  it('rejects a syntactically valid mutation of an issued operation cursor', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    for (const operationId of ['op-cursor-a', 'op-cursor-b', 'op-cursor-c']) {
      // eslint-disable-next-line no-await-in-loop -- durable insertion order is the cursor fixture
      await journal.appendInitial(record(operationId), 'queued');
    }
    const cursor = journal.list({ limit: 1 }).nextCursor!;
    const [prefix, sequence, mac] = cursor.split('.');
    const replacement = mac!.startsWith('A') ? 'B' : 'A';
    const tampered = `${prefix}.${sequence}.${replacement}${mac!.slice(1)}`;

    expect(() => journal.list({ cursor: tampered, limit: 1 })).toThrow(
      'operation list cursor is invalid',
    );
  });

  it('rejects a noncanonical base64url operation cursor MAC alias', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    for (const operationId of ['op-cursor-alias-a', 'op-cursor-alias-b']) {
      // eslint-disable-next-line no-await-in-loop -- durable insertion order is the cursor fixture
      await journal.appendInitial(record(operationId), 'queued');
    }
    const cursor = journal.list({ limit: 1 }).nextCursor!;
    const [prefix, sequence, mac] = cursor.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const lastIndex = alphabet.indexOf(mac!.at(-1)!);
    expect(lastIndex).toBeGreaterThanOrEqual(0);
    expect(lastIndex % 4).toBe(0);
    const aliasMac = `${mac!.slice(0, -1)}${alphabet[lastIndex + 1]}`;
    expect(Buffer.from(aliasMac, 'base64url')).toEqual(Buffer.from(mac!, 'base64url'));
    const noncanonicalCursor = `${prefix}.${sequence}.${aliasMac}`;

    expect(() => journal.list({ cursor: noncanonicalCursor, limit: 1 })).toThrow(
      'operation list cursor is invalid',
    );
  });

  it('rejects an operation cursor issued before journal recovery', async () => {
    const root = await createRoot();
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    for (const operationId of ['op-stale-a', 'op-stale-b', 'op-stale-c']) {
      // eslint-disable-next-line no-await-in-loop -- durable insertion order is the cursor fixture
      await journal.appendInitial(record(operationId), 'queued');
    }
    const cursor = journal.list({ limit: 1 }).nextCursor!;

    const restarted = new OperationJournal({ stateRoot: root, actorId });
    await restarted.recover();
    expect(() => restarted.list({ cursor, limit: 1 })).toThrow('operation list cursor is invalid');
  });

  it('recovers original sequence evidence from an explicit compacted base row', async () => {
    const root = await createRoot();
    const first = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => record('op-a').issuedAt + 1,
      capacity: {
        maxRows: 20,
        maxBytes: 1_000_000,
        compactAtRows: 3,
        compactAtBytes: 900_000,
      },
    });
    await first.recover();
    await first.appendInitial(record('op-a'), 'queued');
    await first.transition('op-a', 'dispatched');
    await first.appendInitial(record('op-b'), 'queued');
    await first.transition('op-b', 'dispatched');
    await first.transition('op-b', 'succeeded', { resultHash: hash('e'), resultBytes: 1 });
    const compacted = await readFile(first.logPath, 'utf8');
    expect(compacted).toContain('"rowType":"compacted-base"');
    expect(compacted).toContain('"operationId":"op-a"');
    expect(compacted).toContain('"sequence":2');

    const restarted = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => record('op-a').issuedAt + 2,
    });
    await restarted.recover();
    expect(restarted.get('op-a')).toMatchObject({
      status: 'outcome-unknown',
      sequence: 3,
      previousStatus: 'dispatched',
    });
  });

  it.each([
    ['transition', 'rawArgs'],
    ['transition', 'unexpectedOuterField'],
    ['compacted-base', 'rawArgs'],
    ['compacted-base', 'unexpectedOuterField'],
  ] as const)(
    'rejects an unchanged-hash %s row carrying outer key %s',
    async (rowVariant, extraKey) => {
      const root = await createRoot();
      const journal = new OperationJournal({
        stateRoot: root,
        actorId,
        capacity: {
          maxRows: 20,
          maxBytes: 1_000_000,
          compactAtRows: rowVariant === 'compacted-base' ? 1 : 20,
          compactAtBytes: 900_000,
        },
      });
      await journal.recover();
      await journal.appendInitial(record(`op-outer-${rowVariant}-${extraKey}`), 'queued');
      if (rowVariant === 'compacted-base') {
        await journal.transition(`op-outer-${rowVariant}-${extraKey}`, 'dispatched');
      }
      const lines = (await readFile(journal.logPath, 'utf8')).trim().split('\n');
      const rowIndex = lines.findIndex(line => {
        const parsed = JSON.parse(line) as { rowType?: unknown };
        return rowVariant === 'compacted-base'
          ? parsed.rowType === 'compacted-base'
          : parsed.rowType === undefined;
      });
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      const row = JSON.parse(lines[rowIndex]!) as Record<string, unknown>;
      row[extraKey] = extraKey === 'rawArgs' ? { secret: 'must-not-load' } : true;
      lines[rowIndex] = canonicalJson(row);
      await writeFile(journal.logPath, `${lines.join('\n')}\n`);

      const restarted = new OperationJournal({ stateRoot: root, actorId });
      await expect(restarted.recover()).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    },
  );

  it('fsyncs a bounded raw-free manual resolution intent in the dedicated reserve', async () => {
    const root = await createRoot();
    const store = new OperationResolutionIntentStore({ stateRoot: root, actorId });
    const base = record('op-resolution');
    await store.appendAndFsync({
      actorId: base.actorId,
      originAuthSessionId: base.originAuthSessionId,
      origin: base.origin,
      resolverAuthSessionId: authSessionId,
      operationId: base.operationId,
      issuedAt: base.issuedAt,
      operationKind: base.operationKind,
      operationName: base.operationName,
      argsHash: base.argsHash,
      captureIntentHash: base.captureIntentHash,
      operationFingerprintHash: base.operationFingerprintHash,
      workspaceId: base.workspaceId,
      fileExecutionKey: base.fileExecutionKey,
      fileExecutionKeyHash: base.fileExecutionKeyHash,
      targetBindingHash: base.targetBindingHash,
      decision: 'abandoned',
      resultHash: null,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: null,
      reasonHash: hash('e'),
      evidenceHash: hash('f'),
      confirmedResultHash: null,
      confirmationHash: hash('0'),
      decidedAt: '2024-08-28T00:00:00.000Z',
    });

    const durable = await readFile(store.path, 'utf8');
    expect(durable.endsWith('\n')).toBe(true);
    expect(durable).not.toContain('rawArgs');
    expect(durable).not.toContain('rawResult');
  });

  it('strictly recovers the resolution reserve and rejects duplicate or payload-bearing intent rows', async () => {
    const root = await createRoot();
    const base = record('op-resolution-strict');
    const store = new OperationResolutionIntentStore({
      stateRoot: root,
      actorId,
      now: () => base.issuedAt + 1,
    });
    const resolution = {
      actorId: base.actorId,
      originAuthSessionId: base.originAuthSessionId,
      origin: base.origin,
      resolverAuthSessionId: authSessionId,
      operationId: base.operationId,
      issuedAt: base.issuedAt,
      operationKind: base.operationKind,
      operationName: base.operationName,
      argsHash: base.argsHash,
      captureIntentHash: base.captureIntentHash,
      operationFingerprintHash: base.operationFingerprintHash,
      workspaceId: base.workspaceId,
      fileExecutionKey: base.fileExecutionKey,
      fileExecutionKeyHash: base.fileExecutionKeyHash,
      targetBindingHash: base.targetBindingHash,
      decision: 'abandoned' as const,
      resultHash: null,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: null,
      reasonHash: hash('e'),
      evidenceHash: hash('f'),
      confirmedResultHash: null,
      confirmationHash: hash('0'),
      decidedAt: '2024-08-28T00:00:00.000Z',
    };

    await expect(
      store.appendAndFsync({ ...resolution, rawArgs: { secret: true } } as never),
    ).rejects.toMatchObject({ code: 'RESOLUTION_INTENT_INVALID' });
    await store.appendAndFsync(resolution);
    const restarted = new OperationResolutionIntentStore({
      stateRoot: root,
      actorId,
      now: () => base.issuedAt + 1,
    });
    await restarted.recover();
    expect(restarted.get(resolution.operationId)).toEqual(resolution);
    await expect(restarted.appendAndFsync(resolution)).rejects.toMatchObject({
      code: 'OPERATION_ID_CONFLICT',
    });
  });

  it('merges a reserved resolution into a no-replay tombstone, releases bytes, and purges at 30 days', async () => {
    const root = await createRoot();
    let clock = record('op-resolution-merge').issuedAt;
    let crashAfterTombstone = true;
    const journal = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => clock,
      afterResolutionTombstoneFsync: async () => {
        if (crashAfterTombstone) throw new Error('crash after resolution tombstone');
      },
    });
    await journal.recover();
    const base = record('op-resolution-merge');
    await journal.appendInitial(base, 'queued');
    await journal.transition(base.operationId, 'dispatched');
    await journal.transition(base.operationId, 'outcome-unknown', {
      errorCode: 'PROCESS_RESTARTED_AFTER_DISPATCH',
    });
    const store = new OperationResolutionIntentStore({
      stateRoot: root,
      actorId,
      now: () => clock,
    });
    const resolution = {
      actorId: base.actorId,
      originAuthSessionId: base.originAuthSessionId,
      origin: base.origin,
      resolverAuthSessionId: authSessionId,
      operationId: base.operationId,
      issuedAt: base.issuedAt,
      operationKind: base.operationKind,
      operationName: base.operationName,
      argsHash: base.argsHash,
      captureIntentHash: base.captureIntentHash,
      operationFingerprintHash: base.operationFingerprintHash,
      workspaceId: base.workspaceId,
      fileExecutionKey: base.fileExecutionKey,
      fileExecutionKeyHash: base.fileExecutionKeyHash,
      targetBindingHash: base.targetBindingHash,
      decision: 'abandoned' as const,
      resultHash: null,
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: null,
      reasonHash: hash('e'),
      evidenceHash: hash('f'),
      confirmedResultHash: null,
      confirmationHash: hash('0'),
      decidedAt: '2024-08-28T00:00:00.000Z',
    };
    await store.appendAndFsync(resolution);
    await expect(journal.mergeResolutionIntent(store, base.operationId)).rejects.toThrow(
      'crash after resolution tombstone',
    );
    expect(store.get(base.operationId)).toBeDefined();
    crashAfterTombstone = false;

    const restartedJournal = new OperationJournal({ stateRoot: root, actorId, now: () => clock });
    const restartedStore = new OperationResolutionIntentStore({
      stateRoot: root,
      actorId,
      now: () => clock,
    });
    await restartedJournal.recover();
    await restartedStore.recover();
    await expect(
      restartedJournal.mergeResolutionIntent(restartedStore, base.operationId),
    ).resolves.toMatchObject({ status: 'abandoned' });
    await expect(
      restartedJournal.mergeResolutionIntent(restartedStore, base.operationId),
    ).resolves.toMatchObject({ status: 'abandoned' });

    expect(restartedStore.get(base.operationId)).toBeUndefined();
    expect(restartedJournal.get(base.operationId)).toMatchObject({ status: 'abandoned' });
    await expect(restartedJournal.hasUnsettled(base.workspaceId!)).resolves.toBe(false);
    await expect(restartedJournal.appendInitial(base, 'queued')).rejects.toMatchObject({
      code: 'OPERATION_ID_CONFLICT',
    });

    const retained = new OperationResolutionIntentStore({
      stateRoot: join(root, 'retained'),
      actorId,
      now: () => clock,
    });
    const retainedBase = record('op-resolution-retained');
    await retained.appendAndFsync({
      ...resolution,
      actorId: retainedBase.actorId,
      originAuthSessionId: retainedBase.originAuthSessionId,
      origin: retainedBase.origin,
      operationId: retainedBase.operationId,
      issuedAt: retainedBase.issuedAt,
      operationKind: retainedBase.operationKind,
      operationName: retainedBase.operationName,
      argsHash: retainedBase.argsHash,
      captureIntentHash: retainedBase.captureIntentHash,
      operationFingerprintHash: retainedBase.operationFingerprintHash,
      workspaceId: retainedBase.workspaceId,
      fileExecutionKey: retainedBase.fileExecutionKey,
      fileExecutionKeyHash: retainedBase.fileExecutionKeyHash,
      targetBindingHash: retainedBase.targetBindingHash,
    });
    clock += 2_592_000_000 - 1;
    await expect(retained.purgeExpired()).resolves.toBe(0);
    clock += 1;
    await expect(retained.purgeExpired()).resolves.toBe(1);
    expect(retained.list({ limit: 1000 })).toEqual([]);
    expect(() => retained.list({ limit: 1001 })).toThrow('resolution list limit is invalid');
  });
});
