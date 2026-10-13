import { execFile, spawn } from 'node:child_process';

import { expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn<typeof spawn>(),
  execFile: vi.fn<(...args: Parameters<typeof execFile>) => ReturnType<typeof execFile>>(() => {
    throw new Error('Unexpected process execution in bound-session fixture');
  }),
}));
vi.mock('node:fs/promises', () => ({
  access: async () => {},
  readFile: async () => JSON.stringify({ identity: `sha256:${'a'.repeat(64)}` }),
}));
vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: () => '/fixture/mcp/dist/index.mjs' }),
}));

import type { ControlClient } from '../src/control-client.js';
import { ensureLocalServer } from '../src/server-session.js';

it('portal-bound Desktop operations cannot spawn an unrelated daemon for an unavailable or different build', async () => {
  const unavailable = { health: async () => false } as unknown as ControlClient;
  await expect(ensureLocalServer(unavailable, { allowStart: false })).rejects.toThrow(
    'BOUND_SERVER_BUILD_UNAVAILABLE',
  );
  const different = {
    health: async () => true,
    status: async () => ({ buildIdentityHash: `sha256:${'b'.repeat(64)}` }),
  } as unknown as ControlClient;
  await expect(ensureLocalServer(different, { allowStart: false })).rejects.toThrow(
    'BOUND_SERVER_BUILD_UNAVAILABLE',
  );
  expect(spawn).not.toHaveBeenCalled();
  expect(execFile).not.toHaveBeenCalled();
});

it('uses a matching existing daemon and respects cancellation before any work', async () => {
  const matching = {
    health: async () => true,
    status: async () => ({ buildIdentityHash: `sha256:${'a'.repeat(64)}` }),
  } as unknown as ControlClient;
  const retained = await ensureLocalServer(matching, { allowStart: false });
  expect(retained.owned).toBe(false);
  await retained.close();
  await expect(
    ensureLocalServer(matching, { allowStart: false, signal: AbortSignal.abort(Error('stopped')) }),
  ).rejects.toThrow('stopped');
  expect(spawn).not.toHaveBeenCalled();
  expect(execFile).not.toHaveBeenCalled();
});
