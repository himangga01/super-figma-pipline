import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { WorkspaceRoot } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimePaths, resolveDefaultStateRoot } from '../../src/runtime-paths.js';
import {
  type BoundStatePermissions,
  createStatePermissions,
  type StatePermissionCommand,
  type StatePermissionCommandRunner,
  type StatePermissionOptions,
  type WindowsAclProbeRecord,
} from '../../src/security/state-permissions.js';
import * as statePermissionModule from '../../src/security/state-permissions.js';

const execFile = promisify(execFileCallback);
const temporaryRoots: string[] = [];

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const windowsProductState = async (): Promise<{
  options: {
    platform: 'win32';
    environment: { LOCALAPPDATA: string };
    homeDirectory: string;
  };
  stateRoot: string;
}> => {
  const base = await temporaryRoot('sfp-task4-windows-product-');
  return {
    options: {
      platform: 'win32',
      environment: { LOCALAPPDATA: base },
      homeDirectory: base,
    },
    stateRoot: join(base, 'SuperFigmaPipeline'),
  };
};

const currentProductState = async (): Promise<{
  options: StatePermissionOptions;
  stateRoot: string;
}> => {
  if (process.platform === 'win32') return windowsProductState();
  const base = await temporaryRoot('sfp-task4-current-product-');
  if (process.platform === 'darwin') {
    const parent = join(base, 'Library', 'Application Support');
    await mkdir(parent, { recursive: true });
    return {
      options: { platform: 'darwin', environment: {}, homeDirectory: base },
      stateRoot: join(parent, 'SuperFigmaPipeline'),
    };
  }
  return {
    options: {
      platform: 'linux',
      environment: { XDG_STATE_HOME: base },
      homeDirectory: dirname(base),
    },
    stateRoot: join(base, 'super-figma-pipeline'),
  };
};

const runtimePermissions = (stateRoot: string): BoundStatePermissions => ({
  stateRoot,
  ensureSecure: async () => undefined,
  verifySecure: async () => undefined,
  inspectSecure: async () => ({
    canonicalPath: stateRoot,
    key: 'runtime-test-state',
    directory: true,
    file: false,
  }),
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('default state locations', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    expect(
      resolveDefaultStateRoot({
        platform: 'win32',
        environment: { LOCALAPPDATA: 'D:\\Owner\\Local' },
        homeDirectory: 'D:\\Owner',
      }),
    ).toBe('D:\\Owner\\Local\\SuperFigmaPipeline');
  });

  it('uses Application Support on macOS', () => {
    expect(
      resolveDefaultStateRoot({
        platform: 'darwin',
        environment: {},
        homeDirectory: '/Users/owner',
      }),
    ).toBe('/Users/owner/Library/Application Support/SuperFigmaPipeline');
  });

  it('uses XDG_STATE_HOME on Linux', () => {
    expect(
      resolveDefaultStateRoot({
        platform: 'linux',
        environment: { XDG_STATE_HOME: '/state/owner' },
        homeDirectory: '/home/owner',
      }),
    ).toBe('/state/owner/super-figma-pipeline');
  });

  it('uses the XDG state fallback when XDG_STATE_HOME is absent', () => {
    expect(
      resolveDefaultStateRoot({
        platform: 'linux',
        environment: {},
        homeDirectory: '/home/owner',
      }),
    ).toBe('/home/owner/.local/state/super-figma-pipeline');
  });

  it('uses the XDG state fallback when XDG_STATE_HOME is relative', () => {
    expect(
      resolveDefaultStateRoot({
        platform: 'linux',
        environment: { XDG_STATE_HOME: 'relative-state' },
        homeDirectory: '/home/owner',
      }),
    ).toBe('/home/owner/.local/state/super-figma-pipeline');
  });

  it('fails closed when the platform state location is unavailable', () => {
    expect(() =>
      resolveDefaultStateRoot({
        platform: 'win32',
        environment: {},
        homeDirectory: 'C:\\Users\\owner',
      }),
    ).toThrow(expect.objectContaining({ code: 'STATE_LOCATION_UNAVAILABLE' }));
  });

  it('fails closed when LOCALAPPDATA is not absolute', () => {
    expect(() =>
      resolveDefaultStateRoot({
        platform: 'win32',
        environment: { LOCALAPPDATA: 'relative-local-data' },
        homeDirectory: 'C:\\Users\\owner',
      }),
    ).toThrow(expect.objectContaining({ code: 'STATE_LOCATION_UNAVAILABLE' }));
  });
});

