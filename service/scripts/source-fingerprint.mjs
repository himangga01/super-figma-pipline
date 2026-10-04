/* eslint-disable no-await-in-loop -- source byte hashing preserves deterministic path order */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const sourceFingerprint = async serviceRoot => {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'service'],
    { cwd: dirname(serviceRoot), windowsHide: true, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  hash.update('source-fingerprint-v2\0');
  for (const name of [...new Set(names)].toSorted()) {
    try {
      const bytes = await readFile(join(dirname(serviceRoot), name));
      hash
        .update(name)
        .update('\0present\0')
        .update(createHash('sha256').update(bytes).digest())
        .update('\0');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') throw error;
      hash.update(name).update('\0missing\0');
    }
  }
  return `sha256:${hash.digest('hex')}`;
};
