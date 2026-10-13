import { afterEach, expect, it, vi } from 'vitest';

import { ControlClient } from '../src/control-client.js';
import {
  executeServiceFeature,
  parseServiceFeature,
  serviceFeatures,
  type ServiceFeatureContext,
} from '../src/service-functions.js';

afterEach(() => vi.restoreAllMocks());
const context = (): ServiceFeatureContext => ({
  workspaceId: null,
  targetSelector: { kind: 'none' },
  signal: new AbortController().signal,
  emit: vi.fn<(value: unknown) => void>(),
});
const client = () => new ControlClient({ stateRoot: 'C:/sfp-fixture-not-used' });

it('covers every enumerated public CLI path with a strict schema and an execution contract', () => {
  const expected =
    'status tools.list tools.call workspace.list workspace.add workspace.remove workspace.default.get workspace.default.set workspace.default.clear workspace.rebind egress.status egress.allow egress.reset egress.audit network.list network.add network.remove approval.list approval.decide operations.list operations.show operations.evidence operations.cancel operations.resolve pair desktop.prepare desktop.connect chrome.open chrome.tabs chrome.inspect.ui chrome.inspect.runtime chrome.inspect.page-api chrome.inspect.scripter chrome.export chrome.copy.svg chrome.copy.png chrome.decode chrome.compare chrome.compare-reads figma-mcp.config figma-mcp.probe figma-mcp.read snapshot.capture grounding.refresh portal.plan portal.start portal.next portal.status portal.cancel portal.resume portal.submit portal.profile.prepare portal.profile.register portal.environment-inspect portal.environment-reconcile portal.validate.candidate portal.apply portal.validate.applied'.split(
      ' ',
    );
  const features = serviceFeatures();
  expected.push(
    'figma-mcp.auth.status',
    'figma-mcp.auth.configure',
    'figma-mcp.auth.start',
    'figma-mcp.auth.cancel',
    'figma-mcp.auth.logout',
    'figma-mcp.auth.refresh',
    'portal.prepare-source',
    'portal.profile.status',
    'portal.profile.preparations',
    'portal.profile.result',
    'portal.profile.cancel',
  );
  expect(features).toHaveLength(69);
  expect(new Set(features.map(row => row.name)).size).toBe(69);
  expect(features.map(row => row.name).toSorted()).toEqual(expected.toSorted());
  for (const feature of features) {
    expect(feature.inputSchema).toBeTruthy();
    expect(feature.executionProof).toMatch(/^(local|composite|single-operation)$/u);
  }
});

it('rejects arbitrary routes, unexpected fields and nonlocal file inputs before effects', async () => {
  const instance = client();
  const request = vi.spyOn(instance, 'request');
  await expect(
    executeServiceFeature(instance, 'shell.exec', { command: 'whoami' }, context()),
  ).rejects.toThrow('SERVICE_FEATURE_UNKNOWN');
  expect(() => parseServiceFeature('workspace.list', { route: '/control/credentials' })).toThrow(
    'SERVICE_FEATURE_ARGUMENTS_INVALID',
  );
  expect(() => parseServiceFeature('workspace.add', { folder: '\\\\server\\share' })).toThrow(
    'SERVICE_FEATURE_LOCAL_PATH_REQUIRED',
  );
  expect(() => parseServiceFeature('workspace.add', { folder: '../elsewhere' })).toThrow(
    'SERVICE_FEATURE_LOCAL_PATH_REQUIRED',
  );
  expect(request).not.toHaveBeenCalled();
});

it('uses the supplied client identity and signal for nested admin nonce and mutation calls', async () => {
  const instance = client();
  const ctx = context();
  const request = vi.spyOn(instance, 'request').mockResolvedValue({ value: 'test-nonce' });
  await executeServiceFeature(instance, 'network.add', { domain: 'registry.npmjs.org' }, ctx);
  expect(request.mock.calls.map(row => row[0])).toEqual([
    '/control/action-nonces',
    '/control/network/domains',
  ]);
  expect(request.mock.calls[1]?.[2]).toEqual({
    fqdn: 'registry.npmjs.org',
    actionNonce: 'test-nonce',
  });
  expect(request.mock.calls.every(row => row[3]?.signal === ctx.signal)).toBe(true);
});

