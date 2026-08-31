import { writeSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  DEFAULT_PORT,
  NO_CAPTURE_OPTIONS,
  OperationEvidenceViewV1Schema,
  PROTOCOL_VERSION,
  encodeFollowerInnerMessage,
  decodeFollowerInnerMessage,
  getRelayBudget,
  type ActorContext,
  type GetScreenshotResult,
  type ProgressReporter,
  type RuntimeExecutionScope,
  type ToolName,
  type OperationEvidenceReceiptV1,
  type ProgressEvent,
  type VerifiedNativeEvidenceContextV1,
} from '@sfp/shared';
import { z } from 'zod';

import pkg from '../package.json' with { type: 'json' };
import { BUILD_ID } from './build-id.js';
import { createActionNonceEndpoint } from './control/action-nonce-endpoints.js';
import { createActionNonceStore } from './control/action-nonce-store.js';
import { createAdminAuditEndpoint } from './control/admin-audit-endpoints.js';
import { createAdminAuditStore } from './control/admin-audit-store.js';
import { createApprovalEndpoints } from './control/approval-endpoints.js';
import {
  createEgressAdminAuditTransactions,
  createEgressControl,
} from './control/egress-endpoints.js';
import { createOperationEndpoints } from './control/operation-endpoints.js';
import { createOperationEvidenceEndpoint } from './control/operation-evidence-endpoint.js';
import { registerTask7ControlRoutes } from './control/route-registry.js';
import {
  AuthenticatedControlRouter,
  createControlHttpHandler,
  createLazyControlHttpHandler,
} from './control/router.js';
import { createControlStatusEndpoint } from './control/status-endpoint.js';
import { createToolCallEndpoint } from './control/tool-call-endpoint.js';
import { createWorkspaceEndpoints } from './control/workspace-endpoints.js';
import { ControlRouteRegistry as LeaderControlRouteRegistry } from './election/control-route-registry.js';
import { Election } from './election/election.js';
import { Follower } from './election/follower.js';
import { attachLeaderEndpoints } from './election/leader-endpoints.js';
import { writeLeaderLock } from './election/leader-lock.js';
import { Node, NodeRole } from './election/node.js';
import type { LeaderResources } from './election/node.js';
import { EgressManifestStore } from './execution/egress-manifest-store.js';
import {
  createDurableExecutionPlaneLifecyclePorts,
  GenerationRuntimeLifecycleRegistry,
  LeaderGenerationExecutionPlane,
} from './execution/execution-plane.js';
import { FileExecutionQueue } from './execution/file-queue.js';
import { FollowerInvocationClient } from './execution/follower-invocation-client.js';
import { createFollowerInvocationEndpoint } from './execution/follower-invocation-endpoint.js';
import { McpInvocationAdapter } from './execution/mcp-invocation-adapter.js';
import { createMcpWorkspaceBinding } from './execution/mcp-workspace-binding.js';
import { NativeEvidenceArtifactPort } from './execution/native-evidence-artifact-port.js';
import {
  createOperationEvidenceProjector,
  nativeEvidenceContextHash,
} from './execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from './execution/operation-evidence-receipt-store.js';
import {
  DurableOperationFinalizer,
  OperationExecutor,
  recoverDurableOperationState,
} from './execution/operation-executor.js';
import { loadOrCreateOperationIdIssuer } from './execution/operation-id.js';
import { JournalWorkspaceUsageGuard, OperationJournal } from './execution/operation-journal.js';
import { OperationResolutionIntentStore } from './execution/operation-resolution-intent.js';
import { TargetResolver } from './execution/target-resolver.js';
import { AtomicFileStore } from './fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from './fs/operation-evidence-artifact-store.js';
import { createWorkspaceConfigStore } from './fs/workspace-config-store.js';
import { createWorkspacePolicy } from './fs/workspace-policy.js';
import { createWorkspaceRegistrationResolver } from './fs/workspace-registration-resolver.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { wireShutdown } from './lifecycle.js';
import { normalizeIdArgs } from './node-id.js';
import { createApprovalBroker } from './policy/approval-broker.js';
import { authorizeEgress, createEgressConfigStore } from './policy/policy-engine.js';
import { PROMPTS } from './prompts/registry.js';
import { resolveDefaultStateRoot } from './runtime-paths.js';
import {
  createFollowerAuthenticatedTransport,
  createFollowerTransportRequestId,
  createMcpSessionId,
} from './security/follower-transport.js';
import { createPairingManager } from './security/pairing-manager.js';
import {
  deriveControlAuthSession,
  deriveMcpAuthSession,
  deriveOwnerActor,
  loadOrCreateOwnerPrincipalKey,
} from './security/principal-derivation.js';
import { createStatePermissions } from './security/state-permissions.js';
import { ToolInvocationService } from './tool-invocation-service.js';
import { ANALYZE_PROJECT_TOOL_NAME, handleAnalyzeProject } from './tools/analyze-project.js';
import { annotationsFor } from './tools/annotations.js';
import { COMPONENT_MAP_TOOL_NAME, handleComponentMap } from './tools/component-map.js';
import { handleDesignContext } from './tools/design-context-guard.js';
import { DESIGN_DIFF_TOOL_NAME, handleDesignDiff } from './tools/design-diff.js';
import { EXPORT_PDF_TOOL_NAME, handleExportPdf } from './tools/export-pdf.js';
import { EXPORT_VIDEO_TOOL_NAME, handleExportVideo } from './tools/export-video.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './tools/get-design-context.js';
import { GET_SCREENSHOT_TOOL_NAME, screenshotContent } from './tools/get-screenshot.js';
import { handleIconMap, ICON_MAP_TOOL_NAME } from './tools/icon-map.js';
import { handleImportImage, IMPORT_IMAGE_TOOL_NAME } from './tools/import-image.js';
import { formatPingResult, handlePing, pingTool, type PingResult } from './tools/ping.js';
import { ALL_TOOL_SPECS } from './tools/registry.js';
import {
  createBoundRuntimeRegistry,
  type PinnedPluginRuntimePort,
  type RuntimeActionContext,
  type ServerAdapterRuntimePort,
} from './tools/runtime-registry.js';
import { handleSaveImageFills, SAVE_IMAGE_FILLS_TOOL_NAME } from './tools/save-image-fills.js';
import { handleSaveScreenshots, SAVE_SCREENSHOTS_TOOL_NAME } from './tools/save-screenshots.js';
import { handleScanComponents, SCAN_COMPONENTS_TOOL_NAME } from './tools/scan-components.js';
import { captureSkew, reportSkew, withSkewNotice } from './tools/skew-notice.js';
import { handleTokenMap, TOKEN_MAP_TOOL_NAME } from './tools/token-map.js';

