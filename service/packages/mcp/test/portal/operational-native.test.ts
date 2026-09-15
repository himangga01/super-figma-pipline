import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PortalPlanSchema, PortalRunSchema, storedChecksum } from '@sfp/ir';
import { type ActorContext, type PortalToolName } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import { PortalCoordinator } from '../../src/portal/coordinator.js';
import { NativePortalRunner, nativeExecutableHash } from '../../src/portal/native-runner.js';
import { PortalNativeProfileSchema, PortalNativeWork } from '../../src/portal/native-work.js';
import { PortalCoreLifecycle } from '../../src/portal/recipes/core-lifecycle.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { currentCaptureFixture } from './capture-fixture.js';
import { portalFixture } from './fixtures.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const actor: ActorContext = {
  actorId: `actor1_${'a'.repeat(43)}`,
  authSessionId: `auth1_${'a'.repeat(43)}`,
  entryPath: 'control',
};
const original =
  'import {createServer} from "node:http"; export const health = () => ({healthy:true}); export const createApp = () => createServer((_req,res)=>res.end(JSON.stringify(health())));';
const app = String.raw`
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
export const health = () => ({healthy:true});
export const start = async database => {
  const db=new DatabaseSync(database);
  db.exec('CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, item TEXT NOT NULL)');
  const identities={'Bearer fixture-alice':{id:'alice',role:'customer'},'Bearer fixture-bob':{id:'bob',role:'customer'},'Bearer fixture-viewer':{id:'viewer',role:'viewer'}};
  const server=createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/health')return json(200,health());
    const identity=identities[req.headers.authorization];
    if(!identity)return json(401,{error:'unauthenticated'});
    if(req.url==='/orders'&&req.method==='POST'){
      if(identity.role!=='customer')return json(403,{error:'forbidden'});
      let text='';for await(const chunk of req)text+=chunk;
      const input=JSON.parse(text);if(typeof input.item!=='string'||!input.item.trim())return json(400,{error:'item-required'});
      const row=db.prepare('INSERT INTO orders(owner,item) VALUES (?,?)').run(identity.id,input.item);
      return json(201,{id:Number(row.lastInsertRowid),item:input.item});
    }
    if(req.url==='/orders'&&req.method==='GET')return json(200,db.prepare('SELECT id,item FROM orders WHERE owner=? ORDER BY id').all(identity.id));
    json(404,{error:'not-found'});
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{await new Promise(done=>server.close(done));db.close();}};
};
`;
const check = String.raw`
import assert from 'node:assert/strict';
import {start} from './app.mjs';
const headers={authorization:'Bearer fixture-alice','content-type':'application/json'};
let app=await start('test-orders.sqlite');
try{
  assert.deepEqual(await (await fetch(app.url+'/health')).json(),{healthy:true});
  assert.equal((await fetch(app.url+'/orders')).status,401);
  assert.equal((await fetch(app.url+'/orders',{method:'POST',headers:{...headers,authorization:'Bearer fixture-viewer'},body:JSON.stringify({item:'Chair'})})).status,403);
  assert.equal((await fetch(app.url+'/orders',{method:'POST',headers,body:JSON.stringify({item:'Chair'})})).status,201);
  assert.deepEqual(await (await fetch(app.url+'/orders',{headers:{authorization:'Bearer fixture-bob'}})).json(),[]);
}finally{await app.close();}
app=await start('test-orders.sqlite');
try{assert.deepEqual(await (await fetch(app.url+'/orders',{headers})).json(),[{id:1,item:'Chair'}]);}
finally{await app.close();}
console.log('real HTTP, authorization, user isolation, migration and SQLite restart persistence passed');
`;

