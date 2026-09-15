import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, stat, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalFileIdentityHash,
  type ActorContext,
  type RuntimeExecutionScope,
  type ApprovalPromptV1,
  type ToolApprovalHandle,
} from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { createOperationEvidenceEndpoint } from '../../mcp/src/control/operation-evidence-endpoint.js';
import { AuthenticatedControlRouter } from '../../mcp/src/control/router.js';
import { hashPluginGeneration } from '../../mcp/src/control/status-endpoint.js';
import { createToolCallEndpoint } from '../../mcp/src/control/tool-call-endpoint.js';
import { EgressManifestStore } from '../../mcp/src/execution/egress-manifest-store.js';
import { LeaderGenerationExecutionPlane } from '../../mcp/src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../mcp/src/execution/file-queue.js';
import { createOperationEvidenceProjector } from '../../mcp/src/execution/operation-evidence-projector.js';
import { OperationEvidenceReceiptStore } from '../../mcp/src/execution/operation-evidence-receipt-store.js';
import { OperationExecutor } from '../../mcp/src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../mcp/src/execution/operation-id.js';
import { OperationJournal } from '../../mcp/src/execution/operation-journal.js';
import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';
import { OperationEvidenceArtifactStore } from '../../mcp/src/fs/operation-evidence-artifact-store.js';
import { createWorkspaceConfigStore } from '../../mcp/src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../mcp/src/fs/workspace-policy.js';
import { createApprovalBroker } from '../../mcp/src/policy/approval-broker.js';
import { registerRecipeEvidenceRoutes } from '../../mcp/src/portal/recipes/evidence-control.js';
import { RecipeEvidenceHolds } from '../../mcp/src/portal/recipes/evidence-hold.js';
import { createRecipeEvidenceOperations } from '../../mcp/src/portal/recipes/evidence-operations.js';
import { PortalStore } from '../../mcp/src/portal/store.js';
import { createFollowerAuth } from '../../mcp/src/security/follower-auth.js';
import {
  deriveControlAuthSession,
  deriveOwnerActor,
} from '../../mcp/src/security/principal-derivation.js';
import { ToolInvocationService } from '../../mcp/src/tool-invocation-service.js';
import { createBoundRuntimeRegistry } from '../../mcp/src/tools/runtime-registry.js';
import {
  CatalogRecipeSchema,
  catalogSnapshotHash,
  runOwnerCatalogRecipe,
} from '../src/catalog-recipe.js';
import { ControlClient } from '../src/control-client.js';
import {
  ControlRecipeClient,
  type RecipeEvidenceRetentionPort,
} from '../src/control-recipe-client.js';
import { RecipeCheckpointStore } from '../src/recipe-checkpoint.js';
import { composeCloneAdjacent, composeRenameNodes } from '../src/recipe-compositions.js';
import {
  ExecutableRecipeSchema,
  recipeHash,
  recipeProducedSubtreeHash,
  type RecipeSourceNode,
} from '../src/recipe-plan.js';
import { runOwnerRecipe } from '../src/recipe-runner.js';

// OS ACL enforcement is covered separately; the HTTP fixture uses real persisted rotating credentials.
vi.mock('../../mcp/src/security/state-permissions.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  createStatePermissions: (stateRoot: string) => ({
    stateRoot,
    verifySecure: async () => {},
    ensureSecure: async () => {},
  }),
}));
vi.setConfig({ testTimeout: 20000 });
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of close.splice(0)) await stop();
});
const rawHash = (domain: string, value: string) =>
  `sha256:${createHash('sha256').update(domain).update('\0').update(value).digest('hex')}` as const;
