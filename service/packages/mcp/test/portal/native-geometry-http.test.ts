import { rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { storedChecksum, PortalPlanSchema, PortalRunSchema } from '@sfp/ir';
import {
  ALL_DATA_CLASSES,
  EgressPolicyError,
  InvocationRequestV1Schema,
  PortalNextResultSchema,
  type ActorContext,
  type DesignObservation,
  type PortalToolName,
} from '@sfp/shared';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AuthenticatedControlRouter, createControlHttpHandler } from '../../src/control/router.js';
import { LeaderGenerationExecutionPlane } from '../../src/execution/execution-plane.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { McpInvocationAdapter } from '../../src/execution/mcp-invocation-adapter.js';
import { OperationExecutor } from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { TargetResolver } from '../../src/execution/target-resolver.js';
import { resultEgressPolicyFor } from '../../src/policy/result-egress-policy.js';
import { preparePortalCaptureAuthority } from '../../src/portal/capture-admission-runtime.js';
import {
  publishNativeContourSupplement,
  StoredNativeContourAcquisition,
} from '../../src/portal/capture-native-supplement.js';
import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { type PortalNativeContourRequest } from '../../src/portal/native-contours.js';
import { readPortalNativeGeometry } from '../../src/portal/native-geometry.js';
import { PortalStore } from '../../src/portal/store.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import { createBoundRuntimeRegistry } from '../../src/tools/runtime-registry.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
const originalFetch = globalThis.fetch,
  ownedOrigins = new Set<string>();
beforeEach(() => {
  for (const method of ['request', 'get'] as const)
    vi.spyOn(http, method).mockImplementation(() => {
      throw Error('UNOWNED_HTTP_TRANSPORT_FORBIDDEN');
    });
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!ownedOrigins.has(url.origin)) throw Error('REAL_NETWORK_FORBIDDEN');
    return originalFetch(input, init);
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw Error('REAL_NETWORK_FORBIDDEN');
  });
  vi.spyOn(https, 'get').mockImplementation(() => {
    throw Error('REAL_NETWORK_FORBIDDEN');
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0)) await close();
});
const actor: ActorContext = {
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
};
const kiwi = createRequire(new URL('../../../cli/package.json', import.meta.url))(
  'kiwi-schema',
) as {
  parseSchema(s: string): unknown;
  encodeBinarySchema(s: unknown): Uint8Array;
  compileSchema(s: unknown): { encodeMessage(v: unknown): Uint8Array };
};
// Constant test codec only. Production interprets the actual incoming schema as data.
const codec = kiwi.parseSchema(`
struct Id { uint sessionID; uint localID; }
struct Point { float x; float y; }
struct Transform { float m00; float m01; float m02; float m10; float m11; float m12; }
message Parent { Id guid=1; string position=2; }
message Font { string family=1; string style=2; }
message FontMeta { Font key=1; byte[] fontDigest=2; uint fontWeight=3; }
message Glyph { uint firstCharacter=1; Point position=2; float fontSize=3; uint commandsBlob=4; }
message Text { string characters=1; }
message Derived { Point layoutSize=1; Glyph[] glyphs=2; FontMeta[] fontMetaData=3; }
message Node { Id guid=1; string type=2; Parent parentIndex=3; Point size=4; Transform transform=5; Text textData=6; Derived derivedTextData=7; Font fontName=8; float fontSize=9; }
message Blob { byte[] bytes=1; }
message Message { Node[] nodeChanges=1; Blob[] blobs=2; }
`);
const font = { family: 'Fixture', style: 'Regular' },
  matrix = [
    [1, 0, 0],
    [0, 1, 0],
  ];