describe('runtime path separation', () => {
  it('verifies the bound product state before loading workspace registrations', async () => {
    const root = await temporaryRoot('sfp-task4-runtime-secure-');
    const stateRoot = join(root, 'state');
    const store = {
      list: vi.fn<() => Promise<readonly WorkspaceRoot[]>>().mockResolvedValue([]),
    };
    const failure = Object.assign(new Error('insecure state'), { code: 'STATE_ACL_INSECURE' });
    const permissions: BoundStatePermissions = {
      stateRoot,
      ensureSecure: async () => undefined,
      verifySecure: vi.fn<() => Promise<void>>().mockRejectedValue(failure),
      inspectSecure: async () => {
        throw failure;
      },
    };

    await expect(createRuntimePaths(store, { stateRoot, permissions })).rejects.toBe(failure);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('allows owner state to exist without registering a workspace', async () => {
    const root = await temporaryRoot('sfp-task4-runtime-');
    const stateRoot = join(root, 'state');
    const store = { list: vi.fn<() => Promise<readonly WorkspaceRoot[]>>().mockResolvedValue([]) };

    await expect(
      createRuntimePaths(store, { stateRoot, permissions: runtimePermissions(stateRoot) }),
    ).resolves.toEqual({
      stateRoot,
      workspaceRoots: [],
    });
  });

  it('rejects an injected workspace that overlaps owner state', async () => {
    const root = await temporaryRoot('sfp-task4-overlap-');
    const stateRoot = join(root, 'state');
    const store = {
      list: vi.fn<() => Promise<readonly WorkspaceRoot[]>>().mockResolvedValue([
        {
          workspaceId: 'workspace-1',
          path: root,
          realPath: root,
          addedAt: '2026-08-28T00:00:00.000Z',
        },
      ]),
    };

    await expect(
      createRuntimePaths(store, { stateRoot, permissions: runtimePermissions(stateRoot) }),
    ).rejects.toMatchObject({
      code: 'STATE_WORKSPACE_OVERLAP',
    });
  });
});

describe('owner-only state permissions', () => {
  it('rejects Unix special mode bits instead of masking them away', () => {
    const isSecureUnixMode = (
      statePermissionModule as unknown as {
        isSecureUnixMode: (mode: number, directory: boolean) => boolean;
      }
    ).isSecureUnixMode;

    expect(isSecureUnixMode?.(0o700, true)).toBe(true);
    expect(isSecureUnixMode?.(0o1700, true)).toBe(false);
    expect(isSecureUnixMode?.(0o4600, false)).toBe(false);
  });

  it('rejects a configured workspace as the product state root', async () => {
    const product = await windowsProductState();

    expect(() =>
      createStatePermissions(product.stateRoot, {
        ...product.options,
        forbiddenRoots: [product.stateRoot],
      }),
    ).toThrow(expect.objectContaining({ code: 'STATE_WORKSPACE_OVERLAP' }));
  });

  it('rejects binding to the app-data parent or filesystem root', async () => {
    const product = await windowsProductState();
    const appDataParent = dirname(product.stateRoot);

    expect(() => createStatePermissions(appDataParent, product.options)).toThrow(
      expect.objectContaining({ code: 'STATE_PATH_UNSAFE' }),
    );
    expect(() => createStatePermissions(parse(product.stateRoot).root, product.options)).toThrow(
      expect.objectContaining({ code: 'STATE_PATH_UNSAFE' }),
    );
  });

  it('rejects a product state leaf whose configured parent is a filesystem root', () => {
    const systemRoot = parse(resolve('.')).root;
    const stateRoot = join(systemRoot, 'SuperFigmaPipeline');

    expect(() =>
      createStatePermissions(stateRoot, {
        platform: 'win32',
        environment: { LOCALAPPDATA: systemRoot },
        homeDirectory: systemRoot,
      }),
    ).toThrow(expect.objectContaining({ code: 'STATE_PATH_UNSAFE' }));
  });

  it.runIf(process.platform === 'win32')(
    'rejects a junction ancestor before creating the product state leaf',
    async () => {
      const realBase = await temporaryRoot('sfp-task4-real-localappdata-');
      const aliasParent = await temporaryRoot('sfp-task4-alias-parent-');
      const aliasBase = join(aliasParent, 'local-data-link');
      await symlink(realBase, aliasBase, 'junction');
      const stateRoot = join(aliasBase, 'SuperFigmaPipeline');
      const permissions = createStatePermissions(stateRoot, {
        platform: 'win32',
        environment: { LOCALAPPDATA: aliasBase },
        homeDirectory: aliasParent,
      });

      await expect(permissions.ensureSecure(stateRoot)).rejects.toMatchObject({
        code: 'STATE_PATH_REPARSE',
      });
    },
  );

  it('rejects a Windows reparse attribute on a state ancestor even when lstat is not a link', async () => {
    const product = await windowsProductState();
    const sid = 'S-1-5-21-111-222-333-1001';
    const parent = dirname(product.stateRoot);
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async (file, args) => {
        if (file === 'whoami.exe') return { stdout: `"owner","${sid}"\r\n`, stderr: '' };
        if (file === 'icacls.exe' && args.length > 0) return { stdout: '', stderr: '' };
        throw new Error(`unexpected command: ${file}`);
      },
      windowsAclProbe: async path => ({
        path,
        attributes: resolve(path) === resolve(parent) ? 16 | 0x400 : 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });

    await expect(permissions.ensureSecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_PATH_REPARSE',
    });
  });

  it('creates only the product leaf and rejects a missing state parent', async () => {
    const base = await temporaryRoot('sfp-task4-missing-parent-base-');
    const missingParent = join(base, 'missing-parent');
    const stateRoot =
      process.platform === 'win32'
        ? join(missingParent, 'SuperFigmaPipeline')
        : join(missingParent, 'super-figma-pipeline');
    const options =
      process.platform === 'win32'
        ? {
            platform: 'win32' as const,
            environment: { LOCALAPPDATA: missingParent },
            homeDirectory: base,
          }
        : {
            platform: 'linux' as const,
            environment: { XDG_STATE_HOME: missingParent },
            homeDirectory: base,
          };
    const permissions = createStatePermissions(stateRoot, options);

    await expect(permissions.ensureSecure(stateRoot)).rejects.toMatchObject({
      code: 'STATE_PATH_UNSAFE',
    });
    await expect(stat(missingParent)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects replacement of the bound root during ACL mutation', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const moved = `${product.stateRoot}-during-mutation`;
    const sid = 'S-1-5-21-111-222-333-1001';
    let replaced = false;
    const command: StatePermissionCommandRunner = async (file, args) => {
      if (file === 'whoami.exe') return { stdout: `"owner","${sid}"\r\n`, stderr: '' };
      if (file === 'icacls.exe' && args.includes('/inheritance:r') && !replaced) {
        replaced = true;
        await rename(product.stateRoot, moved);
        await mkdir(product.stateRoot);
      }
      return { stdout: '', stderr: '' };
    };
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command,
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });

    await expect(permissions.ensureSecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_IDENTITY_CHANGED',
    });
  });

  it('rejects replacement after the bound root identity is established', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const moved = `${product.stateRoot}-after-binding`;
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });
    await permissions.verifySecure(product.stateRoot);
    await rename(product.stateRoot, moved);
    await mkdir(product.stateRoot);

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_IDENTITY_CHANGED',
    });
  });

  it('rejects descendant verification after the bound product root is replaced', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const child = join(product.stateRoot, 'owner.json');
    await writeFile(child, '{}');
    const moved = `${product.stateRoot}-verified-root`;
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async file =>
        file === 'whoami.exe'
          ? { stdout: `"owner","${sid}"\r\n`, stderr: '' }
          : { stdout: '', stderr: '' },
      windowsAclProbe: async path => {
        const metadata = await stat(path);
        return {
          path,
          attributes: metadata.isDirectory() ? 16 : 0,
          sddl: metadata.isDirectory()
            ? `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`
            : `D:P(A;;FA;;;SY)(A;;FA;;;${sid})`,
        };
      },
      windowsBoundaryProbe: async paths =>
        Promise.all(
          paths.map(async path => ({
            path,
            attributes: (await stat(path)).isDirectory() ? 16 : 0,
          })),
        ),
    });
    await permissions.verifySecure(product.stateRoot);
    await rename(product.stateRoot, moved);
    await mkdir(product.stateRoot);
    await writeFile(child, '{}');

    await expect(permissions.verifySecure(child)).rejects.toMatchObject({
      code: 'STATE_IDENTITY_CHANGED',
    });
  });

  it('rejects descendant mutation after the bound product root is replaced', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const child = join(product.stateRoot, 'owner.json');
    await writeFile(child, '{}');
    const moved = `${product.stateRoot}-mutation-root`;
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async file =>
        file === 'whoami.exe'
          ? { stdout: `"owner","${sid}"\r\n`, stderr: '' }
          : { stdout: '', stderr: '' },
      windowsAclProbe: async path => {
        const metadata = await stat(path);
        return {
          path,
          attributes: metadata.isDirectory() ? 16 : 0,
          sddl: metadata.isDirectory()
            ? `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`
            : `D:P(A;;FA;;;SY)(A;;FA;;;${sid})`,
        };
      },
      windowsBoundaryProbe: async paths =>
        Promise.all(
          paths.map(async path => ({
            path,
            attributes: (await stat(path)).isDirectory() ? 16 : 0,
          })),
        ),
    });
    await permissions.verifySecure(product.stateRoot);
    await rename(product.stateRoot, moved);
    await mkdir(product.stateRoot);
    await writeFile(child, '{}');

    await expect(permissions.ensureSecure(child)).rejects.toMatchObject({
      code: 'STATE_IDENTITY_CHANGED',
    });
  });

  it('captures the exact Windows ACL through a fixed stdout probe without an in-root save file', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const calls: StatePermissionCommand[] = [];
    const command = vi.fn<StatePermissionCommandRunner>(async (file, args, options) => {
      calls.push({ file, args: [...args] });
      if (file === 'whoami.exe') return { stdout: `"owner","${sid}"\r\n`, stderr: '' };
      if (file === 'powershell.exe') {
        const aclTarget = options?.environment?.SFP_STATE_ACL_TARGET;
        if (aclTarget !== undefined) {
          return {
            stdout: JSON.stringify({
              path: aclTarget,
              attributes: 16,
              sddl: `O:${sid}G:${sid}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
            } satisfies WindowsAclProbeRecord),
            stderr: '',
          };
        }
        const boundaryPaths = JSON.parse(
          options?.environment?.SFP_STATE_BOUNDARY_PATHS ?? '[]',
        ) as string[];
        return {
          stdout: JSON.stringify(boundaryPaths.map(path => ({ path, attributes: 16 }))),
          stderr: '',
        };
      }
      throw new Error(`unexpected command: ${file}`);
    });
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command,
    });

    await permissions.verifySecure(product.stateRoot);

    expect(calls.map(call => call.file)).toEqual([
      'powershell.exe',
      'whoami.exe',
      'powershell.exe',
    ]);
    expect(calls.flatMap(call => call.args)).not.toContain('/save');
    expect(calls.flatMap(call => call.args)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.txt$/i)]),
    );
  });

  it('rejects an ACL probe record for a different path', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async () => ({
        path: join(dirname(product.stateRoot), 'different'),
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INVALID',
    });
  });

  it('rejects replacement of the inspected target during the ACL probe', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const moved = `${product.stateRoot}-moved`;
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => {
        if (resolve(path) === resolve(product.stateRoot)) {
          await rename(path, moved);
          await mkdir(path);
        }
        return {
          path,
          attributes: 16,
          sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
        };
      },
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_IDENTITY_CHANGED',
    });
  });

  it('uses separate Windows argv calls with no shell string', async () => {
    const product = await windowsProductState();
    const { stateRoot } = product;
    const sid = 'S-1-5-21-111-222-333-1001';
    const calls: StatePermissionCommand[] = [];
    const command = vi.fn<StatePermissionCommandRunner>(async (file, args) => {
      calls.push({ file, args: [...args] });
      if (file === 'whoami.exe') return { stdout: `"owner","${sid}"\r\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const permissions = createStatePermissions(stateRoot, {
      ...product.options,
      command,
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });

    await permissions.ensureSecure(stateRoot);

    expect(calls).toEqual([
      { file: 'whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] },
      { file: 'icacls.exe', args: [stateRoot, '/inheritance:r'] },
      {
        file: 'icacls.exe',
        args: [stateRoot, '/grant:r', `*${sid}:(OI)(CI)F`],
      },
      {
        file: 'icacls.exe',
        args: [stateRoot, '/grant:r', '*S-1-5-18:(OI)(CI)F'],
      },
    ]);
    expect(command).toHaveBeenCalledTimes(4);
  });

  it('fails closed when the current Windows SID cannot be parsed', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: 'not,csv', stderr: '' }),
      windowsAclProbe: async path => ({ path, attributes: 16, sddl: 'D:P' }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INVALID',
    });
  });

  it('rejects an ACL with an unknown allow principal', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})(A;OICI;FR;;;S-1-1-0)`,
      }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INSECURE',
    });
  });

  it('permits an unknown deny ACE when only owner and SYSTEM receive allow ACEs', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(D;;FA;;;WD)(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
      }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).resolves.toBeUndefined();
  });

  it('rejects an inherited owner allow ACE', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICIID;FA;;;${sid})`,
      }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INSECURE',
    });
  });

  it('rejects malformed SDDL from the bound ACL probe', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      windowsAclProbe: async path => ({
        path,
        attributes: 16,
        sddl: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid}`,
      }),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INVALID',
    });
  });

  it('rejects malformed JSON from the fixed PowerShell ACL command', async () => {
    const product = await windowsProductState();
    await mkdir(product.stateRoot);
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions(product.stateRoot, {
      ...product.options,
      command: async file =>
        file === 'whoami.exe'
          ? { stdout: `"owner","${sid}"\r\n`, stderr: '' }
          : { stdout: '{malformed', stderr: '' },
      windowsBoundaryProbe: async paths => paths.map(path => ({ path, attributes: 16 })),
    });

    await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
      code: 'STATE_ACL_INVALID',
    });
  });

  it.runIf(process.platform === 'win32')(
    'rejects a state directory with inherited broad ACL',
    async () => {
      const product = await currentProductState();
      await mkdir(product.stateRoot);
      const permissions = createStatePermissions(product.stateRoot, product.options);

      await expect(permissions.verifySecure(product.stateRoot)).rejects.toMatchObject({
        code: 'STATE_ACL_INSECURE',
      });
    },
  );

  it.runIf(process.platform === 'win32')(
    'hardens and verifies only the disposable state directory',
    async () => {
      const product = await currentProductState();
      const permissions = createStatePermissions(product.stateRoot, product.options);

      await permissions.ensureSecure(product.stateRoot);

      await expect(permissions.verifySecure(product.stateRoot)).resolves.toBeUndefined();
      await expect(stat(dirname(product.stateRoot))).resolves.toMatchObject({});
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects broad Unix mode bits and enforces 0700 directories plus 0600 files',
    async () => {
      const product = await currentProductState();
      const { stateRoot } = product;
      const stateFile = join(stateRoot, 'owner.json');
      await mkdir(stateRoot, { mode: 0o755 });
      await writeFile(stateFile, '{}', { mode: 0o644 });
      await chmod(stateRoot, 0o755);
      await chmod(stateFile, 0o644);
      const permissions = createStatePermissions(stateRoot, product.options);

      await expect(permissions.verifySecure(stateRoot)).rejects.toMatchObject({
        code: 'STATE_MODE_INSECURE',
      });
      await permissions.ensureSecure(stateRoot);
      await permissions.ensureSecure(stateFile);

      expect((await stat(stateRoot)).mode & 0o7777).toBe(0o700);
      expect((await stat(stateFile)).mode & 0o7777).toBe(0o600);
    },
  );
});

it.runIf(process.platform === 'win32')(
  'uses icacls directly in the Windows acceptance environment',
  async () => {
    const { stdout } = await execFile('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    expect(stdout).toMatch(/S-1-/);
  },
);
