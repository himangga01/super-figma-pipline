import type {
  PluginAPI as FigmaAPI,
  InstanceNode as FigmaInstance,
  TextNode as FigmaText,
} from '@figma/plugin-typings/plugin-api-standalone.js';
declare global {
  const figma: FigmaAPI;
  type InstanceNode = FigmaInstance;
  type TextNode = FigmaText;
}
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalFileIdentityHash,
  type FileIdentity,
  type RuntimeExecutionScope,
} from '@sfp/shared';
import { describe, expect, it, vi } from 'vitest';

import { createIdentityBootstrap } from '../../../plugin/src/identity-bootstrap.js';
import { settleHandlerOutcome } from '../../../plugin/src/mutation.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import {
  createIdentityBootstrapCoordinator,
  createIdentityOperation,
} from '../../src/execution/identity-bootstrap-coordinator.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { TargetResolver } from '../../src/execution/target-resolver.js';
import { createApprovalBroker } from '../../src/policy/approval-broker.js';
import { DocumentBindingStore } from '../../src/security/document-binding-store.js';
import type { PairingManager } from '../../src/security/pairing-manager.js';
import { createStatePermissions } from '../../src/security/state-permissions.js';

describe('owner-approved identity bootstrap', () => {
  it('journals a system operation, signs the local URL binding, and returns a one-use reauthentication ticket', async () => {
    const base = await mkdtemp(join(tmpdir(), 'sfp-identity-coordinator-'));
    const root = join(base, 'SuperFigmaPipeline');
    await mkdir(root);
    const ownerKey = Buffer.alloc(32, 31),
      actorId = `actor1_${'A'.repeat(43)}` as const;
    const permissions = createStatePermissions(root, {
      environment: { ...process.env, LOCALAPPDATA: base },
    });
    await permissions.ensureSecure(root);
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    let uuid = '';
    const page = { id: '0:1', type: 'PAGE', name: 'Page', children: [] },
      undo = vi.fn<() => void>();
    const host = {
      currentPage: page,
      commitUndo: undo,
      getNodeByIdAsync: async () => page,
      root: {
        name: 'Fixture',
        getSharedPluginData: () => uuid,
        setSharedPluginData: (_n: string, _k: string, value: string) => {
          uuid = value;
        },
      },
    } as unknown as typeof figma;
    const sandbox = createIdentityBootstrap(
      host,
      () => 'plugin-generation',
      () => {},
    );
    const session = {
      sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
      pluginGeneration: 'plugin-generation',
      fileIdentity: {
        kind: 'unstable-readonly',
        sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
        pluginGeneration: 'plugin-generation',
      } as FileIdentity,
      editorType: 'figma' as const,
      capabilities: [],
      connectedSequence: 1,
      healthy: true,
    };
    const targets = new TargetResolver({ active: () => session, list: () => [session] });
    const plugin = {
      execute: async (_scope: RuntimeExecutionScope, name: string, args: unknown) =>
        settleHandlerOutcome(await sandbox.handlers[name]!(args)),
    };
    const issuer = operationIdIssuerFromKey(ownerKey);
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: {},
      operations: { 'identity.bootstrap': createIdentityOperation(plugin) },
    });
    const broker = createApprovalBroker({
      deliverControlPrompt: async () => {
        throw new Error('wrong channel');
      },
      deliverPluginPrompt: async prompt => {
        expect(prompt.operationKind).toBe('system');
        await broker.settlePlugin(
          {
            pairedSessionId: session.sessionId,
            pluginGeneration: session.pluginGeneration,
            leaderGeneration: 'generation',
            fileExecutionKey: `unstable:${session.sessionId}:${session.pluginGeneration}`,
          },
          {
            version: 1,
            type: 'approval.decision',
            approvalId: prompt.approvalId,
            operationId: prompt.operationId,
            promptHash: prompt.promptHash,
            decision: 'approved',
          },
        );
      },
    });
    const bindings = new DocumentBindingStore(root, ownerKey, permissions);
    const pairing = {
      createChallenge: async () => ({ challengeId: 'ABCDEFGHIJ', code: '12345678' }),
      exchange: async () => ({ wsTicket: 'A'.repeat(22), expiresAt: Date.now() + 30_000 }),
    } as unknown as PairingManager;
    try {
      const sessionBindings = new Map();
      const bind = createIdentityBootstrapCoordinator({
        ownerKey,
        actorId,
        generation: 'generation',
        plugin,
        targets,
        executor,
        approvals: broker,
        issuer,
        pairing,
        bindings,
        sessionBindings,
      });
      const readOnly = await bind(
        session.sessionId,
        { fileKey: 'FixtureFile1234', expectedFileName: 'Fixture', readOnly: true },
        new AbortController().signal,
      );
      expect(readOnly).toMatchObject({ readOnly: true, ticket: null, publishNonce: null });
      expect(sessionBindings.has(session.sessionId)).toBe(true);
      expect(uuid).toBe('');
      expect(undo).not.toHaveBeenCalled();
      const result = await bind(
        session.sessionId,
        { fileKey: 'FixtureFile1234', expectedFileName: 'Fixture' },
        new AbortController().signal,
      );
      expect(uuid).toMatch(/^[0-9a-f-]{36}$/u);
      expect(undo).toHaveBeenCalledTimes(1);
      expect(journal.get(result.operationId)).toMatchObject({
        operationKind: 'system',
        operationName: 'identity.bootstrap',
        status: 'succeeded',
        origin: { kind: 'internal-system', pluginGeneration: session.pluginGeneration },
        fileExecutionKey: null,
      });
      expect(await bindings.get(result.fileIdentity)).toMatchObject({
        fileKeyHash: canonicalFileIdentityHash({
          kind: 'figma-file-key',
          value: 'FixtureFile1234',
        }),
      });
      expect(result.ticket!.wsTicket).toHaveLength(22);
      expect(sandbox.publish(result.publishNonce!)).toBe(true);
      expect(sandbox.ready(result.publishNonce!)).toBe(true);
    } finally {
      broker.dispose();
      await rm(base, { recursive: true, force: true });
    }
  }, 30_000);
});
