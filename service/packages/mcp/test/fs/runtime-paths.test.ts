import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { WorkspaceRoot } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimePaths, resolveDefaultStateRoot } from '../../src/runtime-paths.js';
import {
  createStatePermissions,
  type StatePermissionCommand,
  type StatePermissionCommandRunner,
} from '../../src/security/state-permissions.js';

const execFile = promisify(execFileCallback);
const temporaryRoots: string[] = [];

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

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
  it('allows owner state to exist without registering a workspace', async () => {
    const root = await temporaryRoot('sfp-task4-runtime-');
    const stateRoot = join(root, 'state');
    const store = { list: vi.fn<() => Promise<readonly WorkspaceRoot[]>>().mockResolvedValue([]) };

    await expect(createRuntimePaths(store, { stateRoot })).resolves.toEqual({
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

    await expect(createRuntimePaths(store, { stateRoot })).rejects.toMatchObject({
      code: 'STATE_WORKSPACE_OVERLAP',
    });
  });
});

describe('owner-only state permissions', () => {
  it('uses separate Windows argv calls with no shell string', async () => {
    const root = await temporaryRoot('sfp-task4-state-argv-');
    const stateRoot = join(root, 'state');
    const sid = 'S-1-5-21-111-222-333-1001';
    const calls: StatePermissionCommand[] = [];
    const command = vi.fn<StatePermissionCommandRunner>(async (file, args) => {
      calls.push({ file, args: [...args] });
      if (file === 'whoami.exe') return { stdout: `"owner","${sid}"\r\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const permissions = createStatePermissions({
      platform: 'win32',
      command,
      readWindowsAcl: async () => `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`,
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
    const root = await temporaryRoot('sfp-task4-state-sid-');
    const permissions = createStatePermissions({
      platform: 'win32',
      command: async () => ({ stdout: 'not,csv', stderr: '' }),
      readWindowsAcl: async () => 'D:P',
    });

    await expect(permissions.verifySecure(root)).rejects.toMatchObject({
      code: 'STATE_ACL_INVALID',
    });
  });

  it('rejects an ACL with an unknown allow principal', async () => {
    const root = await temporaryRoot('sfp-task4-state-principal-');
    const sid = 'S-1-5-21-111-222-333-1001';
    const permissions = createStatePermissions({
      platform: 'win32',
      command: async () => ({ stdout: `"owner","${sid}"\r\n`, stderr: '' }),
      readWindowsAcl: async () => `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})(A;OICI;FR;;;S-1-1-0)`,
    });

    await expect(permissions.verifySecure(root)).rejects.toMatchObject({
      code: 'STATE_ACL_INSECURE',
    });
  });

  it.runIf(process.platform === 'win32')(
    'rejects a state directory with inherited broad ACL',
    async () => {
      const root = await temporaryRoot('sfp-task4-state-inherited-');
      const stateRoot = join(root, 'state');
      await mkdir(stateRoot);
      const permissions = createStatePermissions();

      await expect(permissions.verifySecure(stateRoot)).rejects.toMatchObject({
        code: 'STATE_ACL_INSECURE',
      });
    },
  );

  it.runIf(process.platform === 'win32')(
    'hardens and verifies only the disposable state directory',
    async () => {
      const root = await temporaryRoot('sfp-task4-state-secure-');
      const stateRoot = join(root, 'state');
      const permissions = createStatePermissions();

      await permissions.ensureSecure(stateRoot);

      await expect(permissions.verifySecure(stateRoot)).resolves.toBeUndefined();
      await expect(stat(root)).resolves.toMatchObject({});
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects broad Unix mode bits and enforces 0700 directories plus 0600 files',
    async () => {
      const root = await temporaryRoot('sfp-task4-state-mode-');
      const stateRoot = join(root, 'state');
      const stateFile = join(stateRoot, 'owner.json');
      await mkdir(stateRoot, { mode: 0o755 });
      await writeFile(stateFile, '{}', { mode: 0o644 });
      await chmod(stateRoot, 0o755);
      await chmod(stateFile, 0o644);
      const permissions = createStatePermissions();

      await expect(permissions.verifySecure(stateRoot)).rejects.toMatchObject({
        code: 'STATE_MODE_INSECURE',
      });
      await permissions.ensureSecure(stateRoot);
      await permissions.ensureSecure(stateFile);

      expect((await stat(stateRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
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
