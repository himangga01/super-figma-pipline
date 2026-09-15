import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  DEFAULT_PORT,
  NO_CAPTURE_OPTIONS,
  OperationEvidenceViewV1Schema,
  PROTOCOL_VERSION,
  canonicalFileIdentityHash,
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
  type WorkspacePolicy,
} from '@sfp/shared';
import { PORTAL_TOOL_NAMES, type PortalToolName } from '@sfp/shared';
import { firefox } from 'playwright';
import { z } from 'zod';

import pkg from '../package.json' with { type: 'json' };
import { BUILD_ID, BUILD_IDENTITY_HASH } from './build-id.js';
import { createActionNonceEndpoint } from './control/action-nonce-endpoints.js';
import { createActionNonceStore } from './control/action-nonce-store.js';
import { createAdminAuditEndpoint } from './control/admin-audit-endpoints.js';
import { createAdminAuditStore } from './control/admin-audit-store.js';
import { createApprovalEndpoints } from './control/approval-endpoints.js';
import {
  createEgressAdminAuditTransactions,
  createEgressControl,
} from './control/egress-endpoints.js';
import { createGroundingEndpoint } from './control/grounding-endpoints.js';
import { registerIdentityRoutes } from './control/identity-endpoints.js';
import { createNetworkDomainEndpoints } from './control/network-domain-endpoints.js';
import { createOperationEndpoints } from './control/operation-endpoints.js';
import { createOperationEvidenceEndpoint } from './control/operation-evidence-endpoint.js';
import {
  registerTask7ControlRoutes,
  registerTask8BNetworkRoutes,
  registerSnapshotControlRoutes,
} from './control/route-registry.js';
import {
  AuthenticatedControlRouter,
  createControlHttpHandler,
  createLazyControlHttpHandler,
} from './control/router.js';
import { createSnapshotEndpoint } from './control/snapshot-endpoints.js';
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
  followerPingTimeoutForPlatform,
  GenerationRetentionCoordinator,
  GenerationRuntimeLifecycleRegistry,
  LeaderGenerationExecutionPlane,
} from './execution/execution-plane.js';
import { FileExecutionQueue } from './execution/file-queue.js';
import { FollowerInvocationClient } from './execution/follower-invocation-client.js';
import { createFollowerInvocationEndpoint } from './execution/follower-invocation-endpoint.js';
import {
  createIdentityBootstrapCoordinator,
  createIdentityOperation,
  type SessionDocumentBinding,
} from './execution/identity-bootstrap-coordinator.js';
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
import { AtomicFileStore, WorkspaceAtomicFileStore } from './fs/atomic-file.js';
import {
  OperationEvidenceArtifactStore,
  withTask8ProjectionInvariants,
} from './fs/operation-evidence-artifact-store.js';
import { RepoReader } from './fs/repo-walk.js';
import { createWorkspaceConfigStore } from './fs/workspace-config-store.js';
import { createWorkspacePolicy } from './fs/workspace-policy.js';
import { createWorkspaceRegistrationResolver } from './fs/workspace-registration-resolver.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { wireShutdown } from './lifecycle.js';
import { RemoteDomainConfigStore } from './network/remote-domain-config-store.js';
import {
  createRemoteImageFetcher,
  type RemoteImageFetcher,
} from './network/remote-image-fetcher.js';
import { normalizeIdArgs } from './node-id.js';
import { createApprovalBroker } from './policy/approval-broker.js';
import { authorizeEgress, createEgressConfigStore } from './policy/policy-engine.js';
import { preparePortalCaptureAuthority } from './portal/capture-admission-runtime.js';
import { createPortalCaptureRuntime } from './portal/capture-runtime.js';
import {
  createPortalBindingResolver,
  type PortalCaptureAdmissionPorts,
} from './portal/capture-source-admission.js';
import {
  createPortalProfileEndpoint,
  createPortalProfilePreparationEndpoint,
  registerPortalControlRoutes,
  registerPortalEnvironmentRoutes,
} from './portal/control.js';
import { PortalCoordinator } from './portal/coordinator.js';
import { ExistingChromeDesignCapture } from './portal/design-capture.js';
import { PortalNativeWork } from './portal/native-work.js';
import { presentPortalNext } from './portal/presentation.js';
import { PortalCoreLifecycle } from './portal/recipes/core-lifecycle.js';
import { CorePreparations } from './portal/recipes/core-preparation.js';
import { registerRecipeEvidenceRoutes } from './portal/recipes/evidence-control.js';
import { RecipeEvidenceHolds } from './portal/recipes/evidence-hold.js';
import { createRecipeEvidenceOperations } from './portal/recipes/evidence-operations.js';
import { PortalStore } from './portal/store.js';
import { PROMPTS } from './prompts/registry.js';
import { isDaemonMode } from './runtime-mode.js';
import { resolveDefaultStateRoot } from './runtime-paths.js';
import { DocumentBindingStore } from './security/document-binding-store.js';
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
import { createSnapshotOperations } from './snapshot/operations.js';
import { loadTokenValueIndex } from './tokens/token-index.js';
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
import { handleExportTokens, handleExportFramesToPdf, handleDoctor } from './tools/safe-union.js';
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
const [followerTransport, pairing] = await Promise.all([
  createFollowerAuthenticatedTransport({
    stateRoot,
    permissions: statePermissions,
    leaderUrl: `http://127.0.0.1:${PORT}`,
    mcpSession,
  }),
  createPairingManager({
    stateRoot,
    permissions: statePermissions,
    log,
  }),
]);

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
  pingTimeoutMs: followerPingTimeoutForPlatform(process.platform),
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
let followerInvocationAuthority: Promise<
  Readonly<{
    actorId: ActorContext['actorId'];
    issuer: Awaited<ReturnType<typeof loadOrCreateOperationIdIssuer>>;
  }>
