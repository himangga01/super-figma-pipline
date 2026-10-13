import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalRunSchema, storedChecksum } from '@sfp/ir';
import {
  PORTAL_RESULT_SCHEMAS,
  PortalPlanArgsSchema,
  type ActorContext,
  type PortalToolName,
} from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { OFFICIAL_FIGMA_REMOTE } from '../../src/official-figma-mcp.js';
import { resolvePortalCaptureSource } from '../../src/portal/capture-source-admission.js';
import { PortalCoordinator, type PortalWorkPort } from '../../src/portal/coordinator.js';
import {
  describePortalCapture,
  requireCurrentPortalCapture,
  verifyPortalCaptureFiles,
  portalDesignFingerprint,
  type PortalCaptureTransport,
} from '../../src/portal/design-capture.js';
import { createOfficialMcpDesignCapture } from '../../src/portal/official-mcp-capture.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { officialServerFixture, officialUrl } from '../official-mcp-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
it.each(['deadline', 'cancel'] as const)(
  'stops the first late image chunk and publishes no image after scoped %s',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    const transport = Reflect.get(f.capture, 'transport') as PortalCaptureTransport;
    const session = await transport.open(officialUrl, new AbortController().signal);
    cleanup.push(() => session.close());
    const folder = join(f.root, 'deadline-assets');
    await mkdir(folder);
    let now = Date.now();
    const deadlineAt = now + 5000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let chunks = 0;
    Object.assign(f.server.figma, {
      getImageByHash: () => ({
        getBytesAsync: async () => {
          chunks++;
          if (mode === 'deadline') now = deadlineAt + 1;
          else controller.abort(Error('official-scope-cancelled'));
          return new Uint8Array(2 * 1_048_576);
        },
      }),
    });
    const pending = session.assets(
      [
        {
          id: '1:1',
          type: 'FRAME',
          name: 'Image',
          fills: [{ type: 'IMAGE', imageHash: 'a'.repeat(40) }],
        },
      ],
      folder,
      { deadlineAt, signal: controller.signal },
    );
    await expect(pending).rejects.toThrow(
      mode === 'deadline' ? 'FIGMA_MCP_DEADLINE_EXCEEDED' : 'official-scope-cancelled',
    );
    expect(chunks).toBe(1);
    expect((await readdir(join(folder, 'assets'))).some(name => name.startsWith('1-'))).toBe(false);
  },
);
it('rejects expired final source readiness before publishing a complete capture checkpoint', async () => {
  const f = await fixture();
  const create = vi.spyOn(f.store, 'create');
  let now = Date.now(),
    identities = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  f.server.beforeCall(() => {
    const code = String(f.server.calls.at(-1)?.arguments.code);
    if (code.includes("const result = 'ready'") && ++identities === 3) now += 300_001;
  });
  await expect(
    f.capture.capture('official-final-deadline', officialUrl, new AbortController().signal),
  ).rejects.toThrow('FIGMA_MCP_DEADLINE_EXCEEDED');
  expect(identities).toBe(3);
  expect(create.mock.calls.some(([bucket]) => bucket === 'capture-progress')).toBe(false);
});
async function fixture(options: Parameters<typeof officialServerFixture>[0] = {}) {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  const server = officialServerFixture(options);
  const admitted = await resolvePortalCaptureSource(
    { source: 'official-mcp', url: officialUrl },
    { kind: 'portal-source' },
    { sessions: { active: () => undefined, list: () => [] }, bindingFor: async () => null },
  );
  if (admitted.grant.kind !== 'official-mcp') throw Error('fixture source');
  const capture = createOfficialMcpDesignCapture(
    f.stateRoot,
    f.permissions,
    f.store,
    admitted.grant,
    { fetch: server.fetch },
  );
  cleanup.push(() => capture.close());
  return { ...f, ...admitted, server, capture };
}
it('retains official-only complete coverage and exact exported bytes under the existing capture contract', async () => {
  const f = await fixture();
  const value = await f.capture.capture(
    'official-fixture',
    officialUrl,
    new AbortController().signal,
  );
  expect(value.complete).toBe(true);
  expect(value.collectorProvenance).toMatchObject({
    collector: 'official-mcp-fixed-plugin-read-v1',
    endpoint: OFFICIAL_FIGMA_REMOTE,
  });
  expect(value.collectorEvidence?.sourceBinding).toMatchObject({
    status: 'observed',
    method: 'file-key',
  });
  expect(JSON.parse(value.raw).source).toBe('official-figma-mcp');
  expect(
    value.collectorEvidence?.capabilities.every(item =>
      ['complete', 'empty'].includes(item.status),
    ),
  ).toBe(true);
  requireCurrentPortalCapture(value);
  await verifyPortalCaptureFiles(value);
  const descriptor = describePortalCapture(
    value,
    { kind: 'official-mcp', url: officialUrl },
    f.grant,
  );
  expect(descriptor.admission).toEqual(f.grant);
  expect(() => describePortalCapture(value, { kind: 'chrome', url: officialUrl })).toThrow(
    'PORTAL_CAPTURE_COLLECTOR_MISMATCH',
  );
  expect(() =>
    describePortalCapture(value, { kind: 'official-mcp', url: officialUrl }, {
      ...f.grant,
      endpoint: 'http://127.0.0.1:3845/mcp',
    } as never),
  ).toThrow('PORTAL_CAPTURE_TARGET_CHANGED');
  await writeFile(join(value.assetRoot, value.assets[0]!.path!), Buffer.from('changed'));
  await expect(verifyPortalCaptureFiles(value)).rejects.toThrow('PORTAL_CAPTURE_ASSET_CHANGED');
});
it.each([{ missingAsset: true }, { unsupportedVariables: true }])(
  'preserves incomplete asset/capability evidence and blocks generation: %j',
  async options => {
    const f = await fixture(options);
    const captured = await f.capture.capture(
      'official-partial',
      officialUrl,
      new AbortController().signal,
    );
    expect(captured.complete).toBe(false);
    expect(() => requireCurrentPortalCapture(captured)).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
  },
);
it('retains truncation instead of declaring partial official reads complete', async () => {
  const f = await fixture();
  f.server.rewrite(value =>
    value.result?.schemaVersion === 1
      ? { ...value, result: { ...value.result, valueTruncated: true } }
      : value,
  );
  const captured = await f.capture.capture(
    'official-truncated',
    officialUrl,
    new AbortController().signal,
  );
  expect(captured.complete).toBe(false);
  expect(() => requireCurrentPortalCapture(captured)).toThrow('PORTAL_CAPTURE_CURRENT_REQUIRED');
});
it('reobserves actual official data for freshness, detects content changes and never reuses an earlier capture checkpoint', async () => {
  const f = await fixture();
  const original = await f.capture.capture(
    'official-fresh',
    officialUrl,
    new AbortController().signal,
  );
  const before = f.server.calls.length;
  f.server.nodes[0]!.width = 120;
  const fresh = await f.capture.capture(
    'official-fresh',
    officialUrl,
    new AbortController().signal,
  );
  expect(f.server.calls.length).toBeGreaterThan(before);
  expect(portalDesignFingerprint(fresh)).not.toBe(portalDesignFingerprint(original));
  expect(fresh.contentFingerprint).not.toBe(original.contentFingerprint);
});
it('does not accept ongoing source mutation during ordered read reobservation', async () => {
  const f = await fixture();
  f.server.beforeCall(() => {
    f.server.nodes[0]!.width++;
  });
  await expect(
    f.capture.capture('official-changing', officialUrl, new AbortController().signal),
  ).rejects.toThrow(/BROWSER_CONTENT_CHANGED|PORTAL_CAPTURE_CONTENT_CHANGED/u);
});
it('admits only official endpoints with explicit node scope, rejects contradictory plugin targets', async () => {
  expect(
    PortalPlanArgsSchema.safeParse({
      case: 'new',
      design: { source: 'official-mcp', officialEndpoint: 'https://third-party.example/mcp' },
    }).success,
  ).toBe(false);
  expect(
    PortalPlanArgsSchema.safeParse({
      case: 'new',
      design: { source: 'chrome', officialEndpoint: OFFICIAL_FIGMA_REMOTE },
    }).success,
  ).toBe(false);
  const ports = {
    sessions: { active: () => undefined, list: () => [] },
    bindingFor: async () => null,
  };
  await expect(
    resolvePortalCaptureSource(
      { source: 'official-mcp', url: officialUrl.split('?')[0]! },
      { kind: 'portal-source' },
      ports,
    ),
  ).rejects.toThrow('FIGMA_MCP_TARGET_REQUIRED');
  await expect(
    resolvePortalCaptureSource(
      { source: 'official-mcp', url: officialUrl.split('?')[0]! + '?node-id=I1%3A2%3B3%3A4' },
      { kind: 'portal-source' },
      ports,
    ),
  ).rejects.toThrow('FIGMA_MCP_TARGET_REQUIRED');
  await expect(
    resolvePortalCaptureSource(
      { source: 'official-mcp', url: officialUrl },
      { kind: 'active' },
      ports,
    ),
  ).rejects.toMatchObject({ code: 'TARGET_FORBIDDEN' });
});
it('delivers official facts and verified assets through portal generation and candidate submission', async () => {
  const f = await fixture();
  const actor: ActorContext = {
    actorId: `actor1_${'a'.repeat(43)}`,
    authSessionId: `auth1_${'a'.repeat(43)}`,
    entryPath: 'control',
  };
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    {
      apply: vi.fn<PortalWorkPort['apply']>(),
      validate: vi.fn<PortalWorkPort['validate']>(),
      cancel: async () => {},
    },
    Date.now,
    f.capture,
    undefined,
    new PortalCoreLifecycle(new CorePreparations(f)),
  );
  let step = 0;
  const invoke = async (name: PortalToolName, args: unknown) => {
    const operationId = `official-generation-${++step}`;
    const authority = await coordinator.prepare(name, args, actor, f.workspaceId, operationId);
    authority.captureSource = f.grant;
    const result = await coordinator.execute(name, args, {
      actor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      capture: f.capture,
      signal: new AbortController().signal,
    });
    return PORTAL_RESULT_SCHEMAS[name].parse(result) as Record<string, any>;
  };
  const plan = await invoke('portal_plan', {
    case: 'new',
    design: { source: 'official-mcp', url: officialUrl },
  });
  expect(plan.design).toMatchObject({
    complete: true,
    liveVerified: true,
    capture: { source: { kind: 'official-mcp' } },
  });
  await invoke('portal_start', { planId: plan.planId });
  const next = await invoke('portal_next', { runId: plan.planId, assetIds: [0] });
  expect(next.designEvidence.nodes[0].properties).toMatchObject({ width: 100, height: 100 });
  expect(next.assets.contents[0].data).toBe(f.server.bytes.toString('base64'));
  const destination = 'public/official.png';
  await invoke('portal_submit', {
    runId: plan.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: plan.contextHash,
    blueprintHash: plan.blueprintHash,
    assets: [
      {
        path: destination,
        assetId: 0,
        action: 'create',
        baseHash: null,
        contentHash: storedChecksum(f.server.bytes),
      },
    ],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path: destination, hash: storedChecksum(f.server.bytes) }],
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const run = await f.store.get('runs', plan.planId, PortalRunSchema);
  expect(run?.files[0]).toMatchObject({
    path: destination,
    encoding: 'base64',
    contentHash: storedChecksum(f.server.bytes),
  });
  expect(
    await readFile(join(f.stateRoot, 'portal', 'runs', plan.planId + '.json'), 'utf8'),
  ).not.toContain('Bearer');
}, 30_000);