const glyphPath = Buffer.concat(
  [
    { op: 0, v: [] },
    { op: 1, v: [0, 0] },
    { op: 2, v: [1, 0] },
    { op: 2, v: [1, 1] },
    { op: 0, v: [] },
  ].map(x => {
    const b = Buffer.alloc(1 + x.v.length * 4);
    b[0] = x.op;
    x.v.forEach((v, i) => b.writeFloatLE(v, 1 + i * 4));
    return b;
  }),
);
function nativeFixture(commandData: Uint8Array = glyphPath) {
  const message = {
    nodeChanges: [
      { guid: { sessionID: 1, localID: 0 }, type: 'CANVAS' },
      {
        guid: { sessionID: 1, localID: 1 },
        type: 'TEXT',
        parentIndex: { guid: { sessionID: 1, localID: 0 }, position: '!' },
        size: { x: 10, y: 12 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fontName: font,
        fontSize: 10,
        textData: { characters: 'A ' },
        derivedTextData: {
          layoutSize: { x: 10, y: 12 },
          glyphs: [
            { firstCharacter: 0, position: { x: 0, y: 10 }, fontSize: 14, commandsBlob: 0 },
            { firstCharacter: 1, position: { x: 14, y: 10 }, fontSize: 14, commandsBlob: 1 },
          ],
          fontMetaData: [{ key: font, fontDigest: new Uint8Array(20), fontWeight: 400 }],
        },
      },
    ],
    blobs: [{ bytes: glyphPath }, { bytes: Buffer.from([0]) }],
  };
  message.blobs[0]!.bytes = Buffer.from(commandData);
  const chunks = [
      deflateRawSync(kiwi.encodeBinarySchema(codec)),
      deflateRawSync(kiwi.compileSchema(codec).encodeMessage(message)),
    ],
    header = Buffer.alloc(12);
  header.write('fig-kiwi');
  header.writeUInt32LE(106, 8);
  const bytes = Buffer.concat([
    header,
    ...chunks.flatMap(c => {
      const n = Buffer.alloc(4);
      n.writeUInt32LE(c.length);
      return [n, c];
    }),
  ]);
  const fingerprint = storedChecksum('capture'),
    scopeId = JSON.stringify({ requestedNodeId: null, pageId: '1:0', scopeNodeId: '1:0' });
  const request = {
    ownerId: 'owner',
    workspaceId: 'workspace',
    planId: 'plan',
    deadlineAt: Date.now() + 60000,
    primaryCapturedAt: '2000-01-01T00:00:01.000Z',
    capture: {
      designFingerprint: fingerprint,
      source: { scopeId, fileKeyHash: storedChecksum('file'), requestedNodeId: null },
    },
  } as PortalNativeContourRequest;
  const capsule = {
    version: 1 as const,
    ownerId: 'owner',
    workspaceId: 'workspace',
    planId: 'plan',
    pageId: '1:0',
    scopeId,
    fileKeyHash: request.capture.source.fileKeyHash,
    captureFingerprint: fingerprint,
    reobservedCaptureFingerprint: fingerprint,
    capturedAt: '2000-01-01T00:00:00.000Z',
    primaryCapturedAt: request.primaryCapturedAt,
    documentHash: storedChecksum(bytes),
    documentBytes: bytes,
  };
  const observation = {
    nodes: [
      {
        id: '1:1',
        parentId: null,
        childIds: [],
        properties: {
          type: 'TEXT',
          characters: 'A ',
          width: 10,
          height: 12,
          relativeTransform: matrix,
          absoluteTransform: matrix,
          textDecoration: 'NONE',
          fontSize: 10,
          fontName: font,
          fontWeight: 400,
          textSegments: [
            { start: 0, end: 2, characters: 'A ', fontName: font, fontWeight: 400, fontSize: 10 },
          ],
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokes: [],
          effects: [],
          opacity: 1,
        },
      },
    ],
  } as unknown as DesignObservation;
  return { request, capsule, observation };
}
async function setup(publish = true, commandData: Uint8Array = glyphPath) {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const source = nativeFixture(commandData);
  const segment = {
    start: 0,
    end: 2,
    fontName: font,
    fontSize: 10,
    fontWeight: 400,
    characters: 'A ',
    textDecoration: 'NONE',
    textCase: 'ORIGINAL',
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
    textStyleId: '',
    fillStyleId: '',
    hyperlink: null,
    listOptions: { type: 'NONE' },
    indentation: 0,
    textWrapStyle: 'AUTO',
  };
  const node = {
    id: '1:1',
    name: 'Fixture text',
    type: 'TEXT',
    characters: 'A ',
    width: 10,
    height: 12,
    fontName: font,
    fontSize: 10,
    fontWeight: 400,
    textDecoration: 'NONE',
    relativeTransform: matrix,
    absoluteTransform: matrix,
    absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 12 },
    fills: segment.fills,
    strokes: [],
    effects: [],
    opacity: 1,
    getStyledTextSegments: () => [segment],
  };
  const current = await currentCaptureFixture(f, {
    nodes: [node],
    url: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=1-0',
  });
  let nativeReads = 0;
  const stored = new StoredNativeContourAcquisition(f.stateRoot, f.permissions, f.store);
  let activeStored = stored;
  const port = {
    read: async (...args: Parameters<typeof stored.read>) => {
      nativeReads++;
      return activeStored.read(...args);
    },
  };
  const capture = {
    capture: async (planId: string) => {
      const folder = join(f.stateRoot, 'portal', 'captures', planId + '-geometry');
      await rename(current.captured.assetRoot, folder);
      current.captured.assetRoot = folder;
      await writeFile(join(folder, 'document.fig'), source.capsule.documentBytes);
      if (publish)
        await publishNativeContourSupplement({
          stateRoot: f.stateRoot,
          permissions: f.permissions,
          store: f.store,
          planId,
          url: current.descriptor.source.url,
          captured: current.captured,
          exported: {
            schemaVersion: 1,
            source: 'figma-web-native-export',
            requestedUrl: current.descriptor.source.url,
            fileKey: '4IBhv1d8hEclifZQrOYxHS',
            requestedNodeId: '1:0',
            filename: 'Controlled.fig',
            path: 'document.fig',
            bytes: source.capsule.documentBytes.length,
            sha256: storedChecksum(source.capsule.documentBytes),
            capturedAt: new Date(Date.parse(current.captured.capturedAt) - 1).toISOString(),
            fullCapture: false,
            limitation: 'Controlled native codec and captured API fixture; no real Figma export',
          },
          beforeContentHash: current.captured.contentFingerprint!,
          afterContentHash: current.captured.contentFingerprint!,
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 300000,
        });
      return current.captured;
    },
  };
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    {
      apply: async () => {
        throw Error('UNUSED_APPLY');
      },
      validate: async () => {
        throw Error('UNUSED_VALIDATE');
      },
      cancel: async () => {},
    },
    Date.now,
    capture,
    undefined,
    undefined,
    port,
  );
  const issuer = operationIdIssuerFromKey(f.key),
    journal = new OperationJournal({ stateRoot: f.stateRoot, actorId: actor.actorId });
  const executor = new OperationExecutor({
    issuer,
    journal,
    queue: new FileExecutionQueue(),
    runtimes: createBoundRuntimeRegistry(
      {
        execute: async () => {
          throw Error('PLUGIN_EXECUTION_FORBIDDEN');
        },
      },
      {
        execute: async (scope, name, args, signal, _plugin, _reporter, action) =>
          coordinator.execute(name as PortalToolName, args, {
            actor: scope.actor,
            workspaceId: scope.workspace.workspaceId,
            operationId: action!.operationId,
            authority: scope.portalAuthority!,
            signal,
          }),
      },
    ),
  });
  const plane = new LeaderGenerationExecutionPlane('geometry-fixture', {
    closeAdmission: async () => {},
    installGenerationFence: async () => {},
    abortPending: async () => {},
    abortQueued: async () => {},
    markDispatchedOutcomeUnknown: async () => {},
    finalizeAndFlushEgress: async () => {},
    drainTransport: async () => true,
    forceCloseTransport: async () => {},
    destroy: async () => {},
    releasePort: async () => {},
  });
  plane.bindInvocationService(new ToolInvocationService(executor));
  let allowed: readonly (typeof ALL_DATA_CLASSES)[number][] = ALL_DATA_CLASSES;
  const admission = {
    sessions: { active: () => undefined, list: () => [] },
    bindingFor: async () => null,
  };
  const inputClasses: unknown[] = [];
  plane.bindAdmissionAuthority({
    resolveToolAuthority: async input => {
      const prepared = await preparePortalCaptureAuthority(
        { ...input, name: input.name as PortalToolName },
        coordinator,
        admission,
      );
      return {
        workspace: { workspaceId: f.workspaceId, workspaceRoot: f.workspaceRoot },
        portalAuthority: prepared.authority,
        target: prepared.target,
        resolvedPaths: {},
        approvalLabel: 'Controlled fixture only',
      };
    },
    resolveWorkspaceContext: async () => ({
      workspaceId: f.workspaceId,
      workspaceRoot: f.workspaceRoot,
    }),
    workspacePolicy: f.policy,
    targetResolver: new TargetResolver(admission.sessions),
    approval: {
      request: async () => ({
        approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
        waitForDecision: async () => ({ decision: 'approved' }),
      }),
    },
    authorizeEgress: async input => {
      inputClasses.push(input.inputClasses);
      if (input.inputClasses.some(c => !allowed.includes(c)))
        throw new EgressPolicyError('EGRESS_CLASS_NOT_ALLOWED', 'Fixture class denied');
      return { mode: 'local-trusted', consentId: null, allowedClasses: allowed };
    },
    issueOperationId: id => issuer.issue(id),
    verifyOperationId: (id, operation) => {
      issuer.verify(id, operation);
    },
  });
  let sequence = 0;
  const request = (name: string, args: unknown) => ({
    version: 1 as const,
    requestId: ('sfp_req1_' +
      Buffer.alloc(16, ++sequence).toString('base64url')) as `sfp_req1_${string}`,
    toolName: name,
    rawArgs: args,
    workspaceId: f.workspaceId,
    targetSelector: {
      kind: name === 'portal_plan' ? ('portal-source' as const) : ('none' as const),
    },
  });
  const planned = (await plane.invokeTool(
    actor,
    request('portal_plan', {
      case: 'new-blank',
      design: { source: 'chrome', url: current.descriptor.source.url },
    }),
  )) as { planId: string };
  await plane.invokeTool(actor, request('portal_start', { planId: planned.planId }));
  const plan = (await f.store.get('plans', planned.planId, PortalPlanSchema))!,
    run = (await f.store.get('runs', planned.planId, PortalRunSchema))!;
  const router = new AuthenticatedControlRouter();
  router.register({
    id: 'tool.invoke.fixture',
    method: 'POST',
    path: '/control/invoke',
    routeClass: 'tool',
    inputSchema: InvocationRequestV1Schema.extend({ toolName: z.literal('portal_next') }),
    outputSchema: PortalNextResultSchema,
    handle: async (principal, input) =>
      PortalNextResultSchema.parse(await plane.invokeTool(principal, input)),
  });
  router.freeze();
  const server = createServer(
    createControlHttpHandler({
      router,
      principalForRequest: async q => {
        if (q.headers.authorization !== 'Bearer controlled-fixture')
          throw Object.assign(Error('FIXTURE_AUTH_REQUIRED'), {
            code: 'CONTROL_AUTHENTICATION_FAILED',
          });
        return actor;
      },
    }),
  );
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('OWNED_ADDRESS_REQUIRED');
  cleanups.unshift(async () => {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  });
  const origin = `http://127.0.0.1:${address.port}`;
  ownedOrigins.add(origin);
  cleanups.unshift(async () => {
    ownedOrigins.delete(origin);
  });
  const invoke = async (name: string, args: unknown) => {
    const response = await fetch(`${origin}/control/invoke`, {
      method: 'POST',
      headers: { Authorization: 'Bearer controlled-fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify(request(name, args)),
      redirect: 'manual',
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  return {
    ...f,
    current,
    source,
    stored,
    port,
    plan,
    run,
    plane,
    coordinator,
    invoke,
    request,
    reads: () => nativeReads,
    setAllowed: (classes: typeof allowed) => {
      allowed = classes;
    },
    inputClasses,
    restartStored: () => {
      activeStored = new StoredNativeContourAcquisition(
        f.stateRoot,
        f.permissions,
        new PortalStore(f.stateRoot, f.key, f.permissions),
      );
    },
  };
}
it('requires design image and text before an opted-in native authoring lookup', () => {
  const classes = resultEgressPolicyFor('portal_next').possibleInputClasses({
    runId: `sfp_portal1_${'1'.repeat(32)}`,
    nativeGeometry: { section: 'resources', offset: 0, limit: 32 },
  });
  expect(classes).toContain('design-text');
  expect(classes).toContain('design-image');
});
it('serves actual signed stored bytes through canonical MCP and authenticated control JSON pages', async () => {
  const f = await setup(),
    request = { runId: f.run.runId, nativeGeometry: { section: 'resources', offset: 0, limit: 1 } };
  const first = await f.invoke('portal_next', request);
  expect(first.status).toBe(200);
  expect(first.body.nativeGeometry.resources).toHaveLength(1);
  const bindingHash = first.body.nativeGeometry.binding.bindingHash,
    offset = first.body.nativeGeometry.nextOffset;
  const second = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset, limit: 1, bindingHash },
  });
  expect(second.status).toBe(200);
  expect(second.body.nativeGeometry.binding.bindingHash).toBe(bindingHash);
  const adapter = new McpInvocationAdapter({
    role: 'leader',
    resolveWorkspaceId: async () => f.workspaceId,
    createRequestId: () => `sfp_req1_${Buffer.alloc(16, 99).toString('base64url')}`,
  });
  const mcp = await adapter.fromToolCall(
    'portal_next',
    { runId: f.run.runId, nativeGeometry: { section: 'nodes', offset: 0, limit: 1, bindingHash } },
    undefined,
  );
  const node = JSON.parse(JSON.stringify(await f.plane.invokeTool(actor, mcp))) as any;
  expect(node.nativeGeometry.nodes[0].characters).toBe('A ');
  expect(node.nativeGeometry.nodes[0].glyphs).toHaveLength(2);
  expect(node.nativeGeometry.binding.documentHash).toBe(
    storedChecksum(f.source.capsule.documentBytes),
  );
  expect(first.body.lease).toBe(null);
  expect(first.body.state).toBe('needs-input');
  expect(JSON.stringify(first.body.nativeGeometry)).not.toContain(f.stateRoot);
});
it('keeps default next behavior unchanged and does not invoke native lookup without opt-in', async () => {
  const f = await setup(),
    result = await f.invoke('portal_next', { runId: f.run.runId });
  expect(result.status).toBe(200);
  expect(Object.hasOwn(result.body, 'nativeGeometry')).toBe(false);
  expect(f.reads()).toBe(0);
});
it.each(['design-text', 'design-image'] as const)(
  'denies missing %s before protected native lookup over authenticated HTTP',
  async denied => {
    const f = await setup();
    f.setAllowed(ALL_DATA_CLASSES.filter(c => c !== denied));
    const result = await f.invoke('portal_next', {
      runId: f.run.runId,
      nativeGeometry: { section: 'resources', offset: 0 },
    });
    expect(result.status).not.toBe(200);
    expect(f.reads()).toBe(0);
    expect(JSON.stringify(result.body)).not.toContain('M0 0');
  },
);
it('refuses a stale binding on resource continuation and node-section entry without exposing data', async () => {
  const f = await setup();
  const wrong = 'sha256:' + 'f'.repeat(64);
  for (const page of [
    { section: 'resources', offset: 1 },
    { section: 'nodes', offset: 0 },
  ]) {
    const result = await f.invoke('portal_next', {
      runId: f.run.runId,
      nativeGeometry: { ...page, bindingHash: wrong },
    });
    expect(result.status).not.toBe(200);
    expect(result.body.nativeGeometry).toBeUndefined();
  }
});
it.each(['documentPath', 'documentBytes', 'pageId', 'nodeIds'] as const)(
  'rejects caller-controlled %s material selectors at the public schema',
  async key => {
    const f = await setup();
    const result = await f.invoke('portal_next', {
      runId: f.run.runId,
      nativeGeometry: { section: 'resources', offset: 0, [key]: 'forbidden' },
    });
    expect(result.status).not.toBe(200);
    expect(f.reads()).toBe(0);
  },
);
it('fails closed when primary capture exists but no signed native supplement is available', async () => {
  const f = await setup(false),
    result = await f.invoke('portal_next', {
      runId: f.run.runId,
      nativeGeometry: { section: 'resources', offset: 0 },
    });
  expect(result.status).not.toBe(200);
  expect(result.body.nativeGeometry).toBeUndefined();
  expect(JSON.stringify(result.body)).not.toContain(f.stateRoot);
});
it('rejects native byte tampering without trusting retained document hash metadata', async () => {
  const f = await setup();
  await writeFile(join(f.current.captured.assetRoot, 'document.fig'), 'tampered');
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(result.status).not.toBe(200);
  expect(JSON.stringify(result.body)).not.toContain(f.stateRoot);
});
it('does not renew the original run budget to disclose native geometry', async () => {
  const f = await setup();
  await f.store.update('runs', f.run.runId, PortalRunSchema, r => ({
    ...r,
    deadlineAt: Date.now() - 1,
  }));
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(result.status).not.toBe(200);
  expect(f.reads()).toBe(0);
});
it('rejects a changed signed owner through authenticated HTTP before protected native lookup', async () => {
  const f = await setup();
  await f.store.update('plans', f.plan.planId, PortalPlanSchema, p => ({
    ...p,
    ownerId: 'different-owner',
  }));
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(result.status).not.toBe(200);
  expect(f.reads()).toBe(0);
  expect(result.body.nativeGeometry).toBeUndefined();
});
it('binds every section to the current context rather than equal old geometry', async () => {
  const f = await setup();
  const first = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0, limit: 1 },
  });
  expect(first.status).toBe(200);
  await f.store.update('plans', f.plan.planId, PortalPlanSchema, p => ({
    ...p,
    contextHash: storedChecksum('changed context'),
  }));
  const next = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: {
      section: 'nodes',
      offset: 0,
      bindingHash: first.body.nativeGeometry.binding.bindingHash,
    },
  });
  expect(next.status).not.toBe(200);
});
it('reconstructs lookup from actual signed state after acquisition restart and still rejects tampered bytes', async () => {
  const f = await setup();
  const first = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0, limit: 1 },
  });
  f.restartStored();
  const next = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: {
      section: 'nodes',
      offset: 0,
      bindingHash: first.body.nativeGeometry.binding.bindingHash,
    },
  });
  expect(next.status).toBe(200);
  await writeFile(join(f.current.captured.assetRoot, 'document.fig'), 'not current bytes');
  const tampered = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(tampered.status).not.toBe(200);
});
it('never returns material after cancellation while an actual protected lookup finishes late', async () => {
  const f = await setup(),
    controller = new AbortController();
  let release: () => void = () => {},
    entered: () => void = () => {};
  const ready = new Promise<void>(r => (entered = r)),
    gate = new Promise<void>(r => (release = r));
  const port = {
    read: async (...args: Parameters<typeof f.stored.read>) => {
      const capsule = await f.stored.read(...args);
      entered();
      await gate;
      return capsule;
    },
  };
  const result = readPortalNativeGeometry(
    f.store,
    port,
    f.plan,
    f.run,
    { section: 'nodes', offset: 0, limit: 1 },
    controller.signal,
  );
  await ready;
  controller.abort();
  release();
  await expect(result).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
});
it('rechecks current signed context when protected lookup settles after a concurrent change', async () => {
  const f = await setup();
  const port = {
    read: async (...args: Parameters<typeof f.stored.read>) => {
      const capsule = await f.stored.read(...args);
      await f.store.update('plans', f.plan.planId, PortalPlanSchema, p => ({
        ...p,
        contextHash: storedChecksum('late context'),
      }));
      return capsule;
    },
  };
  await expect(
    readPortalNativeGeometry(
      f.store,
      port,
      f.plan,
      f.run,
      { section: 'nodes', offset: 0, limit: 1 },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_GEOMETRY_BINDING_CHANGED' });
});
it('rejects a genuine oversized path row rather than truncating d or returning a stalled cursor', async () => {
  const start = Buffer.alloc(9);
  start[0] = 1;
  const line = Buffer.alloc(9);
  line[0] = 2;
  const f = await setup(
    true,
    Buffer.concat([start, ...Array.from({ length: 55000 }, () => line), Buffer.from([0])]),
  );
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0, limit: 64 },
  });
  expect(result.status).not.toBe(200);
  expect(result.body.nativeGeometry).toBeUndefined();
});

