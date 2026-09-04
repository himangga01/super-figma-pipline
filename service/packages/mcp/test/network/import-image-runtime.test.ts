import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RuntimeExecutionScope } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { createOperationEvidenceProjector } from '../../src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import {
  createRemoteImageFetcher,
  type RemoteImageRequestFactory,
  type RemoteImageResolver,
} from '../../src/network/remote-image-fetcher.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import {
  handleImportImage,
  IMPORT_IMAGE_TOOL_NAME,
  type ImportImageRuntimeDependencies,
  type ToolDispatcher,
} from '../../src/tools/import-image.js';
import {
  createBoundRuntimeRegistry,
  createRuntimeRegistry,
  type PinnedPluginRuntimePort,
} from '../../src/tools/runtime-registry.js';

const actorId = `actor1_${'A'.repeat(43)}` as const;
const authSessionId = `auth1_${'B'.repeat(43)}` as const;
const scope = Object.freeze({
  requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
  leaderGeneration: 'generation-network-test',
  actor: Object.freeze({ actorId, authSessionId, entryPath: 'mcp-direct' as const }),
  workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
  target: Object.freeze({
    sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration: 'plugin-generation',
    fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-a' }),
    fileExecutionKey: 'figma:file-a' as const,
  }),
  consent: Object.freeze({
    mode: 'local-trusted' as const,
    consentId: null,
    allowedClasses: Object.freeze([
      'public',
      'project-code',
      'design-text',
      'design-image',
      'secret',
    ]),
  }),
}) as RuntimeExecutionScope;

const fetchedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const runtimeRoots: string[] = [];