it.each(['legacy', 'new-reference'] as const)(
  'validates real native API/data/auth behavior for %s while keeping missing frontend acceptance incomplete',
  async kind => {
    const value = await portalFixture();
    const source = join(value.workspaceRoot, kind === 'legacy' ? 'legacy' : 'reference');
    await mkdir(source);
    await writeFile(join(source, 'app.mjs'), original);
    await writeFile(join(source, 'package.json'), '{}');
    await writeFile(
      join(value.workspaceRoot, 'design.json'),
      JSON.stringify({
        requestedUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
        truncated: false,
        nodes: [{ id: '1:1', name: 'Orders' }],
      }),
    );
    let referenceWasOffline = false;
    class Runner extends NativePortalRunner {
      override async execute(...args: Parameters<NativePortalRunner['execute']>) {
        if (kind === 'legacy') return super.execute(...args);
        const offline = join(value.workspaceRoot, 'reference-offline');
        // Both paths are fixed children of this generated fixture workspace.
        await rename(source, offline);
        referenceWasOffline = true;
        try {
          return await super.execute(...args);
        } finally {
          await rename(offline, source);
        }
      }
    }
    const work = new PortalNativeWork({
      stateRoot: value.stateRoot,
      store: value.store,
      policy: value.policy,
      permissions: value.permissions,
      runner: new Runner(),
    });
    cleanups.push(async () => {
      await work.close();
      await value.cleanup();
    });
    const capture = await currentCaptureFixture(value, {
      nodes: [{ id: '1:1', name: 'Orders', type: 'FRAME' }],
    });
    const coordinator = new PortalCoordinator(
      value.store,
      value.policy,
      work,
      Date.now,
      {
        capture: async () => capture.captured,
      },
      undefined,
      new PortalCoreLifecycle(new CorePreparations(value)),
    );
    let operation = 0;
    const invoke = async (name: PortalToolName, args: unknown) => {
      const operationId = `operational-${++operation}`,
        authority = await coordinator.prepare(name, args, actor, value.workspaceId, operationId);
      authority.captureSource = capture.grant;
      return coordinator.execute(name, args, {
        actor,
        workspaceId: value.workspaceId,
        operationId,
        authority,
        signal: new AbortController().signal,
      }) as Promise<Record<string, any>>;
    };
    const request = {
      case: kind,
      targetPath: kind === 'legacy' ? 'legacy' : 'new-output',
      ...(kind === 'new-reference'
        ? { references: [{ workspaceId: value.workspaceId, rootPath: 'reference' }] }
        : {}),
      design: { freshness: 'allow-pinned' },
      requirements: [
        {
          id: 'orders',
          description: 'Create orders with authenticated ownership and durable data',
          layers: ['frontend', 'api', 'database', 'authentication', 'authorization'],
          required: true,
          workflow: {
            status: 'confirmed',
            roles: ['owner'],
            states: ['unauthenticated', 'authenticated', 'order-created', 'restarted'],
            routes: ['/orders'],
            apiContracts: [
              'POST /orders requires authentication; GET /orders returns only owner records',
            ],
            dataContracts: ['Orders persist in SQLite across process restarts'],
            decisions: ['frontend', 'api', 'database', 'authentication', 'authorization'].map(
              layer => ({
                layer,
                action: 'implement',
                evidence:
                  'The native fixture implements ownership and durable order storage in the submitted service and journey harness',
              }),
            ),
          },
        },
      ],
    };
    const draft = await invoke('portal_plan', request);
    const sourceReviews = draft.selectedClosure.connections.flatMap(
      (
        analysis: {
          issues: Array<{
            code: string;
            evidence?: { sourceId: string; path: string; hash: string; offset: number };
          }>;
        },
        sourceIndex: number,
      ) =>
        analysis.issues
          .filter(issue => issue.evidence)
          .map(issue => ({
            sourceId: issue.evidence!.sourceId,
            sourceIndex,
            path: issue.evidence!.path,
            hash: issue.evidence!.hash,
            offset: issue.evidence!.offset,
            issue: issue.code,
            decision: 'retain-conservative-closure',
            layers: ['backend'],
            conclusion:
              'Reviewed the exact Node HTTP health handler in this fixture and retain its complete service closure',
          })),
    );
    const planned = await invoke('portal_plan', { ...request, sourceReviews });
    expect(planned.implementationScope).toBe('operational-portal');
    await invoke('portal_start', { planId: planned.planId });
    const next = await invoke('portal_next', { runId: planned.planId });
    expect(
      next.evidence.some((row: { content: string }) => row.content.includes('healthy:true')),
    ).toBe(true);
    const files = [
      {
        path: 'app.mjs',
        content: app,
        action: kind === 'legacy' ? 'replace' : 'create',
        baseHash: kind === 'legacy' ? storedChecksum(original) : null,
      },
      { path: 'check.mjs', content: check, action: 'create', baseHash: null },
      {
        path: 'index.html',
        content: '<main><h1>Orders</h1></main>',
        action: 'create',
        baseHash: null,
      },
      ...(kind === 'new-reference'
        ? [{ path: 'package.json', content: '{}', action: 'create', baseHash: null }]
        : []),
    ];
    await invoke('portal_submit', {
      runId: planned.planId,
      leaseId: next.lease.leaseId,
      leaseEpoch: next.lease.leaseEpoch,
      contextHash: planned.contextHash,
      blueprintHash: planned.blueprintHash,
      files: files.map(file => ({ ...file, contentHash: storedChecksum(file.content) })),
      coreDeclarations: next.recipes.workItems.map(
        (item: { resultId: string; resultHash: string; id: string; kind: string }) => ({
          resultId: item.resultId,
          resultHash: item.resultHash,
          outputItemId: item.id,
          kind: item.kind,
          files: files.map(file => ({ path: file.path, hash: storedChecksum(file.content) })),
          assertionIds: [],
        }),
      ),
      finished: true,
    });
    const plan = (await value.store.get('plans', planned.planId, PortalPlanSchema))!,
      run = (await value.store.get('runs', planned.planId, PortalRunSchema))!;
    await work.registerProfile(
      await work.prepareProfile(
        PortalNativeProfileSchema.parse({
          schemaVersion: 1,
          sourceAuthorityVersion: 2,
          ownerId: actor.actorId,
          planId: plan.planId,
          contextHash: plan.contextHash,
          native: {
            schemaVersion: 1,
            sourceAuthorityVersion: 2,
            id: 'native-operational',
            executionMode: 'native-working-copy',
            environmentKind: 'disposable-test',
            sourceHash: run.candidateHash,
            closure: [
              ...files.map(file => ({ path: file.path, hash: storedChecksum(file.content) })),
              ...(kind === 'legacy' ? [{ path: 'package.json', hash: storedChecksum('{}') }] : []),
            ],
            environment: {},
            commands: [
              {
                id: 'journey',
                produces: [{ path: 'test-orders.sqlite', kind: 'generated-output' }],
                executable: process.execPath,
                executableHash: await nativeExecutableHash(process.execPath),
                args: ['check.mjs'],
                timeoutMs: 10_000,
              },
            ],
          },
          assertions: ['api', 'persistence', 'authorization', 'migration'].map(checkKind => ({
            commandId: 'journey',
            check: { id: checkKind, kind: checkKind, requirementIds: ['orders'], required: true },
          })),
        }),
      ),
    );
    const result = await invoke('portal_validate', {
      runId: run.runId,
      profileId: 'native-operational',
    });
    expect(result.state).toBe('blocked');
    expect(result.validation.runtimeVerified).toBe(true);
    for (const checkKind of ['api', 'persistence', 'authorization', 'migration'])
      expect(result.validation.checks).toContainEqual(
        expect.objectContaining({ kind: checkKind, status: 'passed' }),
      );
    expect(result.issues).toContain('MISSING_REQUIRED_CHECK:visual');
    expect(await readFile(join(source, 'app.mjs'), 'utf8')).toBe(original);
    expect(referenceWasOffline).toBe(kind === 'new-reference');
  },
  90_000,
);
