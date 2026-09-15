/* eslint-disable no-await-in-loop -- deterministic archive and provenance order */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';

import { format } from 'oxfmt';

export const root = resolve(import.meta.dirname, '..');
export const artifactRoot = join(root, 'artifacts');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const epoch = Number(
  process.env.SOURCE_DATE_EPOCH ??
    execFileSync('git', ['log', '-1', '--format=%ct'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
);
export const isoTime = new Date(epoch * 1000).toISOString();
export const filesUnder = async folder => {
  const result = [];
  const visit = async path => {
    for (const item of (await readdir(path, { withFileTypes: true })).toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (item.name === '.git') continue;
      const nested = join(path, item.name);
      if (item.isSymbolicLink()) throw new Error(`RELEASE_SYMLINK:${nested}`);
      if (item.isDirectory()) await visit(nested);
      else if (item.isFile()) result.push(relative(folder, nested).replaceAll('\\', '/'));
    }
  };
  await visit(folder);
  return result;
};
export const publish = async (path, bytes) => {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  if (sha256(await readFile(temporary)) !== sha256(bytes))
    throw new Error('RELEASE_WRITE_MISMATCH');
  await rename(temporary, path);
};
export const installedPackages = async () => {
  const list = JSON.parse(
    execFileSync(
      process.execPath,
      [
        process.env.npm_execpath ??
          join(dirname(process.execPath), 'node_modules/corepack/dist/pnpm.js'),
        'list',
        '-r',
        '--prod',
        '--depth',
        'Infinity',
        '--json',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 32_000_000, windowsHide: true },
    ),
  );
  const packages = new Map();
  const visit = async (item, optional = false) => {
    let metadata;
    if (item.path) {
      try {
        metadata = JSON.parse(await readFile(join(item.path, 'package.json'), 'utf8'));
      } catch (error) {
        if (optional && error.code === 'ENOENT') return;
        throw error;
      }
      const meta = metadata;
      const key = `${meta.name}@${meta.version}`;
      if (!packages.has(key))
        packages.set(key, {
          name: meta.name,
          version: meta.version,
          license: meta.license ?? 'NOASSERTION',
          path: item.path,
          resolved: item.resolved ?? 'NOASSERTION',
        });
    }
    for (const [name, child] of Object.entries(item.dependencies ?? {}))
      await visit(child, Object.hasOwn(metadata?.optionalDependencies ?? {}, name));
    for (const child of Object.values(item.optionalDependencies ?? {})) await visit(child, true);
  };
  for (const item of list) await visit(item);
  return [...packages.values()].toSorted((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
  );
};
export const ensureArtifacts = () => mkdir(artifactRoot, { recursive: true });
export const publishDocument = async (name, text) => {
  const result = await format(join(root, name), text, {
    printWidth: 100,
    tabWidth: 2,
    endOfLine: 'lf',
    insertFinalNewline: true,
  });
  if (result.errors.length > 0) throw new Error(`DOCUMENT_FORMAT_FAILED:${name}`);
  await publish(join(root, name), Buffer.from(result.code));
};