it('independent: cancellation after material read remains cancelled without publication', async () => {
  const f = await setup();
  let read = false,
    changed = false;
  const originalRead = f.port.read.bind(f.port);
  f.port.read = async (...args) => {
    const capsule = await originalRead(...args);
    read = true;
    return capsule;
  };
  const originalCapture = (f.coordinator as any).assertCapture.bind(f.coordinator);
  vi.spyOn(f.coordinator as any, 'assertCapture').mockImplementation(async (plan: any) => {
    await originalCapture(plan);
    if (read && !changed) {
      changed = true;
      await f.store.update('runs', f.run.runId, PortalRunSchema, run => ({
        ...run,
        state: 'cancelled' as const,
        version: run.version + 1,
      }));
    }
  });
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(changed).toBe(true);
  expect(result.status).not.toBe(200);
  expect((await f.store.get('runs', f.run.runId, PortalRunSchema))?.state).toBe('cancelled');
});
it('independent: changed binding before lease mutation keeps the original run version', async () => {
  const f = await setup();
  const before = await f.store.get('runs', f.run.runId, PortalRunSchema);
  let read = false,
    changed = false;
  const originalRead = f.port.read.bind(f.port);
  f.port.read = async (...args) => {
    const capsule = await originalRead(...args);
    read = true;
    return capsule;
  };
  const originalCapture = (f.coordinator as any).assertCapture.bind(f.coordinator);
  vi.spyOn(f.coordinator as any, 'assertCapture').mockImplementation(async (plan: any) => {
    await originalCapture(plan);
    if (read && !changed) {
      changed = true;
      await f.store.update('plans', f.plan.planId, PortalPlanSchema, currentPlan => ({
        ...currentPlan,
        contextHash: 'sha256:' + 'd'.repeat(64),
      }));
    }
  });
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(changed).toBe(true);
  expect(result.status).not.toBe(200);
  const after = await f.store.get('runs', f.run.runId, PortalRunSchema);
  expect(after?.version).toBe(before?.version);
  expect(after?.lease).toEqual(before?.lease);
});
it('retains cancellation that occurs after pre-mutation binding checks but before the locked update', async () => {
  const f = await setup();
  const originalUpdate = f.store.update.bind(f.store);
  let changed = false;
  vi.spyOn(f.store as any, 'update').mockImplementation(async (...args: unknown[]) => {
    const [kind, id, schema, change] = args as Parameters<typeof f.store.update>;
    if (kind === 'runs' && !changed) {
      changed = true;
      await originalUpdate('runs', f.run.runId, PortalRunSchema, run => ({
        ...run,
        state: 'cancelled' as const,
        version: run.version + 1,
      }));
    }
    return originalUpdate(kind, id, schema, change);
  });
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(changed).toBe(true);
  expect(result.status).not.toBe(200);
  const retained = await f.store.get('runs', f.run.runId, PortalRunSchema);
  expect(retained?.state).toBe('cancelled');
  expect(retained?.version).toBe(f.run.version + 1);
  expect(retained?.lease).toEqual(f.run.lease);
});
it('rejects a changed run snapshot at the locked update without consuming another version or lease', async () => {
  const f = await setup();
  const originalUpdate = f.store.update.bind(f.store);
  let changed = false;
  vi.spyOn(f.store as any, 'update').mockImplementation(async (...args: unknown[]) => {
    const [kind, id, schema, change] = args as Parameters<typeof f.store.update>;
    if (kind === 'runs' && !changed) {
      changed = true;
      await originalUpdate('runs', f.run.runId, PortalRunSchema, run => ({
        ...run,
        version: run.version + 1,
      }));
    }
    return originalUpdate(kind, id, schema, change);
  });
  const result = await f.invoke('portal_next', {
    runId: f.run.runId,
    nativeGeometry: { section: 'resources', offset: 0 },
  });
  expect(changed).toBe(true);
  expect(result.status).not.toBe(200);
  const retained = await f.store.get('runs', f.run.runId, PortalRunSchema);
  expect(retained?.version).toBe(f.run.version + 1);
  expect(retained?.lease).toEqual(f.run.lease);
  expect(retained?.generationAttempts).toBe(f.run.generationAttempts);
});
