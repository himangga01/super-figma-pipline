/* eslint-disable no-await-in-loop -- each archive is verified independently */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artifactRoot, filesUnder, sha256 } from './release-common.mjs';
const manifest = JSON.parse(
  await readFile(join(artifactRoot, 'artifact-manifest.v1.json'), 'utf8'),
);
const sums = (await readFile(join(artifactRoot, 'SHA256SUMS'), 'utf8')).trim().split('\n');
const expectedNames = ['artifact-manifest.v1.json', 'cli.tgz', 'mcp.tgz', 'plugin.zip'];
if (JSON.stringify(sums.map(row => row.slice(66))) !== JSON.stringify(expectedNames))
  throw new Error('CHECKSUM_FILE_SET_INVALID');
for (const row of sums)
  if (sha256(await readFile(join(artifactRoot, row.slice(66)))) !== row.slice(0, 64))
    throw new Error('ARTIFACT_CHECKSUM_MISMATCH');
if (
  JSON.stringify(manifest.archives.map(item => item.name).toSorted()) !==
  JSON.stringify(expectedNames.slice(1))
)
  throw new Error('ARCHIVE_SET_INVALID');
const temp = await mkdtemp(join(tmpdir(), 'sfp-verify-artifacts-'));
for (const archive of manifest.archives) {
  const path = join(artifactRoot, archive.name);
  const data = await readFile(path);
  if (sha256(data) !== archive.sha256 || data.length !== archive.bytes)
    throw new Error('ARCHIVE_MANIFEST_MISMATCH');
  const useUnzip = archive.name.endsWith('.zip') && process.platform !== 'win32';
  const listing = execFileSync(
    useUnzip ? 'unzip' : 'tar',
    useUnzip ? ['-Z1', path] : ['-tf', path],
    { encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split(/\r?\n/u);
  for (const item of listing)
    if (
      item.startsWith('/') ||
      item.includes('\\') ||
      item.includes(':') ||
      item.split('/').includes('..')
    )
      throw new Error('ARCHIVE_PATH_INVALID');
  const destination = join(temp, archive.name);
  await mkdir(destination);
  execFileSync(
    useUnzip ? 'unzip' : 'tar',
    useUnzip ? ['-q', path, '-d', destination] : ['-xf', path, '-C', destination],
    { windowsHide: true },
  );
  const unpacked = archive.name.endsWith('.tgz') ? join(destination, 'package') : destination;
  const files = await filesUnder(unpacked);
  if (
    JSON.stringify(files.toSorted()) !==
    JSON.stringify(archive.files.map(item => item.path).toSorted())
  )
    throw new Error('ARCHIVE_CONTENT_SET_MISMATCH');
  for (const item of archive.files) {
    if (/(?:^|\/)(?:src|test|node_modules|code-kb|\.env)(?:\/|$)|\.map$/u.test(item.path))
      throw new Error('ARCHIVE_FORBIDDEN_CONTENT');
    const bytes = await readFile(join(unpacked, item.path));
    if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes)
      throw new Error('ARCHIVE_FILE_MISMATCH');
  }
  for (const required of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'PROVENANCE.md',
    'SBOM.spdx.json',
    'capabilities/union-manifest.json',
    'capabilities/rust-tool-compat.json',
    'capabilities/figmosha-feature-map.json',
  ])
    if (!files.includes(required)) throw new Error(`ARCHIVE_REQUIRED_FILE:${required}`);
  if (archive.name === 'plugin.zip') {
    const plugin = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
    if (!files.includes(plugin.main) || !files.includes(plugin.ui))
      throw new Error('PLUGIN_ENTRY_MISSING');
  }
}
process.stdout.write(
  `Verified ${manifest.archives.length} archives, all file hashes and checksums\n`,
);