const node = (id: string, name: string, parentId: string | null): RecipeSourceNode => ({
  id,
  name,
  type: 'FRAME',
  parentId,
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  children: [],
});
async function variableCatalogFixture() {
  type Collection = {
    id: string;
    key: string;
    name: string;
    defaultModeId: string;
    modes: Array<{ modeId: string; name: string }>;
    variableIds: string[];
    renameMode: (id: string, name: string) => void;
    addMode: (name: string) => string;
    remove: () => void;
  };
  type VariableRow = {
    id: string;
    key: string;
    name: string;
    resolvedType: string;
    variableCollectionId: string;
    valuesByMode: Record<string, unknown>;
    codeSyntax: Record<string, string>;
    setValueForMode: (id: string, value: unknown) => void;
    remove: () => void;
  };
  const collections: Collection[] = [],
    variables: VariableRow[] = [];
  let sequence = 0;
  const context = {
    variables: {
      createVariableCollection: (name: string) => {
        const id = `Collection:${++sequence}`,
          defaultModeId = `Mode:${sequence}`;
        const collection: Collection = {
          id,
          key: 'key-' + id,
          name,
          defaultModeId,
          modes: [{ modeId: defaultModeId, name: 'Mode 1' }],
          variableIds: [],
          renameMode: (modeId, label) => {
            collection.modes.find(row => row.modeId === modeId)!.name = label;
          },
          addMode: label => {
            const modeId = `Mode:${++sequence}`;
            collection.modes.push({ modeId, name: label });
            return modeId;
          },
          remove: () => {
            collections.splice(collections.indexOf(collection), 1);
          },
        };
        collections.push(collection);
        return collection;
      },
      createVariable: (name: string, collection: Collection, resolvedType: string) => {
        const id = `Variable:${++sequence}`;
        const row: VariableRow = {
          id,
          key: 'key-' + id,
          name,
          resolvedType,
          variableCollectionId: collection.id,
          valuesByMode: {},
          codeSyntax: {},
          setValueForMode: (modeId, value) => {
            if (!collection.modes.some(mode => mode.modeId === modeId))
              throw new Error('Unknown mode');
            row.valuesByMode[modeId] = structuredClone(value);
          },
          remove: () => {
            variables.splice(variables.indexOf(row), 1);
            collection.variableIds.splice(collection.variableIds.indexOf(id), 1);
          },
        };
        variables.push(row);
        collection.variableIds.push(id);
        return row;
      },
      getVariableCollectionByIdAsync: async (id: string) =>
        collections.find(row => row.id === id) ?? null,
      getVariableByIdAsync: async (id: string) => variables.find(row => row.id === id) ?? null,
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
    },
  };
  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {};
  for (const [tool, module, exported] of [
    ['get_variable_defs', 'get-variable-defs', 'createGetVariableDefsHandler'],
    [
      'create_variable_collection',
      'create-variable-collection',
      'createCreateVariableCollectionHandler',
    ],
    ['create_variable', 'create-variable', 'createCreateVariableHandler'],
    ['add_variable_mode', 'add-variable-mode', 'createAddVariableModeHandler'],
  ]) {
    const loaded = await vi.importActual<
      Record<string, (context: unknown) => (params: unknown) => Promise<unknown>>
    >(`../../plugin/src/handlers/${module}.js`);
    handlers[tool!] = loaded[exported!]!(context);
  }
  return { handlers, collections, variables, context };
}
const fixture = async (
  realRetention = false,
  additionalHandlers: Record<string, (params: unknown) => Promise<unknown>> = {},
) => {
  // Load the actual handler without importing the plugin's ambient Figma types into CLI compilation.
  const { createSetPositionHandler } = await vi.importActual<{
    createSetPositionHandler: (context: unknown) => (params: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/set-position.js');
  const { createCloneNodeHandler } = await vi.importActual<{
    createCloneNodeHandler: (context: unknown) => (params: unknown) => Promise<unknown>;
  }>('../../plugin/src/handlers/clone-node.js');
  const root = await mkdtemp(join(tmpdir(), 'sfp-recipe-'));
  const stateRoot = join(root, 'state'),
    workspaceRoot = join(root, 'workspace'),
    checkpointsRoot = join(root, 'checkpoints');
  await Promise.all([stateRoot, workspaceRoot, checkpointsRoot].map(path => mkdir(path)));
  const auth = await createFollowerAuth({
    stateRoot,
    permissions: { stateRoot, verifySecure: async () => {}, ensureSecure: async () => {} },
  });
  const credentials = await auth.rotate();
  const key = randomBytes(32),
    actorId = deriveOwnerActor(key, 'control');
  const principal: ActorContext = {
    actorId,
    authSessionId: deriveControlAuthSession(key, credentials.controlToken, credentials.generation),
    entryPath: 'control',
  };
  const permissions = {
    stateRoot,
    ensureSecure: async () => {},
    verifySecure: async () => {},
    inspectSecure: async (path: string) => {
      const metadata = await stat(path, { bigint: true });
      return {
        canonicalPath: await realpath(path),
        key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
        directory: metadata.isDirectory(),
        file: metadata.isFile(),
      };
    },
  };
  const workspaces = createWorkspaceConfigStore(
    stateRoot,
    { hasUnsettled: async () => false },
    permissions,
  );
  const registered = await workspaces.add(actorId, workspaceRoot),
    workspaceId = registered.workspaceId;
  const issuer = operationIdIssuerFromKey(randomBytes(32)),
    journal = new OperationJournal({ stateRoot, actorId });
  const egress = new EgressManifestStore({ stateRoot, actorId }),
    receipts = new OperationEvidenceReceiptStore({ stateRoot, actorId });
  await Promise.all([journal.recover(), egress.recover(Date.now()), receipts.recover()]);
  const documents = new Map([['1:1', node('1:1', 'Source', null)]]),
    calls: string[] = [];
  const sessionId = 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration = 'plugin-1',
    fileIdentity = { kind: 'figma-file-key' as const, value: 'fixture-file' };
  const fileHash = canonicalFileIdentityHash(fileIdentity);
  let mutateAfter: (tool: string) => Promise<void> = async () => {};
  let nextNodeId = 2;
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async (scope, tool, args) => {
          expect(scope.actor).toEqual(principal);
          expect(scope.target.sessionId).toBe(sessionId);
          calls.push(tool);
          const input = args as {
            nodeId?: string;
            name?: string;
            parentId?: string;
            x?: number;
            y?: number;
            width?: number;
            height?: number;
          };
          let result: unknown;
          if (additionalHandlers[tool]) result = await additionalHandlers[tool](args);
          else if (tool === 'get_node') result = { node: documents.get(input.nodeId!) ?? null };
          else if (tool === 'create_frame') {
            const created = node(`1:${nextNodeId++}`, input.name ?? 'Frame', input.parentId!);
            for (const field of ['x', 'y', 'width', 'height'] as const)
              if (input[field] !== undefined) created[field] = input[field];
            documents.set(created.id, created);
            documents.get(input.parentId!)!.children!.push(created);
            result = { ok: true, nodeId: created.id, name: created.name, type: created.type };
          } else if (tool === 'clone_node') {
            const original = documents.get(input.nodeId!)!,
              parent = documents.get(original.parentId!)!;
            const duplicate = (source: RecipeSourceNode, parentId: string): RecipeSourceNode => {
              const copy = {
                ...structuredClone(source),
                id: `1:${nextNodeId++}`,
                parentId,
                children: [] as RecipeSourceNode[],
              };
              copy.children = (source.children ?? []).map(child => duplicate(child, copy.id));
              documents.set(copy.id, copy);
              return copy;
            };
            const handler = createCloneNodeHandler({
              getNodeByIdAsync: async (id: string) =>
                id === original.id
                  ? {
                      ...original,
                      parent: {
                        appendChild: (copy: RecipeSourceNode) => parent.children!.push(copy),
                      },
                      clone: () => duplicate(original, parent.id),
                    }
                  : null,
              currentPage: {
                appendChild: () => {
                  throw new Error('UNEXPECTED_CLONE_PARENT_FALLBACK');
                },
              },
            });
            result = await handler(args);
          } else if (tool === 'set_position') {
            const handler = createSetPositionHandler({
              getNodeByIdAsync: async (id: string) => {
                const target = documents.get(id);
                if (!target) return null;
                return new Proxy(target, {
                  get(object, property) {
                    if (property === 'parent') {
                      const parent = object.parentId ? documents.get(object.parentId) : null;
                      return parent
                        ? {
                            layoutMode:
                              (parent.layout as { mode?: string } | undefined)?.mode ?? 'NONE',
                          }
                        : null;
                    }
                    return Reflect.get(object, property);
                  },
                });
              },
            });
            result = await handler(args);
          } else if (tool === 'rename_node') {
            documents.get(input.nodeId!)!.name = input.name!;
            result = { ok: true, nodeId: input.nodeId };
          } else throw new Error('FIXTURE_TOOL_UNSUPPORTED');
          await mutateAfter(tool);
          return structuredClone(result);
        },
      },
      {
        execute: async () => {
          throw new Error('Unexpected server adapter');
        },
      },
    ),
    durability: {
      egress,
      receipts,
      artifacts: new OperationEvidenceArtifactStore({
        workspacePolicy: createWorkspacePolicy(workspaces),
        atomicFiles: new AtomicFileStore(),
      }),
      projector: createOperationEvidenceProjector(),
      nativeArtifacts: {
        createNativeManifest: async () => {
          throw new Error('Unexpected native manifest');
        },
      },
    },
  });
  const scope = (requestId: `sfp_req1_${string}`): RuntimeExecutionScope => ({
    requestId,
    leaderGeneration: credentials.generation,
    actor: principal,
    workspace: { workspaceId, workspaceRoot },
    target: { sessionId, pluginGeneration, fileIdentity, fileExecutionKey: 'figma:fixture-file' },
    consent: {
      mode: 'local-trusted',
      consentId: null,
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
    },
  });
  const prompts = new Map<
    string,
    { prompt: ApprovalPromptV1; handle: ToolApprovalHandle; resolve: (value: boolean) => void }
  >();
  let deny = false;
  const endpoint = createToolCallEndpoint({
    invokeTool: async (actor, request, options) => {
      expect(actor).toEqual(principal);
      if (
        request.targetSelector?.kind !== 'session' ||
        request.targetSelector.sessionId !== sessionId ||
        request.workspaceId !== workspaceId
      )
        throw new Error('TARGET_SCOPE_INVALID');
      const current = scope(request.requestId as `sfp_req1_${string}`);
      if (request.toolName === 'get_node')
        return executor.invokeTool(
          current,
          request.toolName,
          request.rawArgs,
          request.operationId,
          options,
        );
      const approvalId = `sfp_ap1_${randomBytes(16).toString('base64url')}` as const;
      const handle = await executor.beginToolApproval(
        current,
        request.toolName,
        request.rawArgs,
        request.operationId!,
        approvalId,
        options,
      );
      const decision = new Promise<boolean>(resolve => {
        prompts.set(approvalId, {
          handle,
          resolve,
          prompt: {
            version: 1,
            type: 'approval.prompt',
            approvalId,
            operationId: request.operationId!,
            operationKind: 'tool',
            operationName: request.toolName,
            channel: 'owner-control-session',
            promptHash: recipeHash(request),
            effectSummary: ['design-write'],
            target: { fileIdentityHash: fileHash, label: 'Fixture', targetCount: 1 },
            issuedAt: Date.now(),
            expiresAt: Date.now() + 60000,
          },
        });
      });
      if (await decision) return executor.resumeApprovedTool(handle, current);
      await executor.rejectToolApproval(handle, 'APPROVAL_DENIED');
      throw new Error('APPROVAL_DENIED');
    },
  });
  const evidence = createOperationEvidenceEndpoint({ operations: journal, receipts, egress });
  const recipeRouter = new AuthenticatedControlRouter();
  const serverHolds = realRetention
    ? new RecipeEvidenceHolds({
        stateRoot,
        store: new PortalStore(stateRoot, key, permissions),
        permissions,
        issuer,
        operations: journal,
        workspacePolicy: createWorkspacePolicy(workspaces),
        readEvidence: evidence,
        hasRetainedEvidence: async (id, operationId) =>
          (await receipts.get(id, operationId)) !== null ||
          (await egress.hasFinalizer(id, operationId)),
      })
    : null;
  if (serverHolds) {
    const operations = createRecipeEvidenceOperations(serverHolds);
    const serviceExecutor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: {},
      operations,
      durability: {
        egress,
        receipts,
        artifacts: {
          createNew: async () => {
            throw Error('UNEXPECTED_SERVICE_CAPTURE');
          },
        },
        projector: createOperationEvidenceProjector(),
        nativeArtifacts: {
          createNativeManifest: async () => {
            throw Error('UNEXPECTED_NATIVE_MANIFEST');
          },
        },
      },
    });
    const plane = new LeaderGenerationExecutionPlane(credentials.generation, {
      closeAdmission: () => {},
      installGenerationFence: () => {},
      abortPending: async () => {},
      abortQueued: async () => {},
      markDispatchedOutcomeUnknown: async () => {},
      finalizeAndFlushEgress: async () => {},
      drainTransport: async () => true,
      forceCloseTransport: () => {},
      destroy: () => {},
      releasePort: () => {},
    });
    const broker = createApprovalBroker({
      deliverPluginPrompt: async () => {
        throw Error('WRONG_APPROVAL_CHANNEL');
      },
      deliverControlPrompt: async prompt => {
        await broker.settleControl(
          principal,
          {
            version: 1,
            type: 'approval.decision',
            approvalId: prompt.approvalId,
            operationId: prompt.operationId,
            promptHash: prompt.promptHash,
            decision: 'approved',
          },
          credentials.generation,
        );
      },
    });
    plane.bindInvocationService(new ToolInvocationService(serviceExecutor));
    plane.bindAdmissionAuthority({
      operations,
      workspacePolicy: createWorkspacePolicy(workspaces),
      resolveWorkspaceContext: async id => ({
        workspaceId: id,
        workspaceRoot: id === workspaceId ? workspaceRoot : null,
      }),
      targetResolver: {
        resolve: () => ({
          sessionId: null,
          pluginGeneration: null,
          fileIdentity: null,
          fileExecutionKey: null,
          editorType: null,
          capabilities: null,
        }),
      },
      approval: broker,
      authorizeEgress: async () => ({
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      }),
      issueOperationId: id => issuer.issue(id),
      verifyOperationId: (id, operationId) => {
        issuer.verify(id, operationId);
      },
    });
    registerRecipeEvidenceRoutes(recipeRouter, plane);
  }
  recipeRouter.freeze();
  let corrupt: (value: unknown) => unknown = value => value;
  const server = createServer((request, response) => {
    void (async () => {
      if (
        !(await auth.authorizeControl(
          request.headers.authorization,
          request.headers['x-sfp-leader-generation'] as string,
        ))
      ) {
        response.writeHead(401);
        response.end('{"code":"AUTH_FAILED"}');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString(),
        body = text ? JSON.parse(text) : undefined,
        path = request.url!;
      let result: unknown;
      if (path === '/control/status')
        result = {
          schemaVersion: 1,
          serverVersion: 'fixture',
          buildId: 1,
          buildIdentityHash: null,
          leaderGeneration: credentials.generation,
          role: 'leader',
          pairedPluginCount: 1,
          activePlugin: {
            sessionId,
            fileName: 'Fixture',
            pageName: 'Page',
            fileIdentityKind: 'figma-file-key',
            fileIdentityHash: fileHash,
            pluginVersion: 'fixture',
            pluginGenerationHash: hashPluginGeneration(pluginGeneration),
            editorType: 'figma',
            capabilities: [],
          },
        };
      else if (path.startsWith('/control/recipes/evidence/'))
        result = await recipeRouter.dispatch(
          { method: 'POST', path, input: body },
          principal,
          new AbortController().signal,
        );
      else if (path === '/control/workspaces') result = await workspaces.list();
      else if (path === '/control/operations' && request.method === 'POST')
        result = { operationId: issuer.issue(actorId, Date.now()) };
      else if (path === '/control/tools/call') result = await endpoint(principal, body);
      else if (path === '/control/approvals') result = [...prompts.values()].map(row => row.prompt);
      else if (path.startsWith('/control/approvals/')) {
        const id = decodeURIComponent(path.split('/').at(-1)!);
        const pending = prompts.get(id)!;
        expect(body.operationId).toBe(pending.prompt.operationId);
        expect(body.promptHash).toBe(pending.prompt.promptHash);
        prompts.delete(id);
        pending.resolve(!deny && body.decision === 'approved');
        result = {};
      } else if (path.endsWith('/cancel')) {
        await executor.cancel(principal, body);
        result = {};
      } else if (path.endsWith('/evidence'))
        result = corrupt(await evidence(principal, decodeURIComponent(path.split('/').at(-2)!)));
      else if (path.startsWith('/control/operations/')) {
        result = journal.get(decodeURIComponent(path.split('/').at(-1)!));
        if (!result) {
          response.writeHead(404);
          response.end('{"code":"OPERATION_NOT_FOUND"}');
          return;
        }
      } else throw new Error('Unexpected path');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
    })().catch(error => {
      response.writeHead(409);
      response.end(JSON.stringify({ code: (error as { code?: string }).code ?? 'FIXTURE_FAILED' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  close.push(async () => {
    for (const pending of prompts.values()) pending.resolve(false);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port');
  const port = address.port;
  const control = new ControlClient({ stateRoot, port }),
    credentialHash = await control.credentialHash();
  const holds = new Map<string, string>();
  const retention: RecipeEvidenceRetentionPort = {
    ensureHeld: async binding => {
      const hash = recipeHash(binding),
        previous = holds.get(binding.operationId);
      if (previous && previous !== hash) throw new Error('HOLD_CONFLICT');
      holds.set(binding.operationId, hash);
    },
    verifyHeld: async binding => {
      if (holds.get(binding.operationId) !== recipeHash(binding)) throw new Error('HOLD_MISSING');
    },
  };
  const targetBindingHash = recipeHash(
    {
      targetSessionIdHash: rawHash('sfp-target-session-v1', sessionId),
      fileIdentityHash: fileHash,
      fileExecutionKeyHash: rawHash('sfp-file-execution-key-v1', 'figma:fixture-file'),
      pluginGeneration,
      leaderGeneration: credentials.generation,
    },
    'sfp-entry-target-binding-v1',
  );
  const plan = ExecutableRecipeSchema.parse({
    version: 1,
    execution: 'concrete-owner-client',
    intentId: 'fixture-recipe',
    authority: {
      actorId,
      authSessionId: principal.authSessionId,
      workspaceId,
      sessionId,
      leaderGeneration: credentials.generation,
      pluginGenerationHash: hashPluginGeneration(pluginGeneration),
      fileIdentityHash: fileHash,
      targetBindingHash,
      credentialHash,
    },
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: '1:1' },
        expect: { subtreeHash: recipeHash(documents.get('1:1')) },
      },
      {
        id: 'create',
        tool: 'create_frame',
        postimageHash: recipeProducedSubtreeHash(node('1:2', 'Frame', '1:1')),
        args: { parentId: '1:1', name: 'Frame', width: 100, height: 80 },
      },
      {
        id: 'rename',
        tool: 'rename_node',
        args: { name: 'Finished' },
        bindings: [{ argument: 'nodeId', result: { stepId: 'create', field: 'nodeId' } }],
      },
      {
        id: 'after',
        tool: 'get_node',
        args: {},
        bindings: [{ argument: 'nodeId', result: { stepId: 'create', field: 'nodeId' } }],
        expect: { name: 'Finished', type: 'FRAME', parentId: '1:1' },
      },
    ],
  });
  return {
    root,
    stateRoot,
    workspaceRoot,
    plan,
    calls,
    documents,
    journal,
    receipts,
    holds,
    serverHolds,
    auth,
    credentials,
    port,
    credentialHash,
    client: new ControlRecipeClient(
      { stateRoot, port, credentialHash },
      realRetention ? undefined : retention,
    ),
    checkpoints: new RecipeCheckpointStore(checkpointsRoot),
    setDeny: () => {
      deny = true;
    },
    setCorrupt: (fn: typeof corrupt) => {
      corrupt = fn;
    },
    setAfter: (fn: typeof mutateAfter) => {
      mutateAfter = fn;
    },
  };
};

it('runs concrete canonical writes with real HTTP credentials, approval, durable receipts, retained bytes and final readback', async () => {
  const f = await fixture();
  const result = await runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true });
  expect(result.status).toBe('succeeded');
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
  expect(f.documents.get('1:1')!.children!.map(child => child.name)).toEqual(['Finished']);
  const firstReads = f.calls.filter(tool => tool === 'get_node').length;
  expect(result.currentReadback?.operationId).toMatch(/^sfp_op1_/u);
  expect(f.documents.get('1:2')?.name).toBe('Finished');
  expect(f.holds.size).toBeGreaterThan(4);
  const resumed = await runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true });
  expect(resumed.currentReadback?.operationId).not.toBe(result.currentReadback?.operationId);
  expect(f.calls.filter(tool => tool === 'get_node').length).toBeGreaterThan(firstReads);
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
});
it('defaults to blocking without server retention before any dispatch', async () => {
  const f = await fixture();
  const client = new ControlRecipeClient({
    stateRoot: f.stateRoot,
    port: f.port,
    credentialHash: f.credentialHash,
  });
  await expect(runOwnerRecipe(f.plan, client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_RETENTION_UNAVAILABLE',
  );
  expect(f.calls).toEqual([]);
});

it('uses the real default server retention protocol for original and fresh internal read intents', async () => {
  const f = await fixture(true);
  const result = await runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true });
  expect(result.status).toBe('succeeded');
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
  expect(
    await f.serverHolds!.withRetentionSweep(async scope =>
      scope.isHeld(result.currentReadback!.operationId),
    ),
  ).toBe(true);
  const resumed = await runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true });
  expect(resumed.status).toBe('succeeded');
  expect(resumed.currentReadback!.operationId).not.toBe(result.currentReadback!.operationId);
  expect(
    await f.serverHolds!.withRetentionSweep(async scope =>
      scope.isHeld(resumed.currentReadback!.operationId),
    ),
  ).toBe(true);
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
}, 60000);
it('denied primitive preserves earlier outcomes and cannot feed a dependent write', async () => {
  const f = await fixture();
  f.setDeny();
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_OPERATION_PRE_EGRESS_REJECTED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('recovers the original completed write after checkpoint failure without duplicate mutation', async () => {
  const f = await fixture();
  const original = f.checkpoints.settled.bind(f.checkpoints);
  let failed = false;
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (plan, index, intent, hash) => {
    if (index === 1 && !failed) {
      failed = true;
      throw new Error('SIMULATED_CLIENT_CRASH');
    }
    return original(plan, index, intent, hash);
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'SIMULATED_CLIENT_CRASH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
  await expect(
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool === 'create_frame')).toHaveLength(1);
});
it('wrong owner and source preimage cannot dispatch writes', async () => {
  const f = await fixture();
  f.plan.authority.actorId = `actor1_${'Z'.repeat(43)}`;
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_OPERATION_BINDING_MISMATCH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('rejects absent captured result proof', async () => {
  const f = await fixture();
  f.setCorrupt(value => {
    const view = structuredClone(value) as { receipt: { resultArtifact: unknown } };
    view.receipt.resultArtifact = null;
    return view;
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_RECEIPT_INVALID',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('final readback failure remains a failure after successful command receipts', async () => {
  const f = await fixture();
  Object.assign(f.plan.steps.at(-1)!, { expect: { name: 'Wrong' } });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_READBACK_FAILED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
});
it('cancellation stops dependent dispatch and persists partial outcomes', async () => {
  const f = await fixture(),
    controller = new AbortController();
  const original = f.checkpoints.settled.bind(f.checkpoints);
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await original(...args);
    if (args[1] === 1) controller.abort();
  });
  await expect(
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true, signal: controller.signal }),
  ).resolves.toMatchObject({ status: 'cancelled', completedSteps: ['before', 'create'] });
  await expect(
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'cancelled' });
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
});
it('credential rotation in the same generation is fenced before HTTP dispatch', async () => {
  const f = await fixture();
  await writeFile(
    join(f.stateRoot, 'leader-auth.json'),
    JSON.stringify({ ...f.credentials, controlToken: randomBytes(32).toString('base64url') }),
  );
  await expect(f.client.control.issueOperationId()).rejects.toThrow('CONTROL_CREDENTIAL_CHANGED');
  expect(f.calls).toEqual([]);
});
it('rejects planned catalog skeletons, forward references, arbitrary fields, and unobserved writes', async () => {
  const f = await fixture();
  expect(ExecutableRecipeSchema.safeParse({ execution: 'planned', steps: [] }).success).toBe(false);
  const plan = structuredClone(f.plan);
  plan.steps[2]!.bindings[0]!.result.stepId = 'after';
  expect(ExecutableRecipeSchema.safeParse(plan).success).toBe(false);
  const noRead = structuredClone(f.plan);
  noRead.steps.pop();
  expect(ExecutableRecipeSchema.safeParse(noRead).success).toBe(false);
  expect(ExecutableRecipeSchema.safeParse({ ...f.plan, callback: 'process.exit()' }).success).toBe(
    false,
  );
});

it('changed source preimage fails before the first write', async () => {
  const f = await fixture();
  f.documents.get('1:1')!.name = 'Externally changed';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_READBACK_FAILED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('wrong pinned file and session fail before dispatch', async () => {
  const f = await fixture();
  f.plan.authority.sessionId = 'another-session';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_AUTHORITY_CHANGED',
  );
  expect(f.calls).toEqual([]);
});
it('corrupt result bytes never supply a dependent create ID', async () => {
  const f = await fixture(),
    recover = f.client.recover.bind(f.client);
  let corrupted = false;
  vi.spyOn(f.client, 'recover').mockImplementation(async (plan, step, intent) => {
    if (step.id === 'create' && !corrupted) {
      corrupted = true;
      const receipt = await f.receipts.get(
        plan.authority.actorId as `actor1_${string}`,
        intent.operationId,
      );
      await writeFile(join(f.workspaceRoot, receipt!.resultArtifact!.artifactRelativePath), '{}');
    }
    return recover(plan, step, intent);
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_ARTIFACT_HASH_MISMATCH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
});
it('wrong receipt input binding fails despite a serverVerified flag', async () => {
  const f = await fixture();
  f.setCorrupt(value => {
    const copy = structuredClone(value) as { receipt: { argsHash: string } };
    copy.receipt.argsHash = recipeHash('other');
    return copy;
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_RECEIPT_INVALID',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('unknown pre-dispatch outcome resumes inspection only and never allocates another write', async () => {
  const f = await fixture(),
    invoke = f.client.invoke.bind(f.client);
  let interrupted = false;
  vi.spyOn(f.client, 'invoke').mockImplementation(async (plan, step, intent, options) => {
    if (step.id === 'create' && !interrupted) {
      interrupted = true;
      throw new Error('CRASH_BEFORE_DISPATCH');
    }
    return invoke(plan, step, intent, options);
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'OPERATION_NOT_FOUND',
  );
  const original = await f.checkpoints.intent(f.plan, 1);
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'OPERATION_NOT_FOUND',
  );
  expect((await f.checkpoints.intent(f.plan, 1))?.operationId).toBe(original?.operationId);
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('concurrent same-intent clients cannot duplicate writes', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
  ]);
  expect(
    results.some(result => result.status === 'fulfilled' && result.value.status === 'succeeded'),
  ).toBe(true);
  expect(f.calls.filter(tool => tool === 'create_frame')).toHaveLength(1);
  expect(f.calls.filter(tool => tool === 'rename_node')).toHaveLength(1);
});
it('same intent ID cannot silently adopt changed concrete arguments', async () => {
  const f = await fixture();
  await f.checkpoints.initialize(f.plan);
  const changed = structuredClone(f.plan);
  (changed.steps[1]!.args as { name: string }).name = 'Another';
  await expect(runOwnerRecipe(changed, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_INTENT_CHANGED',
  );
  expect(f.calls).toEqual([]);
});
it('loss of a held result prevents subsequent dependent mutation', async () => {
  const f = await fixture(),
    settled = f.checkpoints.settled.bind(f.checkpoints);
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 1) f.holds.clear();
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'HOLD_MISSING',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
});
it('active cancellation persists its original operation for reconciliation and stops future writes', async () => {
  const f = await fixture(),
    controller = new AbortController();
  f.setAfter(async tool => {
    if (tool === 'create_frame') {
      controller.abort();
      await new Promise<void>(resolve => setTimeout(resolve, 30));
    }
  });
  await runOwnerRecipe(f.plan, f.client, f.checkpoints, {
    approve: true,
    signal: controller.signal,
  }).then(
    result => expect(result.status).toBe('cancelled'),
    error =>
      expect((error as Error).message).toMatch(
        /RECIPE_OPERATION_|OPERATION_EVIDENCE_UNSETTLED|RECIPE_CANCELLED/u,
      ),
  );
  expect(await f.checkpoints.cancelled(f.plan)).toBe(true);
  expect((await f.checkpoints.intent(f.plan, 1))?.operationId).toMatch(/^sfp_op1_/u);
  await expect(
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'cancelled' });
  expect(f.calls.filter(tool => tool === 'rename_node')).toHaveLength(0);
});
it('wrong input target binding cannot proceed past source inspection', async () => {
  const f = await fixture();
  f.plan.authority.targetBindingHash = recipeHash('another-target');
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_OPERATION_BINDING_MISMATCH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('wrong authentication session cannot proceed past source inspection', async () => {
  const f = await fixture();
  f.plan.authority.authSessionId = `auth1_${'Y'.repeat(43)}`;
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_OPERATION_BINDING_MISMATCH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('rejects changed source after the initial checkpoint in the same execution', async () => {
  const f = await fixture(),
    settled = f.checkpoints.settled.bind(f.checkpoints);
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 0) f.documents.get('1:1')!.name = 'External edit';
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_SOURCE_CHANGED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
  expect(f.calls.filter(tool => tool === 'get_node').length).toBeGreaterThan(1);
});
it('rejects changed source after restarting from the initial checkpoint', async () => {
  const f = await fixture(),
    settled = f.checkpoints.settled.bind(f.checkpoints);
  let crashed = false;
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 0 && !crashed) {
      crashed = true;
      throw new Error('CRASH_AFTER_SOURCE');
    }
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'CRASH_AFTER_SOURCE',
  );
  f.documents.get('1:1')!.name = 'External edit';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_SOURCE_CHANGED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('completed resume requires new canonical readback and rejects stale final state', async () => {
  const f = await fixture();
  const first = await runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true });
  const before = f.calls.length;
  f.documents.get('1:2')!.name = 'Changed after completion';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_SOURCE_CHANGED',
  );
  expect(first.currentReadback?.operationId).toMatch(/^sfp_op1_/u);
  expect(f.calls.length).toBeGreaterThan(before);
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
});
it('an unrelated source preimage cannot authorize a literal target outside its subtree', async () => {
  const f = await fixture();
  f.documents.set('2:9', node('2:9', 'Unobserved', null));
  const plan = ExecutableRecipeSchema.parse({
    ...f.plan,
    steps: [
      f.plan.steps[0],
      { id: 'rename-unobserved', tool: 'rename_node', args: { nodeId: '2:9', name: 'Overwrite' } },
      { id: 'after', tool: 'get_node', args: { nodeId: '2:9' }, expect: { name: 'Overwrite' } },
    ],
  });
  f.documents.get('2:9')!.name = 'External edit';
  await expect(runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE',
  );
  expect(f.documents.get('2:9')!.name).toBe('External edit');
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('creation under an unobserved literal parent is rejected before an effect', async () => {
  const f = await fixture();
  f.documents.set('2:9', node('2:9', 'Unobserved', null));
  (f.plan.steps[1]!.args as { parentId: string }).parentId = '2:9';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('a covered literal child is guarded against between-step edits', async () => {
  const f = await fixture(),
    child = node('2:9', 'Observed', '1:1');
  f.documents.set(child.id, child);
  f.documents.get('1:1')!.children!.push(child);
  const plan = ExecutableRecipeSchema.parse({
    ...f.plan,
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: '1:1' },
        expect: { subtreeHash: recipeHash(f.documents.get('1:1')) },
      },
      { id: 'rename-child', tool: 'rename_node', args: { nodeId: '2:9', name: 'Requested' } },
      { id: 'after', tool: 'get_node', args: { nodeId: '2:9' }, expect: { name: 'Requested' } },
    ],
  });
  const settled = f.checkpoints.settled.bind(f.checkpoints);
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 0) child.name = 'External edit';
  });
  await expect(runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_SOURCE_CHANGED',
  );
  expect(child.name).toBe('External edit');
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('a planned literal child rename changes the exact guarded tree and completes', async () => {
  const f = await fixture(),
    child = node('2:9', 'Observed', '1:1');
  f.documents.set(child.id, child);
  f.documents.get('1:1')!.children!.push(child);
  const plan = ExecutableRecipeSchema.parse({
    ...f.plan,
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: '1:1' },
        expect: { subtreeHash: recipeHash(f.documents.get('1:1')) },
      },
      { id: 'rename-child', tool: 'rename_node', args: { nodeId: '2:9', name: 'Requested' } },
      { id: 'after', tool: 'get_node', args: { nodeId: '2:9' }, expect: { name: 'Requested' } },
    ],
  });
  await expect(
    runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.documents.get('1:1')!.children![0]!.name).toBe('Requested');
  expect(f.documents.get('1:1')!.name).toBe('Source');
});
it('crash after a committed create before its post-read reconciles only the planned new subtree', async () => {
  const f = await fixture(),
    recover = f.client.recover.bind(f.client);
  let crashed = false;
  vi.spyOn(f.client, 'recover').mockImplementation(async (...args) => {
    const result = await recover(...args);
    if (args[1].id === 'create' && !crashed) {
      crashed = true;
      throw new Error('CRASH_BEFORE_POST_READ');
    }
    return result;
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'CRASH_BEFORE_POST_READ',
  );
  expect(await f.checkpoints.postIntent(f.plan, 1)).toBeNull();
  expect(f.documents.get('1:1')!.children).toHaveLength(1);
  await expect(
    runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool === 'create_frame')).toHaveLength(1);
  expect(f.documents.get('1:1')!.children![0]!.name).toBe('Finished');
});
it('a changed source after a committed create stops the next mutation on resume', async () => {
  const f = await fixture(),
    settled = f.checkpoints.settled.bind(f.checkpoints);
  let crashed = false;
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 1 && !crashed) {
      crashed = true;
      throw new Error('CRASH_AFTER_CREATE');
    }
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'CRASH_AFTER_CREATE',
  );
  f.documents.get('1:1')!.name = 'Concurrent edit';
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_SOURCE_CHANGED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
});
it('an unexpected produced value cannot become its own approved postimage', async () => {
  const f = await fixture();
  f.setAfter(async tool => {
    if (tool === 'create_frame') f.documents.get('1:2')!.width = 777;
  });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_PRODUCED_POSTIMAGE_MISMATCH',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame']);
});
it('actual canonical clone handler appends after all siblings and recovery never duplicates it', async () => {
  const f = await fixture(),
    original = node('1:9', 'Original', '1:1'),
    child = node('1:8', 'Child', '1:9'),
    sibling = node('1:7', 'Following sibling', '1:1');
  original.children!.push(child);
  f.documents.set(original.id, original);
  f.documents.set(child.id, child);
  f.documents.set(sibling.id, sibling);
  f.documents.get('1:1')!.children!.push(original, sibling);
  const before = structuredClone(original);
  const plan = ExecutableRecipeSchema.parse({
    ...f.plan,
    steps: [
      {
        id: 'before',
        tool: 'get_node',
        args: { nodeId: '1:1' },
        expect: { subtreeHash: recipeHash(f.documents.get('1:1')) },
      },
      {
        id: 'clone',
        tool: 'clone_node',
        args: { nodeId: '1:9' },
        postimageHash: recipeProducedSubtreeHash(original),
      },
      {
        id: 'after',
        tool: 'get_node',
        args: {},
        bindings: [{ argument: 'nodeId', result: { stepId: 'clone', field: 'nodeId' } }],
        expect: { name: 'Original', parentId: '1:1' },
      },
    ],
  });
  const settled = f.checkpoints.settled.bind(f.checkpoints);
  let crashed = false;
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 1 && !crashed) {
      crashed = true;
      throw new Error('CRASH_AFTER_CANONICAL_CLONE');
    }
  });
  await expect(runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'CRASH_AFTER_CANONICAL_CLONE',
  );
  const children = f.documents.get('1:1')!.children!;
  expect(children.map(row => row.id)).toEqual(['1:9', '1:7', '1:2']);
  expect(children[2]!.children![0]!.parentId).toBe('1:2');
  expect(original).toEqual(before);
  await expect(
    runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool === 'clone_node')).toHaveLength(1);
  expect(children.map(row => row.id)).toEqual(['1:9', '1:7', '1:2']);
});
it('known auto-layout parent transitions are rejected before creating an unmodeled own change', async () => {
  const f = await fixture();
  f.documents.get('1:1')!.layout = {
    mode: 'HORIZONTAL',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
  };
  Object.assign(f.plan.steps[0]!, { expect: { subtreeHash: recipeHash(f.documents.get('1:1')) } });
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_PARENT_TRANSITION_UNSUPPORTED',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
});
it('a later unobserved literal mutation invalidates coverage before earlier effects', async () => {
  const f = await fixture();
  f.documents.set('2:9', node('2:9', 'Outside', null));
  const plan = ExecutableRecipeSchema.parse({
    ...f.plan,
    steps: [
      f.plan.steps[0],
      f.plan.steps[1],
      { id: 'outside', tool: 'rename_node', args: { nodeId: '2:9', name: 'Changed' } },
      {
        id: 'created-after',
        tool: 'get_node',
        args: {},
        bindings: [{ argument: 'nodeId', result: { stepId: 'create', field: 'nodeId' } }],
        expect: { name: 'Frame' },
      },
      {
        id: 'outside-after',
        tool: 'get_node',
        args: { nodeId: '2:9' },
        expect: { name: 'Changed' },
      },
    ],
  });
  await expect(runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    'RECIPE_TARGET_OUTSIDE_GUARDED_SOURCE',
  );
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([]);
  expect(f.documents.get('1:1')!.children).toEqual([]);
});
it('produced postimages normalize structural IDs without dropping layout or value differences', () => {
  const original = node('1:1', 'Node', null),
    child = node('1:2', 'Child', '1:1');
  original.children!.push(child);
  const remapped = structuredClone(original);
  remapped.id = '3:1';
  remapped.children![0]!.id = '3:2';
  remapped.children![0]!.parentId = '3:1';
  expect(recipeProducedSubtreeHash(remapped)).toBe(recipeProducedSubtreeHash(original));
  remapped.children![0]!.width = 777;
  expect(recipeProducedSubtreeHash(remapped)).not.toBe(recipeProducedSubtreeHash(original));
  remapped.children![0]!.parentId = '9:9';
  expect(() => recipeProducedSubtreeHash(remapped)).toThrow('RECIPE_SOURCE_TREE_INVALID');
});
it('created postimage is mandatory before any effect and cannot be synthesized from a later read', async () => {
  const f = await fixture(),
    plan = structuredClone(f.plan);
  delete (plan.steps[1] as unknown as Record<string, unknown>).postimageHash;
  expect(ExecutableRecipeSchema.safeParse(plan).success).toBe(false);
  expect(f.calls).toEqual([]);
});
it.each(['later rename', 'x'.repeat(161), '가'.repeat(256)])(
  'retains valid opaque step identifier %s unchanged through the real default protocol',
  async stepId => {
    const f = await fixture(true);
    f.plan.steps[2]!.id = stepId;
    expect(ExecutableRecipeSchema.safeParse(f.plan).success).toBe(true);
    await expect(
      runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(f.calls.filter(tool => tool !== 'get_node')).toEqual(['create_frame', 'rename_node']);
    expect((await f.checkpoints.intent(f.plan, 2))?.stepId).toBe(stepId);
    const stored = JSON.parse(
      await readFile(join(f.stateRoot, 'portal/recipe-holds/index.json'), 'utf8'),
    ) as { payload: { rows: Array<{ state: string; binding: { stepId: string } }> } };
    expect(
      stored.payload.rows.some(row => row.state === 'held' && row.binding.stepId === stepId),
    ).toBe(true);
    expect(f.documents.get('1:2')!.name).toBe('Finished');
  },
  60000,
);
it('rejects a later identifier beyond the shared limit before any primitive effect', async () => {
  const f = await fixture(true);
  f.plan.steps[2]!.id = '가'.repeat(257);
  expect(ExecutableRecipeSchema.safeParse(f.plan).success).toBe(false);
  await expect(runOwnerRecipe(f.plan, f.client, f.checkpoints, { approve: true })).rejects.toThrow(
    /Too big|too_big/u,
  );
  expect(f.calls).toEqual([]);
  expect(f.documents.get('1:1')!.children).toEqual([]);
});
it('executes a compiled adjacent clone through actual handlers and retains its original unchanged', async () => {
  const f = await fixture(true),
    original = node('1:5', 'Original', '1:1'),
    sibling = node('1:7', 'Sibling', '1:1');
  original.x = 10;
  original.y = 20;
  f.documents.set(original.id, original);
  f.documents.set(sibling.id, sibling);
  f.documents.get('1:1')!.children!.push(original, sibling);
  const before = structuredClone(original),
    plan = composeCloneAdjacent({
      authority: f.plan.authority,
      intentId: 'compiled-adjacent-clone',
      source: f.documents.get('1:1')!,
      nodeId: original.id,
      direction: 'right',
      gap: 0,
      name: 'Copy',
    });
  await expect(
    runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool !== 'get_node')).toEqual([
    'clone_node',
    'set_position',
    'rename_node',
  ]);
  expect(f.documents.get('1:2')).toMatchObject({ name: 'Copy', x: 110, y: 20, parentId: '1:1' });
  expect(original).toEqual(before);
  await expect(
    runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool === 'clone_node')).toHaveLength(1);
}, 60000);
it('executes an exact rename composition while preserving slash hierarchy and other node values', async () => {
  const f = await fixture(),
    one = node('1:5', 'Old', '1:1'),
    two = node('1:6', 'Other', '1:1');
  f.documents.set(one.id, one);
  f.documents.set(two.id, two);
  f.documents.get('1:1')!.children!.push(one, two);
  const plan = composeRenameNodes({
    authority: f.plan.authority,
    intentId: 'compiled-rename',
    source: f.documents.get('1:1')!,
    names: [
      { nodeId: '1:5', name: 'Button/Primary' },
      { nodeId: '1:6', name: 'Button/Secondary' },
    ],
  });
  await expect(
    runOwnerRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(one).toMatchObject({ name: 'Button/Primary', width: 100, height: 80 });
  expect(two.name).toBe('Button/Secondary');
});

it('retained catalog execution uses actual modes and values, recovers the original create, and freshly checks completed resume', async () => {
  const catalog = await variableCatalogFixture(),
    f = await fixture(true, catalog.handlers);
  const plan = CatalogRecipeSchema.parse({
    version: 1,
    kind: 'variable-catalog',
    intentId: 'catalog-create',
    authority: f.plan.authority,
    sourceHash: catalogSnapshotHash({ collections: [], variables: [] }),
    steps: [
      {
        id: 'collection',
        tool: 'create_variable_collection',
        args: { name: 'Tokens', defaultModeName: 'Light' },
      },
      {
        id: 'zero',
        tool: 'create_variable',
        args: {
          name: 'spacing/zero',
          resolvedType: 'FLOAT',
          collectionId: { stepId: 'collection', field: 'collectionId' },
          initialValues: [{ modeId: { stepId: 'collection', field: 'defaultModeId' }, value: 0 }],
        },
      },
    ],
  });
  const recover = f.client.recover.bind(f.client);
  let crashed = false;
  vi.spyOn(f.client, 'recover').mockImplementation(async (...args) => {
    const actual = await recover(...args);
    if (args[2].stepId === 'collection' && !crashed) {
      crashed = true;
      throw new Error('CATALOG_CRASH_AFTER_EFFECT');
    }
    return actual;
  });
  await expect(
    runOwnerCatalogRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).rejects.toThrow('CATALOG_CRASH_AFTER_EFFECT');
  expect(catalog.collections).toHaveLength(1);
  await expect(
    runOwnerCatalogRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded', completedSteps: ['collection', 'zero'] });
  expect(f.calls.filter(tool => tool === 'create_variable_collection')).toHaveLength(1);
  expect(catalog.variables[0]!.valuesByMode).toEqual({
    [catalog.collections[0]!.defaultModeId]: 0,
  });
  await expect(
    runOwnerCatalogRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).resolves.toMatchObject({ status: 'succeeded' });
  expect(f.calls.filter(tool => tool === 'create_variable')).toHaveLength(1);
  catalog.variables[0]!.valuesByMode[catalog.collections[0]!.defaultModeId] = 7;
  await expect(
    runOwnerCatalogRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).rejects.toThrow('RECIPE_CATALOG_SOURCE_CHANGED');
}, 120000);

it('retained catalog guards block an unrelated edit after a committed collection before the next variable', async () => {
  const catalog = await variableCatalogFixture();
  const existing = catalog.context.variables.createVariableCollection('Existing');
  const before = await catalog.handlers.get_variable_defs!({});
  const f = await fixture(true, catalog.handlers);
  const plan = CatalogRecipeSchema.parse({
    version: 1,
    kind: 'variable-catalog',
    intentId: 'catalog-stale',
    authority: f.plan.authority,
    sourceHash: catalogSnapshotHash(before),
    steps: [
      {
        id: 'collection',
        tool: 'create_variable_collection',
        args: { name: 'Tokens', defaultModeName: 'Light' },
      },
      {
        id: 'value',
        tool: 'create_variable',
        args: {
          name: 'space',
          resolvedType: 'FLOAT',
          collectionId: { stepId: 'collection', field: 'collectionId' },
          initialValues: [{ modeId: { stepId: 'collection', field: 'defaultModeId' }, value: 1 }],
        },
      },
    ],
  });
  const settled = f.checkpoints.settled.bind(f.checkpoints);
  vi.spyOn(f.checkpoints, 'settled').mockImplementation(async (...args) => {
    await settled(...args);
    if (args[1] === 0) existing.name = 'External edit';
  });
  await expect(
    runOwnerCatalogRecipe(plan, f.client, f.checkpoints, { approve: true }),
  ).rejects.toThrow('RECIPE_CATALOG_SOURCE_CHANGED');
  expect(f.calls).not.toContain('create_variable');
  expect(existing.name).toBe('External edit');
}, 60000);
