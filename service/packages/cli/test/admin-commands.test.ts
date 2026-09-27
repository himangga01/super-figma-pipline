import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashActionRequest } from '@sfp/shared';
import { afterEach, expect, it, vi } from 'vitest';

import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';
import { runAdminCommand } from '../src/admin-commands.js';
import { ControlClient } from '../src/control-client.js';

afterEach(() => vi.restoreAllMocks());
it('lists workspace availability and rebinds a registration with a server-bound nonce', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sfp-cli-rebind-'));
  try {
    const canonical = await realpath(directory);
    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const rows = [
      {
        workspaceId,
        path: canonical,
        realPath: canonical,
        rootIdentityKey: '1:2:3',
        addedAt: '2026-09-27T00:00:00.000Z',
        availability: 'unavailable',
        unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED',
      },
    ];
    const rebound = {
      workspaceId,
      path: canonical,
      realPath: canonical,
      rootIdentityKey: '1:2:4',
      addedAt: '2026-09-27T00:00:00.000Z',
      availability: 'available',
    };
    const request = vi
      .spyOn(ControlClient.prototype, 'request')
      .mockImplementation(async path =>
        path === '/control/workspaces'
          ? rows
          : path === '/control/action-nonces'
            ? { value: 'nonce-fixture' }
            : rebound,
      );
    const emit = vi.fn<(value: unknown) => void>();

    await runAdminCommand(['workspace', 'list'], emit);
    expect(emit).toHaveBeenLastCalledWith(rows);

    await runAdminCommand(['workspace', 'rebind', workspaceId, directory], emit);
    expect(request.mock.calls.slice(1)).toEqual([
      [
        '/control/action-nonces',
        'POST',
        {
          action: 'workspace.rebind',
          requestHash: hashActionRequest('workspace.rebind', { workspaceId, realPath: canonical }),
          registrationPath: canonical,
          workspaceId,
        },
      ],
      [
        `/control/workspaces/${workspaceId}/rebind`,
        'POST',
        { path: canonical, actionNonce: 'nonce-fixture' },
      ],
    ]);
    expect(emit).toHaveBeenLastCalledWith(rebound);

    // Adding the path again does not silently reuse the unavailable registration.
    request.mockClear();
    await expect(runAdminCommand(['workspace', 'add', directory], emit)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
      message: expect.stringContaining(`sfp workspace rebind ${workspaceId}`),
    });
    expect(request.mock.calls.map(call => call[0])).toEqual(['/control/workspaces']);
    await expect(runAdminCommand(['workspace', 'rebind', workspaceId], emit)).rejects.toMatchObject(
      { code: 'CLI_USAGE' },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('lists the complete contract locally without requiring a daemon', async () => {
  const request = vi
    .spyOn(ControlClient.prototype, 'request')
    .mockRejectedValue(new Error('must not request'));
  const emit = vi.fn<(value: unknown) => void>();
  expect(await runAdminCommand(['tools', 'list'], emit)).toBe(true);
  // Derived from the registry rather than a literal count, so adding a tool cannot break it.
  expect(
    (emit.mock.calls[0]![0] as { tools: Array<{ name: string }> }).tools.map(tool => tool.name),
  ).toEqual(ALL_TOOL_SPECS.map(spec => spec.name));
  expect(request).not.toHaveBeenCalled();
});
it('routes portal status through the canonical tool invocation with no Figma target', async () => {
  const invoke = vi
    .spyOn(ControlClient.prototype, 'invoke')
    .mockResolvedValue({ state: 'waiting-agent' });
  const id = `sfp_portal1_${'a'.repeat(32)}`;
  await runAdminCommand(['portal', 'status', id], () => {});
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'portal_status',
      kind: 'tool',
      args: { runId: id },
      targetSelector: { kind: 'none' },
    }),
  );
});
it('keeps the known Figma binding when planning a new portal', async () => {
  const invoke = vi
    .spyOn(ControlClient.prototype, 'invoke')
    .mockResolvedValue({ strategy: 'blank-frontend' });
  await runAdminCommand(
    [
      'portal',
      'plan',
      '--args',
      '{"case":"new"}',
      '--workspace-id',
      '11111111-1111-4111-8111-111111111111',
    ],
    () => {},
  );
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'portal_plan',
      kind: 'tool',
      args: expect.objectContaining({
        case: 'new',
        design: expect.objectContaining({ url: expect.stringContaining('4IBhv1d8hEclifZQrOYxHS') }),
      }),
      targetSelector: { kind: 'portal-source' },
    }),
  );
});
it('validates arguments and command-specific flags before any invocation', async () => {
  const invoke = vi.spyOn(ControlClient.prototype, 'invoke').mockResolvedValue({ ok: true });
  await expect(
    runAdminCommand(['tools', 'call', 'export_tokens', '--args', '{"format":"invalid"}'], () => {}),
  ).rejects.toThrow(/Invalid/u);
  await expect(runAdminCommand(['workspace', 'list', '--yes'], () => {})).rejects.toThrow(
    'not supported',
  );
  expect(invoke).not.toHaveBeenCalled();
});
it('pins the requested session and passes approval only to that invocation', async () => {
  const invoke = vi.spyOn(ControlClient.prototype, 'invoke').mockResolvedValue({ ok: true });
  await runAdminCommand(
    ['tools', 'call', 'get_metadata', '--session', 'pinned-session', '--yes'],
    () => {},
  );
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'get_metadata',
      kind: 'tool',
      targetSelector: { kind: 'session', sessionId: 'pinned-session' },
      approve: true,
      args: {},
    }),
  );
});
it('routes local snapshot operations through the service invocation path', async () => {
  const invoke = vi.spyOn(ControlClient.prototype, 'invoke').mockResolvedValue({ ok: true });
  await runAdminCommand(
    [
      'snapshot',
      'capture',
      '--args',
      '{"nodeIds":["1:2"]}',
      '--workspace-id',
      '11111111-1111-4111-8111-111111111111',
    ],
    () => {},
  );
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'snapshot.capture',
      kind: 'service',
      args: { nodeIds: ['1:2'] },
    }),
  );
});