const SERVER_NAME = 'figwright';
const SERVER_VERSION = pkg.version;

const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

const writeReadyLog = (message: string): void => {
  writeSync(2, Buffer.from(`${message}\n`, 'utf8'));
};

// FIGWRIGHT_PORT is a test/debug seam (the process-lifecycle e2e spawns real servers on a random
// port). The plugin always connects to DEFAULT_PORT, so overriding this in normal use just makes
// the server unreachable — hence undocumented.
const envPort = Number(process.env.FIGWRIGHT_PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 && envPort < 65_536 ? envPort : DEFAULT_PORT;

const stateRoot = resolveDefaultStateRoot();
const statePermissions = createStatePermissions(stateRoot);
await statePermissions.ensureSecure(stateRoot);
await statePermissions.verifySecure(stateRoot);
const mcpSession = createMcpSessionId();
const followerTransport = await createFollowerAuthenticatedTransport({
  stateRoot,
  permissions: statePermissions,
  leaderUrl: `http://127.0.0.1:${PORT}`,
  mcpSession,
});
const pairing = await createPairingManager({
  stateRoot,
  permissions: statePermissions,
  log,
});

interface LeaderRuntime {
  generation: string;
  plane: LeaderGenerationExecutionPlane;
  ownerPrincipalKey: Uint8Array;
  ownerActorId: ActorContext['actorId'];
  operationIdIssuer: Awaited<ReturnType<typeof loadOrCreateOperationIdIssuer>>;
  mcpAdapter: McpInvocationAdapter;
  mcpPrincipal: Readonly<ActorContext>;
  controlHandler: ReturnType<typeof createControlHttpHandler>;
  followerEndpoint: ReturnType<typeof createFollowerInvocationEndpoint>;
  operationJournal: OperationJournal;
  egressManifests: EgressManifestStore;
  evidenceReceipts: OperationEvidenceReceiptStore;
  retentionTimer: NodeJS.Timeout;
  executor: OperationExecutor;
  close(): Promise<void>;
}

const runtimeLifecycles = new GenerationRuntimeLifecycleRegistry<LeaderRuntime>();
const resolvedRuntimes = new Map<string, LeaderRuntime>();
const initializingAuthorities = new Map<
  string,
  Partial<
    Pick<LeaderRuntime, 'operationJournal' | 'egressManifests' | 'evidenceReceipts' | 'executor'>
  >
>();

const node = new Node({
  serverVersion: SERVER_VERSION,
  port: PORT,
  log,
  generationAuth: followerTransport.generation,
  relayAuthenticator: pairing,
  executionPlaneFactory: ({ leaderGeneration, releasePort }) => {
    let plane!: LeaderGenerationExecutionPlane;
    plane = new LeaderGenerationExecutionPlane(
      leaderGeneration,
      createDurableExecutionPlaneLifecyclePorts({
        leaderGeneration,
        journal: () =>
          resolvedRuntimes.get(leaderGeneration)?.operationJournal ??
          initializingAuthorities.get(leaderGeneration)?.operationJournal,
        abortGeneration: async capability => {
          await (
            resolvedRuntimes.get(leaderGeneration)?.executor ??
            initializingAuthorities.get(leaderGeneration)?.executor
          )?.demoteGeneration(leaderGeneration, capability);
        },
        flushDurability: async () => {
          const runtime = resolvedRuntimes.get(leaderGeneration);
          const initializing = initializingAuthorities.get(leaderGeneration);
          await (runtime?.egressManifests ?? initializing?.egressManifests)?.flush();
          await (runtime?.evidenceReceipts ?? initializing?.evidenceReceipts)?.flush();
        },
        drainTransport: deadlineAt => plane.drainInvocationStreams(deadlineAt),
        forceCloseTransport: () => plane.forceCloseInvocationStreams(),
        destroy: async () => {
          await runtimeLifecycles.close(leaderGeneration);
          resolvedRuntimes.delete(leaderGeneration);
          initializingAuthorities.delete(leaderGeneration);
        },
        releasePort,
      }),
    );
    return plane;
  },
});
const follower = new Follower({
  leaderUrl: node.leaderUrl,
  log,
  transport: followerTransport.client,
});
const election = new Election({ node, follower, buildId: BUILD_ID, log });
const followerInvocationClient = new FollowerInvocationClient(
  followerTransport.client,
  () => node.role,
);
const followerWorkspaceStore = createWorkspaceConfigStore(
  stateRoot,
  { hasUnsettled: async () => false },
  statePermissions,
  {},
  createWorkspaceRegistrationResolver(),
);
const followerWorkspaceBinding = createMcpWorkspaceBinding(followerWorkspaceStore);
const followerMcpAdapter = new McpInvocationAdapter({
  role: 'follower',
  resolveWorkspaceId: () => followerWorkspaceBinding.resolveRequiredForMcpSession(mcpSession),
  createRequestId: createFollowerTransportRequestId,
});

const createPinnedPluginPort = (resources: LeaderResources): PinnedPluginRuntimePort =>
  Object.freeze({
    execute: async (
      scope: RuntimeExecutionScope,
      toolName: ToolName,
      args: unknown,
      signal: AbortSignal,
      _reporter?: ProgressReporter,
      action?: Readonly<RuntimeActionContext>,
    ) => {
      if (scope.target.sessionId === null) {
        throw Object.assign(new Error('pinned plugin target is unavailable'), {
          code: 'PINNED_SESSION_LOST',
        });
      }
      signal.throwIfAborted();
      return resources.relay.sendRequest(
        toolName,
        args,
        getRelayBudget(toolName),
        scope.target.sessionId as string,
        served => reportSkew(resources.relay.skewNotice(served)),
        action === undefined
          ? undefined
          : {
              signal,
              operationId: action.operationId,
              actionNonce: action.actionNonce,
            },
      );
    },
  });

const createServerAdapterPort = (): ServerAdapterRuntimePort =>
  Object.freeze({
    execute: async (
      scope: RuntimeExecutionScope,
      toolName: ToolName,
      args: unknown,
      signal: AbortSignal,
      plugin: PinnedPluginRuntimePort,
      reporter?: ProgressReporter,
      action?: Readonly<RuntimeActionContext>,
    ) => {
      const dispatch = (name: string, value: unknown): Promise<unknown> =>
        plugin.execute(scope, name, value, signal, reporter, action);
      const routedDispatch = async (): Promise<typeof dispatch> => dispatch;
      switch (toolName) {
        case 'ping':
          return handlePing({
            node,
            follower,
            serverVersion: SERVER_VERSION,
            buildId: BUILD_ID,
            log,
          });
        case SAVE_SCREENSHOTS_TOOL_NAME:
          return handleSaveScreenshots(dispatch, args);
        case SAVE_IMAGE_FILLS_TOOL_NAME:
          return handleSaveImageFills(dispatch, args);
        case EXPORT_PDF_TOOL_NAME:
          return handleExportPdf(dispatch, args);
        case EXPORT_VIDEO_TOOL_NAME:
          return handleExportVideo(dispatch, args);
        case GET_SCREENSHOT_TOOL_NAME:
          return dispatch(GET_SCREENSHOT_TOOL_NAME, {
            ...(args as Record<string, unknown>),
            forVision: true,
          });
        case ANALYZE_PROJECT_TOOL_NAME:
          return handleAnalyzeProject(args);
        case SCAN_COMPONENTS_TOOL_NAME:
          return handleScanComponents(args);
        case COMPONENT_MAP_TOOL_NAME:
          return handleComponentMap(await routedDispatch(), args);
        case TOKEN_MAP_TOOL_NAME:
          return handleTokenMap(dispatch, args);
        case ICON_MAP_TOOL_NAME:
          return handleIconMap(await routedDispatch(), args);
        case IMPORT_IMAGE_TOOL_NAME:
          return handleImportImage(dispatch, args);
        case DESIGN_DIFF_TOOL_NAME:
          return handleDesignDiff(dispatch, args);
        case GET_DESIGN_CONTEXT_TOOL_NAME:
          return handleDesignContext(dispatch, args);
        default:
          throw Object.assign(new Error(`server adapter missing: ${toolName}`), {
            code: 'SERVER_ADAPTER_MISSING',
          });
      }
    },
  });

const initializeLeaderRuntime = async (resources: LeaderResources): Promise<LeaderRuntime> => {
  const generation = resources.generation.generation;
  const existing = runtimeLifecycles.get(generation);
  if (existing !== undefined) return existing;
  const initializing = runtimeLifecycles.initialize(generation, async signal => {
    if (resources.executionPlane === undefined) {
      throw Object.assign(new Error('leader execution plane was not constructed'), {
        code: 'EXECUTION_PLANE_UNAVAILABLE',
      });
    }
    const ownerPrincipalKey = await loadOrCreateOwnerPrincipalKey({
      stateRoot,
      permissions: statePermissions,
    });
    const ownerActorId = deriveOwnerActor(ownerPrincipalKey, 'control');
    const operationIdIssuer = await loadOrCreateOperationIdIssuer({
      stateRoot,
      permissions: statePermissions,
    });
    const operationJournal = new OperationJournal({ stateRoot, actorId: ownerActorId });
    initializingAuthorities.set(generation, { operationJournal });
    const operationResolutionIntents = new OperationResolutionIntentStore({
      stateRoot,
      actorId: ownerActorId,
    });
    const egressManifests = new EgressManifestStore({
      stateRoot,
      actorId: ownerActorId,
      leaderGeneration: generation,
    });
    const evidenceReceipts = new OperationEvidenceReceiptStore({
      stateRoot,
      actorId: ownerActorId,
    });
    const workspaceRegistrationResolver = createWorkspaceRegistrationResolver();
    const workspaceStore = createWorkspaceConfigStore(
      stateRoot,
      new JournalWorkspaceUsageGuard(operationJournal),
      statePermissions,
      {},
      workspaceRegistrationResolver,
    );
    const workspacePolicy = createWorkspacePolicy(workspaceStore);
    const artifacts = new OperationEvidenceArtifactStore({
      workspacePolicy,
      atomicFiles: new AtomicFileStore(),
    });
    const nativeArtifacts = new NativeEvidenceArtifactPort({
      workspacePolicy,
      atomicFiles: new AtomicFileStore(),
    });
    initializingAuthorities.set(generation, {
      operationJournal,
      egressManifests,
      evidenceReceipts,
    });
    const recoveryFinalizer = new DurableOperationFinalizer({
      artifacts: {
        createNew: async () => {
          throw Object.assign(new Error('artifact writes are unavailable during recovery'), {
            code: 'RECOVERY_ARTIFACT_WRITE_FORBIDDEN',
          });
        },
      },
      receipts: evidenceReceipts,
      egress: egressManifests,
      journal: operationJournal,
      emitTerminal: async () => undefined,
    });
    await Promise.all([
      operationResolutionIntents.recover(),
      recoverDurableOperationState({
        actorId: ownerActorId,
        now: Date.now(),
        egress: egressManifests,
        receipts: evidenceReceipts,
        journal: operationJournal,
        finalizer: recoveryFinalizer,
        deferTombstonePurge: true,
        preRuntimeReservationRecovery: {
          hasResultArtifactSideEffect: (workspaceId, operationId) =>
            artifacts.hasOperationSideEffect(workspaceId, operationId),
          hasNativeArtifactSideEffect: (workspaceId, operationId) =>
            nativeArtifacts.hasOperationSideEffect(workspaceId, operationId),
        },
      }),
    ]);
    const workspaceBinding = createMcpWorkspaceBinding(workspaceStore);
    const egressConfigStore = createEgressConfigStore(stateRoot, statePermissions);
    const adminAuditStore = createAdminAuditStore({ stateRoot });
    await adminAuditStore.queryEgress(ownerActorId, { since: null, cursor: null, limit: 1 });
    await adminAuditStore.recover(await egressConfigStore.load());
    const actionNonces = createActionNonceStore({ leaderGeneration: generation });
    const approvalBroker = createApprovalBroker({
      deliverPluginPrompt: async () => {
        throw Object.assign(new Error('paired approval consumer is not installed'), {
          code: 'APPROVAL_CHANNEL_UNAVAILABLE',
        });
      },
      deliverControlPrompt: async () => undefined,
    });
    const targetResolver = new TargetResolver({
      active: () => {
        const session = resources.relay.pickActiveSession();
        return session === undefined
          ? undefined
          : {
              sessionId: session.id,
              pluginGeneration: session.pluginGeneration,
              fileIdentity: session.fileIdentity,
              connectedSequence: session.connectedSequence,
              healthy: session.state === 'connected' && session.socket !== null,
            };
      },
      list: () =>
        resources.relay.sessions.list().map(session => ({
          sessionId: session.id,
          pluginGeneration: session.pluginGeneration,
          fileIdentity: session.fileIdentity,
          connectedSequence: session.connectedSequence,
          healthy: session.state === 'connected' && session.socket !== null,
        })),
    });
    const removeRetainedArtifacts = async (
      receipt: Readonly<OperationEvidenceReceiptV1>,
    ): Promise<void> => {
      if (receipt.workspaceId === null) {
        if (receipt.resultArtifact !== null || receipt.nativeEvidence.kind !== 'no-artifact') {
          throw Object.assign(new Error('retained evidence lacks a workspace binding'), {
            code: 'EVIDENCE_ARTIFACT_IDENTITY_MISMATCH',
          });
        }
        return;
      }
      if (receipt.resultArtifact !== null) {
        await artifacts.removeLinked({
          workspaceId: receipt.workspaceId,
          operationId: receipt.operationId,
          artifact: receipt.resultArtifact,
        });
      }
      if (receipt.nativeEvidence.kind === 'export') {
        const base = Object.freeze({
          operationId: receipt.operationId,
          workspaceId: receipt.workspaceId,
        });
        const context = Object.freeze({
          ...base,
          contextHash: nativeEvidenceContextHash(base),
        }) as VerifiedNativeEvidenceContextV1;
        await nativeArtifacts.removeLinkedManifest({
          context,
          evidence: receipt.nativeEvidence,
        });
      } else if (receipt.nativeEvidence.kind !== 'no-artifact') {
        throw Object.assign(new Error('native evidence cleanup requires manual verification'), {
          code: 'NATIVE_ARTIFACT_IDENTITY_MISMATCH',
        });
      }
    };
    let retentionFlight: Promise<void> | null = null;
    const sweepRetention = (): Promise<void> => {
      if (retentionFlight !== null) return retentionFlight;
      const flight = (async () => {
        const now = Date.now();
        const linkedAt = (operationId: string): number | null =>
          operationJournal.settledAt(operationId);
        await evidenceReceipts.compact({ now, linkedAt });
        await egressManifests.compact({ now, linkedAt });
        await evidenceReceipts.drainPendingArtifactCleanup(removeRetainedArtifacts);
        const hasLinkedEvidence = async (operationId: string): Promise<boolean> => {
          const operation = operationJournal.get(operationId);
          return (
            (operation !== undefined &&
              ['pending-approval', 'queued', 'dispatched', 'outcome-unknown'].includes(
                operation.status,
              )) ||
            (operation !== undefined &&
              'preExecutionConsentManifestHash' in operation &&
              operation.preExecutionConsentManifestHash !== null) ||
            (operation?.operationEvidenceReceiptHash ?? null) !== null ||
            (operation?.finalEgressManifestHash ?? null) !== null ||
            (await evidenceReceipts.get(ownerActorId, operationId)) !== null ||
            (await egressManifests.hasFinalizer(ownerActorId, operationId))
          );
        };
        /* eslint-disable no-await-in-loop -- each workspace orphan set is identity-verified */
        for (const workspace of await workspaceStore.list()) {
          await artifacts.discoverAndCleanupOrphans({
            workspaceId: workspace.workspaceId,
            hasLinkedEvidence,
          });
          await nativeArtifacts.discoverAndCleanupOrphans({
            workspaceId: workspace.workspaceId,
            hasLinkedEvidence,
          });
        }
        /* eslint-enable no-await-in-loop */
        await operationJournal.purgeExpiredTombstones();
      })();
      retentionFlight = flight.finally(() => {
        retentionFlight = null;
      });
      return retentionFlight;
    };
    await sweepRetention();
    const runtimes = createBoundRuntimeRegistry(
      createPinnedPluginPort(resources),
      createServerAdapterPort(),
    );
    const executor = new OperationExecutor({
      issuer: operationIdIssuer,
      journal: operationJournal,
      queue: new FileExecutionQueue(),
      runtimes,
      durability: {
        egress: egressManifests,
        receipts: evidenceReceipts,
        artifacts,
        projector: createOperationEvidenceProjector(),
        nativeArtifacts,
      },
    });
    initializingAuthorities.set(generation, {
      operationJournal,
      egressManifests,
      evidenceReceipts,
      executor,
    });
    const invocationService = new ToolInvocationService(executor);
    resources.executionPlane.bindInvocationService(invocationService);
    resources.executionPlane.bindAdmissionAuthority({
      resolveWorkspaceContext: async workspaceId => {
        if (workspaceId === null) {
          return Object.freeze({ workspaceId: null, workspaceRoot: null });
        }
        const workspace = (await workspaceStore.list()).find(
          row => row.workspaceId === workspaceId,
        );
        if (workspace === undefined) {
          throw Object.assign(new Error('workspace is not configured'), {
            code: 'WORKSPACE_NOT_CONFIGURED',
          });
        }
        return Object.freeze({ workspaceId, workspaceRoot: workspace.realPath });
      },
      workspacePolicy,
      targetResolver,
      approval: approvalBroker,
      authorizeEgress: async input => {
        const loaded = await egressConfigStore.load();
        const configured =
          loaded.storageState === 'valid' && !loaded.expired ? loaded.config : undefined;
        return authorizeEgress(configured, {
          source: input.principal.entryPath === 'control' ? 'cli-control' : 'mcp',
          inputClasses: input.inputClasses,
          possibleResultClasses: input.possibleResultClasses,
        });
      },
      issueOperationId: actorId => operationIdIssuer.issue(actorId),
      verifyOperationId: (actorId, operationId) => {
        operationIdIssuer.verify(actorId, operationId);
      },
    });
    const workspaceEndpoints = createWorkspaceEndpoints({
      store: workspaceStore,
      nonceStore: actionNonces,
    });
    const operationEndpoints = createOperationEndpoints({
      issuer: operationIdIssuer,
      journal: operationJournal,
      resolutionIntents: operationResolutionIntents,
      nonceStore: actionNonces,
      cancel: (principal, input) =>
        resources.executionPlane?.cancel(principal, input) ?? Promise.resolve(),
    });
    const typedControlRouter = new AuthenticatedControlRouter();
    const operationEvidenceEndpoint = createOperationEvidenceEndpoint({
      operations: operationJournal,
      receipts: evidenceReceipts,
      egress: egressManifests,
    });
    registerTask7ControlRoutes(typedControlRouter, {
      status: createControlStatusEndpoint({
        serverVersion: SERVER_VERSION,
        buildId: BUILD_ID,
        buildIdentityHash: null,
        leaderGeneration: () => generation,
        role: () => node.role,
        sessions: () => {
          const connected = resources.relay.sessions.connected();
          const active = resources.relay.pickActiveSession();
          return {
            pairedPluginCount: connected.length,
            active:
              active === undefined
                ? null
                : {
                    sessionId: active.id,
                    fileName: active.fileName,
                    pageName: active.pageName,
                    fileIdentityKind: active.fileIdentity.kind,
                    pluginVersion: active.clientVersion,
                    pluginGeneration: active.pluginGeneration,
                    editorType: active.editorType,
                    capabilities: active.capabilities,
                  },
          };
        },
      }),
      actionNonce: createActionNonceEndpoint({
        store: actionNonces,
        registrationResolver: workspaceRegistrationResolver,
      }),
      approvals: createApprovalEndpoints({
        broker: approvalBroker,
        leaderGeneration: () => generation,
      }),
      toolCall: createToolCallEndpoint({
        plane: {
          invokeTool: async (principal, request, options) => {
            for await (const frame of resources.executionPlane!.invokeToolFrames(
              principal,
              request,
              options,
            )) {
              if (frame.type === 'result') return frame.result;
              if (frame.type === 'error') {
                throw Object.assign(new Error(frame.error.message), frame.error);
              }
            }
            throw Object.assign(new Error('control stream ended without a terminal frame'), {
              code: 'CONTROL_TERMINAL_MISSING',
            });
          },
        },
        issueOperationId: actorId => operationIdIssuer.issue(actorId),
      }),
      workspaces: workspaceEndpoints,
      operations: operationEndpoints,
      egress: createEgressControl({
        store: egressConfigStore,
        nonceStore: actionNonces,
        audit: createEgressAdminAuditTransactions({ store: adminAuditStore }),
      }),
      adminAudit: createAdminAuditEndpoint(adminAuditStore),
    });
    typedControlRouter.register({
      id: 'operation.evidence',
      method: 'GET',
      path: '/control/operations/:operationId/evidence',
      routeClass: 'admin',
      inputSchema: z.object({ operationId: z.string().min(1).max(384) }).strict(),
      outputSchema: OperationEvidenceViewV1Schema,
      handle: (principal, input) => operationEvidenceEndpoint(principal, input.operationId),
    });
    typedControlRouter.freeze();
    const controlHandler = createControlHttpHandler({
      router: typedControlRouter,
      principalForRequest: async request => {
        const authorization = request.headers.authorization;
        const credential =
          typeof authorization === 'string' && authorization.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length)
            : '';
        return Object.freeze({
          actorId: ownerActorId,
          authSessionId: deriveControlAuthSession(ownerPrincipalKey, credential, generation),
          entryPath: 'control' as const,
        });
      },
    });
    const mcpAdapter = new McpInvocationAdapter({
      role: 'leader',
      resolveWorkspaceId: () => workspaceBinding.resolveRequiredForMcpSession(mcpSession),
      createRequestId: createFollowerTransportRequestId,
    });
    const mcpPrincipal = Object.freeze({
      actorId: deriveOwnerActor(ownerPrincipalKey, 'mcp-direct'),
      authSessionId: deriveMcpAuthSession(ownerPrincipalKey, mcpSession, 'leader'),
      entryPath: 'mcp-direct' as const,
    });
    const followerEndpoint = createFollowerInvocationEndpoint({
      principalForMcpSession: openedMcpSession =>
        Object.freeze({
          actorId: deriveOwnerActor(ownerPrincipalKey, 'mcp-follower'),
          authSessionId: deriveMcpAuthSession(ownerPrincipalKey, openedMcpSession, 'follower'),
          entryPath: 'mcp-follower' as const,
        }),
      plane: {
        invokeTool: (principal, request, subscriberSignal) =>
          resources.executionPlane!.invokeToolFrames(
            principal,
            request,
            NO_CAPTURE_OPTIONS,
            subscriberSignal,
          ),
        invokeService: () => resources.executionPlane!.invokeServiceFrames(),
        cancel: (principal, request) => resources.executionPlane!.cancel(principal, request),
      },
    });
    signal.throwIfAborted();
    if (node.getLeader() !== resources) {
      throw Object.assign(new Error('leader generation changed during runtime initialization'), {
        code: 'LEADER_GENERATION_CLOSED',
      });
    }
    const retentionTimer = setInterval(() => {
      void sweepRetention().catch(error => {
        const errorType = error instanceof Error ? error.name : 'NonError';
        log(`[retention] evidence cleanup failed closed (${errorType})`);
      });
    }, 86_400_000);
    retentionTimer.unref();
    const runtime: LeaderRuntime = {
      generation,
      plane: resources.executionPlane,
      ownerPrincipalKey,
      ownerActorId,
      operationIdIssuer,
      mcpAdapter,
      mcpPrincipal,
      controlHandler,
      followerEndpoint,
      operationJournal,
      egressManifests,
      evidenceReceipts,
      retentionTimer,
      executor,
      close: async () => {
        clearInterval(retentionTimer);
        await Promise.allSettled([
          operationJournal.flush(),
          egressManifests.flush(),
          evidenceReceipts.flush(),
        ]);
        resolvedRuntimes.delete(generation);
        initializingAuthorities.delete(generation);
      },
    };
    resolvedRuntimes.set(generation, runtime);
    initializingAuthorities.delete(generation);
    return runtime;
  });
  return initializing.catch(error => {
    initializingAuthorities.delete(generation);
    throw error;
  });
};

