import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serviceRoot, '..');
const fixtureRoots: string[] = [];

const copyServiceFixture = async (): Promise<{ repositoryRoot: string; serviceRoot: string }> => {
  const fixtureRepository = await mkdtemp(join(tmpdir(), 'sfp-vendor-upstreams-'));
  fixtureRoots.push(fixtureRepository);
  const fixtureService = join(fixtureRepository, 'service');
  await cp(serviceRoot, fixtureService, {
    recursive: true,
    filter: source => {
      const path = relative(serviceRoot, source);
      const segments = path.split(sep);
      return !segments.some(segment => ['coverage', 'dist', 'node_modules'].includes(segment));
    },
  });

  await mkdir(join(fixtureRepository, 'code-kb'), { recursive: true });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await Promise.all(
    ['figwright', 'figma-mcp-rust', 'figmosha2'].map(directory =>
      symlink(
        join(repositoryRoot, 'code-kb', directory),
        join(fixtureRepository, 'code-kb', directory),
        linkType,
      ),
    ),
  );
  await symlink(join(serviceRoot, 'node_modules'), join(fixtureService, 'node_modules'), linkType);
  return { repositoryRoot: fixtureRepository, serviceRoot: fixtureService };
};

const removeRootReadmeRule = async (fixtureService: string): Promise<void> => {
  const path = join(fixtureService, 'vendor-rules.json');
  const rules = JSON.parse(await readFile(path, 'utf8')) as { copy: string[] };
  rules.copy = rules.copy.filter(pattern => pattern !== 'README.md');
  await writeFile(path, `${JSON.stringify(rules, null, 2)}\n`, 'utf8');
};

