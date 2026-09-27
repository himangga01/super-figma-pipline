// VER-8: packaging must not inherit the invoking user's git setup. A hostile configuration that
// signs commits through a prompting program, runs hooks, injects templates, ignore and attribute
// rules, or redirects git to another repository must leave the archives byte-identical and must
// never invoke the signing program or a hook. The hostile setup lives only in temporary files named
// through GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM and XDG_CONFIG_HOME; the real ~/.gitconfig is never
// touched.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hermeticGit, hermeticGitEnvironment } from '../scripts/hermetic-git.mjs';

const serviceRoot = resolve(import.meta.dirname, '..');
const artifacts = ['mcp.tgz', 'cli.tgz', 'plugin.zip', 'artifact-manifest.v1.json'];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const writeTree = async (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
};

const packagingFixture = async (root: string) => {
  const service = join(root, 'service');
  const workspacePackage = (name: string) =>
    `${JSON.stringify({
      name,
      version: '0.1.0',
      private: true,
      scripts: { build: 'tsdown' },
      devDependencies: { tsdown: '0.0.0' },
      dependencies: { '@sfp/ir': 'workspace:*', '@sfp/shared': 'workspace:*', zod: '4.0.0' },
    })}\n`;
  await writeTree(service, {
    LICENSE: 'MIT fixture\n',
    'THIRD_PARTY_NOTICES.md': '# Notices\n',
    'PROVENANCE.md': '# Provenance\n',
    'SBOM.spdx.json': '{}\n',
    'README.md': '# Fixture\n',
    'licenses/fixture.txt': 'license text\n',
    'capabilities/union-manifest.json': '{"canonicalTools":[]}\n',
    'capabilities/rust-tool-compat.json': '{}\n',
    'capabilities/figmosha-feature-map.json': '{}\n',
    'packages/mcp/package.json': workspacePackage('@sfp/mcp'),
    'packages/mcp/dist/daemon-entry.mjs': '#!/usr/bin/env node\nconsole.log("daemon");\n',
    'packages/mcp/dist/index.mjs': 'export const value = 1;\n',
    'packages/mcp/dist/index.mjs.map': '{}\n',
    'packages/cli/package.json': workspacePackage('@sfp/cli'),
    'packages/cli/dist/index.mjs': '#!/usr/bin/env node\nconsole.log("cli");\n',
    'packages/plugin/manifest.json': '{"name":"fixture"}\n',
    'packages/plugin/dist/code.js': 'figma.closePlugin();\n',
    'packages/plugin/dist/index.html': '<!doctype html><title>fixture</title>\n',
  });
  await mkdir(join(service, 'scripts'));
  for (const name of ['package-artifacts.mjs', 'release-common.mjs', 'hermetic-git.mjs'])
    await cp(join(serviceRoot, 'scripts', name), join(service, 'scripts', name));
  await symlink(
    join(serviceRoot, 'node_modules'),
    join(service, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return service;
};

const hostileGitSetup = async (root: string) => {
  const hostile = join(root, 'hostile');
  const marks = join(hostile, 'marks');
  const posix = (path: string) => path.replaceAll('\\', '/');
  // Each program records that it ran and fails, so an invocation shows up as a mark or an error.
  const marker = (name: string) => `#!/bin/sh\necho ran >> "${posix(join(marks, name))}"\nexit 1\n`;
  const programs: Record<string, string> = {
    'hooks/pre-commit': marker('pre-commit'),
    'hooks/commit-msg': marker('commit-msg'),
    'hooks/post-commit': marker('post-commit'),
    'hooks/reference-transaction': marker('reference-transaction'),
    'template/hooks/commit-msg': marker('template-commit-msg'),
    'template/hooks/post-commit': marker('template-post-commit'),
    'bin/sign': marker('sign'),
    'bin/compress': marker('compress'),
  };
  await writeTree(hostile, {
    ...programs,
    'xdg/git/ignore': '*.md\n',
    'xdg/git/attributes': '* text eol=crlf\n*.json export-ignore\n',
    gitconfig: [
      '[commit]',
      '\tgpgsign = true',
      '[gpg]',
      `\tprogram = ${posix(join(hostile, 'bin/sign'))}`,
      '[core]',
      `\thooksPath = ${posix(join(hostile, 'hooks'))}`,
      '\tautocrlf = true',
      '[init]',
      `\ttemplateDir = ${posix(join(hostile, 'template'))}`,
      '[tar "tar.gz"]',
      `\tcommand = ${posix(join(hostile, 'bin/compress'))}`,
      '',
    ].join('\n'),
    'decoy/tracked.txt': 'decoy\n',
  });
  await mkdir(marks);
  for (const path of Object.keys(programs)) await chmod(join(hostile, path), 0o755);
  const decoy = join(hostile, 'decoy');
  hermeticGit(decoy, ['init', '--quiet']);
  hermeticGit(decoy, ['add', 'tracked.txt']);
  hermeticGit(decoy, ['commit', '--quiet', '-m', 'decoy'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Decoy',
      GIT_AUTHOR_EMAIL: 'decoy@localhost',
      GIT_COMMITTER_NAME: 'Decoy',
      GIT_COMMITTER_EMAIL: 'decoy@localhost',
    },
  });
  const decoyState = async () => ({
    head: hermeticGit(decoy, ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
    index: await readFile(join(decoy, '.git', 'index')),
    config: await readFile(join(decoy, '.git', 'config'), 'utf8'),
  });
  const config = join(hostile, 'gitconfig');
  return {
    marks,
    decoyState,
    environment: {
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_SYSTEM: config,
      XDG_CONFIG_HOME: join(hostile, 'xdg'),
      GIT_TEMPLATE_DIR: join(hostile, 'template'),
      GIT_ATTR_SOURCE: 'HEAD',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgSign',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_DIR: join(decoy, '.git'),
      GIT_WORK_TREE: decoy,
      GIT_INDEX_FILE: join(decoy, '.git', 'index'),
    },
  };
};

const packageArtifacts = async (service: string, environment: NodeJS.ProcessEnv) => {
  await rm(join(service, 'artifacts'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [join(service, 'scripts', 'package-artifacts.mjs')], {
    cwd: service,
    encoding: 'utf8',
    env: { ...environment, SOURCE_DATE_EPOCH: '1700000000' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    windowsHide: true,
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  const digests = Object.fromEntries(
    await Promise.all(
      artifacts.map(async name => {
        const bytes = await readFile(join(service, 'artifacts', name));
        return [
          name,
          { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
        ] as const;
      }),
    ),
  );
  const manifest: unknown = JSON.parse(
    await readFile(join(service, 'artifacts', 'artifact-manifest.v1.json'), 'utf8'),
  );
  return { digests, manifest };
};

describe('hermetic packaging git', () => {
  it('drops redirecting and configuring variables whatever their case', () => {
    const environment = hermeticGitEnvironment({
      PATH: 'kept',
      Git_Dir: 'outer/.git',
      git_work_tree: 'outer',
      GIT_INDEX_FILE: 'outer/.git/index',
      GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true'",
      GIT_CONFIG_KEY_3: 'core.hooksPath',
      GIT_CONFIG_VALUE_3: 'hooks',
      Git_Config_Global: 'hostile',
      GIT_TEMPLATE_DIR: 'template',
    });
    expect(Object.keys(environment).toSorted()).toEqual([
      'GIT_ATTR_NOSYSTEM',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_TERMINAL_PROMPT',
      'PATH',
      'XDG_CONFIG_HOME',
    ]);
    expect(environment).toMatchObject({
      PATH: 'kept',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('keeps archives byte-identical and prompts nothing under a hostile git configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-package-hermetic-'));
    roots.push(root);
    const service = await packagingFixture(root);
    const hostile = await hostileGitSetup(root);

    const reference = await packageArtifacts(service, hermeticGitEnvironment());
    const decoyBefore = await hostile.decoyState();
    const underHostileGit = await packageArtifacts(service, {
      ...process.env,
      ...hostile.environment,
    });

    expect(await readdir(hostile.marks)).toEqual([]);
    expect(await hostile.decoyState()).toEqual(decoyBefore);
    expect(underHostileGit.digests).toEqual(reference.digests);
    expect(reference.manifest).toMatchObject({
      created: '2023-11-14T22:13:20.000Z',
      archives: [
        {
          name: 'mcp.tgz',
          files: expect.arrayContaining([expect.objectContaining({ path: 'README.md' })]),
        },
        { name: 'cli.tgz' },
        { name: 'plugin.zip' },
      ],
    });
  }, 120_000);
});
