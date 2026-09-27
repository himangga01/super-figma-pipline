import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveNpmEntry, resolvePnpmEntry } from '../scripts/package-manager-entry.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const write = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** A fake Node.js installation in the Windows (`node_modules` beside node) or POSIX (`lib/`) layout. */
const nodeInstallation = async (layout: 'windows' | 'posix') => {
  const root = await mkdtemp(join(tmpdir(), `sfp-node-${layout}-`));
  roots.push(root);
  const execPath = layout === 'windows' ? join(root, 'node.exe') : join(root, 'bin', 'node');
  const packages =
    layout === 'windows' ? join(root, 'node_modules') : join(root, 'lib', 'node_modules');
  await write(execPath, '');
  await write(
    join(packages, 'corepack', 'package.json'),
    JSON.stringify({
      name: 'corepack',
      exports: { './package.json': './package.json' },
      bin: { pnpm: './dist/pnpm.js' },
    }),
  );
  await write(join(packages, 'corepack', 'dist', 'pnpm.js'), '');
  await write(
    join(packages, 'npm', 'package.json'),
    JSON.stringify({
      name: 'npm',
      exports: { '.': './index.js', './package.json': './package.json' },
      bin: { npm: 'bin/npm-cli.js' },
    }),
  );
  await write(join(packages, 'npm', 'bin', 'npm-cli.js'), '');
  return { root, execPath, packages };
};

describe('package manager entry resolution', () => {
  it.for(['windows', 'posix'] as const)(
    'finds the pnpm shim and npm CLI bundled with a %s Node.js layout',
    async layout => {
      const node = await nodeInstallation(layout);
      expect(resolvePnpmEntry({ env: {}, execPath: node.execPath })).toBe(
        join(node.packages, 'corepack', 'dist', 'pnpm.js'),
      );
      expect(resolveNpmEntry({ env: {}, execPath: node.execPath })).toBe(
        join(node.packages, 'npm', 'bin', 'npm-cli.js'),
      );
    },
  );

  it('prefers npm_execpath only when it names the requested package manager', async () => {
    const node = await nodeInstallation('posix');
    const pnpm = join(node.root, 'custom', 'pnpm.cjs');
    const npm = join(node.root, 'custom', 'npm-cli.js');
    await write(pnpm, '');
    await write(npm, '');
    expect(resolvePnpmEntry({ env: { npm_execpath: pnpm }, execPath: node.execPath })).toBe(pnpm);
    expect(resolveNpmEntry({ env: { npm_execpath: npm }, execPath: node.execPath })).toBe(npm);
    expect(resolveNpmEntry({ env: { npm_execpath: pnpm }, execPath: node.execPath })).toBe(
      join(node.packages, 'npm', 'bin', 'npm-cli.js'),
    );
    expect(resolvePnpmEntry({ env: { npm_execpath: npm }, execPath: node.execPath })).toBe(
      join(node.packages, 'corepack', 'dist', 'pnpm.js'),
    );
  });

  it('fails with an actionable error when no entry exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-node-empty-'));
    roots.push(root);
    const execPath = join(root, 'bin', 'node');
    expect(() => resolvePnpmEntry({ env: {}, execPath })).toThrow(
      /PNPM_ENTRY_NOT_FOUND.*corepack/su,
    );
    expect(() => resolveNpmEntry({ env: {}, execPath })).toThrow(
      /NPM_ENTRY_NOT_FOUND.*npm_execpath/su,
    );
  });

  it('resolves the real entries of the running Node.js', () => {
    expect(resolvePnpmEntry({ env: {} })).toMatch(/pnpm\.js$/u);
    expect(resolveNpmEntry({ env: {} })).toMatch(/npm-cli\.js$/u);
  });
});