afterEach(async () => {
  await Promise.all(runtimeRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

interface RuntimeCounters {
  domains: number;
  fetches: number;
  plugins: number;
  targetResolutions: number;
}

type ApprovalOutcome = 'unavailable' | 'rejected' | 'approved';

const lifecyclePorts = () => ({
  closeAdmission: async () => undefined,
  installGenerationFence: async () => undefined,
  abortPending: async () => undefined,
  abortQueued: async () => undefined,
  markDispatchedOutcomeUnknown: async () => undefined,
  finalizeAndFlushEgress: async () => undefined,
  drainTransport: async () => true,
  forceCloseTransport: async () => undefined,
  destroy: async () => undefined,
  releasePort: async () => undefined,
});

const createExecutionHarness = async (options: {
  approval: ApprovalOutcome;
  rejectEgress?: boolean;
  receiptFailure?: Error;
  afterEvidenceReservationFsync?: () => Promise<void>;
  changeTargetAfterFetch?: boolean;
  domainRules?: readonly Readonly<{ fqdnAscii: string }>[];
  remoteFetcher?: ImportImageRuntimeDependencies['fetcher'];
  url?: string;
}) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-import-runtime-'));
  runtimeRoots.push(root);
  const now = 1_724_803_200_000;
  const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 19));
  const journal = new OperationJournal({ stateRoot: root, actorId, now: () => now });
  await journal.recover();
  const counters: RuntimeCounters = { domains: 0, fetches: 0, plugins: 0, targetResolutions: 0 };
  let activeSessionId = 'AQAAAAAAAAAAAAAAAAAAAA';
  const pluginSessionIds: Array<string | null> = [];
  const pinned: PinnedPluginRuntimePort = {
    execute: async runtimeScope => {
      counters.plugins += 1;
      pluginSessionIds.push(runtimeScope.target.sessionId);
      return { ok: true, nodeId: '1:2', name: 'Imported', type: 'RECTANGLE' };
    },
  };
  const adapter = {
    execute: async (
      runtimeScope: RuntimeExecutionScope,
      toolName: string,
      args: unknown,
      signal: AbortSignal,
      plugin: PinnedPluginRuntimePort,
    ) => {
      if (toolName !== IMPORT_IMAGE_TOOL_NAME) throw new Error(`unexpected adapter ${toolName}`);
      return handleImportImage(
        (name, value) => plugin.execute(runtimeScope, name, value, signal),
        args,
        {
          domains: {
            list: async () => {
              counters.domains += 1;
              return options.domainRules ?? [{ fqdnAscii: 'assets.example.com' }];
            },
          },
          fetcher: {
            fetchApproved: async (...fetchArguments) => {
              counters.fetches += 1;
              if (options.remoteFetcher !== undefined) {
                return options.remoteFetcher.fetchApproved(...fetchArguments);
              }
              if (options.changeTargetAfterFetch === true) {
                activeSessionId = 'AgAAAAAAAAAAAAAAAAAAAA';
              }
              return {
                bytes: fetchedPng,
                mime: 'image/png',
                finalUrlHash: `sha256:${'d'.repeat(64)}`,
              };
            },
          },
          signal,
        },
      );
    },
  };
  let durability: ConstructorParameters<typeof OperationExecutor>[0]['durability'];
  if (options.receiptFailure !== undefined || options.afterEvidenceReservationFsync !== undefined) {
    const egress = new EgressManifestStore({ stateRoot: root, actorId, now: () => now });
    await egress.recover(now);
    const actualReceipts = new OperationEvidenceReceiptStore({ stateRoot: root, actorId });
    await actualReceipts.recover();
    const receipts =
      options.receiptFailure === undefined
        ? actualReceipts
        : ({
            reserveBeforeRuntime: async () => Promise.reject(options.receiptFailure),
          } as never);
    durability = {
      egress,
      receipts,
      artifacts: {
        createNew: async () => {
          throw new Error('capture artifact was not requested');
        },
      },
      projector: createOperationEvidenceProjector(),
      nativeArtifacts: {
        createNativeManifest: async () => {
          throw new Error('import_image has no native evidence');
        },
      },
      ...(options.afterEvidenceReservationFsync === undefined
        ? {}
        : { afterEvidenceReservationFsync: options.afterEvidenceReservationFsync }),
    };
  }
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    runtimes: createBoundRuntimeRegistry(pinned, adapter as never),
    now: () => now,
    ...(durability === undefined ? {} : { durability }),
  });
  const plane = new LeaderGenerationExecutionPlane(
    'generation-network-test',
    lifecyclePorts(),
    () => now,
  );
  plane.bindInvocationService(new ToolInvocationService(executor));
  plane.bindAdmissionAuthority({
    resolveWorkspaceContext: async () => ({ workspaceId: null, workspaceRoot: null }),
    workspacePolicy: {
      resolveRead: async () => '',
      resolveWrite: async () => ({ path: '', overwrites: false }),
      assertWithinRoot: async () => undefined,
    },
    targetResolver: {
      resolve: () => {
        counters.targetResolutions += 1;
        return {
          sessionId: activeSessionId,
          pluginGeneration:
            activeSessionId === 'AQAAAAAAAAAAAAAAAAAAAA'
              ? 'plugin-generation-a'
              : 'plugin-generation-b',
          fileIdentity: {
            kind: 'figma-file-key' as const,
            value: activeSessionId === 'AQAAAAAAAAAAAAAAAAAAAA' ? 'file-a' : 'file-b',
          },
          fileExecutionKey:
            activeSessionId === 'AQAAAAAAAAAAAAAAAAAAAA' ? 'figma:file-a' : 'figma:file-b',
          editorType: 'figma',
          capabilities: [],
        };
      },
    },
    approval: {
      request: async () => {
        if (options.approval === 'unavailable') return null;
        const decision = options.approval;
        return {
          approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
          waitForDecision: async () => ({ decision }),
        };
      },
    },
    authorizeEgress: async () => {
      if (options.rejectEgress === true) {
        throw Object.assign(new Error('egress rejected'), { code: 'EGRESS_CONSENT_REQUIRED' });
      }
      return {
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      };
    },
    issueOperationId: actor => issuer.issue(actor, now),
    verifyOperationId: (actor, operationId) => {
      issuer.verify(actor, operationId, now);
    },
  });
  const operationId = issuer.issue(actorId, now);
  const request = Object.freeze({
    version: 1 as const,
    requestId: 'sfp_req1_CAAAAAAAAAAAAAAAAAAAAA',
    toolName: IMPORT_IMAGE_TOOL_NAME,
    rawArgs: { url: options.url ?? 'https://assets.example.com/image.png' },
    operationId,
    workspaceId: null,
    targetSelector: { kind: 'active' as const },
  });
  return { counters, executor, journal, operationId, plane, pluginSessionIds, request };
};