const nativeProfileFixture = () => ({
  schemaVersion: 1,
  sourceAuthorityVersion: 2,
  planId: `sfp_portal1_${'a'.repeat(32)}`,
  contextHash: `sha256:${'a'.repeat(64)}`,
  native: {
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    id: 'native-fixture',
    executionMode: 'native-working-copy',
    environmentKind: 'disposable-test',
    sourceHash: `sha256:${'b'.repeat(64)}`,
    closure: [{ path: 'check.mjs', hash: `sha256:${'c'.repeat(64)}` }],
    environment: { APP_SECRET: 'private-config-value' },
    commands: [
      {
        id: 'check',
        executable: process.execPath,
        executableHash: `sha256:${'d'.repeat(64)}`,
        args: ['check.mjs'],
        timeoutMs: 1000,
      },
    ],
  },
  sourceReviews: [],
  assertions: [
    {
      commandId: 'check',
      check: { id: 'build', kind: 'build', requirementIds: [], required: true },
    },
  ],
});
it('prepares a native profile without requesting a nonce and exposes no protected environment values', async () => {
  const input = nativeProfileFixture(),
    prepared = {
      ...input,
      native: {
        ...input.native,
        environment: {
          ...input.native.environment,
          SFP_PORTAL_VALIDATOR_URL: 'file:///fixture/validator.mjs',
        },
        externalArtifacts: [],
        artifactAuthority: {
          version: 1,
          configurationHash: `sha256:${'a'.repeat(64)}`,
          commandHash: `sha256:${'b'.repeat(64)}`,
          artifacts: [],
          executables: [],
        },
      },
    };
  const request = vi.spyOn(ControlClient.prototype, 'request').mockResolvedValue(prepared),
    emit = vi.fn<(value: unknown) => void>();
  await runAdminCommand(['portal', 'profile', '--args', JSON.stringify(input)], emit);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]!.slice(0, 2)).toEqual(['/control/portal/profiles/prepare', 'POST']);
  expect(JSON.stringify(emit.mock.calls)).not.toContain('private-config-value');
  expect(emit.mock.calls[0]![0]).toHaveProperty(
    'preparation.artifactAuthority',
    prepared.native.artifactAuthority,
  );
});
it('requires the reviewed preparation and registers its exact bytes without refreshing authority', async () => {
  const request = vi
    .spyOn(ControlClient.prototype, 'request')
    .mockImplementation(async path =>
      path === '/control/action-nonces'
        ? { value: 'nonce-fixture' }
        : { profileId: 'native-fixture' },
    );
  const raw = nativeProfileFixture();
  await expect(
    runAdminCommand(['portal', 'profile', '--args', JSON.stringify(raw), '--yes'], () => {}),
  ).rejects.toMatchObject({ code: 'CLI_USAGE' });
  expect(request).not.toHaveBeenCalled();
  const prepared = {
    ...raw,
    native: {
      ...raw.native,
      artifactAuthority: {
        version: 1,
        configurationHash: `sha256:${'a'.repeat(64)}`,
        commandHash: `sha256:${'b'.repeat(64)}`,
        artifacts: [],
        executables: [],
      },
    },
  };
  await runAdminCommand(
    ['portal', 'profile', '--args', JSON.stringify(prepared), '--yes'],
    () => {},
  );
  expect(request.mock.calls.map(call => call[0])).toEqual([
    '/control/action-nonces',
    '/control/portal/profiles',
  ]);
  expect(request.mock.calls[1]![2]).toMatchObject({
    profile: { native: { artifactAuthority: prepared.native.artifactAuthority } },
  });
});

it.each([undefined, 'none', 'active'] as const)(
  'preserves %s CLI target intent for dynamically resolved portal validation',
  async target => {
    const invoke = vi
      .spyOn(ControlClient.prototype, 'invoke')
      .mockResolvedValue({ state: 'validated-candidate' });
    const args = [
      'portal',
      'validate',
      'sfp_portal1_' + 'a'.repeat(32),
      '--args',
      JSON.stringify({ profileId: 'profile', target: 'candidate' }),
      ...(target === undefined ? [] : ['--target', target]),
    ];
    await runAdminCommand(args, () => {});
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'portal_validate',
        targetSelector: { kind: target ?? 'portal-source' },
      }),
    );
  },
);
it('preserves explicit session selection for Desktop portal validation', async () => {
  const invoke = vi
    .spyOn(ControlClient.prototype, 'invoke')
    .mockResolvedValue({ state: 'validated-candidate' });
  const session = Buffer.alloc(16, 1).toString('base64url');
  await runAdminCommand(
    [
      'portal',
      'validate',
      'sfp_portal1_' + 'a'.repeat(32),
      '--args',
      JSON.stringify({ profileId: 'profile', target: 'candidate' }),
      '--session',
      session,
    ],
    () => {},
  );
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({ targetSelector: { kind: 'session', sessionId: session } }),
  );
});