let currentDetach: (() => void) | null = null;
node.onRoleChange(role => {
  if (currentDetach !== null) {
    currentDetach();
    currentDetach = null;
  }
  if (role === NodeRole.Leader) {
    const res = node.getLeader();
    if (res !== null) {
      const controlRoutes = new LeaderControlRouteRegistry();
      controlRoutes.register(
        '/control',
        createLazyControlHttpHandler(
          async () => (await initializeLeaderRuntime(res)).controlHandler,
        ),
      );
      // Leave a note naming this process as the port's owner. It is read by exactly one caller: a
      // node that finds the port bound by something that won't answer /ping, which is the single
      // failure the election cannot resolve by waiting (see election/leader-lock.ts). Best-effort —
      // a server that can't write it still leads.
      writeLeaderLock({
        port: res.port,
        buildId: BUILD_ID,
        serverVersion: SERVER_VERSION,
        leaderGeneration: res.generation.generation,
      });
      currentDetach = attachLeaderEndpoints(res.http, {
        relay: res.relay,
        serverVersion: SERVER_VERSION,
        buildId: BUILD_ID,
        leaderGeneration: res.generation.generation,
        transport: followerTransport,
        pairing,
        controlRoutes,
        innerRpcHandler: async (opened, response, subscriberSignal) =>
          (await initializeLeaderRuntime(res)).followerEndpoint(opened, response, subscriberSignal),
        // Newest build wins: a follower on a newer build asks us to step down; the port frees for
        // it within ms and the plugin reconnects to the new leader on its next retry (~250ms).
        onAbdicate: () => {
          void election.yieldLeadership().catch(error => {
            log(`[election] durable abdication failed: ${String(error)}`);
          });
        },
        log,
      });
    }
  }
});

