import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { ChromeSessionOwner } from '../../cli/src/browser-session.js';
import type { ControlClient } from '../../cli/src/control-client.js';
import {
  serviceFeatures,
  parseServiceFeature,
  executeServiceFeature,
} from '../../cli/src/service-functions.js';
import { serviceTools, parseServiceTool } from '../../cli/src/service-tool-catalog.js';
import { createServiceJobRuntime } from '../src/control.js';
import { ServiceJobs } from '../src/service-jobs.js';
import { PortalStore } from '../src/store.js';
const library = {
  serviceTools,
  parseServiceTool,
  serviceFeatures,
  parseServiceFeature,
  executeServiceFeature,
};
const input = {
  type: 'tool' as const,
  name: 'get_pages',
  args: {},
  workspaceId: null,
  targetSelector: { kind: 'active' as const },
};
function fixture() {
  const invoke = vi.fn<ControlClient['invoke']>(async () => ({ ok: true }));
  const issueOperationId = vi.fn<ControlClient['issueOperationId']>(async () => 'issued-original');
  const client = {
    invoke,
    issueOperationId,
    decide: async () => {},
    request: async () => ({}),
  } as unknown as ControlClient;
  return {
    invoke,
    issueOperationId,
    runtime: createServiceJobRuntime(client, library, async () => []),
  };
}

