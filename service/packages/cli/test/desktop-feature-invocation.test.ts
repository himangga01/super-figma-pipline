import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalFileIdentityHash } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../src/server-session.js', () => ({
  ensureLocalServer: async () => ({ owned: false, close: async () => {} }),
  runtimePaths: async () => {
    throw Error('Unexpected bundle preparation');
  },
}));

import { ControlClient } from '../src/control-client.js';
import { executeServiceFeature } from '../src/service-functions.js';

afterEach(() => vi.restoreAllMocks());

it('keeps the read allowlist while using the public invocation path with exact targets', async () => {
  const client = new ControlClient({ stateRoot: 'C:/unused-owned-fixture' });
  const invoke = vi.spyOn(client, 'invoke').mockResolvedValue({ ok: true });
  await client.readTool('get_metadata', {}, 'AQAAAAAAAAAAAAAAAAAAAA');
  await client.readTool(
    'analyze_project',
    { rootDir: '.' },
    'AQAAAAAAAAAAAAAAAAAAAA',
    '00000000-0000-4000-8000-000000000001',
  );
  expect(invoke.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      name: 'get_metadata',
      kind: 'tool',
      args: {},
      workspaceId: null,
      targetSelector: { kind: 'session', sessionId: 'AQAAAAAAAAAAAAAAAAAAAA' },
      approve: false,
      captureResult: false,
    }),
  );
  expect(invoke.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({
      name: 'analyze_project',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      targetSelector: { kind: 'none' },
      approve: false,
    }),
  );
  await expect(
    client.readTool('delete_nodes', { nodeIds: ['0:1'] }, 'AQAAAAAAAAAAAAAAAAAAAA'),
  ).rejects.toThrow('AUTOMATION_READ_ONLY');
  expect(invoke).toHaveBeenCalledTimes(2);
});

it.each([null, '00000000-0000-4000-8000-000000000001'])(
  'retains Desktop child reads and routes their progress through the same feature connection (%s)',
  async workspaceId => {
    const folder = await mkdtemp(join(tmpdir(), 'sfp-desktop-feature-'));
    const client = new ControlClient({ stateRoot: folder });
    const fileKey = 'ly06O8jAcrd7oWmwhz5Vr6';
    const metadata = {
      currentPage: { id: '0:1', name: 'Owned fixture' },
      pages: [{ id: '0:1', name: 'Owned fixture' }],
    };
    vi.spyOn(client, 'status').mockResolvedValue({
      pairedPluginCount: 1,
      activePlugin: {
        sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
        fileName: 'Owned fixture',
        fileIdentityKind: 'figma-file-key',
        fileIdentityHash: canonicalFileIdentityHash({ kind: 'figma-file-key', value: fileKey }),
      },
    } as never);
    const emit = vi.fn<(value: unknown) => void>();
    const controller = new AbortController();
    const retained: string[] = [];
    const invoke = vi.spyOn(client, 'invoke').mockImplementation(async call => {
      expect(retained).toContain(call.operationId);
      expect(call.workspaceId).toBe(workspaceId);
      expect(call.signal).toBe(controller.signal);
      expect(call.approve).toBe(false);
      call.emit({ status: 'owned-test-progress', operationId: call.operationId });
      return call.name === 'get_metadata'
        ? metadata
        : call.name === 'get_document'
          ? { pageId: '0:1', nodes: [] }
          : {};
    });
    try {
      await executeServiceFeature(
        client,
        'desktop.connect',
        { url: `https://www.figma.com/design/${fileKey}?node-id=0-1`, out: folder },
        {
          workspaceId,
          targetSelector: { kind: 'none' },
          signal: controller.signal,
          emit,
          beforeInvoke: async call => {
            call.operationId = `owned-operation-${retained.length}`;
            retained.push(call.operationId);
          },
        },
      );
      expect(invoke).toHaveBeenCalledTimes(6);
      expect(retained).toHaveLength(6);
      expect(
        emit.mock.calls.filter(
          row => (row[0] as { status?: string }).status === 'owned-test-progress',
        ),
      ).toHaveLength(6);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