await election.start();

interface ToolHandlerContext {
  mcpReq: {
    _meta?: Record<string, unknown>;
    notify(notification: {
      method: 'notifications/progress';
      params: {
        progressToken: string | number;
        progress: number;
        total?: number;
        message?: string;
      };
    }): Promise<void>;
  };
}
type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolHandlerContext,
) => Promise<CallToolResult>;

const textResult = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

// Raw adapters run before presentation so every result, including binary and server-local paths,
// crosses the canonical result schema. Everything else takes the generic dispatch path below.
// forVision marks this as the path whose rasters are inlined into the model's context, so the
// sandbox caps an oversized scale to what a vision model can actually resolve. save_screenshots
// dispatches the same tool without it — those bytes go to disk and keep the caller's scale.
// The guarded public path: arms the plugin's node-count bail (budget: true) and applies the
// payload-size net + below-full note. Internal dispatches (design_diff, component/icon map) call
// the tool directly and stay raw.

const invokeProductionTool = async (
  toolName: string,
  args: unknown,
  onProgress: (progress: Readonly<ProgressEvent>) => Promise<void>,
): Promise<unknown> => {
  if (node.isLeader()) {
    const resources = node.getLeader();
    if (resources === null) {
      throw Object.assign(new Error('leader resources are unavailable'), {
        code: 'EXECUTION_PLANE_UNAVAILABLE',
      });
    }
    const runtime = await initializeLeaderRuntime(resources);
    const request = await runtime.mcpAdapter.fromToolCall(toolName, args, {});
    for await (const frame of runtime.plane.invokeToolFrames(
      runtime.mcpPrincipal,
      request,
      NO_CAPTURE_OPTIONS,
    )) {
      if (frame.type === 'progress') await onProgress(frame.progress);
      if (frame.type === 'result') return frame.result;
      if (frame.type === 'error') {
        throw Object.assign(new Error(frame.error.message), frame.error);
      }
    }
    throw Object.assign(new Error('MCP operation ended without terminal state'), {
      code: 'MCP_TERMINAL_MISSING',
    });
  }
  const request = await followerMcpAdapter.fromToolCall(toolName, args, {});
  const plaintext = encodeFollowerInnerMessage({ version: 1, type: 'tool', request });
  const chunks = await followerInvocationClient.open(plaintext, new AbortController().signal);
  for await (const chunk of chunks) {
    const frame = decodeFollowerInnerMessage(chunk);
    if (frame.type === 'progress') await onProgress(frame.progress);
    if (frame.type === 'result') return frame.result;
    if (frame.type === 'error') {
      throw Object.assign(new Error(frame.error.message), {
        code: frame.error.code,
        retryable: frame.error.retryable,
      });
    }
  }
  throw Object.assign(new Error('follower stream ended without a terminal frame'), {
    code: 'FOLLOWER_TERMINAL_MISSING',
  });
};

