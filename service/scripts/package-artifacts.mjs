/* eslint-disable no-await-in-loop -- ordered deterministic staging and archives */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  root,
  artifactRoot,
  ensureArtifacts,
  epoch,
  isoTime,
  filesUnder,
  sha256,
  publish,
} from './release-common.mjs';
await ensureArtifacts();
const staging = await mkdtemp(join(artifactRoot, '.staging-'));
const common = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PROVENANCE.md', 'SBOM.spdx.json', 'licenses'];
const manifest = { schemaVersion: 1, created: isoTime, archives: [] };
for (const kind of ['mcp', 'cli', 'plugin']) {
  const stage = join(staging, kind),
    source = join(root, 'packages', kind);
  await mkdir(stage);
  for (const name of common) await cp(join(root, name), join(stage, name), { recursive: true });
  await mkdir(join(stage, 'capabilities'));
  for (const name of ['union-manifest.json', 'rust-tool-compat.json', 'figmosha-feature-map.json'])
    await cp(join(root, 'capabilities', name), join(stage, 'capabilities', name));
  await cp(join(source, 'dist'), join(stage, 'dist'), {
    recursive: true,
    filter: name => !name.endsWith('.map'),
  });
  await cp(join(root, 'README.md'), join(stage, 'README.md'));
  if (kind === 'plugin') await cp(join(source, 'manifest.json'), join(stage, 'manifest.json'));
  else {
    const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    delete metadata.private;
    delete metadata.devDependencies;
    delete metadata.scripts;
    delete metadata.dependencies['@sfp/shared'];
    delete metadata.dependencies['@sfp/ir'];
    if (kind === 'cli') metadata.dependencies['@sfp/mcp'] = metadata.version;
    await writeFile(join(stage, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    if (kind === 'mcp') {
      await mkdir(join(stage, 'dist/plugin/dist'), { recursive: true });
      for (const name of ['manifest.json', 'dist/code.js', 'dist/index.html'])
        await cp(join(root, 'packages/plugin', name), join(stage, 'dist/plugin', name));
    }
  }
  const rows = [];
  for (const path of await filesUnder(stage)) {
    const bytes = await readFile(join(stage, path));
    rows.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const git = args =>
    execFileSync('git', ['-C', stage, ...args], {
      windowsHide: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'SFP',
        GIT_AUTHOR_EMAIL: 'release@localhost',
        GIT_COMMITTER_NAME: 'SFP',
        GIT_COMMITTER_EMAIL: 'release@localhost',
        GIT_AUTHOR_DATE: `${epoch} +0000`,
        GIT_COMMITTER_DATE: `${epoch} +0000`,
      },
    });
  git(['init', '--quiet']);
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '-A']);
  if (kind !== 'plugin')
    git([
      'update-index',
      '--chmod=+x',
      kind === 'mcp' ? 'dist/daemon-entry.mjs' : 'dist/index.mjs',
    ]);
  git(['commit', '--quiet', '-m', 'artifact']);
  const name = kind === 'plugin' ? 'plugin.zip' : `${kind}.tgz`;
  const bytes = git([
    'archive',
    `--format=${kind === 'plugin' ? 'zip' : 'tar.gz'}`,
    ...(kind === 'plugin' ? [] : ['--prefix=package/']),
    'HEAD',
  ]);
  await publish(join(artifactRoot, name), bytes);
  manifest.archives.push({ name, sha256: sha256(bytes), bytes: bytes.length, files: rows });
}
await publish(
  join(artifactRoot, 'artifact-manifest.v1.json'),
  Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
);
process.stdout.write('Packaged MCP, CLI and Figma plugin\n');