it('awaits durable operation admission before tool dispatch and never auto-approves', async () => {
  const instance = client();
  const order: string[] = [];
  const invoke = vi.spyOn(instance, 'invoke').mockImplementation(async () => {
    order.push('dispatch');
    return { status: 'succeeded' };
  });
  const ctx = {
    ...context(),
    beforeInvoke: async () => {
      await Promise.resolve();
      order.push('durable');
    },
  };
  await executeServiceFeature(
    instance,
    'tools.call',
    { name: 'doctor', args: { roundTrip: false } },
    ctx,
  );
  expect(order).toEqual(['durable', 'dispatch']);
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'doctor',
      approve: false,
      signal: ctx.signal,
      targetSelector: { kind: 'none' },
    }),
  );
  expect(
    parseServiceFeature('tools.call', { name: 'doctor', args: { roundTrip: true } })
      .targetRequirement,
  ).toBe('required');
});

it('a failed durable reservation or an already cancelled action cannot dispatch', async () => {
  const instance = client();
  const invoke = vi.spyOn(instance, 'invoke');
  const input = { name: 'doctor', args: { roundTrip: false } };
  await expect(
    executeServiceFeature(instance, 'tools.call', input, {
      ...context(),
      beforeInvoke: async () => {
        throw Error('DISK_FULL');
      },
    }),
  ).rejects.toThrow('DISK_FULL');
  await expect(
    executeServiceFeature(instance, 'tools.call', input, {
      ...context(),
      signal: AbortSignal.abort(Error('cancelled')),
    }),
  ).rejects.toThrow('cancelled');
  expect(invoke).not.toHaveBeenCalled();
});

it('official probe and read use fixed daemon routes without accepting browser token inputs', async () => {
  const instance = client();
  const request = vi
    .spyOn(instance, 'request')
    .mockResolvedValue({ available: false, code: 'AUTH_REQUIRED' });
  await executeServiceFeature(instance, 'figma-mcp.probe', {}, context());
  await executeServiceFeature(
    instance,
    'figma-mcp.read',
    { url: 'https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120' },
    context(),
  );
  expect(request.mock.calls[0]?.slice(0, 3)).toEqual([
    '/control/figma-mcp/probe',
    'POST',
    { endpoint: 'https://mcp.figma.com/mcp' },
  ]);
  expect(request.mock.calls[1]?.slice(0, 3)).toEqual([
    '/control/figma-mcp/read',
    'POST',
    {
      endpoint: 'https://mcp.figma.com/mcp',
      target: { fileKey: 'ly06O8jAcrd7oWmwhz5Vr6', nodeId: '1378:120' },
      tool: 'get_metadata',
    },
  ]);
  expect(() =>
    parseServiceFeature('figma-mcp.probe', { endpoint: 'https://example.com/mcp' }),
  ).toThrow('SERVICE_FEATURE_ARGUMENTS_INVALID');
  expect(() =>
    parseServiceFeature('figma-mcp.read', { url: 'https://figma.com', token: 'never-retain' }),
  ).toThrow('SERVICE_FEATURE_ARGUMENTS_INVALID');
});

it('unknown resolution requires the exact reviewed confirmation before issuing an action nonce', async () => {
  const instance = client();
  const request = vi.spyOn(instance, 'request').mockResolvedValue({ value: 'reviewed-nonce' });
  const args = {
    operationId: 'original',
    decision: 'abandoned',
    reasonHash: `sha256:${'a'.repeat(64)}`,
    evidenceHash: `sha256:${'b'.repeat(64)}`,
    confirm: 'wrong',
  };
  await expect(
    executeServiceFeature(instance, 'operations.resolve', args, context()),
  ).rejects.toThrow('OPERATION_RESOLUTION_CONFIRMATION_INVALID');
  expect(request).not.toHaveBeenCalled();
  await executeServiceFeature(
    instance,
    'operations.resolve',
    { ...args, confirm: 'original/unknown' },
    context(),
  );
  expect(request.mock.calls[1]?.[0]).toBe('/control/operations/original/resolve');
  expect(request.mock.calls[1]?.[2]).toEqual(
    expect.objectContaining({
      actionNonce: 'reviewed-nonce',
      confirm: 'original/unknown',
      confirmedResultHash: null,
    }),
  );
});