const presentResult = (toolName: string, result: unknown): CallToolResult => {
  if (toolName === GET_SCREENSHOT_TOOL_NAME) {
    return { content: screenshotContent(result as GetScreenshotResult) };
  }
  if (toolName === pingTool.name) {
    return {
      content: [{ type: 'text', text: formatPingResult(result as PingResult) }],
    };
  }
  return textResult(result);
};

// serveStdio owns the era decision for the connection: it reads the opening exchange, pins ONE
// instance from this factory for the connection's lifetime, and passes everything after straight
// through. A 2025-era client is served exactly as `new StdioServerTransport()` + `connect()` served
// it; a 2026-07-28 client negotiates the modern revision instead — which a hand-wired transport
// can't do. On stdio there is exactly one connection per process, so this runs once.
const createMcpServer = (): McpServer => {
  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const spec of ALL_TOOL_SPECS) {
    const run: ToolHandler = async (args, context) => {
      const result = await invokeProductionTool(spec.name, args, async progress => {
        // eslint-disable-next-line no-underscore-dangle -- MCP names this field `_meta`.
        const progressToken = context.mcpReq._meta?.progressToken;
        if (typeof progressToken !== 'string' && typeof progressToken !== 'number') return;
        await context.mcpReq.notify({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: progress.completed,
            ...(progress.total === null ? {} : { total: progress.total }),
            ...(progress.message.length === 0 ? {} : { message: progress.message }),
          },
        });
      });
      return presentResult(spec.name, result);
    };
    // Normalize id args (a pasted Figma URL or dash-form node id → canonical colon id) once here, so
    // every tool — generic or special-cased — accepts them without per-handler conversion.
    // An older plugin drops arguments it predates and still answers `{ ok: true }`, so the result
    // cannot be trusted on its face and nothing in it says so. Saying it here, on every affected
    // call, is what replaces the refusal this used to be: the agent is told before it reports
    // success to the user.
    const handler: ToolHandler = async (args, context) =>
      captureSkew(
        () => run(normalizeIdArgs(args), context),
        (result, notice) => withSkewNotice(result, notice),
      );
    // The spec's own Zod object goes straight through: it is already the Standard Schema object the
    // SDK wants. Registering heterogeneous specs through one loop needed a handler cast under v1;
    // v2's typing accepts ToolHandler directly, so the result stays checked against CallToolResult.
    mcp.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: annotationsFor(spec),
      },
      handler,
    );
  }

  for (const prompt of PROMPTS) {
    mcp.registerPrompt(
      prompt.definition.name,
      {
        description: prompt.definition.description ?? '',
        argsSchema: prompt.argsSchema,
      },
      args => prompt.build(args),
    );
  }

  return mcp;
};

