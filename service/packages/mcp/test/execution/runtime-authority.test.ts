import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RuntimeExecutionScope } from '@sfp/shared';
import type { StatePermissions } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveControlAuthSession,
  deriveMcpAuthSession,
  deriveOwnerActor,
  loadOrCreateOwnerPrincipalKey,
} from '../../src/security/principal-derivation.js';
import {
  createBoundRuntimeRegistry,
  executeToolRuntime,
  type ServerAdapterRuntimePort,
} from '../../src/tools/runtime-registry.js';

const ownerKey = Uint8Array.from({ length: 32 }, (_, index) => index);
const otherOwnerKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const scope = Object.freeze({}) as RuntimeExecutionScope;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const permissionsFor = (stateRoot: string): StatePermissions => ({
  stateRoot,
  ensureSecure: vi.fn<StatePermissions['ensureSecure']>(async () => {}),
  verifySecure: vi.fn<StatePermissions['verifySecure']>(async () => {}),
});

describe('runtime and principal authorities', () => {
  it('derives one stable owner actor and domain-separated sessions without body identity', () => {
    expect(deriveOwnerActor(ownerKey, 'mcp-direct')).toBe(deriveOwnerActor(ownerKey, 'control'));
    expect(deriveOwnerActor(ownerKey, 'mcp-follower')).toBe(
      deriveOwnerActor(ownerKey, 'mcp-direct'),
    );
    expect(deriveOwnerActor(otherOwnerKey, 'control')).not.toBe(
      deriveOwnerActor(ownerKey, 'control'),
    );
    expect(deriveMcpAuthSession(ownerKey, 'mcp1_AQAAAAAAAAAAAAAAAAAAAA', 'leader')).toBe(
      deriveMcpAuthSession(ownerKey, 'mcp1_AQAAAAAAAAAAAAAAAAAAAA', 'follower'),
    );
    expect(deriveControlAuthSession(ownerKey, 'token-one', 'generation-1')).not.toBe(
      deriveControlAuthSession(ownerKey, 'token-two', 'generation-1'),
    );
    expect(deriveMcpAuthSession(ownerKey, 'mcp1_AQAAAAAAAAAAAAAAAAAAAA', 'leader')).not.toBe(
      deriveControlAuthSession(ownerKey, 'mcp1_AQAAAAAAAAAAAAAAAAAAAA', 'generation-1'),
    );
  });

  it('validates a pinned plugin subcall before a server adapter can consume it', async () => {
    const adapter = vi.fn<ServerAdapterRuntimePort['execute']>(
      async (_scope, _name, _args, _signal, plugin) =>
        plugin.execute(scope, 'get_selection', {}, new AbortController().signal),
    );
    const runtimes = createBoundRuntimeRegistry(
      { execute: async () => ({ unexpected: true }) },
      { execute: adapter },
    );

    await expect(
      executeToolRuntime('get_design_context', scope, {}, new AbortController().signal, runtimes),
    ).rejects.toMatchObject({ code: 'PLUGIN_RESULT_INVALID', toolName: 'get_selection' });
    expect(adapter).toHaveBeenCalledOnce();
  });

  it('creates one secure owner-principal key and reuses it across restart and publication races', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-owner-key-'));
    roots.push(stateRoot);
    const permissions = permissionsFor(stateRoot);
    let sequence = 1;
    const random = vi.fn<(size: number) => Uint8Array>((size: number) =>
      Uint8Array.from({ length: size }, () => sequence++),
    );

    const [first, raced] = await Promise.all([
      loadOrCreateOwnerPrincipalKey({ stateRoot, permissions, randomBytes: random }),
      loadOrCreateOwnerPrincipalKey({ stateRoot, permissions, randomBytes: random }),
    ]);
    const restarted = await loadOrCreateOwnerPrincipalKey({
      stateRoot,
      permissions,
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 255),
    });

    expect(Buffer.from(first)).toEqual(Buffer.from(raced));
    expect(Buffer.from(first)).toEqual(Buffer.from(restarted));
    expect(await readFile(join(stateRoot, 'auth', 'owner-principal-key.v1'))).toEqual(
      Buffer.from(first),
    );
    expect(first).toHaveLength(32);
    expect(permissions.verifySecure).toHaveBeenCalledWith(
      join(stateRoot, 'auth', 'owner-principal-key.v1'),
    );
  });

  it('creates a missing key before real-style secure verification and rejects restart corruption', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-owner-key-real-permissions-'));
    roots.push(stateRoot);
    const permissions: StatePermissions = {
      stateRoot,
      ensureSecure: async () => {},
      verifySecure: async path => {
        try {
          await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          throw Object.assign(new Error('state path is unavailable', { cause: error }), {
            code: 'STATE_PATH_UNSAFE',
          });
        }
      },
    };
    const first = await loadOrCreateOwnerPrincipalKey({
      stateRoot,
      permissions,
      randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index),
    });
    const restarted = await loadOrCreateOwnerPrincipalKey({
      stateRoot,
      permissions,
      randomBytes: size => Uint8Array.from({ length: size }, () => 255),
    });
    expect(Buffer.from(restarted)).toEqual(Buffer.from(first));

    await writeFile(join(stateRoot, 'auth', 'owner-principal-key.v1'), Buffer.alloc(31));
    await expect(loadOrCreateOwnerPrincipalKey({ stateRoot, permissions })).rejects.toMatchObject({
      code: 'SECURE_KEY_CORRUPT',
    });
  });

  it('rejects foreign permission authority, corrupt key bytes, and permission verification failure', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'sfp-owner-key-invalid-'));
    roots.push(stateRoot);
    await expect(
      loadOrCreateOwnerPrincipalKey({
        stateRoot,
        permissions: permissionsFor(join(stateRoot, 'foreign')),
      }),
    ).rejects.toMatchObject({ code: 'KEY_STATE_ROOT_MISMATCH' });

    const permissions = permissionsFor(stateRoot);
    await loadOrCreateOwnerPrincipalKey({ stateRoot, permissions });
    await writeFile(join(stateRoot, 'auth', 'owner-principal-key.v1'), Buffer.alloc(31));
    await expect(loadOrCreateOwnerPrincipalKey({ stateRoot, permissions })).rejects.toMatchObject({
      code: 'SECURE_KEY_CORRUPT',
    });

    const deniedRoot = await mkdtemp(join(tmpdir(), 'sfp-owner-key-denied-'));
    roots.push(deniedRoot);
    const denied = permissionsFor(deniedRoot);
    denied.verifySecure = vi.fn<StatePermissions['verifySecure']>(async () => {
      throw new Error('permissions denied');
    });
    await expect(
      loadOrCreateOwnerPrincipalKey({ stateRoot: deniedRoot, permissions: denied }),
    ).rejects.toThrow('permissions denied');
  });
});
