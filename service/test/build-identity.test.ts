import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const moduleResolution = vi.hoisted(() => ({ entry: '' }));
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));
vi.mock('node:module', async importOriginal => ({
  ...(await importOriginal<typeof import('node:module')>()),
  createRequire: () => ({ resolve: () => moduleResolution.entry }),
}));

const temporaryRoots: string[] = [];
afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});

const fixtureFiles = [
  ['package.json', '{"name":"fixture"}\n'],
  ['pnpm-lock.yaml', 'lockfileVersion: fixture\n'],
  ['pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n"],
  ['tsconfig.json', '{"extends":"./tsconfig.base.json"}\n'],
  ['tsconfig.base.json', '{"compilerOptions":{"target":"ES2023"}}\n'],
  ['scripts/build-server.mjs', 'fixture build entry\n'],
  ['scripts/build-identity.mjs', 'fixture identity helper\n'],
  ['packages/shared/package.json', '{"name":"@sfp/shared"}\n'],
  ['packages/shared/tsconfig.json', '{}\n'],
  ['packages/shared/src/index.ts', "export const shared = 'fixture';\n"],
  ['packages/ir/package.json', '{"name":"@sfp/ir"}\n'],
  ['packages/ir/tsconfig.json', '{}\n'],
  ['packages/ir/src/index.ts', "export const ir = 'fixture';\n"],
  ['packages/mcp/package.json', '{"name":"@sfp/mcp"}\n'],
  ['packages/mcp/tsconfig.json', '{}\n'],
  ['packages/mcp/tsdown.config.ts', "export default { entry: ['src/index.ts'] };\n"],
  ['packages/mcp/src/index.ts', "export const mcp = 'fixture';\n"],
  ['packages/cli/package.json', '{"name":"@sfp/cli"}\n'],
  ['packages/cli/tsconfig.json', '{}\n'],
  ['packages/cli/tsdown.config.ts', "export default { entry: ['src/index.ts'] };\n"],
  ['packages/cli/src/capture-assets.ts', "export const collector = 'before';\n"],
] as const;

const write = async (root: string, path: string, content: string) => {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
};
const createFixture = async (reverse = false) => {
  const root = await mkdtemp(resolve(tmpdir(), 'sfp-build-identity-'));
  temporaryRoots.push(root);
  const files = reverse ? fixtureFiles.toReversed() : fixtureFiles;
  for (const [path, content] of files) await write(root, path, content);
  return root;
};

const legacyBuildIdentity = async (root: string) => {
  const hash = createHash('sha256');
  const walk = async (folder: string): Promise<void> => {
    for (const item of (await readdir(folder, { withFileTypes: true })).toSorted((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      if (['node_modules', 'dist', 'test'].includes(item.name)) continue;
      const path = resolve(folder, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        hash.update(relative(root, path).replaceAll('\\', '/'));
        hash.update(await readFile(path));
      }
    }
  };
  for (const name of ['shared', 'ir', 'mcp']) await walk(resolve(root, 'packages', name));
  hash.update(await readFile(resolve(root, 'pnpm-lock.yaml')));
  return `sha256:${hash.digest('hex')}`;
};

const loadHelper = () => import('../scripts/build-identity.mjs');

describe('daemon build identity', () => {
  it('detects a CLI collector change that the legacy digest misses', async () => {
    const root = await createFixture();
    const oldBefore = await legacyBuildIdentity(root);
    const { computeBuildIdentity } = await loadHelper();
    const currentBefore = await computeBuildIdentity(root);

    await write(root, 'packages/cli/src/capture-assets.ts', "export const collector = 'after';\n");

    expect(await legacyBuildIdentity(root)).toBe(oldBefore);
    expect(await computeBuildIdentity(root)).not.toBe(currentBefore);
  });

  it('enumerates and hashes inputs deterministically', async () => {
    const first = await createFixture();
    const second = await createFixture(true);
    const { computeBuildIdentity, enumerateBuildIdentityInputs } = await loadHelper();

    const firstPaths = await enumerateBuildIdentityInputs(first);
    const secondPaths = await enumerateBuildIdentityInputs(second);
    expect(firstPaths).toEqual(firstPaths.toSorted());
    expect(secondPaths).toEqual(firstPaths);
    expect(await computeBuildIdentity(second)).toBe(await computeBuildIdentity(first));
  });

  it('changes for source and behavior-affecting build configuration', async () => {
    const root = await createFixture();
    const { computeBuildIdentity } = await loadHelper();
    const baseline = await computeBuildIdentity(root);

    await write(root, 'packages/shared/src/index.ts', "export const shared = 'changed';\n");
    expect(await computeBuildIdentity(root)).not.toBe(baseline);
    await write(root, 'packages/shared/src/index.ts', "export const shared = 'fixture';\n");

    await write(
      root,
      'packages/mcp/tsdown.config.ts',
      "export default { entry: ['src/daemon-entry.ts'] };\n",
    );
    expect(await computeBuildIdentity(root)).not.toBe(baseline);
  });

  it('hashes an imported runtime helper even when its directory is named test', async () => {
    const root = await createFixture();
    const { computeBuildIdentity } = await loadHelper();
    await write(
      root,
      'packages/mcp/src/index.ts',
      "export { runtimeHelper } from './test/runtime-helper.js';\n",
    );
    await write(
      root,
      'packages/mcp/src/test/runtime-helper.ts',
      "export const runtimeHelper = 'before';\n",
    );
    const baseline = await computeBuildIdentity(root);

    await write(
      root,
      'packages/mcp/src/test/runtime-helper.ts',
      "export const runtimeHelper = 'after';\n",
    );

    expect(await computeBuildIdentity(root)).not.toBe(baseline);
  });

  it('ignores generated output and test-only input', async () => {
    const root = await createFixture();
    const { computeBuildIdentity } = await loadHelper();
    const baseline = await computeBuildIdentity(root);

    await write(root, 'packages/mcp/dist/index.mjs', 'generated output\n');
    await write(root, 'packages/cli/test/capture-assets.test.ts', 'test-only input\n');
    await write(root, 'packages/shared/coverage/coverage.json', '{}\n');

    expect(await computeBuildIdentity(root)).toBe(baseline);
  });

  it('fails explicitly when a required input is missing', async () => {
    const root = await createFixture();
    const { computeBuildIdentity } = await loadHelper();
    await rm(resolve(root, 'packages/mcp/package.json'));

    await expect(computeBuildIdentity(root)).rejects.toThrow(
      'BUILD_IDENTITY_REQUIRED_INPUT_MISSING:packages/mcp/package.json',
    );
  });
});

describe('CLI stale-daemon identity comparison', () => {
  it('starts the packaged entry when a healthy daemon reports a stale identity', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sfp-packaged-server-'));
    temporaryRoots.push(root);
    moduleResolution.entry = resolve(root, 'mcp/index.mjs');
    const expected = { identity: `sha256:${'1'.repeat(64)}` };
    await write(root, 'mcp/index.mjs', 'export {};\n');
    await write(root, 'mcp/build-info.json', `${JSON.stringify(expected)}\n`);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      stdin: { end: vi.fn<() => void>() },
      stderr: { resume: vi.fn<() => void>() },
      kill: vi.fn<() => void>(),
    });
    spawnMock.mockReturnValue(child);
    vi.resetModules();
    const { ensureLocalServer } = await import('../packages/cli/src/server-session.js');
    const status = vi
      .fn<() => Promise<{ buildIdentityHash: string }>>()
      .mockResolvedValueOnce({ buildIdentityHash: `sha256:${'0'.repeat(64)}` })
      .mockResolvedValueOnce({ buildIdentityHash: expected.identity });
    const client = { health: vi.fn<() => Promise<boolean>>().mockResolvedValue(true), status };

    const server = await ensureLocalServer(client as never);

    expect(server.owned).toBe(true);
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [moduleResolution.entry],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(status).toHaveBeenCalledTimes(2);
  });
});