/**
 * A stdio transport that reports its own death.
 *
 * The SDK closes this transport when a read fails fatally — reachably today when an inbound message
 * exceeds the 10MB read buffer, which `import_image`'s base64 `data` can do. Closing only detaches
 * the stdin listeners and pauses the stream: it emits neither 'end' nor 'close', so none of
 * wireShutdown's triggers fire. The process then survives as a leader that can no longer hear its
 * client while still holding the relay port — a follower behind it can never take over, and nothing
 * is logged. Reporting the close routes that silent dead end into the ordinary shutdown path, after
 * which the port frees and a follower is promoted on its next tick.
 *
 * Overriding close() rather than onclose is deliberate: whoever owns the connection assigns onclose
 * for its own bookkeeping, so it is not ours to take.
 */
class SelfReportingStdioTransport extends StdioServerTransport {
  constructor(private readonly onClosed: () => void) {
    super();
  }

  override async close(): Promise<void> {
    await super.close();
    this.onClosed();
  }
}

// Deferred because the trigger only exists once wireShutdown has run, and that needs the transport.
let triggerShutdown = (): void => {};
const stdioTransport = new SelfReportingStdioTransport(() => {
  triggerShutdown();
});

const roleDetail = node.isLeader()
  ? `relay on :${node.getLeader()?.port ?? PORT}`
  : node.isConflicted()
    ? `:${PORT} held by an unresponsive owner — contending for it`
    : `follower → ${node.leaderUrl}`;