> | null = null;
const getFollowerInvocationAuthority = () => {
  followerInvocationAuthority ??= Promise.all([
    loadOrCreateOwnerPrincipalKey({ stateRoot, permissions: statePermissions }),
    loadOrCreateOperationIdIssuer({ stateRoot, permissions: statePermissions }),
  ]).then(([ownerPrincipalKey, issuer]) =>
    Object.freeze({
      actorId: deriveOwnerActor(ownerPrincipalKey, 'mcp-follower'),
      issuer,
    }),
  );
  return followerInvocationAuthority;
};

const createPinnedPluginPort = (resources: LeaderResources): PinnedPluginRuntimePort =>
  Object.freeze({
    execute: async (
      scope: RuntimeExecutionScope,
      toolName: ToolName,
      args: unknown,
      signal: AbortSignal,
      reporter?: ProgressReporter,
      action?: Readonly<RuntimeActionContext>,
    ) => {
      if (scope.target.sessionId === null) {
        throw Object.assign(new Error('pinned plugin target is unavailable'), {
          code: 'PINNED_SESSION_LOST',
        });
      }
      if (
        scope.target.fileIdentity === null ||
        scope.target.fileExecutionKey === null ||
        scope.target.pluginGeneration === null ||
        scope.target.editorType == null ||
        scope.target.capabilities == null
      ) {
        throw Object.assign(new Error('pinned plugin target binding is incomplete'), {
          code: 'INVOCATION_TARGET_INVALID',
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
              ...(reporter === undefined
                ? {}
                : {
                    onProgress: (progress: Readonly<ProgressEvent>) =>
                      reporter.report({
                        phase: progress.phase,
                        completed: progress.completed,
                        total: progress.total,
                        message: progress.message,
                      }),
                  }),
            },
        {
          sessionId: scope.target.sessionId,
          pluginGeneration: scope.target.pluginGeneration,
          fileIdentity: scope.target.fileIdentity,
          fileIdentityHash: canonicalFileIdentityHash(scope.target.fileIdentity),
          fileExecutionKey: scope.target.fileExecutionKey,
          editorType: scope.target.editorType,
          capabilities: scope.target.capabilities,
        },
      );
    },
  });

const createServerAdapterPort = (
  workspacePolicy: WorkspacePolicy,
  remoteImages: RemoteImageFetcher,
  remoteDomains: RemoteDomainConfigStore,
  portal: PortalCoordinator,
  captureRuntime: ReturnType<typeof createPortalCaptureRuntime>,
): ServerAdapterRuntimePort =>
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
      if (PORTAL_TOOL_NAMES.some(name => name === toolName)) {
        if (!scope.portalAuthority || !action)
          throw Object.assign(new Error('Verified portal invocation authority is required'), {
            code: 'PORTAL_AUTHORITY_REQUIRED',
          });
        const scopedCapture = await captureRuntime(scope, plugin, action, reporter);
        try {
          return await portal.execute(toolName as PortalToolName, args, {
            actor: scope.actor,
            workspaceId: scope.workspace.workspaceId,
            operationId: action.operationId,
            authority: scope.portalAuthority,
            ...(scopedCapture.capture ? { capture: scopedCapture.capture } : {}),
            ...(reporter ? { reporter } : {}),
            signal,
          });
        } finally {
          await scopedCapture.close();
        }
      }
      let dispatchIndex = 0;
      const dispatch = (name: string, value: unknown): Promise<unknown> => {
        const index = dispatchIndex++;
        const childAction =
          action === undefined || index === 0
            ? action
            : {
                ...action,
                actionNonce: createHash('sha256')
                  .update(`${action.actionNonce}:${index}`)
                  .digest('base64url'),
              };
        return plugin.execute(scope, name, value, signal, reporter, childAction);
      };
      const routedDispatch = async (): Promise<typeof dispatch> => dispatch;
      const workspaceId = scope.workspace.workspaceId;
      const workspaceRoot = scope.workspace.workspaceRoot;
      const requireWorkspaceId = (): string => {
        if (workspaceId === null || workspaceRoot === null) {
          throw Object.assign(new Error('local filesystem tool requires a workspace'), {
            code: 'WORKSPACE_REQUIRED',
          });
        }
        return workspaceId;
      };
      const workspaceArgs = (): Record<string, unknown> => {
        const record =
          typeof args === 'object' && args !== null && !Array.isArray(args)
            ? { ...(args as Record<string, unknown>) }
            : {};
        const rootDir = scope.resolvedPaths?.rootDir;
        if (rootDir !== undefined) record.rootDir = rootDir.path;
        for (const pathArg of ['outDir', 'outPath'] as const) {
          const resolved = scope.resolvedPaths?.[pathArg];
          if (resolved === undefined || workspaceRoot === null) continue;
          const fromRoot = relative(workspaceRoot, resolved.path);
          if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
            throw Object.assign(new Error('output path is outside the resolved workspace root'), {
              code: 'PATH_OUTSIDE_WORKSPACE',
            });
          }
          record[pathArg] = (fromRoot === '' ? '.' : fromRoot).split(sep).join('/');
        }
        return record;
      };
      const repoReader = (): RepoReader => {
        const id = requireWorkspaceId();
        const rootDir = scope.resolvedPaths?.rootDir?.path ?? (workspaceRoot as string);
        return new RepoReader({ rootDir, workspaceId: id, workspacePolicy, signal });
      };
      const localReadArgs = (reader: RepoReader): Record<string, unknown> => {
        const record = workspaceArgs();
        record.rootDir = reader.rootDir;
        const tokenSource = scope.resolvedPaths?.tokenSource?.path;
        if (tokenSource !== undefined) {
          const fromRoot = relative(reader.rootDir, tokenSource);
          if (
            fromRoot === '' ||
            fromRoot === '..' ||
            fromRoot.startsWith(`..${sep}`) ||
            isAbsolute(fromRoot)
          ) {
            throw Object.assign(new Error('token source is outside the resolved repo root'), {
              code: 'PATH_OUTSIDE_WORKSPACE',
            });
          }
          record.tokenSource = fromRoot.split(sep).join('/');
        }
        return record;
      };
      const workspaceFiles = (): WorkspaceAtomicFileStore =>
        new WorkspaceAtomicFileStore({
          workspaceId: requireWorkspaceId(),
          workspacePolicy,
          atomicFiles: new AtomicFileStore(),
        });
      switch (toolName) {
        case 'export_tokens':
          if (scope.resolvedPaths?.outPath?.overwrites) throw new Error('TARGET_ALREADY_EXISTS');
          return handleExportTokens(
            dispatch,
            workspaceArgs(),
            (args as { outPath?: string }).outPath === undefined ? undefined : workspaceFiles(),
          );
        case 'export_frames_to_pdf':
          if (scope.resolvedPaths?.outPath?.overwrites) throw new Error('TARGET_ALREADY_EXISTS');
          return handleExportFramesToPdf(dispatch, workspaceArgs(), workspaceFiles());
        case 'doctor':
          return handleDoctor(args, {
            role: node.role,
            pluginConnected: node.getLeader()?.relay.pickActiveSession() !== undefined,
            roundTrip: () => dispatch('get_metadata', {}),
          });
        case 'ping':
          return handlePing({
            node,
            follower,
            serverVersion: SERVER_VERSION,
            buildId: BUILD_ID,
            log,
          });
        case SAVE_SCREENSHOTS_TOOL_NAME:
          return handleSaveScreenshots(dispatch, workspaceArgs(), workspaceFiles());
        case SAVE_IMAGE_FILLS_TOOL_NAME:
          return handleSaveImageFills(dispatch, workspaceArgs(), workspaceFiles());
        case EXPORT_PDF_TOOL_NAME:
          return handleExportPdf(dispatch, workspaceArgs(), workspaceFiles());
        case EXPORT_VIDEO_TOOL_NAME:
          return handleExportVideo(dispatch, workspaceArgs(), workspaceFiles());
        case GET_SCREENSHOT_TOOL_NAME:
          return dispatch(GET_SCREENSHOT_TOOL_NAME, {
            ...(args as Record<string, unknown>),
            forVision: true,
          });
        case ANALYZE_PROJECT_TOOL_NAME: {
          const reader = repoReader();
          return handleAnalyzeProject(localReadArgs(reader), reader);
        }
        case SCAN_COMPONENTS_TOOL_NAME: {
          const reader = repoReader();
          return handleScanComponents(localReadArgs(reader), reader);
        }
        case COMPONENT_MAP_TOOL_NAME: {
          const reader = repoReader();
          return handleComponentMap(await routedDispatch(), localReadArgs(reader), reader);
        }
        case TOKEN_MAP_TOOL_NAME: {
          const reader = repoReader();
          return handleTokenMap(dispatch, localReadArgs(reader), reader);
        }
        case ICON_MAP_TOOL_NAME: {
          const reader = repoReader();
          return handleIconMap(await routedDispatch(), localReadArgs(reader), reader);
        }
        case IMPORT_IMAGE_TOOL_NAME:
          return handleImportImage(dispatch, args, {
            fetcher: remoteImages,
            domains: remoteDomains,
            signal,
          });
        case DESIGN_DIFF_TOOL_NAME: {
          const reader = repoReader();
          const localArgs = localReadArgs(reader);
          const snapshot = scope.resolvedPaths?.snapshotPath;
          if (snapshot === undefined) {
            throw Object.assign(new Error('design diff snapshot authority is missing'), {
              code: 'SNAPSHOT_AUTHORITY_MISMATCH',
            });
          }
          const fromRoot = relative(reader.rootDir, snapshot.path);
          if (
            fromRoot === '' ||
            fromRoot === '..' ||
            fromRoot.startsWith(`..${sep}`) ||
            isAbsolute(fromRoot)
          ) {
            throw Object.assign(new Error('design diff snapshot escaped the workspace'), {
              code: 'SNAPSHOT_AUTHORITY_MISMATCH',
            });
          }
          return handleDesignDiff(
            dispatch,
            localArgs,
            reader,
            workspaceFiles(),
            {
              relativePath: fromRoot.split(sep).join('/'),
              absolutePath: snapshot.path,
              overwrites: snapshot.overwrites,
              destructiveApproved:
                action !== undefined && localArgs.update === true && snapshot.overwrites,
            },
            canonicalFileIdentityHash(scope.target.fileIdentity!),
          );
        }
        case GET_DESIGN_CONTEXT_TOOL_NAME:
          if (workspaceId === null || workspaceRoot === null) {
            return handleDesignContext(dispatch, args, null);
          }
          {
            const reader = repoReader();
            return handleDesignContext(dispatch, args, () =>
              loadTokenValueIndex(reader.rootDir, reader),
            );
          }
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
    const assertInitializationActive = (): void => {
      if (!signal.aborted) return;
      throw Object.assign(new Error('leader generation closed during runtime initialization'), {
        code: 'LEADER_GENERATION_CLOSED',
      });
    };
    assertInitializationActive();
    if (resources.executionPlane === undefined) {
      throw Object.assign(new Error('leader execution plane was not constructed'), {
        code: 'EXECUTION_PLANE_UNAVAILABLE',
      });
    }
    const ownerPrincipalKey = await loadOrCreateOwnerPrincipalKey({
      stateRoot,
      permissions: statePermissions,
    });
    assertInitializationActive();
    const ownerActorId = deriveOwnerActor(ownerPrincipalKey, 'control');
    const operationIdIssuer = await loadOrCreateOperationIdIssuer({
      stateRoot,
      permissions: statePermissions,
    });
    assertInitializationActive();
    const operationJournal = new OperationJournal({
      stateRoot,
      actorId: ownerActorId,
      externallyManagedRetention: true,
    });
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
    const portalStore = new PortalStore(stateRoot, ownerPrincipalKey, statePermissions, () => {
      if (!resources.executionPlane?.admissionOpen)
        throw Object.assign(new Error('Portal leader generation is closed'), {
          code: 'LEADER_GENERATION_CLOSED',
        });
    });
    const portalCapture = new ExistingChromeDesignCapture(stateRoot, statePermissions, portalStore);
    const portalWork = new PortalNativeWork({
      stateRoot,
      leaderGeneration: generation,
      store: portalStore,
      policy: workspacePolicy,
      permissions: statePermissions,
      designCapture: portalCapture,
      validatorModuleUrl: new URL('./portal-validation.mjs', import.meta.url).href,
      firefoxExecutable: firefox.executablePath(),
    });
    const portalRecipes = new PortalCoreLifecycle(
      new CorePreparations({ stateRoot, store: portalStore, permissions: statePermissions }),
    );
    const portal = new PortalCoordinator(
      portalStore,
      workspacePolicy,
      portalWork,
      Date.now,
      portalCapture,
      (actor, runId) => executor.cancelPendingPortalRun(actor, runId),
      portalRecipes,
    );
    const remoteDomains = new RemoteDomainConfigStore({
      stateRoot,
      permissions: statePermissions,
    });
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
    assertInitializationActive();
    await remoteDomains.recover();
    assertInitializationActive();
    const remoteImages = createRemoteImageFetcher();
    const workspaceBinding = createMcpWorkspaceBinding(workspaceStore);
    const egressConfigStore = createEgressConfigStore(stateRoot, statePermissions);
    const adminAuditStore = createAdminAuditStore({ stateRoot });
    await adminAuditStore.queryEgress(ownerActorId, { since: null, cursor: null, limit: 1 });
    await adminAuditStore.recover(await egressConfigStore.load());
    assertInitializationActive();
    const actionNonces = createActionNonceStore({ leaderGeneration: generation });
    const approvalBroker = createApprovalBroker({
      deliverPluginPrompt: async prompt => {
        const binding = approvalBroker.getBinding(prompt.approvalId);
        if (binding?.channel !== 'plugin-session' || binding.leaderGeneration !== generation)
          throw Object.assign(new Error('approval binding is unavailable'), {
            code: 'APPROVAL_CHANNEL_UNAVAILABLE',
          });
        const target = targetResolver.resolve(
          { kind: 'session', sessionId: binding.pairedSessionId },
          'required',
        );
        if (
          target.pluginGeneration !== binding.pluginGeneration ||
          target.fileExecutionKey !== binding.fileExecutionKey ||
          target.fileIdentity === null
        )
          throw Object.assign(new Error('approval target changed'), {
            code: 'APPROVAL_TARGET_MISMATCH',
          });
        const decision = await resources.relay.sendRequest(
          '$approval',
          prompt,
          Math.max(1, prompt.expiresAt - Date.now()),
          binding.pairedSessionId,
          undefined,
          undefined,
          {
            sessionId: binding.pairedSessionId,
            pluginGeneration: binding.pluginGeneration,
            fileIdentity: target.fileIdentity,
            fileIdentityHash: canonicalFileIdentityHash(target.fileIdentity),
            fileExecutionKey: binding.fileExecutionKey,
            editorType: target.editorType!,
            capabilities: target.capabilities!,
          },
        );
        await approvalBroker.settlePlugin(
          {
            pairedSessionId: binding.pairedSessionId,
            leaderGeneration: generation,
            pluginGeneration: binding.pluginGeneration,
            fileExecutionKey: binding.fileExecutionKey,
          },
          decision,
        );
      },
      deliverControlPrompt: async () => undefined,
    });
    const targetSessions: PortalCaptureAdmissionPorts['sessions'] = {
      active: () => {
        const session = resources.relay.pickActiveSession();
        return session === undefined
          ? undefined
          : {
              sessionId: session.id,
              pluginGeneration: session.pluginGeneration,
              fileIdentity: session.fileIdentity,
              editorType: session.editorType,
              capabilities: session.capabilities,
              connectedSequence: session.connectedSequence,
              healthy: session.state === 'connected' && session.socket !== null,
            };
      },
      list: () =>
        resources.relay.sessions.list().map(session => ({
          sessionId: session.id,
          pluginGeneration: session.pluginGeneration,
          fileIdentity: session.fileIdentity,
          editorType: session.editorType,
          capabilities: session.capabilities,
          connectedSequence: session.connectedSequence,
          healthy: session.state === 'connected' && session.socket !== null,
        })),
    };
    const targetResolver = new TargetResolver(targetSessions);
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
    const operationEvidenceEndpoint = createOperationEvidenceEndpoint({
      operations: operationJournal,
      receipts: evidenceReceipts,
      egress: egressManifests,
    });
    const recipeEvidenceHolds = new RecipeEvidenceHolds({
      stateRoot,
      store: portalStore,
      permissions: statePermissions,
      issuer: operationIdIssuer,
      operations: operationJournal,
      workspacePolicy,
      readEvidence: operationEvidenceEndpoint,
      hasRetainedEvidence: async (actorId, operationId) =>
        (await evidenceReceipts.get(actorId, operationId)) !== null ||
        (await egressManifests.hasFinalizer(actorId, operationId)),
    });
    const retention = new GenerationRetentionCoordinator(() =>
      recipeEvidenceHolds.withRetentionSweep(async retentionScope => {
        const { isHeld } = retentionScope;
        const now = Date.now();
        const linkedAt = (operationId: string): number | null =>
          isHeld(operationId) ? null : operationJournal.settledAt(operationId);
        await evidenceReceipts.compact({ now, linkedAt });
        await egressManifests.compact({ now, linkedAt });
        await evidenceReceipts.drainPendingArtifactCleanup(async receipt => {
          if (isHeld(receipt.operationId))
            throw Object.assign(new Error('Held evidence has a pending cleanup intent'), {
              code: 'RECIPE_HOLD_RETENTION_CONFLICT',
            });
          await removeRetainedArtifacts(receipt);
        });
        const hasLinkedEvidence = async (operationId: string): Promise<boolean> => {
          if (isHeld(operationId)) return true;
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
          const orphanState = await artifacts.discoverAndCleanupOrphans({
            workspaceId: workspace.workspaceId,
            hasLinkedEvidence,
          });
          if (orphanState.status === 'manual-cleanup') {
            log(
              `[retention] workspace ${workspace.workspaceId} evidence requires manual cleanup (${orphanState.errorCode}; scanned=${orphanState.scannedEntries}; rows=${orphanState.retainedRows}; bytes=${orphanState.retainedBytes})`,
            );
          }
          const nativeOrphanState = await nativeArtifacts.discoverAndCleanupOrphans({
            workspaceId: workspace.workspaceId,
            hasLinkedEvidence,
          });
          if (nativeOrphanState.status === 'manual-cleanup') {
            log(
              `[retention] workspace ${workspace.workspaceId} native evidence requires manual cleanup (${nativeOrphanState.errorCode}; scanned=${nativeOrphanState.scannedEntries}; rows=${nativeOrphanState.retainedRows}; bytes=${nativeOrphanState.retainedBytes})`,
            );
          }
        }
        /* eslint-enable no-await-in-loop */
        await operationJournal.purgeExpiredTombstones(now, retentionScope);
      }),
    );
    await retention.sweep();
    assertInitializationActive();
    const pluginPort = createPinnedPluginPort(resources);
    const snapshotOperations = createSnapshotOperations({
      workspacePolicy,
      plugin: pluginPort,
      productVersion: SERVER_VERSION,
      fileName: sessionId => resources.relay.sessions.get(sessionId)?.fileName ?? 'Figma document',
      getOperation: operationId => operationJournal.get(operationId),
    });
    const serviceOperations = Object.freeze({
      ...snapshotOperations,
      ...createRecipeEvidenceOperations(recipeEvidenceHolds),
      'identity.bootstrap': createIdentityOperation(pluginPort),
    });
    const documentBindings = new DocumentBindingStore(
      stateRoot,
      ownerPrincipalKey,
      statePermissions,
    );
    const sessionBindings = new Map<string, SessionDocumentBinding>();
    const captureAdmission: PortalCaptureAdmissionPorts = {
      sessions: targetSessions,
      bindingFor: createPortalBindingResolver({
        fileName: sessionId => resources.relay.sessions.get(sessionId)?.fileName,
        documents: documentBindings,
        sessions: sessionBindings,
      }),
    };
    const captureRuntime = createPortalCaptureRuntime({
      stateRoot,
      permissions: statePermissions,
      store: portalStore,
      chrome: portalCapture,
      admission: captureAdmission,
    });
    const runtimes = createBoundRuntimeRegistry(
      pluginPort,
      createServerAdapterPort(workspacePolicy, remoteImages, remoteDomains, portal, captureRuntime),
    );
    const executor = new OperationExecutor({
      issuer: operationIdIssuer,
      journal: operationJournal,
      queue: new FileExecutionQueue(),
      runtimes,
      operations: serviceOperations,
      durability: {
        egress: egressManifests,
        receipts: evidenceReceipts,
        artifacts,
        projector: withTask8ProjectionInvariants(createOperationEvidenceProjector()),
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
    resources.relay.setDocumentBindingHandler(
      createIdentityBootstrapCoordinator({
        ownerKey: ownerPrincipalKey,
        actorId: ownerActorId,
        generation,
        plugin: pluginPort,
        targets: targetResolver,
        executor,
        approvals: approvalBroker,
        issuer: operationIdIssuer,
        pairing,
        bindings: documentBindings,
        sessionBindings,
      }),
    );
    resources.executionPlane.bindInvocationService(invocationService);
    resources.executionPlane.bindAdmissionAuthority({
      operations: serviceOperations,
      resolveToolAuthority: async input => {
        if (!PORTAL_TOOL_NAMES.some(name => name === input.name)) return undefined;
        const { authority, target: selectedTarget } = await preparePortalCaptureAuthority(
          { ...input, name: input.name as PortalToolName },
          portal,
          captureAdmission,
        );
        const registration = (await workspaceStore.list()).find(
          row => row.workspaceId === authority.workspaceId,
        );
        const roots = Object.fromEntries(
          authority.roots.map((root, index) => [
            `portalSource${index}`,
            { path: root.path, overwrites: false },
          ]),
        );
        const target = authority.roots.find(root => root.role === 'target');
        return {
          workspace: {
            workspaceId: registration ? authority.workspaceId : null,
            workspaceRoot: registration?.realPath ?? null,
          },
          portalAuthority: authority,
          target: selectedTarget,
          resolvedPaths: {
            ...roots,
            ...Object.fromEntries(
              Object.entries(
                (
                  authority.nativeEnvironment as
                    | { environment?: Record<string, string> }
                    | undefined
                )?.environment ?? {},
              ).map(([name, path]) => [`portalEnvironment_${name}`, { path, overwrites: true }]),
            ),
            ...(target
              ? {
                  portalTarget: {
                    path: target.path,
                    overwrites: authority.scope === 'operational-portal',
                  },
                }
              : {}),
          },
          approvalLabel: `Portal ${authority.scope}: ${authority.targetPath}; native execution, retained environment artifacts; ${authority.executionResources?.map(resource => resource.key).join(', ') ?? authority.resource.key}; same owner account, no OS sandbox`,
        };
      },
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
    registerTask7ControlRoutes(typedControlRouter, {
      status: createControlStatusEndpoint({
        browserConnection: () => portalCapture.connectionState(),
        serverVersion: SERVER_VERSION,
        buildId: BUILD_ID,
        buildIdentityHash: BUILD_IDENTITY_HASH,
        leaderGeneration: () => generation,
        role: () => node.role,
        bindingFor: async sessionId => {
          const session = resources.relay.sessions.get(sessionId);
          const sessionBinding = sessionBindings.get(sessionId);
          if (
            session !== undefined &&
            sessionBinding !== undefined &&
            sessionBinding.pluginGeneration === session.pluginGeneration &&
            sessionBinding.fileIdentityHash === canonicalFileIdentityHash(session.fileIdentity) &&
            sessionBinding.fileName === session.fileName
          )
            return {
              bindingFileKeyHash: sessionBinding.fileKeyHash,
              bindingVerifiedBy: 'owner-session-confirmation' as const,
            };
          if (session?.fileIdentity.kind !== 'document-plugin-uuid') return null;
          const binding = await documentBindings.get(session.fileIdentity);
          return binding !== null && binding.fileName === session.fileName
            ? {
                bindingFileKeyHash: binding.fileKeyHash,
                bindingVerifiedBy: 'owner-confirmation' as const,
              }
            : null;
        },
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
                    fileIdentity: active.fileIdentity,
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
    registerTask8BNetworkRoutes(
      typedControlRouter,
      createNetworkDomainEndpoints({
        store: remoteDomains,
        nonceStore: actionNonces,
      }),
    );
    typedControlRouter.register({
      id: 'operation.evidence',
      method: 'GET',
      path: '/control/operations/:operationId/evidence',
      routeClass: 'admin',
      inputSchema: z.object({ operationId: z.string().min(1).max(384) }).strict(),
      outputSchema: OperationEvidenceViewV1Schema,
      handle: (principal, input) => operationEvidenceEndpoint(principal, input.operationId),
    });
    registerSnapshotControlRoutes(typedControlRouter, {
      capture: createSnapshotEndpoint(resources.executionPlane),
      refresh: createGroundingEndpoint(resources.executionPlane),
    });
    registerRecipeEvidenceRoutes(typedControlRouter, resources.executionPlane);
    registerIdentityRoutes(typedControlRouter, resources.relay, targetResolver);
    registerPortalEnvironmentRoutes(typedControlRouter, portalWork, actionNonces);
    registerPortalControlRoutes(
      typedControlRouter,
      createPortalProfileEndpoint({ store: portalStore, work: portalWork, nonces: actionNonces }),
      createPortalProfilePreparationEndpoint({ store: portalStore, work: portalWork }),
    );
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
        invokeService: (principal, request, subscriberSignal) =>
          resources.executionPlane!.invokeServiceFrames(
            principal,
            request,
            NO_CAPTURE_OPTIONS,
            subscriberSignal,
          ),
        cancel: (principal, request) => resources.executionPlane!.cancel(principal, request),
      },
    });
    assertInitializationActive();
    if (node.getLeader() !== resources) {
      throw Object.assign(new Error('leader generation changed during runtime initialization'), {
        code: 'LEADER_GENERATION_CLOSED',
      });
    }
    const retentionTimer = setInterval(() => {
      void retention.sweep().catch(error => {
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
        await portalCapture.close();
        await portalWork.close();
        resources.relay.setDocumentBindingHandler(null);
        clearInterval(retentionTimer);
        approvalBroker.dispose();
        await retention.close();
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
      void initializeLeaderRuntime(res).catch(error => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'LEADER_GENERATION_CLOSED'
        ) {
          return;
        }
        log(`[execution] leader runtime initialization failed (${String(error)})`);
      });
    }
  }
});

await election.start();

type ToolHandlerContext = ServerContext;
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
  requestSignal: AbortSignal,
): Promise<unknown> => {
  if (node.isLeader()) {
    const resources = node.getLeader();
    if (resources === null) {
      throw Object.assign(new Error('leader resources are unavailable'), {
        code: 'EXECUTION_PLANE_UNAVAILABLE',
      });
    }
    const runtime = await initializeLeaderRuntime(resources);
    const adapted = await runtime.mcpAdapter.fromToolCall(toolName, args, {});
    const operationId = runtime.operationIdIssuer.issue(runtime.mcpPrincipal.actorId);
    const request = Object.freeze({ ...adapted, operationId });
    const cancelRequest = Object.freeze({
      version: 1 as const,
      requestId: request.requestId,
      operationId,
    });
    let admitted = false;
    let abortRequested = requestSignal.aborted;
    let cancelFlight: Promise<void> | null = null;
    const cancel = (): void => {
      abortRequested = true;
      if (!admitted || cancelFlight !== null) return;
      cancelFlight = runtime.plane.cancel(runtime.mcpPrincipal, cancelRequest);
    };
    requestSignal.addEventListener('abort', cancel, { once: true });
    try {
      for await (const frame of runtime.plane.invokeToolFrames(
        runtime.mcpPrincipal,
        request,
        NO_CAPTURE_OPTIONS,
      )) {
        if (frame.type === 'accepted') {
          admitted = true;
          if (abortRequested) cancel();
        }
        if (frame.type === 'progress') await onProgress(frame.progress);
        if (frame.type === 'result') return frame.result;
        if (frame.type === 'error') {
          throw Object.assign(new Error(frame.error.message), frame.error);
        }
      }
    } finally {
      requestSignal.removeEventListener('abort', cancel);
      await (cancelFlight as Promise<void> | null)?.catch(() => undefined);
    }
    throw Object.assign(new Error('MCP operation ended without terminal state'), {
      code: 'MCP_TERMINAL_MISSING',
    });
  }
  const authority = await getFollowerInvocationAuthority();
  const adapted = await followerMcpAdapter.fromToolCall(toolName, args, {});
  const operationId = authority.issuer.issue(authority.actorId);
  const request = Object.freeze({ ...adapted, operationId });
  const plaintext = encodeFollowerInnerMessage({ version: 1, type: 'tool', request });
  const cancelPlaintext = encodeFollowerInnerMessage({
    version: 1,
    type: 'cancel',
    requestId: request.requestId,
    operationId,
  });
  const chunks = await followerInvocationClient.open(plaintext, requestSignal, cancelPlaintext);
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
  if (toolName === 'portal_next') return presentPortalNext(result);
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
      const result = await invokeProductionTool(
        spec.name,
        args,
        async progress => {
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
        },
        context.mcpReq.signal,
      );
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

const stdio = isDaemonMode()
  ? null
  : serveStdio(createMcpServer, {
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
  await stdio?.close().catch(() => {});
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
  ...(isDaemonMode() ? {} : { stdin: process.stdin }),
  shutdown,
  hardExit: () => {
    log('[figwright] graceful shutdown stalled — forcing exit');
    process.exit(1);
  },
});