describe('import_image daemon runtime boundary', () => {
  it('rejects a nested URL at outer batch admission before journal or runtime side effects', async () => {
    let journalCalls = 0;
    let pluginCalls = 0;
    const journal = new Proxy(
      {},
      {
        get: () => () => {
          journalCalls += 1;
          throw Object.assign(new Error('journal was reached'), { code: 'JOURNAL_REACHED' });
        },
      },
    );
    const executor = new OperationExecutor({
      issuer: operationIdIssuerFromKey(Buffer.alloc(32, 7)),
      journal: journal as never,
      queue: new FileExecutionQueue(),
      runtimes: createRuntimeRegistry([
        [
          'batch',
          {
            execution: 'plugin-direct',
            runtime: {
              execute: async () => {
                pluginCalls += 1;
                return { ok: true, results: [] };
              },
            },
          },
        ],
      ]),
    });

    await expect(
      executor.invokeTool(scope, 'batch', {
        ops: [
          {
            tool: 'import_image',
            params: { url: 'https://assets.example.com/nested.png' },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVOCATION_ARGS_INVALID' });
    expect({ journalCalls, pluginCalls }).toEqual({ journalCalls: 0, pluginCalls: 0 });
  });

  it('keeps inline data on the pinned plugin path with zero domain or fetch IO', async () => {
    let domainCalls = 0;
    let fetchCalls = 0;
    let dispatched: unknown;
    const dependencies: ImportImageRuntimeDependencies = {
      domains: {
        list: async () => {
          domainCalls += 1;
          return [];
        },
      },
      fetcher: {
        fetchApproved: async () => {
          fetchCalls += 1;
          return {
            bytes: fetchedPng,
            mime: 'image/png',
            finalUrlHash: `sha256:${'a'.repeat(64)}`,
          };
        },
      },
      signal: new AbortController().signal,
    };
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return { ok: true };
    };

    await handleImportImage(dispatch, { data: 'AA==', name: 'inline' }, dependencies);

    expect({ domainCalls, fetchCalls }).toEqual({ domainCalls: 0, fetchCalls: 0 });
    expect(dispatched).toEqual({
      tool: IMPORT_IMAGE_TOOL_NAME,
      args: { data: 'AA==', name: 'inline' },
    });
  });

  it('fetches an approved URL once and dispatches only canonical data plus non-source fields', async () => {
    const controller = new AbortController();
    const observed: { fetch?: unknown; dispatch?: unknown; domainCalls: number } = {
      domainCalls: 0,
    };
    const dependencies: ImportImageRuntimeDependencies = {
      domains: {
        list: async () => {
          observed.domainCalls += 1;
          return Object.freeze([
            Object.freeze({
              fqdnAscii: 'assets.example.com',
              addedBy: actorId,
              addedAt: '2026-09-05T00:00:00.000Z',
            }),
          ]);
        },
      },
      fetcher: {
        fetchApproved: async (url, policy, signal) => {
          observed.fetch = { url, policy, signal };
          return {
            bytes: fetchedPng,
            mime: 'image/png',
            finalUrlHash: `sha256:${'b'.repeat(64)}`,
          };
        },
      },
      signal: controller.signal,
    };
    const dispatch: ToolDispatcher = async (tool, args) => {
      observed.dispatch = { tool, args };
      return { ok: true };
    };
    const input = {
      url: 'https://assets.example.com/image.png?version=1',
      name: 'Hero',
      parentId: '1:2',
      x: 10,
      y: 20,
      width: 640,
      height: 480,
      scaleMode: 'FIT' as const,
    };

    await handleImportImage(dispatch, input, dependencies);

    expect(observed.domainCalls).toBe(1);
    expect(observed.fetch).toEqual({
      url: input.url,
      policy: {
        allowedDomains: ['assets.example.com'],
        maxRedirects: 3,
        maxBytes: 6_291_456,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      },
      signal: controller.signal,
    });
    expect(observed.dispatch).toEqual({
      tool: IMPORT_IMAGE_TOOL_NAME,
      args: {
        data: fetchedPng.toString('base64'),
        name: 'Hero',
        parentId: '1:2',
        x: 10,
        y: 20,
        width: 640,
        height: 480,
        scaleMode: 'FIT',
      },
    });
  });

  it('honors cancellation after fetch and before plugin dispatch', async () => {
    const controller = new AbortController();
    let dispatchCalls = 0;
    const dependencies: ImportImageRuntimeDependencies = {
      domains: {
        list: async () => [{ fqdnAscii: 'assets.example.com' }],
      },
      fetcher: {
        fetchApproved: async () => {
          controller.abort(Object.assign(new Error('cancelled'), { code: 'OPERATION_CANCELLED' }));
          return {
            bytes: fetchedPng,
            mime: 'image/png',
            finalUrlHash: `sha256:${'c'.repeat(64)}`,
          };
        },
      },
      signal: controller.signal,
    };

    await expect(
      handleImportImage(
        async () => {
          dispatchCalls += 1;
          return { ok: true };
        },
        { url: 'https://assets.example.com/image.png' },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(dispatchCalls).toBe(0);
  });

  it.each([
    ['unavailable', 'APPROVAL_CHANNEL_UNAVAILABLE'],
    ['rejected', 'APPROVAL_REJECTED'],
  ] as const)('keeps network and plugin at zero when approval is %s', async (approval, code) => {
    const harness = await createExecutionHarness({ approval });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toMatchObject({
      code,
    });

    expect(harness.counters).toEqual({
      domains: 0,
      fetches: 0,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: code,
    });
  });

  it('keeps network and plugin at zero when egress authorization rejects', async () => {
    const harness = await createExecutionHarness({ approval: 'approved', rejectEgress: true });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toMatchObject({
      code: 'EGRESS_CONSENT_REQUIRED',
    });

    expect(harness.counters).toEqual({
      domains: 0,
      fetches: 0,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: 'EGRESS_CONSENT_REQUIRED',
    });
  });

  it('keeps network and plugin at zero when evidence reservation fails', async () => {
    const reservationFailure = Object.assign(new Error('evidence capacity is full'), {
      code: 'EVIDENCE_CAPACITY_EXCEEDED',
    });
    const harness = await createExecutionHarness({
      approval: 'approved',
      receiptFailure: reservationFailure,
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toBe(
      reservationFailure,
    );

    expect(harness.counters).toEqual({
      domains: 0,
      fetches: 0,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'rejected',
      errorCode: 'EVIDENCE_CAPACITY_EXCEEDED',
    });
  });

  it('keeps network and plugin at zero for cancellation after reservation but before dispatch', async () => {
    let enterBarrier!: () => void;
    let releaseBarrier!: () => void;
    const barrierEntered = new Promise<void>(resolve => {
      enterBarrier = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      releaseBarrier = resolve;
    });
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => {
        enterBarrier();
        await barrier;
      },
    });
    const invocation = harness.plane.invokeTool(scope.actor, harness.request);
    await barrierEntered;
    expect(harness.journal.get(harness.operationId)).toMatchObject({ status: 'pending-approval' });

    await harness.plane.cancel(scope.actor, {
      version: 1,
      requestId: harness.request.requestId,
      operationId: harness.operationId,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: 'OPERATION_CANCELLED',
    });
    releaseBarrier();

    await expect(invocation).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(harness.counters).toEqual({
      domains: 0,
      fetches: 0,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: 'OPERATION_CANCELLED',
    });
  });

  it('reaches the data-only pinned plugin exactly once after all admission boundaries pass', async () => {
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => undefined,
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).resolves.toMatchObject({
      ok: true,
      nodeId: '1:2',
    });

    expect(harness.counters).toEqual({
      domains: 1,
      fetches: 1,
      plugins: 1,
      targetResolutions: 1,
    });
    expect(harness.journal.get(harness.operationId)).toMatchObject({ status: 'succeeded' });
  });

  it('keeps the originally resolved target frozen when the active target changes after fetch', async () => {
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => undefined,
      changeTargetAfterFetch: true,
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).resolves.toMatchObject({
      ok: true,
    });

    expect(harness.counters).toEqual({
      domains: 1,
      fetches: 1,
      plugins: 1,
      targetResolutions: 1,
    });
    expect(harness.pluginSessionIds).toEqual(['AQAAAAAAAAAAAAAAAAAAAA']);
  });

  it('never refetches when the same settled URL operation is submitted again', async () => {
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => undefined,
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).resolves.toMatchObject({
      ok: true,
    });
    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toMatchObject({
      code: 'OPERATION_ID_CONFLICT',
    });

    expect(harness.counters).toEqual({
      domains: 1,
      fetches: 1,
      plugins: 1,
      targetResolutions: 2,
    });
  });

  it('rejects an approved URL with an empty domain snapshot before DNS, request, or plugin', async () => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const request = vi.fn<RemoteImageRequestFactory>(() => {
      throw new Error('request boundary was reached');
    });
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => undefined,
      domainRules: [],
      remoteFetcher: createRemoteImageFetcher({ resolver, request }),
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toMatchObject({
      code: 'REMOTE_DOMAIN_NOT_ALLOWED',
    });

    expect(harness.counters).toEqual({
      domains: 1,
      fetches: 1,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'failed',
      errorCode: 'REMOTE_DOMAIN_NOT_ALLOWED',
    });
  });

  it.each([
    ['leading whitespace', ' https://assets.example.com/image.png'],
    ['trailing whitespace', 'https://assets.example.com/image.png '],
    ['embedded C0', 'https://assets.example.com/\u0000image.png'],
  ])('preserves and rejects raw URL %s before DNS, request, or plugin', async (_name, url) => {
    const resolver = vi.fn<RemoteImageResolver>(async () => [{ address: '8.8.8.8', family: 4 }]);
    const request = vi.fn<RemoteImageRequestFactory>(() => {
      throw new Error('request boundary was reached');
    });
    const harness = await createExecutionHarness({
      approval: 'approved',
      afterEvidenceReservationFsync: async () => undefined,
      url,
      remoteFetcher: createRemoteImageFetcher({ resolver, request }),
    });

    await expect(harness.plane.invokeTool(scope.actor, harness.request)).rejects.toMatchObject({
      code: 'REMOTE_URL_INVALID',
    });

    expect(harness.counters).toEqual({
      domains: 1,
      fetches: 1,
      plugins: 0,
      targetResolutions: 1,
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(harness.journal.get(harness.operationId)).toMatchObject({
      status: 'failed',
      errorCode: 'REMOTE_URL_INVALID',
    });
  });
});