writeReadyLog(
  `[figwright] server ${SERVER_VERSION} (protocol ${PROTOCOL_VERSION}) ready as ${node.role}, ${roleDetail}`,
);

const stdio = serveStdio(createMcpServer, {
  // serveStdio would otherwise construct its own transport, and we need one that reports its death.
  transport: stdioTransport,
  // Unset, serveStdio discards transport errors outright, so the one message naming the cause
  // (e.g. "ReadBuffer exceeded maximum size of 10485760 bytes") never reaches the user's stderr.
  onerror: (error: Error): void => {
    log(`[figwright] stdio transport error: ${error.message}`);
  },
});

const shutdown = async (): Promise<void> => {
  // serveStdio owns the transport it started, so it has to be the one to close it — closing the
  // pinned instance and detaching from stdin. Its own errors must not skip the relay teardown
  // below: the relay port is the resource a zombie would hold, and stdio is already going away.
  await stdio.close().catch(() => {});
  election.stop();
  await node.stop();
  process.exit(0);
};
// Exit on SIGINT/SIGTERM, on stdin EOF, and on the transport dying under us. stdin closes when the
// client that spawned us goes away (including a crash that sends no signal); without this the
// process would linger holding the relay port as a stale "zombie" leader serving an old build.
// wireShutdown runs shutdown at most once, so the transport trigger is safe to fire during our own
// shutdown — which closes that same transport. hardExit is the backstop for the graceful path
// itself stalling (e.g. a close waiting on connections that never drain) — exit code 1 marks the
// forced, non-clean variant.
triggerShutdown = wireShutdown({
  proc: process,
  stdin: process.stdin,
  shutdown,
  hardExit: () => {
    log('[figwright] graceful shutdown stalled — forcing exit');
    process.exit(1);
  },
});
