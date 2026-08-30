import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NO_CAPTURE_OPTIONS } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import {
  OperationExecutor,
  type OperationJournalPort,
} from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import {
  createBoundRuntimeRegistry,
  type PinnedPluginRuntimePort,
} from '../../src/tools/runtime-registry.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const now = 1_724_803_200_000;
const scope = (consentId: string) => ({
  requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const,
  leaderGeneration: 'generation-1',
  actor: { actorId, authSessionId, entryPath: 'mcp-direct' as const },
  workspace: { workspaceId: null, workspaceRoot: null },
  target: {
    sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration: 'plugin-g1',
    fileIdentity: { kind: 'figma-file-key' as const, value: 'file-a' },
    fileExecutionKey: 'figma:file-a' as const,
  },
  consent: {
    mode: 'external-model' as const,
    consentId,
    allowedClasses: ['public', 'design-text', 'design-image'] as const,
  },
});

const localScope = () => ({
  ...scope('consent-unused'),
  consent: {
    mode: 'local-trusted' as const,
    consentId: null,
    allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'] as const,
  },
});

describe('canonical completed-result replay', () => {
  it('replays only under the exact consent fingerprint and otherwise returns payload-free settled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replay-'));
    roots.push(root);
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 9));
    const operationId = issuer.issue(actorId, now, { nonce: 'AgAAAAAAAAAAAAAAAAAAAA' });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => now });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => {
      const result = { pageId: '1:1', pageName: 'Page', nodes: [] };
      Object.defineProperty(result, 'secretInternalField', {
        value: 'RAW_REPLAY_SENTINEL',
        enumerable: false,
      });
      return result;
    });
    const audits: Readonly<Record<string, unknown>>[] = [];
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => now,
      replayAudit: row => audits.push(row),
    });

    const first = await executor.invokeTool(
      scope('consent-1'),
      'get_selection',
      {},
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    expect(first).not.toHaveProperty('secretInternalField');
    (first as { pageName: string }).pageName = 'MUTATED_BY_CALLER';
    await expect(
      executor.invokeTool(scope('consent-1'), 'get_selection', {}, operationId, NO_CAPTURE_OPTIONS),
    ).resolves.toMatchObject({ pageName: 'Page' });
    for (const mismatchedScope of [
      scope('consent-2'),
      {
        ...scope('consent-1'),
        consent: {
          ...scope('consent-1').consent,
          allowedClasses: ['public', 'design-text'] as const,
        },
      },
      localScope(),
    ]) {
      const error = await executor
        .invokeTool(mismatchedScope, 'get_selection', {}, operationId, NO_CAPTURE_OPTIONS)
        .catch(value => value as Record<string, unknown>);
      expect(error).toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
      expect(error).not.toHaveProperty('result');
      expect(JSON.stringify(error)).not.toContain('RAW_REPLAY_SENTINEL');
    }
    expect(runtime).toHaveBeenCalledOnce();
    expect(audits).toHaveLength(3);
    for (const audit of audits) {
      expect(Object.keys(audit).toSorted()).toEqual([
        'newFingerprintHash',
        'oldFingerprintHash',
        'operationId',
      ]);
      expect(audit).toMatchObject({
        operationId,
        oldFingerprintHash: expect.stringMatching(/^sha256:/),
        newFingerprintHash: expect.stringMatching(/^sha256:/),
      });
      expect(JSON.stringify(audit)).not.toContain('RAW_REPLAY_SENTINEL');
    }
  });

  it('audits an expired completed cache entry and never reruns it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-replay-expired-'));
    roots.push(root);
    let clock = now;
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 10));
    const operationId = issuer.issue(actorId, now, { nonce: 'AwAAAAAAAAAAAAAAAAAAAA' });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => clock });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      pageId: '1:1',
      pageName: 'Page',
      nodes: [],
    }));
    const audits: Readonly<Record<string, unknown>>[] = [];
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => clock,
      replayAudit: row => audits.push(row),
    });
    await executor.invokeTool(
      scope('consent-1'),
      'get_selection',
      {},
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    clock += 60_001;

    await expect(
      executor.invokeTool(scope('consent-1'), 'get_selection', {}, operationId, NO_CAPTURE_OPTIONS),
    ).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED' });
    expect(runtime).toHaveBeenCalledOnce();
    expect(audits).toEqual([
      {
        operationId,
        oldFingerprintHash: expect.stringMatching(/^sha256:/),
        newFingerprintHash: expect.stringMatching(/^sha256:/),
      },
    ]);
  });

  it.each([
    ['operation id', { operationId: 'foreign-operation' }, 'OPERATION_ID_CONFLICT', 0],
    ['result hash', { resultHash: `sha256:${'f'.repeat(64)}` }, 'OPERATION_ALREADY_SETTLED', 1],
    ['result byte count', { resultBytes: 1 }, 'OPERATION_ALREADY_SETTLED', 1],
  ] as const)(
    'refuses replay when durable %s disagrees with the canonical cache',
    async (_label, patch, code, expectedAuditCount) => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-replay-integrity-'));
      roots.push(root);
      const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 11));
      const operationId = issuer.issue(actorId, now, { nonce: 'BAAAAAAAAAAAAAAAAAAAAA' });
      const durable = new OperationJournal({ stateRoot: root, actorId, now: () => now });
      await durable.recover();
      let corruptRead = false;
      const journal: OperationJournalPort = {
        appendInitial: (...args) => durable.appendInitial(...args),
        transition: (...args) => durable.transition(...args),
        get: id => {
          const record = durable.get(id);
          return record === undefined || !corruptRead ? record : { ...record, ...patch };
        },
      };
      const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
        pageId: '1:1',
        pageName: 'Page',
        nodes: [],
      }));
      const audits: Readonly<Record<string, unknown>>[] = [];
      const executor = new OperationExecutor({
        issuer,
        journal,
        queue: new FileExecutionQueue(),
        runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
        now: () => now,
        replayAudit: row => audits.push(row),
      });
      await executor.invokeTool(
        scope('consent-1'),
        'get_selection',
        {},
        operationId,
        NO_CAPTURE_OPTIONS,
      );
      corruptRead = true;

      await expect(
        executor.invokeTool(
          scope('consent-1'),
          'get_selection',
          {},
          operationId,
          NO_CAPTURE_OPTIONS,
        ),
      ).rejects.toMatchObject({ code });
      expect(runtime).toHaveBeenCalledOnce();
      expect(audits).toHaveLength(expectedAuditCount);
    },
  );
});