it('injects one portal Chrome owner and the original signal into public feature dispatch', async () => {
  const owner = new ChromeSessionOwner();
  const execute = vi.fn<typeof executeServiceFeature>(async () => ({ status: 'owned-fixture' }));
  const runtime = createServiceJobRuntime(
    {} as ControlClient,
    { ...library, executeServiceFeature: execute },
    async () => [],
    owner,
  );
  const signal = new AbortController().signal;
  const deadlineAt = Date.now() + 1000;
  try {
    await runtime.execute(
      {
        type: 'feature',
        name: 'chrome.tabs',
        args: { url: 'https://www.figma.com/design/ownerControlFixtureKey?node-id=0-1' },
        workspaceId: null,
        targetSelector: { kind: 'none' },
      },
      { signal, deadlineAt, beforeInvoke: async () => {}, emit: () => {} },
    );
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      'chrome.tabs',
      expect.anything(),
      expect.objectContaining({ chromeSessionOwner: owner, signal, deadlineAt }),
    );
  } finally {
    await owner.close();
  }
});
it.each(['missing', 'identity-mismatch', 'access-denied'] as const)(
  'rejects %s workspaces before executing a function',
  async availability => {
    const runtime = createServiceJobRuntime({} as ControlClient, library, async () => [
      {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        realPath: 'C:/owned-fixture',
        availability,
      },
    ]);
    await expect(
      runtime.prepare({ ...input, workspaceId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toThrow('available workspace');
  },
);
it('advertises every registered tool schema and fixed feature descriptor', async () => {
  const { runtime } = fixture();
  const catalog = await runtime.catalog();
  expect(catalog.tools).toEqual(serviceTools());
  expect(catalog.features).toEqual(serviceFeatures());
  expect(new Set(catalog.tools.map(row => row.name)).size).toBe(catalog.tools.length);
  expect(new Set(catalog.features.map(row => row.name)).size).toBe(catalog.features.length);
  for (const action of ['status', 'configure', 'start', 'cancel', 'logout', 'refresh']) {
    const descriptor = catalog.features.find(row => row.name === `figma-mcp.auth.${action}`);
    expect(descriptor?.kind).toBe(action === 'status' ? 'read' : 'write');
    expect(descriptor?.confirmationRequired).toBe(action !== 'status');
    expect(descriptor?.inputSchema).toBeDefined();
  }
  expect(catalog.tools.find(row => row.name === 'get_pages')?.inputSchema).toEqual(
    serviceTools().find(row => row.name === 'get_pages')!.inputSchema,
  );
});
it('keeps exactly the two pure local feature jobs readable without widening mutating local tools', async () => {
  const { runtime } = fixture();
  for (const name of ['tools.list', 'figma-mcp.config']) {
    const parsed = await runtime.prepare({
      ...input,
      type: 'feature',
      name,
      args: {},
      targetSelector: { kind: 'none' },
    });
    expect(parsed.descriptor.kind).toBe('local');
    expect(parsed.readOnly).toBe(true);
  }
  const cancelled = await runtime.prepare({
    ...input,
    name: 'portal_cancel',
    args: { runId: 'sfp_portal1_11111111111111111111111111111111' },
    targetSelector: { kind: 'none' },
  });
  expect(cancelled.readOnly).toBe(false);
  expect(cancelled.recovery).toBe(true);
});
it.each(['tool', 'feature'] as const)(
  'classifies only local doctor diagnostics as read-only through %s',
  async type => {
    const { runtime } = fixture();
    for (const roundTrip of [undefined, false, true]) {
      const args = roundTrip === undefined ? {} : { roundTrip };
      const prepared = await runtime.prepare({
        ...input,
        type,
        name: type === 'tool' ? 'doctor' : 'tools.call',
        args: type === 'tool' ? args : { name: 'doctor', args },
        targetSelector: { kind: roundTrip === true ? 'active' : 'none' },
      });
      expect(prepared.descriptor.kind).toBe('local');
      expect(prepared.readOnly).toBe(roundTrip !== true);
      expect(prepared.recovery).toBe(false);
    }
  },
);

it('permits direct and aliased local doctor jobs while preserving an unknown mutation fence', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sfp-doctor-fence-'));
  const f = fixture();
  let sequence = 0;
  f.issueOperationId.mockImplementation(async () => `owned-operation-${++sequence}`);
  f.invoke.mockImplementation(async call => {
    if (call.name === 'delete_nodes')
      throw Object.assign(Error('lost after dispatch'), { code: 'ECONNRESET' });
    return { overall: 'degraded', checks: [] };
  });
  const jobs = await ServiceJobs.open(await PortalStore.open(folder), f.runtime);
  try {
    const unknown = await jobs.create({
      ...input,
      name: 'delete_nodes',
      args: { nodeIds: ['1:1'] },
    });
    await jobs.idle();
    expect(jobs.get(unknown.id).status).toBe('unknown');
    const direct = await jobs.create({
      ...input,
      name: 'doctor',
      args: { roundTrip: false },
      targetSelector: { kind: 'none' },
    });
    await jobs.idle();
    expect(jobs.get(direct.id).status).toBe('succeeded');
    const alias = await jobs.create({
      ...input,
      type: 'feature',
      name: 'tools.call',
      args: { name: 'doctor', args: {} },
      targetSelector: { kind: 'none' },
    });
    await jobs.idle();
    expect(jobs.get(alias.id).status).toBe('succeeded');
    await expect(
      jobs.create({ ...input, name: 'doctor', args: { roundTrip: true } }),
    ).rejects.toThrow('SERVICE_JOB_OUTCOME_UNKNOWN');
    await expect(
      jobs.create({
        ...input,
        type: 'feature',
        name: 'tools.call',
        args: { name: 'doctor', args: { roundTrip: true } },
      }),
    ).rejects.toThrow('SERVICE_JOB_OUTCOME_UNKNOWN');
    expect(jobs.get(unknown.id).status).toBe('unknown');
    expect(jobs.get(unknown.id).operationId).toBe('owned-operation-1');
    expect(f.invoke).toHaveBeenCalledTimes(3);
  } finally {
    await jobs.idle();
    await rm(folder, { recursive: true, force: true });
  }
});
it('parses nested tools, recognizes local status/recovery, and rejects target/schema bypasses', async () => {
  const { runtime } = fixture();
  await expect(runtime.prepare({ ...input, name: 'arbitrary_shell' })).rejects.toThrow(
    'SERVICE_TOOL_UNKNOWN',
  );
  await expect(runtime.prepare({ ...input, targetSelector: { kind: 'none' } })).rejects.toThrow(
    'authorized paired',
  );
  const args = { runId: 'sfp_portal1_11111111111111111111111111111111' };
  expect(
    (
      await runtime.prepare({
        ...input,
        name: 'portal_status',
        args,
        targetSelector: { kind: 'none' },
      })
    ).readOnly,
  ).toBe(true);
  expect(
    (
      await runtime.prepare({
        ...input,
        name: 'portal_cancel',
        args,
        targetSelector: { kind: 'none' },
      })
    ).recovery,
  ).toBe(true);
  expect(
    (
      await runtime.prepare({
        ...input,
        type: 'feature',
        name: 'tools.call',
        args: { name: 'portal_status', args },
        targetSelector: { kind: 'none' },
      })
    ).readOnly,
  ).toBe(true);
});
it.each(['tool', 'feature'] as const)(
  'persists an issued original ID before %s dispatch with the original signal and bounded timeout',
  async type => {
    const f = fixture();
    const order: string[] = [];
    f.invoke.mockImplementation(async call => {
      order.push('dispatch');
      expect(call.operationId).toBe('issued-original');
      expect(call.approve).toBe(false);
      expect(call.timeoutMs).toBeLessThanOrEqual(1000);
      return {};
    });
    await f.runtime.execute(
      {
        ...input,
        type,
        name: type === 'tool' ? 'get_pages' : 'tools.call',
        args: type === 'tool' ? {} : { name: 'get_pages', args: {} },
      },
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1000,
        emit: () => {},
        beforeInvoke: async retained => {
          order.push('retain');
          expect(retained.operationId).toBe('issued-original');
        },
      },
    );
    expect(order).toEqual(['retain', 'dispatch']);
  },
);
it('does not dispatch if durable retention rejects or cancellation arrives while retaining', async () => {
  const f = fixture();
  const controller = new AbortController();
  await expect(
    f.runtime.execute(input, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      emit: () => {},
      beforeInvoke: async () => {
        throw Error('STORE_DENIED');
      },
    }),
  ).rejects.toThrow('STORE_DENIED');
  expect(f.invoke).not.toHaveBeenCalled();
  await expect(
    f.runtime.execute(input, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      emit: () => {},
      beforeInvoke: async () => {
        controller.abort(Error('cancelled'));
      },
    }),
  ).rejects.toThrow('cancelled');
  expect(f.invoke).not.toHaveBeenCalled();
});
it('rejects an expired original deadline before issuing or dispatching an operation', async () => {
  const f = fixture();
  await expect(
    f.runtime.execute(input, {
      signal: new AbortController().signal,
      deadlineAt: Date.now() - 1,
      emit: () => {},
      beforeInvoke: async () => {},
    }),
  ).rejects.toThrow('original job deadline');
  expect(f.issueOperationId).not.toHaveBeenCalled();
  expect(f.invoke).not.toHaveBeenCalled();
});

it('classifies only the exact retained preparation cancellation as recovery without fence disposition', async () => {
  const { runtime } = fixture();
  const cancelled = await runtime.prepare({
    type: 'feature',
    name: 'portal.profile.cancel',
    args: { preparationId: '123e4567-e89b-42d3-a456-426614174000' },
    workspaceId: null,
    targetSelector: { kind: 'none' },
  });
  expect(cancelled.recovery).toBe(true);
  expect(cancelled.readOnly).toBe(false);
  for (const name of ['portal.profile.status', 'portal.profile.result']) {
    const read = await runtime.prepare({
      type: 'feature',
      name,
      args: { preparationId: '123e4567-e89b-42d3-a456-426614174000' },
      workspaceId: null,
      targetSelector: { kind: 'none' },
    });
    expect(read.readOnly).toBe(true);
    expect(read.recovery).toBe(false);
  }
});