const runCopyOnly = (fixtureService: string): ReturnType<typeof spawnSync> =>
  spawnSync(
    process.execPath,
    [join(fixtureService, 'scripts', 'vendor-upstreams.mjs'), '--copy-only'],
    {
      cwd: dirname(fixtureService),
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

const runVerifier = (
  fixture: { repositoryRoot: string; serviceRoot: string },
  mode: '--offline' | '--with-upstreams',
): ReturnType<typeof spawnSync> =>
  spawnSync(
    process.execPath,
    [
      join(fixture.serviceRoot, 'scripts', 'verify-upstream-lock.mjs'),
      mode,
      ...(mode === '--with-upstreams' ? [join(fixture.repositoryRoot, 'code-kb')] : []),
    ],
    {
      cwd: fixture.repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map(path => rm(path, { force: true, recursive: true })));
});

describe('vendor upstream reconciliation', () => {
  it('removes a previous managed destination when its mapped bytes are unchanged', async () => {
    const fixture = await copyServiceFixture();
    await removeRootReadmeRule(fixture.serviceRoot);

    const result = runCopyOnly(fixture.serviceRoot);

    expect(result.status).toBe(0);
    await expect(stat(join(fixture.serviceRoot, 'README.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const vendorMap = JSON.parse(
      await readFile(join(fixture.serviceRoot, 'vendor-map.json'), 'utf8'),
    ) as { files: Array<{ destination: string | null }> };
    expect(vendorMap.files.some(row => row.destination === 'README.md')).toBe(false);
  }, 30_000);

  it('rejects a locally modified obsolete destination without changing the file or map', async () => {
    const fixture = await copyServiceFixture();
    const readmePath = join(fixture.serviceRoot, 'README.md');
    const mapPath = join(fixture.serviceRoot, 'vendor-map.json');
    const previousMap = await readFile(mapPath);
    await writeFile(readmePath, 'locally modified\n', 'utf8');
    await removeRootReadmeRule(fixture.serviceRoot);

    const result = runCopyOnly(fixture.serviceRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[VENDOR_STALE_MODIFIED]');
    expect(await readFile(readmePath, 'utf8')).toBe('locally modified\n');
    expect(await readFile(mapPath)).toEqual(previousMap);
  }, 30_000);

  it('preserves service-owned lifecycle scripts and excludes the upstream-only clean command', async () => {
    const fixture = await copyServiceFixture();
    const manifestPath = join(fixture.serviceRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    delete manifest.scripts.clean;
    manifest.scripts.postinstall = 'node service-postinstall.mjs';
    manifest.scripts.release = 'node service-release.mjs';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = spawnSync(
      process.execPath,
      [join(fixture.serviceRoot, 'scripts', 'vendor-upstreams.mjs'), '--merge-manifests'],
      {
        cwd: fixture.repositoryRoot,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(0);
    const merged = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(merged.scripts.postinstall).toBe('node service-postinstall.mjs');
    expect(merged.scripts.release).toBe('node service-release.mjs');
    expect(merged.scripts.clean).toBeUndefined();
  }, 30_000);
});

describe('managed destination closure', () => {
  it.each(['--offline', '--with-upstreams'] as const)(
    'rejects an unregistered file inside a managed root in %s mode',
    async mode => {
      const fixture = await copyServiceFixture();
      await writeFile(
        join(fixture.serviceRoot, 'packages', 'mcp', 'src', 'stale-vendor-fixture.ts'),
        'export const stale = true;\n',
        'utf8',
      );

      const result = runVerifier(fixture, mode);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[UNMANAGED_DESTINATION]');
    },
    30_000,
  );
});

describe('protected service authorities', () => {
  const mutations: Array<{
    name: string;
    path: string;
    mutate: (contents: string) => string;
  }> = [
    {
      name: 'root package version',
      path: 'package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { version: string };
        manifest.version = '9.9.9';
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'root TypeScript devDependency',
      path: 'package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { devDependencies: Record<string, string> };
        manifest.devDependencies.typescript = '^0.0.0';
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'MCP build script',
      path: 'packages/mcp/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { scripts: Record<string, string> };
        manifest.scripts.build = 'node changed-build.mjs';
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'MCP exports absence',
      path: 'packages/mcp/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { exports?: unknown };
        manifest.exports = { '.': './src/index.ts' };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'MCP ws dependency',
      path: 'packages/mcp/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { dependencies: Record<string, string> };
        manifest.dependencies.ws = '^0.0.0';
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'MCP optionalDependencies absence',
      path: 'packages/mcp/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { optionalDependencies?: Record<string, string> };
        manifest.optionalDependencies = { optional: '1.0.0' };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'plugin peerDependencies absence',
      path: 'packages/plugin/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { peerDependencies?: Record<string, string> };
        manifest.peerDependencies = { peer: '1.0.0' };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'shared integration exports',
      path: 'packages/shared/package.json',
      mutate: contents => {
        const manifest = JSON.parse(contents) as { exports: Record<string, unknown> };
        manifest.exports['.'] = './dist/index.js';
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    },
    {
      name: 'Task 4 runtime path authority',
      path: 'packages/mcp/src/runtime-paths.ts',
      mutate: contents => contents.replace('SuperFigmaPipeline', 'UntrustedPipelineState'),
    },
    {
      name: 'Task 4 bound state-permissions authority',
      path: 'packages/mcp/src/security/state-permissions.ts',
      mutate: contents => contents.replace('-NoProfile', '-Profile'),
    },
    {
      name: 'Task 4 canonical workspace-boundary authority',
      path: 'packages/mcp/src/fs/workspace-policy.ts',
      mutate: contents =>
        contents.replace(
          'addObservedPath(canonicalPath, followed);',
          '// canonical boundary removed',
        ),
    },
    {
      name: 'Task 5 dynamic operation-policy authority',
      path: 'packages/mcp/src/policy/operation-policy.ts',
      mutate: contents =>
        contents.replace("effect.type === 'network'", "effect.type === 'offline'"),
    },
    {
      name: 'Task 5 persisted egress-config authority',
      path: 'packages/mcp/src/policy/policy-engine.ts',
      mutate: contents => contents.replace("'egress.v1.json'", "'implicit-egress.json'"),
    },
    {
      name: 'Task 5 fail-closed result-egress authority',
      path: 'packages/mcp/src/policy/result-egress-policy.ts',
      mutate: contents => contents.replace("'EGRESS_RESULT_INVALID'", "'EGRESS_MODE_UNKNOWN'"),
    },
    {
      name: 'Task 5 exact image-source schema authority',
      path: 'packages/mcp/src/tools/import-image.ts',
      mutate: contents =>
        contents.replace('requires exactly one', 'allows implicit precedence for'),
    },
    {
      name: 'Task 5 exact image-source plugin authority',
      path: 'packages/plugin/src/handlers/import-image.ts',
      mutate: contents => contents.replace('provide exactly one', 'prefer data over'),
    },
    {
      name: 'Task 5 normalized component-key schema authority',
      path: 'packages/mcp/src/tools/create-instance.ts',
      mutate: contents => contents.replace('.trim()', ''),
    },
    {
      name: 'Task 5 normalized component-key plugin authority',
      path: 'packages/plugin/src/handlers/swap-component.ts',
      mutate: contents => contents.replace("p.componentKey.trim() === ''", 'false'),
    },
    {
      name: 'Task 6 product identity authority',
      path: 'packages/shared/src/auth.ts',
      mutate: contents => contents.replace('super-figma-pipeline', 'foreign-local-service'),
    },
    {
      name: 'Task 6 unknown-role authority',
      path: 'packages/mcp/src/dispatch.ts',
      mutate: contents => contents.replace('ctx.node.role === NodeRole.Unknown', 'false'),
    },
    {
      name: 'Task 6 follower bearer authority',
      path: 'packages/mcp/src/security/follower-auth.ts',
      mutate: contents => contents.replace('^Bearer ', '^Optional '),
    },
    {
      name: 'Task 6 closed Origin authority',
      path: 'packages/mcp/src/security/local-access.ts',
      mutate: contents => contents.replace("'https://figma.com',", "'https://evil.example',"),
    },
    {
      name: 'Task 6 pairing HMAC authority',
      path: 'packages/mcp/src/security/pairing-manager.ts',
      mutate: contents => contents.replace("digest('pair-code', code)", 'code'),
    },
    {
      name: 'Task 6 request limit authority',
      path: 'packages/mcp/src/security/request-limits.ts',
      mutate: contents => contents.replace('16 * 1024', 'Number.MAX_SAFE_INTEGER'),
    },
    {
      name: 'Task 6 PNA response authority',
      path: 'packages/mcp/src/election/leader-endpoints.ts',
      mutate: contents =>
        contents.replace(
          "'access-control-allow-origin': origin",
          "'access-control-allow-origin': '*'",
        ),
    },
    {
      name: 'Task 6 WebSocket path authority',
      path: 'packages/mcp/src/relay/relay.ts',
      mutate: contents => contents.replace("path: '/ws'", "path: '/'"),
    },
    {
      name: 'Task 6 process auth wiring authority',
      path: 'packages/mcp/src/index.ts',
      mutate: contents =>
        contents.replace('relayAuthenticator: pairing', 'relayAuthenticator: undefined'),
    },
    {
      name: 'Task 6 atomic pairing revision authority',
      path: 'packages/mcp/src/security/pairing-manager.ts',
      mutate: contents =>
        contents.replace('await link(temporary, target)', 'await rename(temporary, target)'),
    },
    {
      name: 'Task 6 recoverable hello commit authority',
      path: 'packages/mcp/src/relay/relay.ts',
      mutate: contents =>
        contents.replace('commitHello?.(preparationId)', 'authenticateHello?.(parsed.data)'),
    },
    {
      name: 'Task 6 fresh follower identity authority',
      path: 'packages/mcp/src/election/follower.ts',
      mutate: contents => contents.replace('await this.verifyFreshLeader()', 'undefined'),
    },
    {
      name: 'Task 6 encrypted follower channel authority',
      path: 'packages/mcp/src/election/follower.ts',
      mutate: contents => contents.replace('body: sealed.body', 'body'),
    },
    {
      name: 'Task 6 one-use follower challenge authority',
      path: 'packages/mcp/src/security/follower-auth.ts',
      mutate: contents => contents.replace('followerChallenges.delete(nonce)', '// replay allowed'),
    },
    {
      name: 'Task 6 hello recovery binding authority',
      path: 'packages/mcp/src/security/pairing-manager.ts',
      mutate: contents => contents.replace("'hello-binding'", "'hello-unbound'"),
    },
    {
      name: 'Task 6 identity-aware session cleanup authority',
      path: 'packages/mcp/src/relay/session.ts',
      mutate: contents => contents.replace('if (current !== session) return;', ''),
    },
    {
      name: 'Task 6 zero pending-frame retention authority',
      path: 'packages/mcp/src/relay/relay.ts',
      mutate: contents =>
        contents.replace(
          "socket.close(1008, 'non-hello message while authentication is pending')",
          '// queued until authentication completes',
        ),
    },
    {
      name: 'Task 6 inline image cap authority',
      path: 'packages/mcp/src/tools/import-image.ts',
      mutate: contents => contents.replace('assertBase64Payload(args.data', 'void (args.data'),
    },
    {
      name: 'Task 6 native binary cap authority',
      path: 'packages/mcp/src/tools/binary-payload.ts',
      mutate: contents => contents.replace('carrier.bytes.byteLength', '0'),
    },
    {
      name: 'Task 6 pre-write video cap authority',
      path: 'packages/mcp/src/tools/export-video.ts',
      mutate: contents => contents.replace("code: 'EXPORT_TOO_LARGE'", "code: 'PAYLOAD_TOO_LARGE'"),
    },
    {
      name: 'Task 6 unread-body authority',
      path: 'packages/mcp/src/election/leader-endpoints.ts',
      mutate: contents => contents.replace('hasUnreadBody(req)', 'false'),
    },
    {
      name: 'pnpm lockfile bytes',
      path: 'pnpm-lock.yaml',
      mutate: contents => `${contents}# local mutation\n`,
    },
    {
      name: 'npm hygiene configuration',
      path: '.npmrc',
      mutate: () => 'engine-strict=false\n',
    },
  ];

  it.each(mutations)(
    'rejects a mutation to $name',
    async ({ path, mutate }) => {
      const fixture = await copyServiceFixture();
      const target = join(fixture.serviceRoot, ...path.split('/'));
      await writeFile(target, mutate(await readFile(target, 'utf8')), 'utf8');

      const result = runVerifier(fixture, '--offline');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[PROTECTED_AUTHORITY]');
      expect(result.stderr).toContain(path);
    },
    30_000,
  );
});
