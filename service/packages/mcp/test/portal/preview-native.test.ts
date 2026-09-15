import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import pngModule from '@pdf-lib/upng';
import { PortalPlanSchema, PortalRunSchema, storedChecksum } from '@sfp/ir';
import { type ActorContext, type PortalToolName } from '@sfp/shared';
import { firefox } from 'playwright';
import { build } from 'tsdown';
import { afterEach, beforeAll, expect, it } from 'vitest';

import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { nativeExecutableHash } from '../../src/portal/native-runner.js';
import { PortalNativeWork, PortalNativeProfileSchema } from '../../src/portal/native-work.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';
const cleanups: Array<() => Promise<void>> = [];
const output = resolve('packages/mcp/.cache/task55-validator/' + randomUUID());
beforeAll(async () => {
  await build({
    cwd: resolve('packages/mcp'),
    config: false,
    entry: ['src/portal-validation.ts'],
    outDir: output,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    clean: false,
    fixedExtension: true,
    deps: { alwaysBundle: ['@sfp/shared', '@sfp/ir'] },
    logLevel: 'silent',
  });
});
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
it('executes a prepared owned worker through NativeWork and ignores forged stdout reports', async () => {
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const png =
    'encode' in pngModule
      ? pngModule
      : (pngModule as unknown as { default: typeof pngModule }).default;
  const oracle = Buffer.from(
    png.encode([new Uint8Array(100 * 100 * 4).fill(255).buffer], 100, 100, 0),
  );
  const assetRoot = join(f.root, 'assets');
  await mkdir(assetRoot);
  await writeFile(join(assetRoot, 'root.png'), oracle);
  const captured = await currentCaptureFixture(f, {
    assetRoot,
    assets: [
      {
        query: { kind: 'png', nodeId: '1:1' },
        status: 'captured',
        path: 'root.png',
        sha256: storedChecksum(oracle),
        bytes: oracle.length,
      },
    ],
  });
  const validator = join(output, 'portal-validation.mjs');
  const work = new PortalNativeWork({
    ...f,
    validatorModuleUrl: pathToFileURL(validator).href,
    firefoxExecutable: firefox.executablePath(),
  });
  cleanups.unshift(() => work.close());
  const coordinator = new PortalCoordinator(
    f.store,
    f.policy,
    work,
    Date.now,
    {
      capture: async () => captured.captured,
    },
    undefined,
    new PortalCoreLifecycle(new CorePreparations(f)),
  );
  let op = 0;
  const invoke = async (name: PortalToolName, args: unknown) => {
    const operationId = 'preview-native-' + ++op;
    const authority = await coordinator.prepare(name, args, actor, f.workspaceId, operationId);
    authority.captureSource = captured.grant;
    return coordinator.execute(name, args, {
      actor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    }) as Promise<any>;
  };
  const planned = await invoke('portal_plan', {
    case: 'new-blank',
    targetPath: 'output',
    design: { freshness: 'allow-pinned' },
  });
  await invoke('portal_start', { planId: planned.planId });
  const next = await invoke('portal_next', { runId: planned.planId });
  const content =
    '<html lang="en"><head><title>Owned preview</title></head><body style="margin:0;background:white"><main data-sfp-root="1:1" style="width:100px;height:100px"></main></body></html>';
  await invoke('portal_submit', {
    runId: planned.planId,
    leaseId: next.lease.leaseId,
    leaseEpoch: next.lease.leaseEpoch,
    contextHash: planned.contextHash,
    blueprintHash: planned.blueprintHash,
    files: [
      {
        path: 'index.html',
        action: 'create',
        baseHash: null,
        content,
        contentHash: storedChecksum(content),
      },
    ],
    coreDeclarations: next.recipes.workItems.map(
      (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
        resultId: item.resultId,
        resultHash: item.resultHash,
        outputItemId: item.id,
        kind: item.kind,
        files: [{ path: 'index.html', hash: storedChecksum(content) }],
        assertionIds: [],
      }),
    ),
    finished: true,
  });
  const plan = (await f.store.get('plans', planned.planId, PortalPlanSchema))!,
    run = (await f.store.get('runs', planned.planId, PortalRunSchema))!;
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
  const address = probe.address();
  if (!address || typeof address === 'string') throw Error('ADDRESS');
  const port = address.port;
  await new Promise<void>(done => probe.close(() => done()));
  const server = `const {createServer}=require('node:http'),{readFileSync}=require('node:fs'); if(process.env.SFP_NATIVE_PREVIEW_TOKEN||process.env.SFP_NATIVE_PREVIEW_PIPE)throw Error('SECRET_LEAK'); console.log('SFP_PREVIEW_REPORT:'+JSON.stringify({browser:'firefox',screens:[{passed:true}]})); createServer((q,s)=>{s.setHeader('content-type','text/html');s.end(readFileSync('index.html'))}).listen(${port},'127.0.0.1')`;
  const profile = PortalNativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    ownerId: plan.ownerId,
    planId: plan.planId,
    contextHash: plan.contextHash,
    native: {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'owned-preview',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: run.candidateHash,
      closure: [{ path: 'index.html', hash: storedChecksum(content) }],
      environment: {},
      commands: [
        {
          id: 'visual',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['-e', server],
          timeoutMs: 90000,
          preview: {
            protocol: 'sfp-owned-preview-v1',
            spec: {
              root: '.',
              baseUrl: `http://127.0.0.1:${port}`,
              screens: [
                {
                  id: 'root',
                  rootNodeId: '1:1',
                  state: 'source:1:1',
                  path: '/',
                  viewport: { width: 100, height: 100 },
                  oraclePath: 'root.png',
                  oracleHash: storedChecksum(oracle),
                  assertionIds: [],
                },
              ],
            },
          },
        },
      ],
    },
    assertions: ['visual', 'interaction', 'accessibility'].map(kind => ({
      commandId: 'visual',
      check: { id: kind, kind, requirementIds: plan.requirements.map(r => r.id), required: true },
    })),
  });
  const prepared = await work.prepareProfile(profile);
  expect(prepared.native.commands[0]?.preview?.bootstrapHash).toMatch(/^sha256:/u);
  expect(prepared.observationManifest?.screens).toHaveLength(1);
  await work.registerProfile(prepared);
  const result = await invoke('portal_validate', { runId: run.runId, profileId: 'owned-preview' });
  expect(result.validation.runtimeVerified).toBe(true);
  expect(result.validation.observations.executedObservationIds).toEqual(['root']);
  expect(result.validation.checks.find((value: any) => value.id === 'visual').status).toBe(
    'passed',
  );
  expect(result.state).toBe('blocked'); // This bounded fixture deliberately omits build and typecheck acceptance.
  const forged = {
    ...profile,
    native: {
      ...profile.native,
      id: 'forged-preview',
      commands: [
        {
          id: 'visual',
          executable: process.execPath,
          executableHash: profile.native.commands[0]!.executableHash,
          args: [
            '-e',
            'console.log(' +
              JSON.stringify(
                'SFP_PREVIEW_REPORT:' + JSON.stringify({ browser: 'firefox', passed: true }),
              ) +
              ')',
          ],
          timeoutMs: 5000,
        },
      ],
    },
  };
  await work.registerProfile(await work.prepareProfile(PortalNativeProfileSchema.parse(forged)));
  const rejected = await invoke('portal_validate', {
    runId: run.runId,
    profileId: 'forged-preview',
  });
  expect(rejected.validation.runtimeVerified).toBe(false);
  expect(rejected.validation.observations).toBeUndefined();
  expect(rejected.validation.checks.find((check: any) => check.id === 'visual').status).toBe(
    'blocked',
  );
  const unrelated = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(content);
  });
  await new Promise<void>(done => unrelated.listen(port, '127.0.0.1', done));
  cleanups.unshift(async () => {
    await new Promise<void>(done => unrelated.close(() => done()));
  });
  const wrong = PortalNativeProfileSchema.parse({
    ...profile,
    native: {
      ...profile.native,
      id: 'unrelated-listener',
      commands: profile.native.commands.map(command =>
        Object.assign({}, command, { args: ['-e', 'setInterval(()=>{},1000)'] }),
      ),
    },
  });
  await work.registerProfile(await work.prepareProfile(wrong));
  const unowned = await invoke('portal_validate', {
    runId: run.runId,
    profileId: 'unrelated-listener',
  });
  expect(unowned.validation.runtimeVerified).toBe(false);
  expect(unowned.validation.observations).toBeUndefined();
}, 180000);
